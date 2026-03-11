import {
  looksLikeWebsite,
  looksLikeAIAgent,
  looksLikeChatbot,
  looksLikeAutomation,
  looksLikePricing,
  looksLikeServicesList,
  looksLikeContactRequest,
} from "./legacySelectors.js";
import { norm } from "./shared.js";

const WEEKDAYS = [
  { keys: ["bazar ertəsi", "bazarertəsi", "bazar ertesi", "monday", "pazartesi", "понедель", "lunes", "montag", "lundi"], out: "Monday" },
  { keys: ["çərşənbə axşamı", "cersenbe axsami", "çərşənbə axşami", "tuesday", "sali", "вторник", "martes", "dienstag", "mardi"], out: "Tuesday" },
  { keys: ["çərşənbə", "cersenbe", "wednesday", "çarşamba", "среда", "miércoles", "mittwoch", "mercredi"], out: "Wednesday" },
  { keys: ["cümə axşamı", "cume axsami", "cümə axşami", "thursday", "perşembe", "четверг", "jueves", "donnerstag", "jeudi"], out: "Thursday" },
  { keys: ["cümə", "cume", "friday", "cuma", "пятниц", "viernes", "freitag", "vendredi"], out: "Friday" },
  { keys: ["şənbə", "senbe", "saturday", "cumartesi", "суббот", "sábado", "samstag", "samedi"], out: "Saturday" },
  { keys: ["bazar", "sunday", "pazar", "воскрес", "domingo", "sonntag", "dimanche"], out: "Sunday" },
];

function extractTimeLike(text) {
  const t = String(text || "");

  const m1 = t.match(/\b([01]?\d|2[0-3])[:. ]([0-5]\d)\b/);
  if (m1) {
    const hh = String(m1[1]).padStart(2, "0");
    const mm = String(m1[2]).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const m2 = t.match(/\b(saat|at)\s*([1-9]|1\d|2[0-3])\b/i);
  if (m2) {
    const hh = String(m2[2]).padStart(2, "0");
    return `${hh}:00`;
  }

  const m3 = t.match(/\b([1-9]|1\d|2[0-3])\s*(də|de)\b/i);
  if (m3) {
    const hh = String(m3[1]).padStart(2, "0");
    return `${hh}:00`;
  }

  return null;
}

export function extractMeetingInfo(transcripts) {
  const list = Array.isArray(transcripts) ? transcripts : [];
  const joined = list.map((x) => String(x?.text || x || "")).join(" | ");
  const low = norm(joined);

  let day = null;
  for (const w of WEEKDAYS) {
    for (const key of w.keys) {
      if (low.includes(norm(key))) {
        day = w.out;
        break;
      }
    }
    if (day) break;
  }

  const time = extractTimeLike(joined);

  const wantsMeeting =
    low.includes("görüş") ||
    low.includes("gorus") ||
    low.includes("meeting") ||
    low.includes("call back") ||
    low.includes("callback") ||
    low.includes("zəng") ||
    low.includes("zeng") ||
    low.includes("əlaqə saxla") ||
    low.includes("elaqe saxla") ||
    low.includes("appointment") ||
    low.includes("booking");

  if (!wantsMeeting && !day && !time) {
    return { scheduled: false, day: null, time: null, text: null };
  }

  const parts = [];
  if (day) parts.push(day);
  if (time) parts.push(time);

  const text = parts.length
    ? `Meeting requested: ${parts.join(" ")}.`
    : "Meeting requested, but time is not yet confirmed.";

  return { scheduled: true, day, time, text };
}

export function extractPhoneDigits(text) {
  const raw = String(text || "");
  const cleaned = raw.replace(/[^\d+]/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ").filter(Boolean);

  let best = "";
  for (const p of parts) {
    const x = p.replace(/[^\d+]/g, "");
    const digits = x.replace(/\D/g, "");
    if (digits.length > best.replace(/\D/g, "").length) best = x;
  }

  if (!best) return null;

  const digitsOnly = best.replace(/\D/g, "");
  if (digitsOnly.length < 9) return null;
  if (digitsOnly.length > 16) return null;

  return digitsOnly;
}

export function normalizePhone(digits) {
  const d = String(digits || "").replace(/\D/g, "");

  if (d.length >= 9 && d.length <= 15) {
    const e164 = d.startsWith("0") ? d : `+${d}`;
    return {
      e164,
      pretty: d,
      confidence: d.length >= 10 ? "high" : "low",
    };
  }

  return null;
}

export const normalizeAzPhone = normalizePhone;

export function summarizeLead({
  lastLang,
  leadFlag,
  askedOperator,
  askedContact,
  confirmedContact,
  lastFinalTranscript,
  transcriptLog,
}) {
  const parts = [];

  const t = String(lastFinalTranscript || "");
  let need = null;

  if (looksLikeWebsite(t)) need = "Website";
  else if (looksLikeAIAgent(t)) need = "Voice AI agent";
  else if (looksLikeChatbot(t)) need = "AI chatbot";
  else if (looksLikeAutomation(t)) need = "Business automation / integration";
  else if (looksLikePricing(t)) need = "Pricing / quote";
  else if (looksLikeServicesList(t)) need = "Service / information";
  else if (looksLikeContactRequest(t)) need = "Contact details";
  else need = leadFlag ? "Lead intent detected" : "General inquiry";

  parts.push(`Need: ${need}.`);

  const langMap = { az: "AZ", tr: "TR", ru: "RU", en: "EN", es: "ES", de: "DE", fr: "FR" };
  parts.push(`Language: ${langMap[String(lastLang || "en").toLowerCase()] || "EN"}.`);

  parts.push(`Requested operator: ${askedOperator ? "yes" : "no"}.`);
  parts.push(`Asked for contact: ${askedContact ? "yes" : "no"}.`);

  if (confirmedContact?.name) parts.push(`Name: ${confirmedContact.name}.`);
  if (confirmedContact?.phone) parts.push(`Phone: ${confirmedContact.phone}.`);
  if (confirmedContact?.email) parts.push(`Email: ${confirmedContact.email}.`);

  if (!confirmedContact?.name && !confirmedContact?.phone && !confirmedContact?.email) {
    parts.push("Confirmed contact: none.");
  }

  const meeting = extractMeetingInfo(transcriptLog || []);
  if (meeting?.scheduled && meeting?.text) parts.push(meeting.text);

  return parts.join(" ");
}

export function buildLeadFields({ lastFinalTranscript, transcriptLog, confirmedContact }) {
  const t = String(lastFinalTranscript || "");
  let service = "";

  if (looksLikeWebsite(t)) service = "Website";
  else if (looksLikeAIAgent(t)) service = "Voice AI agent";
  else if (looksLikeChatbot(t)) service = "AI chatbot";
  else if (looksLikeAutomation(t)) service = "Business automation / integration";
  else if (looksLikePricing(t)) service = "Pricing / quote";
  else if (looksLikeServicesList(t)) service = "Service / information";
  else if (looksLikeContactRequest(t)) service = "Contact";

  const meeting = extractMeetingInfo(transcriptLog || []);

  return {
    service: service || "",
    name: confirmedContact?.name || "",
    phone: confirmedContact?.phone || "",
    email: confirmedContact?.email || "",
    meetingScheduled: meeting?.scheduled ? "yes" : "no",
    meetingAt: meeting?.scheduled ? [meeting.day, meeting.time].filter(Boolean).join(" ") : "",
    notes: "",
  };
}

export const extractMeetingAz = extractMeetingInfo;
export const summarizeLeadAz = summarizeLead;
export const buildLeadFieldsAz = buildLeadFields;