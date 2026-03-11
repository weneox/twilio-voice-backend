import express from "express";
import twilio from "twilio";
import { cfg } from "../config.js";
import { resolveTenantFromRequest } from "../services/tenantResolver.js";
import { getTenantVoiceConfig } from "../services/tenantConfig.js";

function s(v, d = "") {
  return String(v ?? d).trim();
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

function createTransferResponseXml({ operatorPhone, callerId, transferText, unavailableText }) {
  const vr = new twilio.twiml.VoiceResponse();

  vr.say({ voice: "alice" }, transferText || "Yaxşı, sizi operatora yönləndirirəm.");

  const dial = vr.dial({
    callerId: callerId || undefined,
    timeout: 25,
  });

  dial.number(operatorPhone);

  vr.say(
    { voice: "alice" },
    unavailableText || "Təəssüf ki, operator hazırda cavab vermir."
  );

  return vr.toString();
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
        tenantConfig?.tenantKey || tenant?.tenantKey || cfg.DEFAULT_TENANT_KEY
      );

      const xml = createVoiceResponseXml({
        wsUrl,
        from,
        to,
        tenantKey,
      });

      res.type("text/xml").send(xml);
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

      const operatorPhone =
        s(tenantConfig?.operator?.phone) || s(cfg.OPERATOR_PHONE, "+994518005577");

      const callerId =
        s(tenantConfig?.operator?.callerId) || s(cfg.TWILIO_CALLER_ID);

      const transferText =
        s(tenantConfig?.texts?.transfer_ack?.az) ||
        "Yaxşı, sizi operatora yönləndirirəm.";

      const unavailableText =
        s(tenantConfig?.texts?.transfer_unavailable?.az) ||
        "Təəssüf ki, operator hazırda cavab vermir.";

      const xml = createTransferResponseXml({
        operatorPhone,
        callerId,
        transferText,
        unavailableText,
      });

      res.type("text/xml").send(xml);
    } catch (err) {
      console.error("[twilio/transfer] error:", err);
      return res.status(500).json({
        ok: false,
        error: "transfer_route_failed",
      });
    }
  });

  r.post("/twilio/voice/fallback", (_req, res) => {
    const vr = new twilio.twiml.VoiceResponse();
    vr.say("Sorry, the realtime service is unavailable right now.");
    res.type("text/xml").send(vr.toString());
  });

  return r;
}