export { MIN_RT_TEMP, rtTemp, safeJsonParse, norm, s } from "./voice/shared.js";

export {
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
  makeI18n,
  pickLang,
  fallbackShort,
} from "./voice/i18n.js";

export {
  callerLikelyAZ,
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
} from "./voice/intents.js";

export {
  extractMeetingAz,
  extractPhoneDigits,
  normalizeAzPhone,
  summarizeLeadAz,
  buildLeadFieldsAz,
} from "./voice/lead.js";

export { buildStrictInstructions } from "./voice/instructions.js";

export { createRealtimeCore } from "./voice/core.js";