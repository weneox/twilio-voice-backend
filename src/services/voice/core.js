import {
  detectLang,
  looksLikeContactRequest,
  looksLikeHumanRequest,
  looksLikeHardGoodbye,
  looksLikeThanksOnly,
  looksLikeYes,
  looksLikeNo,
  looksClearlyOffTopic,
  isMeaningfulTranscript,
  looksLikePricing,
  looksLikeLeadIntent,
  callerLikelyAZ,
} from "./intents.js";

import {
  getGreeting,
  misheardReply,
  offTopicReply,
  goodbyeReplyFormalHangup,
  thanksContinueReply,
  askUserContact,
  askYesNo,
  connectOperatorAck,
  askTellQuestion,
  buildContactReply,
} from "./i18n.js";

import {
  extractPhoneDigits,
  normalizeAzPhone,
  summarizeLeadAz,
  buildLeadFieldsAz,
} from "./lead.js";

function s(v, d = "") {
  return String(v ?? d).trim();
}

function detectDefaultLang(tenantConfig = null) {
  return s(
    tenantConfig?.voiceProfile?.defaultLanguage || tenantConfig?.defaultLanguage,
    "en"
  ).toLowerCase();
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function getOperatorRouting(tenantConfig = null) {
  const routing = isObj(tenantConfig?.operatorRouting) ? tenantConfig.operatorRouting : {};
  const departments = isObj(routing.departments) ? routing.departments : {};

  return {
    mode: s(
      routing.mode ||
        tenantConfig?.voiceProfile?.transferMode ||
        tenantConfig?.operator?.mode,
      "manual"
    ).toLowerCase(),
    defaultDepartment: s(routing.defaultDepartment).toLowerCase(),
    departments,
  };
}

function getDepartmentEntry(tenantConfig, deptKey) {
  const routing = getOperatorRouting(tenantConfig);
  const key = s(deptKey).toLowerCase();
  if (!key) return null;
  const item = routing.departments?.[key];
  return isObj(item) ? item : null;
}

function hasEnabledDepartmentPhone(tenantConfig, deptKey) {
  const item = getDepartmentEntry(tenantConfig, deptKey);
  if (!item) return false;
  if (String(item.enabled ?? "true").trim() === "false") return false;
  return !!s(item.phone);
}

function listEnabledDepartments(tenantConfig) {
  const routing = getOperatorRouting(tenantConfig);
  const out = [];
  for (const [k, v] of Object.entries(routing.departments || {})) {
    if (!isObj(v)) continue;
    if (String(v.enabled ?? "true").trim() === "false") continue;
    out.push({
      key: s(k).toLowerCase(),
      label: s(v.label || k),
      phone: s(v.phone),
      keywords: arr(v.keywords).map((x) => s(x).toLowerCase()).filter(Boolean),
      fallbackDepartment: s(v.fallbackDepartment).toLowerCase(),
      callerId: s(v.callerId),
    });
  }
  return out;
}

function detectDepartmentFromTranscript(text, tenantConfig = null) {
  const t = s(text).toLowerCase();
  if (!t) return "";

  const enabled = listEnabledDepartments(tenantConfig);
  if (!enabled.length) return "";

  const score = new Map();
  for (const item of enabled) {
    score.set(item.key, 0);

    for (const kw of item.keywords) {
      if (kw && t.includes(kw)) {
        score.set(item.key, (score.get(item.key) || 0) + 3);
      }
    }
  }

  if (
    t.includes("price") ||
    t.includes("pricing") ||
    t.includes("quote") ||
    t.includes("offer") ||
    t.includes("proposal") ||
    t.includes("demo") ||
    t.includes("sales") ||
    t.includes("təklif") ||
    t.includes("qiym") ||
    t.includes("paket")
  ) {
    score.set("sales", (score.get("sales") || 0) + 4);
  }

  if (
    t.includes("support") ||
    t.includes("problem") ||
    t.includes("issue") ||
    t.includes("error") ||
    t.includes("help") ||
    t.includes("complaint") ||
    t.includes("dəstək") ||
    t.includes("destek")
  ) {
    score.set("support", (score.get("support") || 0) + 4);
  }

  if (
    t.includes("meeting") ||
    t.includes("appointment") ||
    t.includes("booking") ||
    t.includes("reservation") ||
    t.includes("schedule") ||
    t.includes("görüş") ||
    t.includes("gorus")
  ) {
    score.set("booking", (score.get("booking") || 0) + 4);
  }

  if (
    t.includes("invoice") ||
    t.includes("payment") ||
    t.includes("billing") ||
    t.includes("refund") ||
    t.includes("ödəniş")
  ) {
    score.set("billing", (score.get("billing") || 0) + 4);
  }

  if (
    t.includes("manager") ||
    t.includes("director") ||
    t.includes("owner") ||
    t.includes("boss") ||
    t.includes("rəhbər")
  ) {
    score.set("manager", (score.get("manager") || 0) + 4);
  }

  let bestKey = "";
  let bestScore = 0;

  for (const [k, v] of score.entries()) {
    if (v > bestScore && hasEnabledDepartmentPhone(tenantConfig, k)) {
      bestKey = k;
      bestScore = v;
    }
  }

  if (bestKey) return bestKey;

  const routing = getOperatorRouting(tenantConfig);
  if (routing.defaultDepartment && hasEnabledDepartmentPhone(tenantConfig, routing.defaultDepartment)) {
    return routing.defaultDepartment;
  }

  return "";
}

function resolveTransferDepartment(tenantConfig, requestedDepartment = "") {
  const routing = getOperatorRouting(tenantConfig);
  const requested = s(requestedDepartment).toLowerCase();

  if (requested) {
    const item = getDepartmentEntry(tenantConfig, requested);
    if (item && String(item.enabled ?? "true").trim() !== "false" && s(item.phone)) {
      return requested;
    }

    const fb = s(item?.fallbackDepartment).toLowerCase();
    if (fb) {
      const fbItem = getDepartmentEntry(tenantConfig, fb);
      if (fbItem && String(fbItem.enabled ?? "true").trim() !== "false" && s(fbItem.phone)) {
        return fb;
      }
    }
  }

  const def = s(routing.defaultDepartment).toLowerCase();
  if (def) {
    const defItem = getDepartmentEntry(tenantConfig, def);
    if (defItem && String(defItem.enabled ?? "true").trim() !== "false" && s(defItem.phone)) {
      return def;
    }
  }

  const enabled = listEnabledDepartments(tenantConfig).find((x) => x.phone);
  return enabled?.key || "";
}

function buildTransferOfferText(lang, tenantConfig, departmentKey = "") {
  const dept = getDepartmentEntry(tenantConfig, departmentKey);
  const label = s(dept?.label || departmentKey || "operator");
  const L = s(lang, "en").toLowerCase();

  if (L === "ru") return `Если хотите, я могу соединить вас с отделом ${label}. Соединить?`;
  if (L === "tr") return `İsterseniz sizi ${label} bölümüne bağlayabilirim. Bağlayayım mı?`;
  if (L === "en") return `If you want, I can connect you to the ${label} team. Should I do that?`;
  if (L === "es") return `Si quieres, puedo conectarte con el equipo de ${label}. ¿Lo hago?`;
  if (L === "de") return `Wenn Sie möchten, kann ich Sie mit dem ${label}-Team verbinden. Soll ich das tun?`;
  if (L === "fr") return `Si vous voulez, je peux vous mettre en relation avec l’équipe ${label}. Je le fais ?`;
  return `İstəsəniz, sizi ${label} komandası ilə əlaqələndirə bilərəm. Qoşum?`;
}

function buildTransferAckText(lang, tenantConfig, departmentKey = "") {
  const dept = getDepartmentEntry(tenantConfig, departmentKey);
  const label = s(dept?.label || departmentKey || "operator");
  const L = s(lang, "en").toLowerCase();

  if (L === "ru") return `Хорошо, соединяю вас с отделом ${label}.`;
  if (L === "tr") return `Tamam, sizi ${label} bölümüne bağlıyorum.`;
  if (L === "en") return `Okay, I will connect you to the ${label} team.`;
  if (L === "es") return `De acuerdo, te conecto con el equipo de ${label}.`;
  if (L === "de") return `Okay, ich verbinde Sie mit dem ${label}-Team.`;
  if (L === "fr") return `D’accord, je vous mets en relation avec l’équipe ${label}.`;
  return `Yaxşı, sizi ${label} komandası ilə əlaqələndirirəm.`;
}

export function createRealtimeCore(opts) {
  const {
    sendResponse,
    scheduleForceHangup,
    hangupNow,
    redirectToTransfer,
    reporters,
    tenantConfig = null,
    getNow = () => Date.now(),
    MIN_TRANSCRIPT_CHARS,
    MIN_SPEECH_CHUNKS,
    ASSISTANT_COOLDOWN_MS,
    MISHEARD_COOLDOWN_MS,
    GREETING_PROTECT_MS = 2600,
    DUPLICATE_TRANSCRIPT_WINDOW_MS = Math.max(
      1200,
      Number(process.env.DUPLICATE_TRANSCRIPT_WINDOW_MS || "2500") || 2500
    ),
  } = opts;

  const state = {
    callSid: null,
    fromNumber: null,
    tenantConfig,
    lastLang: detectDefaultLang(tenantConfig),
    lastFinalTranscript: "",
    greeted: false,
    greetingInProgress: false,
    greetingStartedAt: 0,

    awaitingTransferConfirm: false,
    transferArmed: false,
    requestedDepartment: "",
    resolvedDepartment: "",
    hangupAfterDone: false,

    inboundChunkCount: 0,
    lastAssistantAudioAt: 0,

    transcriptLog: [],
    leadFlag: false,
    askedContact: false,
    askedOperator: false,

    askedUserContactOnce: false,
    leadCaptureMode: "none",
    pendingPhone: null,
    pendingName: null,
    confirmedContact: null,

    _reportedFinal: false,
    _reportedPre: false,

    lastMisheardAt: 0,

    lastHandledText: "",
    lastHandledAt: 0,
  };

  function setTenantConfig(nextTenantConfig) {
    state.tenantConfig = nextTenantConfig || null;
    if (!state.lastLang) {
      state.lastLang = detectDefaultLang(nextTenantConfig);
    }
  }

  function pushTranscript(text) {
    const t = s(text);
    if (!t) return;

    state.transcriptLog.push({ ts: new Date().toISOString(), text: t });
    while (state.transcriptLog.length > 14) state.transcriptLog.shift();

    if (looksLikeLeadIntent(t)) state.leadFlag = true;
    if (looksLikeContactRequest(t)) state.askedContact = true;
    if (looksLikeHumanRequest(t)) state.askedOperator = true;

    state.lastLang = detectLang(t) || state.lastLang || detectDefaultLang(state.tenantConfig);
    state.lastFinalTranscript = t;

    const dep = detectDepartmentFromTranscript(t, state.tenantConfig);
    if (dep) state.requestedDepartment = dep;
  }

  function getReportCtx(getDurationSec, metrics) {
    const leadNotes = summarizeLeadAz({
      lastLang: state.lastLang,
      leadFlag: state.leadFlag,
      askedOperator: state.askedOperator,
      askedContact: state.askedContact,
      confirmedContact: state.confirmedContact,
      lastFinalTranscript: state.lastFinalTranscript,
      transcriptLog: state.transcriptLog,
    });

    const leadFields = buildLeadFieldsAz({
      lastFinalTranscript: state.lastFinalTranscript,
      transcriptLog: state.transcriptLog,
      confirmedContact: state.confirmedContact,
    });

    return {
      callSid: state.callSid,
      fromNumber: state.fromNumber,
      lastLang: state.lastLang,
      metricResponses: metrics.metricResponses,
      metricCancels: metrics.metricCancels,
      transcriptLog: state.transcriptLog,
      notes: leadNotes,
      leadFields,
      leadFlag: state.leadFlag,
      askedContact: state.askedContact,
      askedOperator: state.askedOperator,
      confirmedContact: state.confirmedContact,
      durationSec: getDurationSec,
      tenantKey: s(state.tenantConfig?.tenantKey),
      companyName: s(state.tenantConfig?.companyName),
      tenantConfig: state.tenantConfig,
      requestedDepartment: s(state.requestedDepartment),
      resolvedDepartment: s(state.resolvedDepartment),

      set _reportedFinal(v) {
        state._reportedFinal = v;
      },
      get _reportedFinal() {
        return state._reportedFinal;
      },
      set _reportedPre(v) {
        state._reportedPre = v;
      },
      get _reportedPre() {
        return state._reportedPre;
      },
    };
  }

  function maybeMisheard(lang) {
    const now = getNow();
    if (now - state.lastMisheardAt < MISHEARD_COOLDOWN_MS) return;
    if (state.inboundChunkCount < MIN_SPEECH_CHUNKS) return;
    if (isMeaningfulTranscript(state.lastFinalTranscript, MIN_TRANSCRIPT_CHARS)) return;

    state.lastMisheardAt = now;

    const msg = misheardReply(lang, state.tenantConfig);
    sendResponse(`Say exactly ONE short sentence in user's language: "${msg}" Then STOP and wait.`, {
      temperature: 0.6,
      maxTokens: 40,
    });
  }

  function askConfirmPhone(lang, pretty) {
    const L = s(lang, "en").toLowerCase();
    const p = s(pretty);

    if (L === "ru") return `Проверьте, пожалуйста: ваш номер ${p} — верно?`;
    if (L === "tr") return `Numaranız ${p}, doğru mu?`;
    if (L === "en") return `Just to confirm: your number is ${p}, correct?`;
    if (L === "es") return `Solo para confirmar: tu número es ${p}, ¿correcto?`;
    if (L === "de") return `Nur zur Bestätigung: Ihre Nummer ist ${p}, richtig?`;
    if (L === "fr") return `Juste pour confirmer : votre numéro est ${p}, c’est bien ça ?`;
    return `Sadəcə dəqiqləşdirim: nömrəniz ${p}, düzdür?`;
  }

  function askConfirmName(lang, name) {
    const L = s(lang, "en").toLowerCase();
    const n = s(name);

    if (L === "ru") return `Правильно услышал(а): ${n}?`;
    if (L === "tr") return `Doğru anladım mı: ${n}?`;
    if (L === "en") return `Did I get it right: ${n}?`;
    if (L === "es") return `¿Lo entendí bien: ${n}?`;
    if (L === "de") return `Habe ich richtig verstanden: ${n}?`;
    if (L === "fr") return `J’ai bien compris : ${n} ?`;
    return `Düz başa düşdüm: ${n}?`;
  }

  function buildCallbackAck(lang) {
    const L = s(lang, "en").toLowerCase();

    if (L === "ru") return "Спасибо. Мы свяжемся с вами — когда вам будет удобно?";
    if (L === "tr") return "Teşekkürler. Sizinle geri iletişime geçeceğiz — hangi saat uygundur?";
    if (L === "en") return "Thanks. We’ll get back to you—what time works best for you?";
    if (L === "es") return "Gracias. Nos pondremos en contacto contigo—¿qué hora te viene bien?";
    if (L === "de") return "Danke. Wir melden uns bei Ihnen—wann passt es Ihnen am besten?";
    if (L === "fr") return "Merci. Nous vous recontacterons—quelle heure vous convient le mieux ?";
    return "Təşəkkür edirəm. Sizinlə geri əlaqə saxlayacağıq — hansı saat sizə uyğundur?";
  }

  function buildRetryPhonePrompt(lang) {
    const L = s(lang, "en").toLowerCase();

    if (L === "ru") return "Я не расслышал(а) номер. Назовите телефон, пожалуйста, цифра за цифрой.";
    if (L === "tr") return "Numarayı net alamadım. Lütfen rakam rakam söyleyin.";
    if (L === "en") return "I couldn’t catch the number. Please say it digit by digit.";
    if (L === "es") return "No pude captar el número. Dímelo dígito por dígito, por favor.";
    if (L === "de") return "Ich habe die Nummer nicht verstanden. Bitte Ziffer für Ziffer sagen.";
    if (L === "fr") return "Je n’ai pas bien saisi le numéro. Dites-le chiffre par chiffre, s’il vous plaît.";
    return "Nömrəni aydın tutmadım. Zəhmət olmasa rəqəm-rəqəm deyin.";
  }

  function handleLeadContactFlow(text) {
    const t = s(text);
    const lang = state.lastLang || detectLang(t) || detectDefaultLang(state.tenantConfig);

    if (state.leadCaptureMode === "confirm_phone") {
      if (looksLikeYes(t)) {
        state.confirmedContact = { ...(state.confirmedContact || {}) };
        state.confirmedContact.phone = state.pendingPhone?.pretty || state.pendingPhone?.e164 || null;

        state.pendingPhone = null;
        state.leadCaptureMode = state.pendingName ? "confirm_name" : "done";

        if (state.leadCaptureMode === "confirm_name") {
          const q = askConfirmName(lang, state.pendingName);
          sendResponse(`Say exactly ONE short sentence in user's language: "${q}" Then stop.`, {
            temperature: 0.6,
            maxTokens: 34,
          });
        }
        return true;
      }

      if (looksLikeNo(t)) {
        state.pendingPhone = null;
        state.pendingName = null;
        state.leadCaptureMode = "waiting_contact";
        sendResponse(
          `Say exactly ONE short sentence in user's language: "${askUserContact(lang, state.tenantConfig)}" Then stop.`,
          {
            temperature: 0.6,
            maxTokens: 60,
          }
        );
        return true;
      }

      sendResponse(
        `Say exactly ONE short sentence in user's language: "${askYesNo(lang, state.tenantConfig)}" Then stop.`,
        {
          temperature: 0.6,
          maxTokens: 24,
        }
      );
      return true;
    }

    if (state.leadCaptureMode === "confirm_name") {
      if (looksLikeYes(t)) {
        state.confirmedContact = { ...(state.confirmedContact || {}) };
        state.confirmedContact.name = state.pendingName;

        state.pendingName = null;
        state.leadCaptureMode = "done";

        const ack = buildCallbackAck(lang);
        sendResponse(`Say exactly ONE short sentence in user's language: "${ack}" Then stop.`, {
          temperature: 0.62,
          maxTokens: 70,
        });
        return true;
      }

      if (looksLikeNo(t)) {
        state.pendingPhone = null;
        state.pendingName = null;
        state.leadCaptureMode = "waiting_contact";
        sendResponse(
          `Say exactly ONE short sentence in user's language: "${askUserContact(lang, state.tenantConfig)}" Then stop.`,
          {
            temperature: 0.6,
            maxTokens: 60,
          }
        );
        return true;
      }

      sendResponse(
        `Say exactly ONE short sentence in user's language: "${askYesNo(lang, state.tenantConfig)}" Then stop.`,
        {
          temperature: 0.6,
          maxTokens: 24,
        }
      );
      return true;
    }

    if (state.leadCaptureMode === "waiting_contact") {
      const words = t.split(/\s+/).filter(Boolean);
      const maybeName = words
        .slice(0, 3)
        .join(" ")
        .replace(/[0-9+]/g, "")
        .replace(/[^\p{L}\s'-]/gu, "")
        .trim();

      const digits = extractPhoneDigits(t);
      const phone = digits ? normalizeAzPhone(digits) : null;

      if (phone) {
        state.pendingPhone = phone;
        state.confirmedContact = { ...(state.confirmedContact || {}) };
        if (maybeName && maybeName.length >= 2) state.pendingName = maybeName;

        state.leadCaptureMode = "confirm_phone";
        const q = askConfirmPhone(lang, phone.pretty || phone.e164);
        sendResponse(`Say exactly ONE short sentence in user's language: "${q}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 40,
        });
        return true;
      }

      const again = buildRetryPhonePrompt(lang);
      sendResponse(`Say exactly ONE short sentence in user's language: "${again}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 40,
      });
      return true;
    }

    return false;
  }

  function isDuplicateTranscript(t) {
    const now = getNow();
    const x = s(t);
    if (!x) return false;
    return x === state.lastHandledText && now - state.lastHandledAt < DUPLICATE_TRANSCRIPT_WINDOW_MS;
  }

  function markHandledTranscript(t) {
    state.lastHandledText = s(t);
    state.lastHandledAt = getNow();
  }

  function respondFromTranscript(text, runtime) {
    const { getDurationSec, metrics } = runtime;

    const t = s(text);
    if (!t) return;
    if (isDuplicateTranscript(t)) return;

    const lang =
      detectLang(t || state.lastFinalTranscript || "") ||
      state.lastLang ||
      detectDefaultLang(state.tenantConfig);

    state.lastLang = lang;
    state.lastFinalTranscript = t || state.lastFinalTranscript || "";

    const detectedDepartment = detectDepartmentFromTranscript(t, state.tenantConfig);
    if (detectedDepartment) {
      state.requestedDepartment = detectedDepartment;
    }

    if (state.leadCaptureMode !== "none" && state.leadCaptureMode !== "done") {
      markHandledTranscript(t);
      return handleLeadContactFlow(t);
    }

    if (!isMeaningfulTranscript(t, MIN_TRANSCRIPT_CHARS)) return;
    if (!state.greeted) return;
    if (getNow() - state.lastAssistantAudioAt < ASSISTANT_COOLDOWN_MS) return;

    const isAzCaller = callerLikelyAZ(state.fromNumber);

    if (looksLikeLeadIntent(t)) {
      reporters
        ?.sendReports?.(getReportCtx(getDurationSec, metrics), { status: "in_progress" })
        .catch?.(() => {});
    }

    if (looksLikeHardGoodbye(t)) {
      state.hangupAfterDone = true;
      const bye = goodbyeReplyFormalHangup(lang, state.tenantConfig);

      const sent = sendResponse(`Say exactly ONE short sentence in user's language: "${bye}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 34,
      });

      markHandledTranscript(t);
      scheduleForceHangup(sent ? 7500 : 2500);
      return;
    }

    if (looksLikeThanksOnly(t)) {
      const rep = thanksContinueReply(lang, state.tenantConfig);
      sendResponse(`Say exactly ONE short sentence in user's language: "${rep}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 34,
      });
      markHandledTranscript(t);
      return;
    }

    if (state.awaitingTransferConfirm) {
      if (looksLikeYes(t)) {
        state.awaitingTransferConfirm = false;
        state.resolvedDepartment = resolveTransferDepartment(
          state.tenantConfig,
          state.requestedDepartment
        );
        state.transferArmed = true;

        const ack = buildTransferAckText(
          lang,
          state.tenantConfig,
          state.resolvedDepartment
        );

        sendResponse(`Say exactly ONE short sentence in user's language: "${ack}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 36,
        });

        markHandledTranscript(t);
        return;
      }

      if (looksLikeNo(t)) {
        state.awaitingTransferConfirm = false;
        state.requestedDepartment = "";
        state.resolvedDepartment = "";

        const msg = askTellQuestion(lang, state.tenantConfig);
        sendResponse(`Say exactly ONE short sentence in user's language: "${msg}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 28,
        });

        markHandledTranscript(t);
        return;
      }

      sendResponse(
        `Say exactly ONE short sentence in user's language: "${askYesNo(lang, state.tenantConfig)}" Then stop.`,
        {
          temperature: 0.6,
          maxTokens: 18,
        }
      );

      markHandledTranscript(t);
      return;
    }

    if (looksLikeContactRequest(t) || looksLikeHumanRequest(t)) {
      const routing = getOperatorRouting(state.tenantConfig);
      const routedDepartment =
        state.requestedDepartment ||
        detectDepartmentFromTranscript(t, state.tenantConfig) ||
        routing.defaultDepartment ||
        "";

      if (routing.mode === "department" && routedDepartment) {
        state.requestedDepartment = routedDepartment;
        state.awaitingTransferConfirm = true;

        const offer = buildTransferOfferText(lang, state.tenantConfig, routedDepartment);
        sendResponse(`Say this EXACTLY in user's language (single sentence): "${offer}" Then stop and wait.`, {
          temperature: 0.6,
          maxTokens: 80,
        });

        markHandledTranscript(t);
        return;
      }

      state.awaitingTransferConfirm = true;
      const contact = buildContactReply(lang, isAzCaller, state.tenantConfig);
      sendResponse(`Say this EXACTLY in user's language (single sentence): "${contact}" Then stop and wait.`, {
        temperature: 0.6,
        maxTokens: 80,
      });

      markHandledTranscript(t);
      return;
    }

    if (looksClearlyOffTopic(t, state.tenantConfig)) {
      const r = offTopicReply(lang, state.tenantConfig);
      sendResponse(`Say EXACTLY ONE short sentence in user's language: "${r}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 30,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikeLeadIntent(t) && !state.askedUserContactOnce) {
      state.askedUserContactOnce = true;
      state.leadCaptureMode = "waiting_contact";

      if (!state.requestedDepartment) {
        state.requestedDepartment =
          detectDepartmentFromTranscript(t, state.tenantConfig) ||
          state.requestedDepartment;
      }

      const q = askUserContact(lang, state.tenantConfig);
      sendResponse(`Say exactly ONE short sentence in user's language: "${q}" Then stop.`, {
        temperature: 0.62,
        maxTokens: 80,
      });

      markHandledTranscript(t);
      return;
    }

    if (looksLikePricing(t)) {
      sendResponse(
        "Reply in user's language. Format MUST be: 1 short sentence + 1 short question. " +
          "Sentence: say pricing depends on scope very briefly. " +
          "Question: ask ONE qualifier that moves to the next step. " +
          "Then STOP.",
        { temperature: 0.62, maxTokens: 110 }
      );

      markHandledTranscript(t);
      return;
    }

    sendResponse(
      "Reply in user's language. Format MUST be: 1 short sentence + 1 short relevant question. " +
        "Answer ONLY what user asked; no extra topics. If vague, ask ONE clarifier that moves to the next step. " +
        "Then STOP.",
      { temperature: 0.64, maxTokens: 120 }
    );

    markHandledTranscript(t);
  }

  function markGreetingStarted(lang = null) {
    state.greetingInProgress = true;
    state.greetingStartedAt = getNow();
    state.lastLang = s(
      lang || state.lastLang || detectDefaultLang(state.tenantConfig),
      "en"
    ).toLowerCase();
  }

  function markGreetingFinished() {
    state.greetingInProgress = false;
    state.greeted = true;
  }

  function isGreetingProtectedNow() {
    if (!state.greetingInProgress) return false;
    return getNow() - state.greetingStartedAt < GREETING_PROTECT_MS;
  }

  function resetForNewCall({ callSid, fromNumber, tenantConfig: nextTenantConfig = null }) {
    state.callSid = callSid || null;
    state.fromNumber = fromNumber || null;
    state.tenantConfig = nextTenantConfig || state.tenantConfig || null;

    state.lastLang = detectDefaultLang(state.tenantConfig);
    state.lastFinalTranscript = "";
    state.greeted = false;
    state.greetingInProgress = false;
    state.greetingStartedAt = 0;

    state.awaitingTransferConfirm = false;
    state.transferArmed = false;
    state.requestedDepartment = "";
    state.resolvedDepartment = "";
    state.hangupAfterDone = false;

    state.inboundChunkCount = 0;
    state.lastAssistantAudioAt = 0;

    state.transcriptLog.length = 0;
    state.leadFlag = false;
    state.askedContact = false;
    state.askedOperator = false;

    state.askedUserContactOnce = false;
    state.leadCaptureMode = "none";
    state.pendingPhone = null;
    state.pendingName = null;
    state.confirmedContact = null;

    state._reportedFinal = false;
    state._reportedPre = false;

    state.lastMisheardAt = 0;

    state.lastHandledText = "";
    state.lastHandledAt = 0;
  }

  return {
    state,
    setTenantConfig,
    pushTranscript,
    maybeMisheard,
    respondFromTranscript,
    getReportCtx,
    resetForNewCall,
    getGreeting,
    markGreetingStarted,
    markGreetingFinished,
    isGreetingProtectedNow,
    detectDepartmentFromTranscript,
    resolveTransferDepartment,
  };
}