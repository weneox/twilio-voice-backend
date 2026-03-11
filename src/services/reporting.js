// src/services/reporting.js
// Telegram + Google Sheets (GAS) + n8n + dedup + optional OpenAI lead extraction

function safeJsonParse(s) {
  try {
    if (typeof s !== "string") return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function postJson(fetchFn, url, payload, extraHeaders = {}) {
  if (!url) return { ok: false, status: 0, text: "missing_url" };
  try {
    const json = JSON.stringify(payload || {});
    const resp = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
      body: Buffer.from(json, "utf8"),
    });
    const text = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, text: text.slice(0, 900) };
  } catch (e) {
    return { ok: false, status: 0, text: String(e?.message || e).slice(0, 900) };
  }
}

async function postJsonWithTimeout(fetchFn, url, payload, extraHeaders = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const json = JSON.stringify(payload || {});
    const resp = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
      body: Buffer.from(json, "utf8"),
      signal: controller.signal,
    });
    const text = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, text: text.slice(0, 900) };
  } catch (e) {
    return { ok: false, status: 0, text: String(e?.message || e).slice(0, 900) };
  } finally {
    clearTimeout(t);
  }
}

/** Redis/local dedup */
const LOCAL_DEDUP = new Map();
function localDedupKeySet(key, ttlSec) {
  const now = Date.now();
  for (const [k, exp] of LOCAL_DEDUP.entries()) {
    if (exp <= now) LOCAL_DEDUP.delete(k);
  }
  if (LOCAL_DEDUP.has(key)) return false;
  LOCAL_DEDUP.set(key, now + ttlSec * 1000);
  return true;
}

async function dedupOnce(redis, key, ttlSec = 86400) {
  if (!key) return true;
  try {
    if (redis) {
      const r = await redis.set(key, "1", "EX", ttlSec, "NX");
      return r === "OK";
    }
  } catch (e) {
    console.log("[dedup] redis set failed", e?.message || e);
  }
  return localDedupKeySet(key, ttlSec);
}

/** Lead extraction helpers */
function shouldExtractLead({ enabled, OPENAI_API_KEY, leadFlag, askedContact, askedOperator, transcriptLog, minTranscripts }) {
  if (!enabled) return false;
  if (!OPENAI_API_KEY) return false;
  if (!Array.isArray(transcriptLog) || transcriptLog.length < (minTranscripts || 2)) return false;
  return leadFlag || askedContact || askedOperator;
}

async function extractLeadFromTranscripts({ fetchFn, OPENAI_API_KEY, OPENAI_MODEL, transcriptLog, fromNumber, lastLang }) {
  const joined = transcriptLog
    .slice(-12)
    .map((x) => `- ${String(x.text || "").slice(0, 240)}`)
    .join("\n");

  const sys = [
    "You extract sales lead info from short call transcripts for NEOX company.",
    "Return ONLY strict JSON (no markdown).",
    "If a field is unknown, return null (not empty string).",
    "Never invent phone/email.",
    "JSON schema:",
    "{",
    '  "service": {"primary": "website|chatbot|voice_agent|automation|other", "details": string|null},',
    '  "contact": {"name": string|null, "company": string|null, "role": string|null, "phone": string|null, "email": string|null},',
    '  "business": {"domain": string|null},',
    '  "meeting": {"scheduled": boolean, "datetime": string|null, "channel": "call|whatsapp|zoom|google_meet|office|other"|null},',
    '  "notes": string|null,',
    '  "leadScore": number|null',
    "}",
  ].join("\n");

  const user = [
    `Caller: ${fromNumber || "-"}`,
    `Language: ${lastLang || "-"}`,
    "Transcripts:",
    joined,
    "Extract lead JSON now.",
  ].join("\n");

  const model = (OPENAI_MODEL || "gpt-4.1-mini").trim();

  try {
    const resp = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json; charset=utf-8" },
      body: Buffer.from(
        JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          max_tokens: 350,
        }),
        "utf8"
      ),
    });

    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`openai_extract_failed ${resp.status} ${txt.slice(0, 300)}`);

    const outer = safeJsonParse(txt);
    const content = outer?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;

    const parsed = safeJsonParse(content.trim());
    if (parsed && typeof parsed === "object") return parsed;

    const m = content.match(/\{[\s\S]*\}$/);
    if (m) {
      const raw = safeJsonParse(m[0]);
      if (raw) return raw;
    }

    return null;
  } catch (e) {
    console.log("[lead] extract error", e?.message || e);
    return null;
  }
}

