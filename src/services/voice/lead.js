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
  { az: ["bazar ertəsi", "bazarertəsi", "bazar ertesi", "monday", "pazartesi", "понедель", "lunes", "montag", "lundi"], out: "Bazar ertəsi" },
  { az: ["çərşənbə axşamı", "cersenbe axsami", "çərşənbə axşami", "tuesday", "sali", "вторник", "martes", "dienstag", "mardi"], out: "Çərşənbə axşamı" },
  { az: ["çərşənbə", "cersenbe", "wednesday", "çarşamba", "среда", "miércoles", "mittwoch", "mercredi"], out: "Çərşənbə" },
  { az: ["cümə axşamı", "cume axsami", "cümə axşami", "thursday", "perşembe", "четверг", "jueves", "donnerstag", "jeudi"], out: "Cümə axşamı" },
  { az: ["cümə", "cume", "friday", "cuma", "пятниц", "viernes", "freitag", "vendredi"], out: "Cümə" },
  { az: ["şənbə", "senbe", "saturday", "cumartesi", "суббот", "sábado", "samstag", "samedi"], out: "Şənbə" },
  { az: ["bazar", "sunday", "pazar", "воскрес", "domingo", "sonntag", "dimanche"], out: "Bazar" },
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

export function extractMeetingAz(transcripts) {
  const list = Array.isArray(transcripts) ? transcripts : [];
  const joined = list.map((x) => String(x?.text || x || "")).join(" | ");
  const low = norm(joined);

  let dayAz = null;
  for (const w of WEEKDAYS) {
    for (const key of w.az) {
      if (low.includes(norm(key))) {
        dayAz = w.out;
        break;
      }
    }
    if (dayAz) break;
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

  if (!wantsMeeting && !dayAz && !time) {
    return { scheduled: false, dayAz: null, time: null, textAz: null };
  }

  const parts = [];
  if (dayAz) parts.push(dayAz);
  if (time) parts.push(time);

  const textAz = parts.length ? `Görüş: ${parts.join(" ")}.` : "Görüş: istək var (vaxt dəqiqləşməyib).";
  return { scheduled: true, dayAz, time, textAz };
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

export function normalizeAzPhone(digits) {
  const d = String(digits || "").replace(/\D/g, "");

  if (d.length === 10 && d.startsWith("0")) {
    return {
      e164: `+994${d.slice(1)}`,
      pretty: `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`,
      confidence: "high",
    };
  }

  if (d.length === 12 && d.startsWith("994")) {
    const local = `0${d.slice(3)}`;
    return {
      e164: `+${d}`,
      pretty: `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8, 10)}`,
      confidence: "high",
    };
  }

  if (d.length >= 9 && d.length <= 15) {
    return {
      e164: d.startsWith("0") ? d : `+${d}`,
      pretty: d,
      confidence: "low",
    };
  }

  return null;
}

export function summarizeLeadAz({
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

  if (looksLikeWebsite(t)) need = "Veb sayt";
  else if (looksLikeAIAgent(t)) need = "Səsli AI agent";
  else if (looksLikeChatbot(t)) need = "AI chatbot";
  else if (looksLikeAutomation(t)) need = "Biznes avtomatlaşdırma/inteqrasiya";
  else if (looksLikePricing(t)) need = "Qiymət/təklif";
  else if (looksLikeServicesList(t)) need = "Xidmət / məlumat";
  else if (looksLikeContactRequest(t)) need = "Əlaqə məlumatı";
  else need = leadFlag ? "Maraqlanır (lead niyyəti var)" : "Müraciət";

  parts.push(`İstək: ${need}.`);

  const langMapAz = { az: "AZ", tr: "TR", ru: "RU", en: "EN", es: "ES", de: "DE", fr: "FR" };
  parts.push(`Zəng dili: ${langMapAz[String(lastLang || "az").toLowerCase()] || "AZ"}.`);

  parts.push(`Operator istəyi: ${askedOperator ? "bəli" : "xeyr"}.`);
  parts.push(`Əlaqə soruşdu: ${askedContact ? "bəli" : "xeyr"}.`);

  if (confirmedContact?.name) parts.push(`Ad: ${confirmedContact.name}.`);
  if (confirmedContact?.phone) parts.push(`Telefon: ${confirmedContact.phone}.`);
  if (confirmedContact?.email) parts.push(`Email: ${confirmedContact.email}.`);

  if (!confirmedContact?.name && !confirmedContact?.phone && !confirmedContact?.email) {
    parts.push("Əlaqə məlumatı: təsdiqlənməyib (yazılmadı).");
  }

  const meeting = extractMeetingAz(transcriptLog || []);
  if (meeting?.scheduled && meeting?.textAz) parts.push(meeting.textAz);

  return parts.join(" ");
}

export function buildLeadFieldsAz({ lastFinalTranscript, transcriptLog, confirmedContact }) {
  const t = String(lastFinalTranscript || "");
  let service = "";

  if (looksLikeWebsite(t)) service = "Veb sayt";
  else if (looksLikeAIAgent(t)) service = "Səsli AI agent";
  else if (looksLikeChatbot(t)) service = "AI chatbot";
  else if (looksLikeAutomation(t)) service = "Biznes avtomatlaşdırma/inteqrasiya";
  else if (looksLikePricing(t)) service = "Qiymət/təklif";
  else if (looksLikeServicesList(t)) service = "Xidmət / məlumat";
  else if (looksLikeContactRequest(t)) service = "Əlaqə";

  const meeting = extractMeetingAz(transcriptLog || []);

  return {
    service: service || "",
    name: confirmedContact?.name || "",
    phone: confirmedContact?.phone || "",
    email: confirmedContact?.email || "",
    meetingScheduled: meeting?.scheduled ? "bəli" : "xeyr",
    meetingAt: meeting?.scheduled ? [meeting.dayAz, meeting.time].filter(Boolean).join(" ") : "",
    notes: "",
  };
}