import WebSocket from "ws";
import {
  safeJsonParse,
  rtTemp,
  buildStrictInstructions,
  createRealtimeCore,
  callerLikelyAZ,
  buildContactReply,
  getGreeting,
  detectLang,
} from "./realtimeBridge.core.js";
import { getTenantVoiceConfig } from "./tenantConfig.js";
import { createAihqVoiceClient } from "./aihqVoiceClient.js";
import { cfg } from "../config.js";
import { s, sendTwilioMedia, getBridgeEnv } from "./bridge/shared.js";

function detectDefaultLang(tenantConfig = null) {
  return s(
    tenantConfig?.voiceProfile?.defaultLanguage || tenantConfig?.defaultLanguage,
    "en"
  ).toLowerCase();
}

function buildTransferUnavailablePrefix(lang) {
  const L = s(lang, "en").toLowerCase();

  if (L === "ru") return "Не удалось перевести звонок на оператора.";
  if (L === "tr") return "Operatöre yönlendirme mümkün olmadı.";
  if (L === "en") return "Operator transfer is not available right now.";
  if (L === "es") return "La transferencia al operador no está disponible en este momento.";
  if (L === "de") return "Die Weiterleitung zum Operator ist im Moment nicht verfügbar.";
  if (L === "fr") return "Le transfert vers un opérateur n’est pas disponible pour le moment.";
  return "Operatora yönləndirmə hazırda mümkün olmadı.";
}