function normalizeExtractedLead(raw) {
  if (!raw || typeof raw !== "object") return null;

  const servicePrimary = raw?.service?.primary || null;
  const serviceDetails = raw?.service?.details || null;

  const contact = raw?.contact || {};
  const business = raw?.business || {};
  const meeting = raw?.meeting || {};

  const lead = {
    service: {
      primary: typeof servicePrimary === "string" ? servicePrimary : null,
      details: typeof serviceDetails === "string" ? serviceDetails : null,
    },
    contact: {
      name: typeof contact.name === "string" ? contact.name : null,
      company: typeof contact.company === "string" ? contact.company : null,
      role: typeof contact.role === "string" ? contact.role : null,
      phone: typeof contact.phone === "string" ? contact.phone : null,
      email: typeof contact.email === "string" ? contact.email : null,
    },
    business: {
      domain: typeof business.domain === "string" ? business.domain : null,
    },
    meeting: {
      scheduled: !!meeting.scheduled,
      datetime: typeof meeting.datetime === "string" ? meeting.datetime : null,
      channel: typeof meeting.channel === "string" ? meeting.channel : null,
    },
    notes: typeof raw.notes === "string" ? raw.notes : null,
    leadScore: Number.isFinite(Number(raw.leadScore)) ? Number(raw.leadScore) : null,
  };

  const hasAny =
    lead.service.primary ||
    lead.service.details ||
    lead.contact.name ||
    lead.contact.company ||
    lead.contact.role ||
    lead.contact.phone ||
    lead.contact.email ||
    lead.business.domain ||
    lead.notes ||
    lead.leadScore !== null ||
    (lead.meeting.scheduled && (lead.meeting.datetime || lead.meeting.channel));

  return hasAny ? lead : null;
}

/** Telegram / Sheets / n8n payload formatting */
function buildN8nEventPayload({
  status,
  callSid,
  fromNumber,
  durationSec,
  lastLang,
  metricResponses,
  metricCancels,
  extractedLead,
  transcriptLog,
  confirmedContact,
}) {
  return {
    event: "neox.lead",
    status,
    createdAt: new Date().toISOString(),
    callSid: callSid || "",
    from: fromNumber || "",
    durationSec: Number(durationSec || 0),
    lang: lastLang || "az",
    metrics: {
      responses: Number(metricResponses || 0),
      cancels: Number(metricCancels || 0),
    },
    confirmedContact: confirmedContact || null,
    lead: extractedLead || null,
    transcripts: Array.isArray(transcriptLog)
      ? transcriptLog.slice(-10).map((x) => ({ ts: x.ts, text: String(x.text || "").slice(0, 400) }))
      : [],
  };
}

function buildSheetsPayload({ extractedLead, callSid, fromNumber, durationSec, lastLang, status, confirmedContact }) {
  const mergedContact = { ...(extractedLead?.contact || {}), ...(confirmedContact || {}) };
  return {
    status: status || "completed",
    callSid: callSid || "",
    from: fromNumber || "",
    durationSec: durationSec || 0,
    lang: lastLang || "az",
    service: extractedLead?.service || undefined,
    contact: mergedContact || undefined,
    business: extractedLead?.business || undefined,
    meeting: extractedLead?.meeting || undefined,
    notes: extractedLead?.notes || undefined,
    leadScore: extractedLead?.leadScore ?? undefined,
  };
}

