import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import http from "http";

import { cfg } from "./src/config.js";
import { twilioRouter } from "./src/routes/twilio.js";

const app = express();
const server = http.createServer(app);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "twilio-voice-backend",
    env: cfg.APP_ENV,
    port: cfg.PORT,
  });
});

app.use("/", twilioRouter());

server.listen(cfg.PORT, () => {
  console.log(`[twilio-voice-backend] listening on :${cfg.PORT}`);
});