function buildConferenceName(tenantKey, callSid) {
  return `${s(tenantKey || "default")}:${s(callSid || "call")}`;
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
  const {
    RESPONSE_MODALITIES,
    MIN_TRANSCRIPT_CHARS,
    MIN_SPEECH_CHUNKS,
    ASSISTANT_COOLDOWN_MS,
    MISHEARD_COOLDOWN_MS,
    ECHO_GUARD_MS,
    AUDIO_BUFFER_MAX,
    SILENCE_MS,
    GREETING_PROTECT_MS,
    WATCHDOG_MS,
    RESPOND_AFTER_STOP_DELAY_MS,
    VAD_SILENCE_MS,
    VAD_PREFIX_MS,
  } = getBridgeEnv();

  const aihqVoiceClient = createAihqVoiceClient({
    fetchFn: globalThis.fetch,
    baseUrl: cfg.AIHQ_BASE_URL,
    internalToken: cfg.AIHQ_INTERNAL_TOKEN,
    timeoutMs: 8000,
    debug: !!DEBUG_REALTIME,
  });

  function dlog(...args) {
    if (!DEBUG_REALTIME) return;
    console.log("[bridge]", ...args);
  }

  wss.on("connection", (twilioWs, req) => {
    console.log("[bridge] twilio websocket connected", {
      url: req?.url || null,
      ua: req?.headers?.["user-agent"] || null,
      xfwd: req?.headers?.["x-forwarded-for"] || null,
    });

    let streamSid = null;
    let callSid = null;
    let fromNumber = null;
    let toNumber = null;
    let tenantKey = null;
    let tenantConfig = null;

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
    let lastLang = "en";

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

    async function syncSessionUpsert(extra = {}) {
      try {
        if (!aihqVoiceClient.canUse()) return;

        await aihqVoiceClient.upsertSession({
          tenantKey,
          provider: "twilio",
          providerCallSid: callSid,
          providerStreamSid: streamSid,
          conferenceName: buildConferenceName(tenantKey, callSid),
          fromNumber,
          toNumber,
          customerNumber: fromNumber,
          customerName: "",
          language: lastLang || detectDefaultLang(tenantConfig),
          agentMode: "assistant",
          direction: "outbound",
          callStatus: "in_progress",
          sessionDirection: "outbound_callback",
          sessionStatus: "bot_active",
          botActive: true,
          operatorJoinRequested: false,
          operatorJoined: false,
          whisperActive: false,
          takeoverActive: false,
          requestedDepartment:
            s(core?.state?.requestedDepartment) || null,
          resolvedDepartment:
            s(core?.state?.resolvedDepartment) || null,
          leadPayload: core?.state?.confirmedContact || {},
          metrics: {
            responses: metricResponses,
            cancels: metricCancels,
            inboundChunks: metricInboundChunks,
          },
          startedAt: new Date().toISOString(),
          ...extra,
        });
      } catch (e) {
        dlog("syncSessionUpsert failed", e?.message || e);
      }
    }

    async function syncTranscript(role, text) {
      try {
        if (!aihqVoiceClient.canUse()) return;
        if (!callSid || !text) return;

        await aihqVoiceClient.appendTranscript({
          providerCallSid: callSid,
          role: s(role, "customer"),
          text: s(text),
          ts: new Date().toISOString(),
        });
      } catch (e) {
        dlog("syncTranscript failed", e?.message || e);
      }
    }

    async function syncState(eventType, extra = {}) {
      try {
        if (!aihqVoiceClient.canUse()) return;
        if (!callSid) return;

        await aihqVoiceClient.updateSessionState({
          providerCallSid: callSid,
          eventType: s(eventType, "session_state_updated"),
          status: s(extra.status),
          requestedDepartment:
            s(extra.requestedDepartment || core?.state?.requestedDepartment) || null,
          resolvedDepartment:
            s(extra.resolvedDepartment || core?.state?.resolvedDepartment) || null,
          operatorUserId:
            s(extra.operatorUserId || core?.state?.operatorUserId) || null,
          operatorName:
            s(extra.operatorName || core?.state?.operatorName) || null,
          operatorJoinMode:
            s(extra.operatorJoinMode || core?.state?.operatorJoinMode || "live"),
          botActive:
            typeof extra.botActive === "boolean"
              ? extra.botActive
              : !(extra.status === "bot_silent" || extra.status === "completed"),
          operatorJoinRequested:
            typeof extra.operatorJoinRequested === "boolean"
              ? extra.operatorJoinRequested
              : !!core?.state?.awaitingTransferConfirm,
          operatorJoined:
            typeof extra.operatorJoined === "boolean"
              ? extra.operatorJoined
              : !!core?.state?.transferArmed,
          whisperActive: !!extra.whisperActive,
          takeoverActive: !!extra.takeoverActive,
          summary: s(extra.summary),
          leadPayload: core?.state?.confirmedContact || {},
          meta: isFinite(metricResponses)
            ? {
                responses: metricResponses,
                cancels: metricCancels,
                inboundChunks: metricInboundChunks,
                durationSec: durationSec(),
              }
            : {},
          endedAt: extra.endedAt || null,
        });
      } catch (e) {
        dlog("syncState failed", e?.message || e);
      }
    }

    async function syncOperatorJoin(extra = {}) {
      try {
        if (!aihqVoiceClient.canUse()) return;
        if (!callSid) return;

        await aihqVoiceClient.markOperatorJoin({
          providerCallSid: callSid,
          operatorUserId: s(extra.operatorUserId || core?.state?.operatorUserId) || null,
          operatorName: s(extra.operatorName || core?.state?.operatorName) || null,
          operatorJoinMode: s(extra.operatorJoinMode || "live"),
          takeoverActive: !!extra.takeoverActive,
          botActive:
            typeof extra.botActive === "boolean" ? extra.botActive : false,
          operatorJoinedAt: new Date().toISOString(),
        });
      } catch (e) {
        dlog("syncOperatorJoin failed", e?.message || e);
      }
    }

    async function redirectToTransfer() {
      if (!twilioClient || !callSid) return false;

      const base = String(PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
      if (!base.startsWith("http")) return false;

      const department = encodeURIComponent(
        s(core?.state?.resolvedDepartment || core?.state?.requestedDepartment || "")
      );
      const lang = encodeURIComponent(
        s(core?.state?.lastLang || lastLang || detectDefaultLang(tenantConfig))
      );

      const url = `${base}/twilio/transfer?department=${department}&lang=${lang}`;

      try {
        await twilioClient.calls(callSid).update({
          url,
          method: "POST",
        });

        await syncState("transfer_redirected", {
          status: "agent_ringing",
          requestedDepartment: s(core?.state?.requestedDepartment),
          resolvedDepartment: s(core?.state?.resolvedDepartment),
          operatorJoinRequested: true,
          operatorJoined: false,
          botActive: true,
        });

        return true;
      } catch (e) {
        console.log("[twilio] redirect transfer failed", e?.message || e);
        return false;
      }
    }

    function currentGreeting() {
      const langForGreeting = detectDefaultLang(tenantConfig);
      return getGreeting(langForGreeting, tenantConfig);
    }

    function currentInstructions() {
      const extra = s(tenantConfig?.realtime?.instructions);
      const businessContext = s(tenantConfig?.businessContext);

      let base = buildStrictInstructions(tenantConfig);

      if (businessContext) {
        base += `\nTenant business context: ${businessContext}`;
      }

      if (extra) {
        base += `\nTenant extra instructions:\n${extra}`;
      }

      return base;
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
      tenantConfig,
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
        core?.markGreetingStarted?.(lastLang || detectDefaultLang(tenantConfig));
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

      const greeting = currentGreeting();
      const greetingLang = detectDefaultLang(tenantConfig);

      try {
        openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: RESPONSE_MODALITIES,
              temperature: rtTemp(0.62),
              max_output_tokens: 240,
              instructions:
                `Say EXACTLY this full sentence in ${greetingLang}, smoothly, without stopping mid-sentence: "${greeting}" ` +
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
          core.maybeMisheard(lastLang || detectDefaultLang(tenantConfig));
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

      const model = s(tenantConfig?.realtime?.model) || REALTIME_MODEL;
      const voice = s(tenantConfig?.realtime?.voice) || REALTIME_VOICE;

      console.log("[bridge] opening openai realtime", {
        attempt: reconnectAttempts,
        model,
        voice,
        tenantKey,
        callSid,
      });

      openaiWs = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1",
          },
        }
      );

      openaiWs.on("open", () => {
        console.log("[bridge] openai websocket open", { callSid, streamSid });

        try {
          openaiWs.send(
            JSON.stringify({
              type: "session.update",
              session: {
                voice,
                instructions: currentInstructions(),
                input_audio_format: "g711_ulaw",
                output_audio_format: "g711_ulaw",
                turn_detection: {
                  type: "server_vad",
                  silence_duration_ms: VAD_SILENCE_MS,
                  prefix_padding_ms: VAD_PREFIX_MS,
                },
                input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
              },
            })
          );
        } catch (e) {
          console.log("[bridge] session.update send failed", e?.message || e);
        }
      });

      openaiWs.on("message", async (buf) => {
        const msg = safeJsonParse(buf.toString("utf8")) || null;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "session.created" || msg.type === "session.updated") {
          console.log("[bridge] openai session ready", {
            type: msg.type,
            callSid,
            streamSid,
          });

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
            lastLang = core.state.lastLang || detectLang(text) || detectDefaultLang(tenantConfig);
            dlog("transcript", text);
            syncTranscript("customer", text).catch(() => {});
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

            await syncState("call_completed", {
              status: "completed",
              botActive: false,
              operatorJoinRequested: !!core?.state?.awaitingTransferConfirm,
              operatorJoined: false,
              endedAt: new Date().toISOString(),
            });

            await hangupNowFn();
            closeBoth();
            return;
          }

          if (core.state.transferArmed) {
            core.state.transferArmed = false;

            const joinMode = s(core?.state?.operatorJoinMode || "live").toLowerCase();
            await syncState("operator_join_requested", {
              status: "agent_ringing",
              operatorJoinRequested: true,
              operatorJoined: false,
              operatorJoinMode: joinMode,
              requestedDepartment: s(core?.state?.requestedDepartment),
              resolvedDepartment: s(core?.state?.resolvedDepartment),
              botActive: true,
            });

            const ok = await redirectToTransfer();

            if (!ok) {
              const isAzCaller = callerLikelyAZ(fromNumber);
              const contact = buildContactReply(
                core.state.lastLang || detectDefaultLang(tenantConfig),
                isAzCaller,
                tenantConfig
              );
              const prefix = buildTransferUnavailablePrefix(
                core.state.lastLang || detectDefaultLang(tenantConfig)
              );

              sendResponse(
                `Say this in user's language as ONE sentence: "${prefix} ${contact}" Then stop.`,
                { temperature: 0.6, maxTokens: 120 }
              );

              await syncState("transfer_redirect_failed", {
                status: "bot_active",
                operatorJoinRequested: false,
                operatorJoined: false,
                botActive: true,
              });
            } else {
              await syncOperatorJoin({
                operatorJoinMode: joinMode,
                botActive: joinMode !== "live",
                takeoverActive: joinMode === "live",
              });
            }
          }
        }
      });

      openaiWs.on("close", (code, reasonBuf) => {
        const reason =
          Buffer.isBuffer(reasonBuf) ? reasonBuf.toString("utf8") : String(reasonBuf || "");

        console.log("[bridge] openai websocket close", {
          code,
          reason,
          callSid,
          streamSid,
          reconnectAttempts,
        });

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
        console.log("[bridge] openai websocket error", e?.message || e);
      });
    }

    twilioWs.on("message", async (buf) => {
      const msg = safeJsonParse(buf.toString("utf8"));
      if (!msg) return;

      if (msg.event === "start") {
        streamSid = msg.start?.streamSid || msg.streamSid || null;
        callSid = msg.start?.callSid || null;
        fromNumber = msg.start?.customParameters?.From || msg.start?.from || null;
        toNumber = msg.start?.customParameters?.To || null;
        tenantKey = msg.start?.customParameters?.TenantKey || null;

        console.log("[bridge] start event", {
          streamSid,
          callSid,
          from: fromNumber,
          to: toNumber,
          tenantKey,
        });

        tenantConfig = await getTenantVoiceConfig({
          tenant: {
            tenantKey,
            toNumber,
            matchedBy: tenantKey ? "tenantKey" : "toNumber",
          },
        });

        core.setTenantConfig(tenantConfig);

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
        lastLang = detectDefaultLang(tenantConfig);
        sawSpeechStart = false;
        lastInboundAt = 0;

        turnId = 0;
        respondedTurnId = -1;
        reconnectAttempts = 0;

        core.resetForNewCall({ callSid, fromNumber, tenantConfig });

        await syncSessionUpsert({
          language: lastLang,
          callStatus: "in_progress",
          sessionStatus: "bot_active",
          botActive: true,
          operatorJoinRequested: false,
          operatorJoined: false,
          whisperActive: false,
          takeoverActive: false,
        });

        if (!OPENAI_API_KEY) {
          console.log("[bridge] missing OPENAI_API_KEY");

          await syncState("call_failed_missing_openai", {
            status: "failed",
            botActive: false,
            endedAt: new Date().toISOString(),
          });

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
        console.log("[bridge] stop event", { callSid, streamSid });

        await syncState("call_stopped", {
          status: "completed",
          botActive: false,
          endedAt: new Date().toISOString(),
        });

        reporters
          ?.sendReports?.(
            core.getReportCtx(durationSec, { metricResponses, metricCancels }),
            { status: "completed" }
          )
          .finally(() => closeBoth());
      }
    });

    twilioWs.on("close", async (code, reasonBuf) => {
      const reason =
        Buffer.isBuffer(reasonBuf) ? reasonBuf.toString("utf8") : String(reasonBuf || "");

      console.log("[bridge] twilio websocket close", {
        code,
        reason,
        callSid,
        streamSid,
      });

      await syncState("twilio_ws_closed", {
        status: "completed",
        botActive: false,
        endedAt: new Date().toISOString(),
      });

      reporters
        ?.sendReports?.(
          core.getReportCtx(durationSec, { metricResponses, metricCancels }),
          { status: "completed" }
        )
        .finally(() => {
          closeOpenAI();
          clearTimers();
        });
    });

    twilioWs.on("error", async (e) => {
      console.log("[bridge] twilio websocket error", e?.message || e);

      await syncState("twilio_ws_error", {
        status: "failed",
        botActive: false,
        endedAt: new Date().toISOString(),
      });

      reporters
        ?.sendReports?.(
          core.getReportCtx(durationSec, { metricResponses, metricCancels }),
          { status: "completed" }
        )
        .finally(() => {
          closeOpenAI();
          clearTimers();
        });
    });
  });
}