function buildTelegramTextSalesReady({ status, callSid, fromNumber, dur, lastLang, metricResponses, metricCancels, extractedLead, transcriptLog, confirmedContact }) {
  const lines = [];
  const score = extractedLead?.leadScore;
  const scoreText = Number.isFinite(Number(score)) ? ` (score ${Number(score)})` : "";
  const head = status === "in_progress" ? `🟡 Yeni lead (in progress)${scoreText}` : `🟢 Lead tamamlandı${scoreText}`;

  lines.push(head);
  if (callSid) lines.push(`callSid: ${callSid}`);
  if (fromNumber) lines.push(`from: ${fromNumber}`);
  if (lastLang) lines.push(`lang: ${lastLang}`);
  if (typeof dur === "number") lines.push(`duration: ${dur}s`);
  lines.push(`responses: ${metricResponses} | cancels: ${metricCancels}`);

  if (extractedLead?.service?.primary) lines.push(`service: ${extractedLead.service.primary}`);
  if (extractedLead?.service?.details) lines.push(`details: ${extractedLead.service.details}`);

  const c = { ...(extractedLead?.contact || {}), ...(confirmedContact || {}) };
  if (c.name) lines.push(`name: ${c.name}`);
  if (c.company) lines.push(`company: ${c.company}`);
  if (c.role) lines.push(`role: ${c.role}`);
  if (c.phone) lines.push(`phone: ${c.phone}`);
  if (c.email) lines.push(`email: ${c.email}`);

  const b = extractedLead?.business || {};
  if (b.domain) lines.push(`business: ${b.domain}`);

  const m = extractedLead?.meeting;
  if (m && (m.scheduled || m.datetime || m.channel)) {
    lines.push(`meeting: ${m.scheduled ? "YES" : "no"}`);
    if (m.datetime) lines.push(`meetingTime: ${m.datetime}`);
    if (m.channel) lines.push(`meetingChannel: ${m.channel}`);
  }

  if (extractedLead?.notes) {
    lines.push("");
    lines.push("notes:");
    lines.push(String(extractedLead.notes).slice(0, 700));
  }

  if (Array.isArray(transcriptLog) && transcriptLog.length) {
    lines.push("");
    lines.push("last transcripts:");
    for (const it of transcriptLog.slice(-6)) lines.push(`- ${String(it.text || "").slice(0, 220)}`);
  }

  return lines.join("\n").slice(0, 3800);
}

