import WebSocket from "ws";

export function s(v, d = "") {
  return String(v ?? d).trim();
}

export function sendTwilioMedia(twilioWs, streamSid, base64Payload) {
  if (!twilioWs || twilioWs.readyState !== WebSocket.OPEN) return;
  if (!streamSid) return;
  if (!base64Payload) return;

  twilioWs.send(
    JSON.stringify({
      event: "media",
      streamSid,
      media: { payload: base64Payload },
    })
  );
}

export function getBridgeEnv() {
  return {
    RESPONSE_MODALITIES: ["audio", "text"],

    MIN_TRANSCRIPT_CHARS: Math.max(6, Number(process.env.MIN_TRANSCRIPT_CHARS || "7") || 7),
    MIN_SPEECH_CHUNKS: Math.max(10, Number(process.env.MIN_SPEECH_CHUNKS || "14") || 14),
    ASSISTANT_COOLDOWN_MS: Math.max(1200, Number(process.env.ASSISTANT_COOLDOWN_MS || "1600") || 1600),
    MISHEARD_COOLDOWN_MS: Math.max(2500, Number(process.env.MISHEARD_COOLDOWN_MS || "6500") || 6500),
    ECHO_GUARD_MS: Math.max(0, Number(process.env.ECHO_GUARD_MS || "900") || 900),
    AUDIO_BUFFER_MAX: Math.max(90, Number(process.env.TWILIO_AUDIO_BUFFER_MAX || "260") || 260),
    SILENCE_MS: Math.max(1600, Number(process.env.SILENCE_FALLBACK_MS || "2600") || 2600),
    GREETING_PROTECT_MS: Math.max(1800, Number(process.env.GREETING_PROTECT_MS || "3200") || 3200),
    WATCHDOG_MS: Math.max(6500, Number(process.env.PENDING_WATCHDOG_MS || "9500") || 9500),
    RESPOND_AFTER_STOP_DELAY_MS: Math.max(0, Number(process.env.RESPOND_AFTER_STOP_DELAY_MS || "120") || 120),

    VAD_SILENCE_MS: Math.max(900, Number(process.env.VAD_SILENCE_MS || "1200") || 1200),
    VAD_PREFIX_MS: Math.max(240, Number(process.env.VAD_PREFIX_MS || "380") || 380),
  };
}