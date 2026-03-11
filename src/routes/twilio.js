import express from "express";
import twilio from "twilio";
import { cfg } from "../config.js";
import { resolveTenantFromRequest } from "../services/tenantResolver.js";
import { getTenantVoiceConfig } from "../services/tenantConfig.js";
import {
  contactUnavailableReply,
  pickLang,
  makeI18n,
} from "../services/voice/i18n.js";

function s(v, d = "") {
  return String(v ?? d).trim();
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function getBaseUrlFromReq(req) {
  const envBase = s(cfg.PUBLIC_BASE_URL);
  if (envBase) return envBase.replace(/\/+$/, "");

  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString()
    .split(",")[0]
    .trim();

  const host = (req.headers["x-forwarded-host"] || req.get("host") || "")
    .toString()
    .split(",")[0]
    .trim();

  return `${proto}://${host}`.replace(/\/+$/, "");
}

function toWsUrl(httpUrl) {
  return httpUrl.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
}

function validateTwilioSignature(req) {
  if (!cfg.TWILIO_AUTH_TOKEN) return true;

  try {
    const signature = req.header("X-Twilio-Signature") || "";
    const base = (cfg.PUBLIC_BASE_URL || getBaseUrlFromReq(req)).replace(/\/+$/, "");
    const url = base + req.originalUrl;
    const params = req.body && typeof req.body === "object" ? req.body : {};
    return !!twilio.validateRequest(cfg.TWILIO_AUTH_TOKEN, signature, url, params);
  } catch {
    return false;
  }
}

function requireTwilioSignature(req, res, next) {
  if (validateTwilioSignature(req)) return next();
  return res.status(403).type("text/plain").send("Forbidden");
}

function createVoiceResponseXml({ wsUrl, from, to, tenantKey }) {
  const vr = new twilio.twiml.VoiceResponse();
  const connect = vr.connect();
  const stream = connect.stream({ url: wsUrl });

  stream.parameter({
    name: "From",
    value: s(from),
  });

  stream.parameter({
    name: "To",
    value: s(to),
  });

  stream.parameter({
    name: "TenantKey",
    value: s(tenantKey),
  });

  return vr.toString();
}

function createTransferResponseXml({
  operatorPhone,
  callerId,
  transferText,
  unavailableText,
}) {
  const vr = new twilio.twiml.VoiceResponse();

  if (!s(operatorPhone)) {
    vr.say({ voice: "alice" }, unavailableText || "Operator is not available right now.");
    return vr.toString();
  }

  vr.say({ voice: "alice" }, transferText || "Okay, I will connect you now.");

  const dial = vr.dial({
    callerId: s(callerId) || undefined,
    timeout: 25,
  });

  dial.number(operatorPhone);

  vr.say({ voice: "alice" }, unavailableText || "Operator is not available right now.");

  return vr.toString();
}

function createSimpleSayXml(text) {
  const vr = new twilio.twiml.VoiceResponse();
  vr.say({ voice: "alice" }, s(text, "The service is temporarily unavailable."));
  return vr.toString();
}

function detectPreferredLang(req, tenantConfig) {
  const explicit =
    s(req.body?.lang) ||
    s(req.query?.lang) ||
    s(req.body?.Language) ||
    s(req.query?.Language);

  if (explicit) {
    const dict = makeI18n(tenantConfig);
    return pickLang(explicit, dict);
  }

  return s(
    tenantConfig?.voiceProfile?.defaultLanguage || tenantConfig?.defaultLanguage,
    "en"
  ).toLowerCase();
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

function getDepartmentEntry(tenantConfig, departmentKey) {
  const routing = getOperatorRouting(tenantConfig);
  const key = s(departmentKey).toLowerCase();
  if (!key) return null;

  const item = routing.departments?.[key];
  return isObj(item) ? item : null;
}

function resolveDepartmentForTransfer(tenantConfig, requestedDepartment = "") {
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

  for (const [key, value] of Object.entries(routing.departments || {})) {
    if (!isObj(value)) continue;
    if (String(value.enabled ?? "true").trim() === "false") continue;
    if (s(value.phone)) return s(key).toLowerCase();
  }

  return "";
}

function getRequestedDepartment(req) {
  return s(
    req.body?.department ||
      req.body?.Department ||
      req.query?.department ||
      req.query?.Department ||
      req.body?.targetDepartment ||
      req.query?.targetDepartment
  ).toLowerCase();
}

function buildDepartmentTransferAck(lang, tenantConfig, departmentKey = "") {
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

function buildFallbackUnavailableReply(lang) {
  const L = s(lang, "en").toLowerCase();

  if (L === "ru") return "Извините, сервис сейчас временно недоступен.";
  if (L === "tr") return "Üzgünüm, hizmet şu anda geçici olarak kullanılamıyor.";
  if (L === "en") return "Sorry, the service is temporarily unavailable right now.";
  if (L === "es") return "Lo siento, el servicio no está disponible temporalmente en este momento.";
  if (L === "de") return "Entschuldigung, der Dienst ist im Moment vorübergehend nicht verfügbar.";
  if (L === "fr") return "Désolé, le service est temporairement indisponible pour le moment.";
  return "Bağışlayın, xidmət hazırda müvəqqəti olaraq əlçatan deyil.";
}

export function twilioRouter() {
  const r = express.Router();

  r.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "twilio-voice-backend",
      env: cfg.APP_ENV,
      port: cfg.PORT,
    });
  });

  r.options("/twilio/token", (_req, res) => res.sendStatus(204));

  r.get("/twilio/token", (_req, res) => {
    return res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      message: "Use POST /twilio/token",
    });
  });

  r.post("/twilio/token", (req, res) => {
    if (
      !cfg.TWILIO_ACCOUNT_SID ||
      !cfg.TWILIO_API_KEY ||
      !cfg.TWILIO_API_SECRET ||
      !cfg.TWILIO_TWIML_APP_SID
    ) {
      return res.status(400).json({
        ok: false,
        error: "missing_twilio_env",
      });
    }

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const identity =
      s(req.body?.identity || req.query?.identity) ||
      `browser-${Math.random().toString(16).slice(2)}-${Date.now().toString(36)}`;

    const token = new AccessToken(
      cfg.TWILIO_ACCOUNT_SID,
      cfg.TWILIO_API_KEY,
      cfg.TWILIO_API_SECRET,
      { identity, ttl: 3600 }
    );

    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: cfg.TWILIO_TWIML_APP_SID,
        incomingAllow: true,
      })
    );

    return res.json({
      ok: true,
      token: token.toJwt(),
      identity,
    });
  });

  r.post("/twilio/voice", requireTwilioSignature, async (req, res) => {
    try {
      const tenant = await resolveTenantFromRequest(req);
      const tenantConfig = await getTenantVoiceConfig({ tenant });

      const baseUrl = getBaseUrlFromReq(req);
      const wsUrl = `${toWsUrl(baseUrl)}/twilio/stream`;

      const from = s(req.body?.From || req.query?.From);
      const to = s(req.body?.To || req.query?.To || req.body?.Called || req.query?.Called);
      const tenantKey = s(
        tenantConfig?.tenantKey || tenant?.tenantKey || cfg.DEFAULT_TENANT_KEY || "default"
      );

      const xml = createVoiceResponseXml({
        wsUrl,
        from,
        to,
        tenantKey,
      });

      return res.type("text/xml").send(xml);
    } catch (err) {
      console.error("[twilio/voice] error:", err);
      return res.status(500).json({
        ok: false,
        error: "voice_route_failed",
      });
    }
  });

  r.post("/twilio/transfer", requireTwilioSignature, async (req, res) => {
    try {
      const tenant = await resolveTenantFromRequest(req);
      const tenantConfig = await getTenantVoiceConfig({ tenant });
      const lang = detectPreferredLang(req, tenantConfig);

      const requestedDepartment = getRequestedDepartment(req);
      const resolvedDepartment = resolveDepartmentForTransfer(
        tenantConfig,
        requestedDepartment
      );

      const dept = getDepartmentEntry(tenantConfig, resolvedDepartment);

      const operatorPhone =
        s(dept?.phone) ||
        s(tenantConfig?.operator?.phone) ||
        s(cfg.OPERATOR_PHONE);

      const callerId =
        s(dept?.callerId) ||
        s(tenantConfig?.operator?.callerId) ||
        s(cfg.TWILIO_CALLER_ID);

      const transferText = buildDepartmentTransferAck(
        lang,
        tenantConfig,
        resolvedDepartment
      );

      const unavailableText = contactUnavailableReply(lang, tenantConfig);

      const xml = createTransferResponseXml({
        operatorPhone,
        callerId,
        transferText,
        unavailableText,
      });

      return res.type("text/xml").send(xml);
    } catch (err) {
      console.error("[twilio/transfer] error:", err);
      return res.status(500).json({
        ok: false,
        error: "transfer_route_failed",
      });
    }
  });

  r.post("/twilio/voice/fallback", async (req, res) => {
    try {
      const tenant = await resolveTenantFromRequest(req).catch(() => null);
      const tenantConfig = await getTenantVoiceConfig({ tenant }).catch(() => null);
      const lang = detectPreferredLang(req, tenantConfig);
      const text = buildFallbackUnavailableReply(lang);

      return res.type("text/xml").send(createSimpleSayXml(text));
    } catch (err) {
      console.error("[twilio/voice/fallback] error:", err);
      return res
        .type("text/xml")
        .send(createSimpleSayXml("The service is temporarily unavailable."));
    }
  });

  return r;
}