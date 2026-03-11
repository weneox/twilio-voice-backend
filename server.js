import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import twilio from "twilio";
import { WebSocketServer } from "ws";

import { cfg } from "./src/config.js";
import { twilioRouter } from "./src/routes/twilio.js";
import { attachRealtimeBridge } from "./src/services/realtimeBridge.js";
import { createReporters } from "./src/services/reporting.js";

const app = express();
const server = http.createServer(app);

if (cfg.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);

if (cfg.ENABLE_HSTS) {
  app.use(
    helmet.hsts({
      maxAge: 15552000,
      includeSubDomains: true,
      preload: true,
    })
  );
}

app.use(cors());
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(express.json({ limit: "6mb", strict: true }));

app.use("/", twilioRouter());

function getTwilioClient() {
  if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_API_KEY || !cfg.TWILIO_API_SECRET) return null;
  return twilio(cfg.TWILIO_API_KEY, cfg.TWILIO_API_SECRET, {
    accountSid: cfg.TWILIO_ACCOUNT_SID,
  });
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch.bind(globalThis);
  const mod = await import("undici");
  return mod.fetch;
}

const fetchFn = await getFetch();

const wss = new WebSocketServer({
  server,
  path: "/twilio/stream",
});

const reporters = createReporters({
  fetchFn,
  redis: null,
  PUBLIC_BASE_URL: cfg.PUBLIC_BASE_URL,
  OPENAI_API_KEY: cfg.OPENAI_API_KEY,
  OPENAI_MODEL: "gpt-4.1-mini",
});

attachRealtimeBridge({
  wss,
  OPENAI_API_KEY: cfg.OPENAI_API_KEY,
  DEBUG_REALTIME: cfg.DEBUG_REALTIME,
  PUBLIC_BASE_URL: cfg.PUBLIC_BASE_URL,
  reporters,
  twilioClient: getTwilioClient(),
  REALTIME_MODEL: cfg.OPENAI_REALTIME_MODEL,
  REALTIME_VOICE: cfg.OPENAI_REALTIME_VOICE,
  RECONNECT_MAX: cfg.OPENAI_REALTIME_RECONNECT_MAX,
});

server.listen(cfg.PORT, "0.0.0.0", () => {
  console.log(`[twilio-voice-backend] listening on :${cfg.PORT}`);
});