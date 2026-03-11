import { norm } from "./shared.js";

function s(v, d = "") {
  return String(v ?? d).trim();
}

export function callerLikelyAZ(fromE164) {
  const x = s(fromE164);
  return x.startsWith("+994") || x.startsWith("994");
}

export function detectLang(text, fallback = "en") {
  const t = s(text);
  if (!t) return s(fallback, "en").toLowerCase();
  if (/[А-Яа-яЁё]/.test(t)) return "ru";

  const low = norm(t);

  let az = 0;
  let tr = 0;
  let en = 0;
  let es = 0;
  let fr = 0;
  let de = 0;

  if (/[əƏ]/.test(t)) az += 8;
  if (/[ğĞ]/.test(t)) tr += 2;
  if (/[ıİ]/.test(t)) tr += 2;
  if (/[şŞçÇöÖüÜ]/.test(t)) {
    az += 1;
    tr += 1;
  }
  if (/[áéíóúñ¿¡]/i.test(t)) es += 4;
  if (/[àâçéèêëîïôùûüÿœæ]/i.test(t)) fr += 4;
  if (/[äöüß]/i.test(t)) de += 4;

  const AZ = ["zəhmət", "necə", "siz", "bəli", "yox", "xidmət", "əlaqə", "qiymət", "təklif", "görüş", "sabah", "zəng"];
  const TR = ["lütfen", "nasıl", "siz", "evet", "hayır", "hizmet", "iletişim", "fiyat", "teklif", "görüşme", "yarın", "arama"];
  const EN = ["hello", "price", "service", "support", "meeting", "call", "quote", "budget"];
  const ES = ["hola", "precio", "servicio", "soporte", "reunión", "llamada", "presupuesto"];
  const FR = ["bonjour", "prix", "service", "support", "réunion", "appel", "devis"];
  const DE = ["hallo", "preis", "service", "support", "meeting", "anruf", "angebot"];

  for (const w of AZ) if (low.includes(w)) az += 2;
  for (const w of TR) if (low.includes(w)) tr += 2;
  for (const w of EN) if (low.includes(w)) en += 2;
  for (const w of ES) if (low.includes(w)) es += 2;
  for (const w of FR) if (low.includes(w)) fr += 2;
  for (const w of DE) if (low.includes(w)) de += 2;

  const scores = [
    ["az", az],
    ["tr", tr],
    ["en", en],
    ["es", es],
    ["fr", fr],
    ["de", de],
  ].sort((a, b) => b[1] - a[1]);

  if (scores[0][1] < 3) return s(fallback, "en").toLowerCase();
  return scores[0][0];
}

export function looksLikeContactRequest(text) {
  const x = norm(text);
  return (
    x.includes("əlaqə") ||
    x.includes("elaqe") ||
    x.includes("nömr") ||
    x.includes("nomr") ||
    x.includes("telefon") ||
    x.includes("whatsapp") ||
    x.includes("email") ||
    x.includes("e-mail") ||
    x.includes("mail") ||
    x.includes("@") ||
    x.includes("contact") ||
    x.includes("numero") ||
    x.includes("teléfono") ||
    x.includes("numéro") ||
    x.includes("kontakt") ||
    x.includes("whats")
  );
}

export function looksLikeHumanRequest(text) {
  const x = norm(text);
  return (
    x.includes("operator") ||
    x.includes("canlı") ||
    x.includes("canli") ||
    x.includes("insan") ||
    x.includes("dəstək") ||
    x.includes("destek") ||
    x.includes("support") ||
    x.includes("manager") ||
    x.includes("agent") ||
    x.includes("live") ||
    x.includes("human")
  );
}

export function looksLikeHardGoodbye(text) {
  const x = norm(text);

  const direct = [
    "hələlik",
    "helelik",
    "bye",
    "goodbye",
    "zəngi bitir",
    "zengi bitir",
    "bitdi",
    "bağla",
    "bagla",
    "kapat",
    "до свид",
    "görüşərik",
    "gorus",
    "adiós",
    "ciao",
    "au revoir",
    "tschüss",
  ];

  const tomorrowClose =
    (x.includes("sabah") || x.includes("tomorrow") || x.includes("yarın")) &&
    (x.includes("əlaqə saxla") ||
      x.includes("elaqe saxla") ||
      x.includes("əlaqə saxlayacam") ||
      x.includes("elaqe saxlayacam") ||
      x.includes("call you") ||
      x.includes("te llamar") ||
      x.includes("rappeler"));

  return direct.some((k) => x.includes(k)) || tomorrowClose;
}

