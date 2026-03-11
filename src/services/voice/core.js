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
    lastLang: "az",
    lastFinalTranscript: "",
    greeted: false,
    greetingInProgress: false,
    greetingStartedAt: 0,

    awaitingTransferConfirm: false,
    transferArmed: false,
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
  }

  function pushTranscript(text) {
    const t = String(text || "").trim();
    if (!t) return;

    state.transcriptLog.push({ ts: new Date().toISOString(), text: t });
    while (state.transcriptLog.length > 14) state.transcriptLog.shift();

    if (looksLikeLeadIntent(t)) state.leadFlag = true;
    if (looksLikeContactRequest(t)) state.askedContact = true;
    if (looksLikeHumanRequest(t)) state.askedOperator = true;

    state.lastLang = detectLang(t);
    state.lastFinalTranscript = t;
  }

  function getReportCtx(getDurationSec, metrics) {
    const notesAz = summarizeLeadAz({
      lastLang: state.lastLang,
      leadFlag: state.leadFlag,
      askedOperator: state.askedOperator,
      askedContact: state.askedContact,
      confirmedContact: state.confirmedContact,
      lastFinalTranscript: state.lastFinalTranscript,
      transcriptLog: state.transcriptLog,
    });

    const leadFieldsAz = buildLeadFieldsAz({
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
      notesAz,
      leadFieldsAz,
      leadFlag: state.leadFlag,
      askedContact: state.askedContact,
      askedOperator: state.askedOperator,
      confirmedContact: state.confirmedContact,
      durationSec: getDurationSec,

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
    const L = String(lang || "az").toLowerCase();
    const p = String(pretty || "");
    if (L === "ru") return `Проверьте, пожалуйста: ваш номер ${p} — верно?`;
    if (L === "tr") return `Dəqiqləşdirim: nömrəniz ${p} — düzdür?`;
    if (L === "en") return `Just to confirm: your number is ${p}, correct?`;
    if (L === "es") return `Solo para confirmar: tu número es ${p}, ¿correcto?`;
    if (L === "de") return `Nur zur Bestätigung: Ihre Nummer ist ${p}, richtig?`;
    if (L === "fr") return `Juste pour confirmer : votre numéro est ${p}, c’est bien ça ?`;
    return `Dəqiqləşdirim: nömrəniz ${p} — düzdür?`;
  }

  function askConfirmName(lang, name) {
    const L = String(lang || "az").toLowerCase();
    const n = String(name || "");
    if (L === "ru") return `Правильно услышала: ${n}?`;
    if (L === "tr") return `Düz başa düşdüm: ${n}?`;
    if (L === "en") return `Did I get it right: ${n}?`;
    if (L === "es") return `¿Lo entendí bien: ${n}?`;
    if (L === "de") return `Habe ich richtig verstanden: ${n}?`;
    if (L === "fr") return `J’ai bien compris : ${n} ?`;
    return `Düz başa düşdüm: ${n}?`;
  }

  function handleLeadContactFlow(text) {
    const t = String(text || "").trim();
    const lang = state.lastLang || detectLang(t) || "az";

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
        sendResponse(`Say exactly ONE short sentence in user's language: "${askUserContact(lang, state.tenantConfig)}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 60,
        });
        return true;
      }

      sendResponse(`Say exactly ONE short sentence in user's language: "${askYesNo(lang, state.tenantConfig)}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 24,
      });
      return true;
    }

    if (state.leadCaptureMode === "confirm_name") {
      if (looksLikeYes(t)) {
        state.confirmedContact = { ...(state.confirmedContact || {}) };
        state.confirmedContact.name = state.pendingName;

        state.pendingName = null;
        state.leadCaptureMode = "done";

        const L = String(lang || "az").toLowerCase();
        const ack =
          L === "ru"
            ? "Спасибо. Мы перезвоним вам сегодня — в какое время удобно?"
            : L === "tr"
            ? "Teşekkürler. Bugün geri dönüş yapacağız — hangi saat uygundur?"
            : L === "en"
            ? "Thanks. We’ll call you back today—what time works best?"
            : L === "es"
            ? "Gracias. Te llamaremos hoy—¿qué hora te viene bien?"
            : L === "de"
            ? "Danke. Wir rufen Sie heute zurück—wann passt es Ihnen?"
            : L === "fr"
            ? "Merci. On vous rappelle aujourd’hui—quelle heure vous convient ?"
            : "Təşəkkür edirəm. Bu gün geri zəng edəcəyik — hansı saat sizə uyğundur?";

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
        sendResponse(`Say exactly ONE short sentence in user's language: "${askUserContact(lang, state.tenantConfig)}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 60,
        });
        return true;
      }

      sendResponse(`Say exactly ONE short sentence in user's language: "${askYesNo(lang, state.tenantConfig)}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 24,
      });
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
        if (maybeName && maybeName.length >= 3) state.pendingName = maybeName;

        state.leadCaptureMode = "confirm_phone";
        const q = askConfirmPhone(lang, phone.pretty || phone.e164);
        sendResponse(`Say exactly ONE short sentence in user's language: "${q}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 40,
        });
        return true;
      }

      const L = String(lang || "az").toLowerCase();
      const again =
        L === "ru"
          ? "Номер не расслышала. Скажите телефон цифра-за-цифрой, пожалуйста."
          : L === "tr"
          ? "Numarayı net alamadım. Lütfen rakam rakam söyleyin."
          : L === "en"
          ? "I couldn’t catch the number. Please say it digit by digit."
          : L === "es"
          ? "No pude captar el número. Dímelo dígito por dígito, por favor."
          : L === "de"
          ? "Ich habe die Nummer nicht verstanden. Bitte Ziffer für Ziffer sagen."
          : L === "fr"
          ? "Je n’ai pas bien saisi le numéro. Dites-le chiffre par chiffre, s’il vous plaît."
          : "Nömrəni aydın tutmadım. Zəhmət olmasa rəqəm-rəqəm deyin.";

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
    const x = String(t || "").trim();
    if (!x) return false;
    return x === state.lastHandledText && now - state.lastHandledAt < DUPLICATE_TRANSCRIPT_WINDOW_MS;
  }

  function markHandledTranscript(t) {
    state.lastHandledText = String(t || "").trim();
    state.lastHandledAt = getNow();
  }

  function respondFromTranscript(text, runtime) {
    const { getDurationSec, metrics } = runtime;

    const t = String(text || "").trim();
    if (!t) return;
    if (isDuplicateTranscript(t)) return;

    const lang = detectLang(t || state.lastFinalTranscript || "") || "az";
    state.lastLang = lang;
    state.lastFinalTranscript = t || state.lastFinalTranscript || "";

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
        state.transferArmed = true;

        const ack = connectOperatorAck(lang, state.tenantConfig);
        sendResponse(`Say exactly ONE short sentence in user's language: "${ack}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 28,
        });

        markHandledTranscript(t);
        return;
      }

      if (looksLikeNo(t)) {
        state.awaitingTransferConfirm = false;
        const msg = askTellQuestion(lang, state.tenantConfig);
        sendResponse(`Say exactly ONE short sentence in user's language: "${msg}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 28,
        });
        markHandledTranscript(t);
        return;
      }

      sendResponse(`Say exactly ONE short sentence in user's language: "${askYesNo(lang, state.tenantConfig)}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 18,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikeContactRequest(t) || looksLikeHumanRequest(t)) {
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

  function markGreetingStarted(lang = "az") {
    state.greetingInProgress = true;
    state.greetingStartedAt = getNow();
    state.lastLang = String(lang || "az").toLowerCase();
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

    state.lastLang = "az";
    state.lastFinalTranscript = "";
    state.greeted = false;
    state.greetingInProgress = false;
    state.greetingStartedAt = 0;

    state.awaitingTransferConfirm = false;
    state.transferArmed = false;
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
  };
}