export function createReporters({ fetchFn, redis, PUBLIC_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL }) {
  const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();

  async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
    try {
      const resp = await fetchFn(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: Buffer.from(
          JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: String(text || "").slice(0, 3900), disable_web_page_preview: true }),
          "utf8"
        ),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  const GOOGLE_SHEETS_WEBHOOK_URL =
    String(process.env.GOOGLE_SHEETS_WEBHOOK_URL || "").trim() ||
    "https://script.google.com/macros/s/AKfycbwlxFqmaFtqXE2v-VXtvtqRM-hzK895xKzZXEuWvTJaHVHn9xRz35eaHxxL751FfO3Kww/exec";
  const GOOGLE_SHEETS_WEBHOOK_TOKEN = String(process.env.GOOGLE_SHEETS_WEBHOOK_TOKEN || "").trim();

  async function sendToGoogleSheets(payload) {
    if (!GOOGLE_SHEETS_WEBHOOK_URL) return false;
    const body = GOOGLE_SHEETS_WEBHOOK_TOKEN ? { token: GOOGLE_SHEETS_WEBHOOK_TOKEN, ...(payload || {}) } : payload || {};
    const r = await postJson(fetchFn, GOOGLE_SHEETS_WEBHOOK_URL, body, {});
    if (!r.ok) console.log("[sheets] webhook failed", r.status, r.text);
    return r.ok;
  }

  const N8N_WEBHOOK_URL = String(process.env.N8N_WEBHOOK_URL || "").trim();
  const N8N_WEBHOOK_TOKEN = String(process.env.N8N_WEBHOOK_TOKEN || "").trim();
  const N8N_TIMEOUT_MS = Math.max(2500, Number(process.env.N8N_TIMEOUT_MS || "6500") || 6500);
  const N8N_RETRIES = Math.max(0, Number(process.env.N8N_RETRIES || "2") || 2);
  const N8N_RETRY_BACKOFF_MS = Math.max(250, Number(process.env.N8N_RETRY_BACKOFF_MS || "650") || 650);

  async function sendToN8n(payload) {
    if (!N8N_WEBHOOK_URL) return false;
    const headers = {};
    if (N8N_WEBHOOK_TOKEN) headers["X-Webhook-Token"] = N8N_WEBHOOK_TOKEN;

    for (let attempt = 0; attempt <= N8N_RETRIES; attempt++) {
      const r = await postJsonWithTimeout(fetchFn, N8N_WEBHOOK_URL, payload, headers, N8N_TIMEOUT_MS);
      if (r.ok) return true;

      if (attempt < N8N_RETRIES) {
        const wait = N8N_RETRY_BACKOFF_MS * (attempt + 1);
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }

      console.log("[n8n] webhook failed", r.status, r.text);
      return false;
    }
    return false;
  }

  const LEAD_EXTRACT_ON_CALL_END = String(process.env.LEAD_EXTRACT_ON_CALL_END || "0") === "1";
  const LEAD_EXTRACT_MIN_TRANSCRIPTS = Math.max(1, Number(process.env.LEAD_EXTRACT_MIN_TRANSCRIPTS || "2") || 2);

  const flags = {
    telegram: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
    sheets: !!GOOGLE_SHEETS_WEBHOOK_URL,
    n8n: !!N8N_WEBHOOK_URL,
    leadExtract: !!LEAD_EXTRACT_ON_CALL_END,
  };

  async function sendReports(ctx, { status }) {
    const { callSid } = ctx;
    if (!callSid) return;

    if (status === "in_progress") {
      const ok = await dedupOnce(redis, `lead:pre:${callSid}`, 86400);
      if (!ok || ctx._reportedPre) return;
      ctx._reportedPre = true;
    } else {
      const ok = await dedupOnce(redis, `lead:final:${callSid}`, 86400);
      if (!ok || ctx._reportedFinal) return;
      ctx._reportedFinal = true;
    }

    let extractedLead = null;

    const canExtractFinal =
      status !== "in_progress" &&
      shouldExtractLead({
        enabled: LEAD_EXTRACT_ON_CALL_END,
        OPENAI_API_KEY,
        leadFlag: ctx.leadFlag,
        askedContact: ctx.askedContact,
        askedOperator: ctx.askedOperator,
        transcriptLog: ctx.transcriptLog,
        minTranscripts: LEAD_EXTRACT_MIN_TRANSCRIPTS,
      });

    if (canExtractFinal) {
      const raw = await extractLeadFromTranscripts({
        fetchFn,
        OPENAI_API_KEY,
        OPENAI_MODEL,
        transcriptLog: ctx.transcriptLog,
        fromNumber: ctx.fromNumber,
        lastLang: ctx.lastLang,
      });
      extractedLead = normalizeExtractedLead(raw);
    }

    if (N8N_WEBHOOK_URL) {
      const payload = buildN8nEventPayload({
        status,
        callSid: ctx.callSid,
        fromNumber: ctx.fromNumber,
        durationSec: ctx.durationSec(),
        lastLang: ctx.lastLang,
        metricResponses: ctx.metricResponses,
        metricCancels: ctx.metricCancels,
        extractedLead,
        transcriptLog: ctx.transcriptLog,
        confirmedContact: ctx.confirmedContact,
      });
      sendToN8n(payload).catch(() => {});
    }

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      const tgText = buildTelegramTextSalesReady({
        status,
        callSid: ctx.callSid,
        fromNumber: ctx.fromNumber,
        dur: ctx.durationSec(),
        lastLang: ctx.lastLang,
        metricResponses: ctx.metricResponses,
        metricCancels: ctx.metricCancels,
        extractedLead,
        transcriptLog: ctx.transcriptLog,
        confirmedContact: ctx.confirmedContact,
      });
      await sendTelegramMessage(tgText);
    }

    if (GOOGLE_SHEETS_WEBHOOK_URL) {
      const payload = buildSheetsPayload({
        extractedLead,
        callSid: ctx.callSid,
        fromNumber: ctx.fromNumber,
        durationSec: ctx.durationSec(),
        lastLang: ctx.lastLang,
        status,
        confirmedContact: ctx.confirmedContact,
      });
      await sendToGoogleSheets(payload);
    }
  }

  return { sendReports, flags };
}