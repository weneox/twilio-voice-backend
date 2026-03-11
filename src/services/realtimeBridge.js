import WebSocket from "ws";
import {
  safeJsonParse,
  rtTemp,
  buildStrictInstructions,
  createRealtimeCore,
  callerLikelyAZ,
  buildContactReply,
  getGreeting,
} from "./realtimeBridge.core.js";

function sendTwilioMedia(twilioWs, streamSid, base64Payload) {
  if (!twilioWs || twilioWs.readyState !== WebSocket.OPEN) return;
  if (!streamSid) return;
  if (!base64Payload) return;
  twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: base64Payload } }));
}

export function attachRealtimeBridge({
  wss,
  OPENAI_API_KEY,
  DEBUG_REALTIME,
  PUBLIC_BASE_URL,
  reporters,
  twilioClient,
  REALTIME_MODEL,
  REALTIME_VOICE,
  RECONNECT_MAX,
}) {
  const RESPONSE_MODALITIES = ["audio", "text"];

  const MIN_TRANSCRIPT_CHARS = Math.max(6, Number(process.env.MIN_TRANSCRIPT_CHARS || "7") || 7);
  const MIN_SPEECH_CHUNKS = Math.max(10, Number(process.env.MIN_SPEECH_CHUNKS || "14") || 14);
  const ASSISTANT_COOLDOWN_MS = Math.max(1200, Number(process.env.ASSISTANT_COOLDOWN_MS || "1600") || 1600);
  const MISHEARD_COOLDOWN_MS = Math.max(2500, Number(process.env.MISHEARD_COOLDOWN_MS || "6500") || 6500);
  const ECHO_GUARD_MS = Math.max(0, Number(process.env.ECHO_GUARD_MS || "900") || 900);
  const AUDIO_BUFFER_MAX = Math.max(90, Number(process.env.TWILIO_AUDIO_BUFFER_MAX || "260") || 260);
  const SILENCE_MS = Math.max(1600, Number(process.env.SILENCE_FALLBACK_MS || "2600") || 2600);
  const GREETING_PROTECT_MS = Math.max(1800, Number(process.env.GREETING_PROTECT_MS || "3200") || 3200);
  const WATCHDOG_MS = Math.max(6500, Number(process.env.PENDING_WATCHDOG_MS || "9500") || 9500);
  const RESPOND_AFTER_STOP_DELAY_MS = Math.max(0, Number(process.env.RESPOND_AFTER_STOP_DELAY_MS || "120") || 120);

  function dlog(...args) {
    if (!DEBUG_REALTIME) return;
    console.log("[bridge]", ...args);
  }

  wss.on("connection", (twilioWs) => {
    let streamSid = null;
    let callSid = null;
    let fromNumber = null;

    let openaiWs = null;
    let openaiSessionReady = false;

    const audioQueue = [];

    let pendingResponse = false;
    let pendingSince = 0;

    let assistantSpeaking = false;
    let lastAssistantAudioAt = 0;

    let sawSpeechStart = false;
    let inboundChunkCount = 0;
    let lastInboundAt = 0;

    let lastFinalTranscript = "";
    let lastLang = "az";

    let greeted = false;
    let greetingInProgress = false;
    let greetingStartedAt = 0;

    let hangupAfterDone = false;
    let forceHangupTimer = null;

    let reconnectAttempts = 0;

    let metricResponses = 0;
    let metricCancels = 0;
    let metricInboundChunks = 0;
    let metricStartedAt = Date.now();

    let watchdog = null;
    let silenceTimer = null;

    let turnId = 0;
    let respondedTurnId = -1;

    function durationSec() {
      const durMs = Date.now() - metricStartedAt;
      return Math.max(0, Math.round(durMs / 1000));
    }

    function canSendToOpenAI() {
      return !!(openaiWs && openaiWs.readyState === WebSocket.OPEN && openaiSessionReady);
    }

    function setPending(on) {
      pendingResponse = on;
      pendingSince = on ? Date.now() : 0;
    }

    function flushAudioQueueToOpenAI(limit = 80) {
      if (!canSendToOpenAI()) return;
      if (!audioQueue.length) return;

      let n = 0;
      while (audioQueue.length && n < limit) {
        const payload = audioQueue.shift();
        if (!payload) continue;
        try {
          openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
        } catch {}
        n += 1;
      }
    }

    function closeOpenAI() {
      try {
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
      } catch {}
    }

    function clearTimers() {
      try {
        if (watchdog) clearInterval(watchdog);
      } catch {}
      try {
        if (silenceTimer) clearInterval(silenceTimer);
      } catch {}
      watchdog = null;
      silenceTimer = null;

      try {
        if (forceHangupTimer) clearTimeout(forceHangupTimer);
      } catch {}
      forceHangupTimer = null;
    }

    function closeBoth() {
      clearTimers();
      closeOpenAI();
      try {
        twilioWs.close();
      } catch {}
    }

    async function hangupNowFn() {
      if (!twilioClient || !callSid) return;
      try {
        await twilioClient.calls(callSid).update({ status: "completed" });
      } catch (e) {
        console.log("[twilio] hangup failed", e?.message || e);
      }
    }

    function scheduleForceHangup(ms = 6500) {
      try {
        if (forceHangupTimer) clearTimeout(forceHangupTimer);
      } catch {}
      forceHangupTimer = setTimeout(() => {
        hangupNowFn().finally(() => closeBoth());
      }, ms);
      try {
        forceHangupTimer.unref?.();
      } catch {}
    }

    async function redirectToTransfer() {
      if (!twilioClient || !callSid) return false;
      const base = String(PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
      if (!base.startsWith("http")) return false;
      try {
        await twilioClient.calls(callSid).update({ url: `${base}/twilio/transfer`, method: "POST" });
        return true;
      } catch (e) {
        console.log("[twilio] redirect transfer failed", e?.message || e);
        return false;
      }
    }

    function sendResponse(instructions, { temperature = 0.6, maxTokens = 140 } = {}) {
      if (!canSendToOpenAI()) return false;
      if (pendingResponse) return false;

      setPending(true);
      metricResponses += 1;

      try {
        openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: RESPONSE_MODALITIES,
              temperature: rtTemp(temperature),
              max_output_tokens: maxTokens,
              instructions,
            },
          })
        );
        return true;
      } catch {
        setPending(false);
        return false;
      }
    }

    const core = createRealtimeCore({
      sendResponse,
      scheduleForceHangup,
      hangupNow: hangupNowFn,
      redirectToTransfer,
      reporters,
      MIN_TRANSCRIPT_CHARS,
      MIN_SPEECH_CHUNKS,
      ASSISTANT_COOLDOWN_MS,
      MISHEARD_COOLDOWN_MS,
      GREETING_PROTECT_MS,
    });

    function greetingProtected() {
      const now = Date.now();
      if (greetingInProgress && now - greetingStartedAt < GREETING_PROTECT_MS) return true;
      try {
        if (core?.isGreetingProtectedNow?.()) return true;
      } catch {}
      return false;
    }

    function cancelAssistantIfSpeakingDelayed() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
      if (!assistantSpeaking && !pendingResponse) return;

      const startAt = Date.now();
      setTimeout(() => {
        if (greetingProtected()) return;
        if (inboundChunkCount < 4 && Date.now() - startAt < 350) return;

        try {
          openaiWs.send(JSON.stringify({ type: "response.cancel" }));
          metricCancels += 1;
        } catch {}

        assistantSpeaking = false;
        setPending(false);
      }, 220);
    }

    function markGreetingStart() {
      greetingInProgress = true;
      greetingStartedAt = Date.now();
      try {
        core?.markGreetingStarted?.(lastLang || "az");
      } catch {}
    }

    function markGreetingEnd() {
      greetingInProgress = false;
      try {
        core?.markGreetingFinished?.();
      } catch {}
    }

    function maybeSendGreeting() {
      if (greeted) return;
      if (!streamSid) return;
      if (!canSendToOpenAI()) return;
      if (pendingResponse) return;

      greeted = true;
      markGreetingStart();
      setPending(true);
      metricResponses += 1;

      const langForGreeting = "az";
      const greeting =
        typeof getGreeting === "function"
          ? getGreeting(langForGreeting)
          : "Salam, mən NEOX şirkətinin virtual asistentiyəm. Sizə necə kömək edə bilərəm?";

      try {
        openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: RESPONSE_MODALITIES,
              temperature: rtTemp(0.62),
              max_output_tokens: 240,
              instructions:
                `Say EXACTLY this full sentence in Azerbaijani, smoothly, without stopping mid-sentence: "${greeting}" ` +
                `Then STOP completely and wait for the user. Do not add anything else.`,
            },
          })
        );
      } catch {
        setPending(false);
        markGreetingEnd();
        return;
      }

      const t = setTimeout(() => {
        if (greetingInProgress && Date.now() - greetingStartedAt > GREETING_PROTECT_MS + 1200) {
          markGreetingEnd();
          setPending(false);
        }
      }, GREETING_PROTECT_MS + 1600);
      try {
        t.unref?.();
      } catch {}
    }

    function canRespondThisTurn() {
      if (!sawSpeechStart) return false;
      if (respondedTurnId === turnId) return false;
      if (!greeted) return false;
      if (pendingResponse) return false;
      return true;
    }

    function respondOnceFromLatestTranscript() {
      if (!canRespondThisTurn()) return;

      const t = String(lastFinalTranscript || "").trim();

      respondedTurnId = turnId;

      flushAudioQueueToOpenAI();

      if (t) {
        setTimeout(() => {
          try {
            core.respondFromTranscript(t, {
              getDurationSec: durationSec,
              metrics: { metricResponses, metricCancels },
            });
          } catch {}
        }, RESPOND_AFTER_STOP_DELAY_MS);
      } else {
        core.state.inboundChunkCount = inboundChunkCount;
        try {
          core.maybeMisheard(lastLang || "az");
        } catch {}
      }

      sawSpeechStart = false;
      inboundChunkCount = 0;
    }

    watchdog = setInterval(() => {
      if (!pendingResponse) return;
      if (Date.now() - pendingSince > WATCHDOG_MS) {
        dlog("watchdog reset pending");
        setPending(false);
        assistantSpeaking = false;
        if (greetingInProgress && Date.now() - greetingStartedAt > GREETING_PROTECT_MS + 1600) {
          markGreetingEnd();
        }
      }
    }, 1000);

    silenceTimer = setInterval(() => {
      if (!canSendToOpenAI()) return;
      if (!greeted) return;
      if (!sawSpeechStart) return;
      if (pendingResponse) return;

      const now = Date.now();
      if (!lastInboundAt) return;
      const silentFor = now - lastInboundAt;
      if (silentFor < SILENCE_MS) return;

      respondOnceFromLatestTranscript();
    }, 250);

    function openOpenAI() {
      reconnectAttempts += 1;
      openaiSessionReady = false;

      openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`, {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
      });

      openaiWs.on("open", () => {
        try {
          openaiWs.send(
            JSON.stringify({
              type: "session.update",
              session: {
                voice: REALTIME_VOICE,
                instructions: buildStrictInstructions(),
                input_audio_format: "g711_ulaw",
                output_audio_format: "g711_ulaw",
                turn_detection: {
                  type: "server_vad",
                  silence_duration_ms: Math.max(900, Number(process.env.VAD_SILENCE_MS || "1200") || 1200),
                  prefix_padding_ms: Math.max(240, Number(process.env.VAD_PREFIX_MS || "380") || 380),
                },
                input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
              },
            })
          );
        } catch {}
      });

      openaiWs.on("message", async (buf) => {
        const msg = safeJsonParse(buf.toString("utf8")) || null;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "session.created" || msg.type === "session.updated") {
          openaiSessionReady = true;
          setPending(false);
          assistantSpeaking = false;
          flushAudioQueueToOpenAI();
          setTimeout(() => maybeSendGreeting(), 220);
          return;
        }

        if (msg.type === "error") {
          console.log("[OAI] error event", msg?.error || msg);
          setPending(false);
          assistantSpeaking = false;
          markGreetingEnd();
          return;
        }

        if (msg.type === "input_audio_buffer.speech_started") {
          turnId += 1;
          respondedTurnId = -1;

          sawSpeechStart = true;
          inboundChunkCount = 0;
          lastFinalTranscript = "";

          if (!greetingProtected()) {
            cancelAssistantIfSpeakingDelayed();
          }
          return;
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (!sawSpeechStart) return;
          respondOnceFromLatestTranscript();
          return;
        }

        const typ = String(msg.type || "");
        const isTranscript =
          typ === "input_audio_transcription.completed" ||
          typ === "input_audio_transcription.final" ||
          typ.endsWith(".input_audio_transcription.completed") ||
          typ.endsWith(".input_audio_transcription.final");

        if (isTranscript) {
          const text = String(msg.transcript || msg.text || "").trim();
          if (text) {
            lastFinalTranscript = text;
            core.pushTranscript(text);
            lastLang = core.state.lastLang || lastLang;
          }
          return;
        }

        if (
          (msg.type === "response.audio.delta" && msg.delta) ||
          (msg.type === "response.output_audio.delta" && msg.delta)
        ) {
          assistantSpeaking = true;
          lastAssistantAudioAt = Date.now();
          core.state.lastAssistantAudioAt = lastAssistantAudioAt;
          sendTwilioMedia(twilioWs, streamSid, msg.delta);
          return;
        }

        if (msg.type === "response.done") {
          setPending(false);
          assistantSpeaking = false;

          if (greetingInProgress) markGreetingEnd();

          if (hangupAfterDone || core.state.hangupAfterDone) {
            hangupAfterDone = false;
            core.state.hangupAfterDone = false;
            try {
              if (forceHangupTimer) clearTimeout(forceHangupTimer);
            } catch {}
            forceHangupTimer = null;
            await hangupNowFn();
            closeBoth();
            return;
          }

          if (core.state.transferArmed) {
            core.state.transferArmed = false;
            const ok = await redirectToTransfer();
            if (!ok) {
              const isAzCaller = callerLikelyAZ(fromNumber);
              const contact = buildContactReply(core.state.lastLang || "az", isAzCaller);
              sendResponse(
                `Say this in user's language as ONE sentence: "Operatora yönləndirmə mümkün olmadı. ${contact}" Then stop.`,
                { temperature: 0.6, maxTokens: 120 }
              );
            }
          }
        }
      });

      openaiWs.on("close", () => {
        openaiSessionReady = false;
        setPending(false);
        assistantSpeaking = false;
        markGreetingEnd();

        const twilioAlive = twilioWs && twilioWs.readyState === WebSocket.OPEN;
        if (twilioAlive && reconnectAttempts <= RECONNECT_MAX) {
          const wait = 700 * reconnectAttempts;
          setTimeout(() => {
            try {
              openOpenAI();
            } catch {
              closeBoth();
            }
          }, wait);
          return;
        }
        closeBoth();
      });

      openaiWs.on("error", (e) => {
        openaiSessionReady = false;
        setPending(false);
        assistantSpeaking = false;
        markGreetingEnd();
        console.log("[OAI] error", e?.message || e);
      });
    }

    twilioWs.on("message", (buf) => {
      const msg = safeJsonParse(buf.toString("utf8"));
      if (!msg) return;

      if (msg.event === "start") {
        streamSid = msg.start?.streamSid || msg.streamSid || null;
        callSid = msg.start?.callSid || null;
        fromNumber = msg.start?.customParameters?.From || msg.start?.from || null;

        setPending(false);
        assistantSpeaking = false;
        lastAssistantAudioAt = 0;

        inboundChunkCount = 0;
        metricInboundChunks = 0;
        metricResponses = 0;
        metricCancels = 0;
        metricStartedAt = Date.now();

        audioQueue.length = 0;

        greeted = false;
        greetingInProgress = false;
        greetingStartedAt = 0;
        hangupAfterDone = false;

        lastFinalTranscript = "";
        lastLang = "az";
        sawSpeechStart = false;
        lastInboundAt = 0;

        turnId = 0;
        respondedTurnId = -1;

        reconnectAttempts = 0;

        core.resetForNewCall({ callSid, fromNumber });

        if (!OPENAI_API_KEY) {
          try {
            twilioWs.close();
          } catch {}
          return;
        }

        openOpenAI();
        return;
      }

      if (msg.event === "media") {
        const payload = msg.media?.payload;
        if (!payload) return;

        const track = String(msg.media?.track || "").toLowerCase();
        if (track && track !== "inbound") return;

        lastInboundAt = Date.now();

        if (assistantSpeaking && Date.now() - lastAssistantAudioAt < ECHO_GUARD_MS) return;

        inboundChunkCount += 1;
        metricInboundChunks += 1;
        core.state.inboundChunkCount = inboundChunkCount;

        audioQueue.push(payload);
        while (audioQueue.length > AUDIO_BUFFER_MAX) audioQueue.shift();

        if (canSendToOpenAI()) flushAudioQueueToOpenAI();
        return;
      }

      if (msg.event === "stop") {
        reporters
          ?.sendReports?.(core.getReportCtx(durationSec, { metricResponses, metricCancels }), { status: "completed" })
          .finally(() => closeBoth());
      }
    });

    twilioWs.on("close", () => {
      reporters
        ?.sendReports?.(core.getReportCtx(durationSec, { metricResponses, metricCancels }), { status: "completed" })
        .finally(() => {
          closeOpenAI();
          clearTimers();
        });
    });

    twilioWs.on("error", () => {
      reporters
        ?.sendReports?.(core.getReportCtx(durationSec, { metricResponses, metricCancels }), { status: "completed" })
        .finally(() => {
          closeOpenAI();
          clearTimers();
        });
    });
  });
}