export function looksLikeThanksOnly(text) {
  const x = norm(text);
  return (
    x === "sağ ol" ||
    x === "sag ol" ||
    x.includes("çox sağ ol") ||
    x.includes("cox sag ol") ||
    x.includes("təşəkkür") ||
    x.includes("tesekkur") ||
    x.includes("thank") ||
    x.includes("thanks") ||
    x.includes("спасибо") ||
    x.includes("teşekkür") ||
    x.includes("saol") ||
    x.includes("gracias") ||
    x.includes("merci") ||
    x.includes("danke")
  );
}

export function looksLikeYes(text) {
  const x = norm(text);
  return (
    x === "bəli" ||
    x === "beli" ||
    x === "hə" ||
    x === "he" ||
    x === "ok" ||
    x.includes("olar") ||
    x === "yes" ||
    x === "да" ||
    x === "evet" ||
    x === "sí" ||
    x === "si" ||
    x === "oui" ||
    x === "ja"
  );
}

export function looksLikeNo(text) {
  const x = norm(text);
  return (
    x === "yox" ||
    x.includes("istemir") ||
    x.includes("lazim deyil") ||
    x === "no" ||
    x === "нет" ||
    x.includes("hayir") ||
    x === "non" ||
    x === "nein"
  );
}

export function looksClearlyOffTopic(text, tenantConfig = null) {
  const x = norm(text);

  const allowedTopics = Array.isArray(tenantConfig?.voiceProfile?.allowedTopics)
    ? tenantConfig.voiceProfile.allowedTopics.map((v) => norm(v))
    : [];

  if (allowedTopics.some((k) => k && x.includes(k))) return false;

  const genericOn = [
    "xidmət",
    "xidmet",
    "qiym",
    "dəyər",
    "deyer",
    "təklif",
    "teklif",
    "support",
    "dəstək",
    "destek",
    "service",
    "services",
    "contact",
    "operator",
    "meeting",
    "appointment",
    "booking",
    "order",
    "problem",
    "yardım",
    "help",
  ];

  if (genericOn.some((k) => x.includes(k))) return false;

  const off = [
    "hava",
    "musiqi",
    "film",
    "oyun",
    "siyas",
    "dini",
    "tibb",
    "resept",
    "idman",
    "futbol",
    "weather",
    "music",
    "movie",
    "politic",
    "religion",
    "medicine",
  ];

  return off.some((k) => x.includes(k));
}

export function isMeaningfulTranscript(t, minChars) {
  const x = s(t);
  if (x.length < minChars) return false;
  if (!/[a-zA-Z0-9əğıöüşçƏĞİÖÜŞÇА-Яа-яЁё]/.test(x)) return false;

  const low = norm(x);

  if (["hə", "he", "hmm", "mm", "aaa", "eee", "uh", "eh", "ok"].includes(low)) return false;
  if (low.split(" ").length === 1 && x.length <= 5) return false;
  if (/(.)\1{6,}/.test(low)) return false;

  return true;
}

export function looksLikePricing(text) {
  const x = norm(text);
  return (
    x.includes("qiym") ||
    x.includes("price") ||
    x.includes("dəyər") ||
    x.includes("deyer") ||
    x.includes("cost") ||
    x.includes("paket") ||
    x.includes("budget") ||
    x.includes("quote") ||
    x.includes("tarif") ||
    x.includes("ücret")
  );
}

export function looksLikeLeadIntent(text) {
  const x = norm(text);
  return (
    x.includes("sifariş") ||
    x.includes("sifaris") ||
    x.includes("order") ||
    x.includes("qiym") ||
    x.includes("price") ||
    x.includes("paket") ||
    x.includes("təklif") ||
    x.includes("teklif") ||
    x.includes("görüş") ||
    x.includes("gorus") ||
    x.includes("meeting") ||
    x.includes("appointment") ||
    x.includes("booking") ||
    x.includes("əlaqə saxla") ||
    x.includes("elaqe saxla") ||
    x.includes("sabah") ||
    x.includes("tomorrow") ||
    x.includes("callback") ||
    x.includes("call back") ||
    x.includes("devis") ||
    x.includes("presupuesto")
  );
}