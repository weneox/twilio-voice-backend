import express from "express";
import twilio from "twilio";
import { cfg } from "../config.js";

function getBaseUrlFromReq(req) {
  const envBase = String(cfg.PUBLIC_BASE_URL || "").trim();
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
      String(req.body?.identity || req.query?.identity || "").trim() ||
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
    const baseUrl = getBaseUrlFromReq(req);
    const wsUrl = `${toWsUrl(baseUrl)}/twilio/stream`;

    const vr = new twilio.twiml.VoiceResponse();
    const connect = vr.connect();

    const stream = connect.stream({
      url: wsUrl,
    });

    stream.parameter({
      name: "From",
      value: String(req.body?.From || req.query?.From || ""),
    });

    res.type("text/xml").send(vr.toString());
  });

  r.post("/twilio/transfer", requireTwilioSignature, (_req, res) => {
    const vr = new twilio.twiml.VoiceResponse();

    vr.say({ voice: "alice" }, "Yaxşı, sizi operatora yönləndirirəm.");

    const dial = vr.dial({
      callerId: cfg.TWILIO_CALLER_ID || undefined,
      timeout: 25,
    });

    dial.number(cfg.OPERATOR_PHONE || "+994518005577");

    vr.say({ voice: "alice" }, "Təəssüf ki, operator hazırda cavab vermir.");

    res.type("text/xml").send(vr.toString());
  });

  r.post("/twilio/voice/fallback", (_req, res) => {
    const vr = new twilio.twiml.VoiceResponse();
    vr.say("Sorry, the realtime service is unavailable right now.");
    res.type("text/xml").send(vr.toString());
  });

  return r;
}