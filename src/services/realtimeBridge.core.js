// src/services/realtimeBridge.core.js
// ✅ PURE CORE LOGIC (no WS)
// ✅ No Arabic anywhere
// ✅ Lead summary for Telegram/Sheets is AZ-only, NOT raw quotes
// ✅ Extracts: service interest, confirmed contact, operator request, and meeting day/time
// ✅ Anti-duplicate guard: same transcript won't trigger response twice (helps stop "monologue-like" repeats)

export const MIN_RT_TEMP = 0.6;
export function rtTemp(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return MIN_RT_TEMP;
  return Math.max(MIN_RT_TEMP, n);
}

export function safeJsonParse(s) {
  try {
    if (typeof s !== "string") return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic constants */
export const PHONE_LOCAL_SPOKEN = "051 800 55 77";
export const PHONE_INTL_SPOKEN = "+994 51 800 55 77";
export const EMAIL_LOCAL = "info@neox.az";
export const EMAIL_INTL = "info@weneox.com";

export function callerLikelyAZ(fromE164) {
  const s = String(fromE164 || "").trim();
  return s.startsWith("+994") || s.startsWith("994");
}

/**
 * i18n dictionary
 * NOTE:
 * - Everything returned to the USER must be in user's language.
 * - Everything sent to TELEGRAM/Sheets/n8n "notes" should be Azerbaijani ONLY (see summarizeLeadAz()).
 * - Arabic removed completely.
 */
const I18N = {
  greeting: {
    az: "Salam, mən NEOX şirkətinin virtual asistentiyəm. Sizə necə kömək edə bilərəm?",
    tr: "Merhaba, ben NEOX şirketinin sanal asistanıyım. Size nasıl yardımcı olabilirim?",
    ru: "Здравствуйте! Я виртуальный ассистент компании NEOX. Чем могу помочь?",
    en: "Hello! I’m NEOX company’s virtual assistant. How can I help you?",
    es: "¡Hola! Soy la asistente virtual de NEOX. ¿En qué puedo ayudarte?",
    de: "Hallo! Ich bin die virtuelle Assistentin von NEOX. Wie kann ich helfen?",
    fr: "Bonjour ! Je suis l’assistante virtuelle de NEOX. Comment puis-je vous aider ?",
  },

  misheard: {
    az: "Bağışlayın, sizi aydın eşitmədim. Zəhmət olmasa bir daha təkrar edin.",
    tr: "Kusura bakmayın, net duyamadım. Lütfen bir kez daha tekrar eder misiniz?",
    ru: "Извините, я не расслышала. Повторите, пожалуйста, ещё раз.",
    en: "Sorry, I couldn’t hear that clearly. Could you please repeat it once more?",
    es: "Perdón, no lo escuché bien. ¿Podrías repetirlo una vez más?",
    de: "Entschuldigung, ich habe das nicht klar gehört. Können Sie es bitte wiederholen?",
    fr: "Désolée, je n’ai pas bien entendu. Pouvez-vous répéter une fois, s’il vous plaît ?",
  },

  offTopic: {
    az: "Bağışlayın, mən yalnız NEOX şirkəti ilə bağlı suallara cavab verə bilərəm.",
    tr: "Üzgünüm, yalnızca NEOX şirketi ile ilgili soruları yanıtlayabilirim.",
    ru: "Извините, я могу отвечать только на вопросы о компании NEOX.",
    en: "Sorry, I can only answer questions related to NEOX company.",
    es: "Lo siento, solo puedo responder preguntas relacionadas con NEOX.",
    de: "Entschuldigung, ich kann nur Fragen zu NEOX beantworten.",
    fr: "Désolée, je peux répondre uniquement aux questions liées à NEOX.",
  },

  goodbyeFormalHangup: {
    az: "Çox sağ olun. Gününüz xoş keçsin.",
    tr: "Çok teşekkürler. İyi günler dilerim.",
    ru: "Спасибо большое. Хорошего вам дня.",
    en: "Thank you. Have a nice day.",
    es: "Muchas gracias. Que tenga un buen día.",
    de: "Vielen Dank. Ich wünsche Ihnen einen schönen Tag.",
    fr: "Merci beaucoup. Je vous souhaite une excellente journée.",
  },

  thanksContinue: {
    az: "Buyurun — NEOX ilə bağlı başqa sualınız var?",
    tr: "Rica ederim — NEOX ile ilgili başka bir sorunuz var mı?",
    ru: "Пожалуйста — у вас есть ещё вопрос по NEOX?",
    en: "You’re welcome—do you have another question about NEOX?",
    es: "De nada—¿tienes otra pregunta sobre NEOX?",
    de: "Gern—haben Sie noch eine Frage zu NEOX?",
    fr: "Avec plaisir—avez-vous une autre question sur NEOX ?",
  },

  servicesPitch: {
    az: "Veb sayt, AI chatbot, səsli AI agent və biznes avtomatlaşdırma/inteqrasiyalar edirik. Hansı xidmət maraqlıdır?",
    tr: "Web site, AI chatbot, sesli asistan/agent ve otomasyon-entegrasyonlar yapıyoruz. Hangi hizmet ilginizi çeker?",
    ru: "Мы делаем сайты, AI чат-боты, голосовых ассистентов/агентов и автоматизацию/интеграции. Что вам интересно?",
    en: "We build websites, AI chatbots, voice assistants/agents, and business automation/integrations. Which service are you interested in?",
    es: "Creamos sitios web, chatbots de IA, asistentes/agentes de voz y automatización/integraciones. ¿Qué servicio te interesa?",
    de: "Wir erstellen Websites, KI-Chatbots, Sprachassistenten/Agenten sowie Automatisierung/Integrationen. Wofür interessieren Sie sich?",
    fr: "Nous créons des sites web, des chatbots IA, des assistants/agentes vocaux et de l’automatisation/intégrations. Quel service vous intéresse ?",
  },

  offerWebsite: {
    az: "Veb saytı iki formatda edirik: sadə korporativ və ya satış yönümlü (landing/e-commerce). Hansı format sizə uyğundur?",
    tr: "Web sitesini iki formatta yapıyoruz: basit kurumsal ya da satış odaklı (landing/e-ticaret). Hangi format uygundur?",
    ru: "Сайт можем сделать в двух вариантах: простой презентационный или продажный (landing/e-commerce). Какой формат нужен?",
    en: "We can build a simple corporate site or a sales-focused landing/e-commerce. Which format do you need?",
    es: "Podemos hacer un sitio corporativo simple o uno orientado a ventas (landing/e-commerce). ¿Qué formato necesitas?",
    de: "Wir können eine einfache Firmenwebsite oder eine verkaufsorientierte Landing/E-Commerce-Seite bauen. Welches Format brauchen Sie?",
    fr: "Nous pouvons créer un site vitrine simple ou un site orienté vente (landing/e-commerce). Quel format vous convient ?",
  },

  offerChatbot: {
    az: "AI chatbot-u ya sadə sual-cavab, ya da satış/lead toplayan ssenari ilə qururuq. Hansı sizə uyğundur?",
    tr: "AI chatbot’u ya basit soru-cevap, ya da satış/lead toplayan senaryo ile kuruyoruz. Hangisi uygun?",
    ru: "AI чат-бот делаем либо FAQ, либо продажный с лидогенерацией. Что вам больше подходит?",
    en: "We can set up a basic FAQ chatbot or a sales/lead-collecting chatbot. Which one do you want?",
    es: "Podemos crear un chatbot FAQ o uno de ventas para captar leads. ¿Cuál prefieres?",
    de: "Wir können einen FAQ-Chatbot oder einen Verkaufs/Lead-Chatbot bauen. Was passt besser?",
    fr: "Nous pouvons faire un chatbot FAQ ou un chatbot vente/collecte de leads. Lequel vous convient ?",
  },

  offerAutomation: {
    az: "Avtomatlaşdırmada CRM/WhatsApp/zənglər və hesabatları birləşdiririk. Hazırda hansı sistemdən istifadə edirsiniz?",
    tr: "Otomasyonda CRM/WhatsApp/aramalar ve raporlamayı birleştiriyoruz. Şu an hangi sistemi kullanıyorsunuz?",
    ru: "В автоматизации связываем CRM/WhatsApp/звонки и отчёты. Какая система у вас сейчас?",
    en: "For automation we connect CRM/WhatsApp/calls and reporting. What system do you currently use?",
    es: "En automatización conectamos CRM/WhatsApp/llamadas y reportes. ¿Qué sistema usas ahora?",
    de: "Bei Automatisierung verbinden wir CRM/WhatsApp/Anrufe und Reporting. Welches System nutzen Sie aktuell?",
    fr: "Pour l’automatisation, nous connectons CRM/WhatsApp/appels et reporting. Quel système utilisez-vous actuellement ?",
  },

  askUserContact: {
    az: "Başa düşdüm. Geri zəng üçün adınızı və telefon nömrənizi rəqəm-rəqəm deyin (məsələn 0-5-1…).",
    tr: "Anladım. Geri dönüş için adınızı ve telefon numaranızı rakam rakam söyleyin (örnek 0-5-1…).",
    ru: "Поняла. Для обратного звонка назовите, пожалуйста, имя и номер телефона цифра-за-цифрой (например 0-5-1…).",
    en: "Got it. Please say your name and phone number digit by digit (for example 0-5-1…), so we can call you back.",
    es: "Entendido. Para devolverte la llamada, dime tu nombre y tu teléfono dígito por dígito (por ejemplo 0-5-1…).",
    de: "Verstanden. Bitte nennen Sie Ihren Namen und Ihre Telefonnummer Ziffer für Ziffer (z. B. 0-5-1…), damit wir zurückrufen.",
    fr: "Compris. Dites votre nom et votre numéro de téléphone chiffre par chiffre (ex. 0-5-1…) pour qu’on vous rappelle.",
  },

  askYesNo: {
    az: 'Zəhmət olmasa "bəli" və ya "yox" deyin.',
    tr: 'Lütfen "evet" ya da "hayır" deyin.',
    ru: 'Скажите "да" или "нет", пожалуйста.',
    en: 'Please say "yes" or "no".',
    es: 'Por favor di "sí" o "no".',
    de: 'Bitte sagen Sie "ja" oder "nein".',
    fr: 'Veuillez dire "oui" ou "non".',
  },

  connectOperatorAck: {
    az: "Yaxşı, sizi operatora yönləndirirəm.",
    tr: "Tamam, sizi operatöre bağlıyorum.",
    ru: "Хорошо, соединяю с оператором.",
    en: "Okay, I will connect you to an operator.",
    es: "De acuerdo, te conecto con un operador.",
    de: "Okay, ich verbinde Sie mit einem Operator.",
    fr: "D’accord, je vous mets en relation avec un opérateur.",
  },

  askTellQuestion: {
    az: "Oldu. Buyurun, sualınızı deyin.",
    tr: "Tamam. Lütfen sorunuzu söyleyin.",
    ru: "Хорошо. Скажите ваш вопрос.",
    en: "Okay. Please tell me your question.",
    es: "De acuerdo. Dime tu pregunta.",
    de: "Okay. Bitte sagen Sie Ihre Frage.",
    fr: "D’accord. Dites votre question.",
  },
};

function pickLang(lang) {
  const L = String(lang || "az").toLowerCase();
  if (I18N.greeting[L]) return L;
  return "az";
}

export function getGreeting(lang) {
  const L = pickLang(lang);
  return I18N.greeting[L];
}

export function misheardReply(lang) {
  const L = pickLang(lang);
  return I18N.misheard[L];
}

export function offTopicReply(lang) {
  const L = pickLang(lang);
  return I18N.offTopic[L];
}

export function goodbyeReplyFormalHangup(lang) {
  const L = pickLang(lang);
  return I18N.goodbyeFormalHangup[L];
}

export function thanksContinueReply(lang) {
  const L = pickLang(lang);
  return I18N.thanksContinue[L];
}

export function servicesPitch(lang) {
  const L = pickLang(lang);
  return I18N.servicesPitch[L];
}

export function offerWebsite(lang) {
  const L = pickLang(lang);
  return I18N.offerWebsite[L];
}

export function offerChatbot(lang) {
  const L = pickLang(lang);
  return I18N.offerChatbot[L];
}

export function offerAutomation(lang) {
  const L = pickLang(lang);
  return I18N.offerAutomation[L];
}

export function askUserContact(lang) {
  const L = pickLang(lang);
  return I18N.askUserContact[L];
}

function askYesNo(lang) {
  const L = pickLang(lang);
  return I18N.askYesNo[L];
}

function connectOperatorAck(lang) {
  const L = pickLang(lang);
  return I18N.connectOperatorAck[L];
}

function askTellQuestion(lang) {
  const L = pickLang(lang);
  return I18N.askTellQuestion[L];
}

export function buildContactReply(lang, isAz) {
  const L = pickLang(lang);
  const phone = isAz ? PHONE_LOCAL_SPOKEN : PHONE_INTL_SPOKEN;
  const email = isAz ? EMAIL_LOCAL : EMAIL_INTL;

  if (L === "ru") return `Контакты NEOX: телефон ${phone}, email ${email}. Соединить с оператором?`;
  if (L === "tr") return `NEOX iletişim: telefon ${phone}, e-posta ${email}. Operatöre bağlayayım mı?`;
  if (L === "en") return `NEOX contact: phone ${phone}, email ${email}. Connect you to an operator?`;
  if (L === "es") return `Contacto NEOX: teléfono ${phone}, email ${email}. ¿Te conecto con un operador?`;
  if (L === "de") return `NEOX Kontakt: Telefon ${phone}, E-Mail ${email}. Soll ich Sie mit einem Operator verbinden?`;
  if (L === "fr") return `Contact NEOX : téléphone ${phone}, email ${email}. Voulez-vous être mis en relation avec un opérateur ?`;
  return `Əlaqə: ${phone}, email: ${email}. Operatora qoşum?`;
}

/** Score-based lang detect (Arabic removed) */
export function detectLang(text) {
  const t = String(text || "").trim();
  if (!t) return "az";
  if (/[А-Яа-яЁё]/.test(t)) return "ru";

  const low = norm(t);
  let az = 0,
    tr = 0,
    en = 0,
    es = 0,
    fr = 0,
    de = 0;

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
  const EN = ["hello", "price", "website", "chatbot", "automation", "meeting", "call", "quote", "budget"];
  const ES = ["hola", "precio", "sitio", "web", "chatbot", "automat", "reunión", "llamada", "presupuesto"];
  const FR = ["bonjour", "prix", "site", "web", "chatbot", "automatisation", "réunion", "appel", "devis"];
  const DE = ["hallo", "preis", "webseite", "chatbot", "automatisierung", "meeting", "anruf", "angebot"];

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

  if (scores[0][1] < 3) return "az";
  return scores[0][0];
}

export function looksLikeContactRequest(text) {
  const s = norm(text);
  return (
    s.includes("əlaqə") ||
    s.includes("elaqe") ||
    s.includes("nömr") ||
    s.includes("nomr") ||
    s.includes("telefon") ||
    s.includes("whatsapp") ||
    s.includes("email") ||
    s.includes("e-mail") ||
    s.includes("mail") ||
    s.includes("@") ||
    s.includes("contact") ||
    s.includes("numero") ||
    s.includes("teléfono") ||
    s.includes("numéro") ||
    s.includes("kontakt") ||
    s.includes("whats")
  );
}
export function looksLikeHumanRequest(text) {
  const s = norm(text);
  return (
    s.includes("operator") ||
    s.includes("canlı") ||
    s.includes("canli") ||
    s.includes("insan") ||
    s.includes("dəstək") ||
    s.includes("destek") ||
    s.includes("support") ||
    s.includes("manager") ||
    s.includes("agent") ||
    s.includes("live") ||
    s.includes("human")
  );
}
export function looksLikeHardGoodbye(text) {
  const s = norm(text);
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
    (s.includes("sabah") || s.includes("tomorrow") || s.includes("yarın")) &&
    (s.includes("əlaqə saxla") ||
      s.includes("elaqe saxla") ||
      s.includes("əlaqə saxlayacam") ||
      s.includes("elaqe saxlayacam") ||
      s.includes("call you") ||
      s.includes("te llamar") ||
      s.includes("rappeler"));
  return direct.some((k) => s.includes(k)) || tomorrowClose;
}
export function looksLikeThanksOnly(text) {
  const s = norm(text);
  return (
    s === "sağ ol" ||
    s === "sag ol" ||
    s.includes("çox sağ ol") ||
    s.includes("cox sag ol") ||
    s.includes("təşəkkür") ||
    s.includes("tesekkur") ||
    s.includes("thank") ||
    s.includes("thanks") ||
    s.includes("спасибо") ||
    s.includes("teşekkür") ||
    s.includes("saol") ||
    s.includes("gracias") ||
    s.includes("merci") ||
    s.includes("danke")
  );
}
export function looksLikeYes(text) {
  const s = norm(text);
  return s === "bəli" || s === "beli" || s === "hə" || s === "he" || s === "ok" || s.includes("olar") || s === "yes" || s === "да" || s === "evet" || s === "sí" || s === "si" || s === "oui" || s === "ja";
}
export function looksLikeNo(text) {
  const s = norm(text);
  return s === "yox" || s.includes("istemir") || s.includes("lazim deyil") || s === "no" || s === "нет" || s.includes("hayir") || s === "non" || s === "nein";
}
export function looksClearlyOffTopic(text) {
  const s = norm(text);

  const on = [
    "neox",
    "xidmət",
    "xidmet",
    "qiym",
    "dəyər",
    "deyer",
    "təklif",
    "teklif",
    "avtomat",
    "assistent",
    "assistant",
    "agent",
    "voice",
    "zəng",
    "zeng",
    "support",
    "dəstək",
    "destek",
    "inteqr",
    "crm",
    "erp",
    "whatsapp",
    "telegram",
    "chatbot",
    "site",
    "sayt",
    "website",
    "landing",
    "e-commerce",
    "reklam",
    "kampaniya",
    "smm",
    "video",
    "brend",
    "biznes",
    "business",
    "automation",
    "integration",
    "price",
    "budget",
    "quote",
    "meeting",
  ];
  if (on.some((k) => s.includes(k))) return false;

  const off = ["hava", "musiqi", "film", "oyun", "siyas", "dini", "tibb", "resept", "idman", "futbol", "weather", "music", "movie", "politic", "religion", "medicine"];
  return off.some((k) => s.includes(k));
}
export function isMeaningfulTranscript(t, minChars) {
  const s = String(t || "").trim();
  if (s.length < minChars) return false;
  if (!/[a-zA-Z0-9əğıöüşçƏĞİÖÜŞÇА-Яа-яЁё]/.test(s)) return false;

  const low = norm(s);
  if (["hə", "he", "hmm", "mm", "aaa", "eee", "uh", "eh", "ok"].includes(low)) return false;
  if (low.split(" ").length === 1 && s.length <= 5) return false;
  if (/(.)\1{6,}/.test(low)) return false;

  return true;
}

export function looksLikeServicesList(text) {
  const s = norm(text);
  return s.includes("xidmət") || s.includes("xidmet") || s.includes("services") || s.includes("nə edirsiniz") || s.includes("ne edirsiniz") || s.includes("what do you do") || s.includes("offer") || s.includes("servicios") || s.includes("leistungen") || s.includes("prestations");
}
export function looksLikeWebsite(text) {
  const s = norm(text);
  return s.includes("veb") || s.includes("web") || s.includes("sayt") || s.includes("site") || s.includes("website") || s.includes("landing");
}
export function looksLikeChatbot(text) {
  const s = norm(text);
  return s.includes("chatbot") || s.includes("catbot") || s.includes("assistent") || s.includes("assistant") || s.includes("бот");
}
export function looksLikeAIAgent(text) {
  const s = norm(text);
  return s.includes("ai agent") || (s.includes("ai") && s.includes("agent")) || s.includes("səsli agent") || s.includes("sesli agent") || s.includes("voice agent");
}
export function looksLikeAutomation(text) {
  const s = norm(text);
  return s.includes("avtomat") || s.includes("automation") || s.includes("inteqr") || s.includes("crm") || s.includes("erp") || s.includes("integration");
}
export function looksLikePricing(text) {
  const s = norm(text);
  return s.includes("qiym") || s.includes("price") || s.includes("dəyər") || s.includes("deyer") || s.includes("cost") || s.includes("paket") || s.includes("budget") || s.includes("quote");
}
export function looksLikeLeadIntent(text) {
  const s = norm(text);
  return (
    s.includes("sifariş") ||
    s.includes("sifaris") ||
    s.includes("order") ||
    s.includes("qiym") ||
    s.includes("price") ||
    s.includes("paket") ||
    s.includes("təklif") ||
    s.includes("teklif") ||
    s.includes("görüş") ||
    s.includes("gorus") ||
    s.includes("meeting") ||
    s.includes("əlaqə saxla") ||
    s.includes("elaqe saxla") ||
    s.includes("sabah") ||
    s.includes("tomorrow") ||
    s.includes("callback") ||
    s.includes("call back") ||
    s.includes("devis") ||
    s.includes("presupuesto")
  );
}

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
  const wantsMeeting = low.includes("görüş") || low.includes("gorus") || low.includes("meeting") || low.includes("call back") || low.includes("callback") || low.includes("zəng") || low.includes("zeng") || low.includes("əlaqə saxla") || low.includes("elaqe saxla");

  if (!wantsMeeting && !dayAz && !time) return { scheduled: false, dayAz: null, time: null, textAz: null };

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

export function buildStrictInstructions() {
  const NEOX_CONTEXT =
    (process.env.NEOX_CONTEXT || "").trim() ||
    [
      "NEOX şirkəti AI və avtomatlaşdırma həlləri təqdim edir.",
      "Xidmətlər: veb sayt, AI chatbot, səsli AI agent/assistent, biznes avtomatlaşdırma və inteqrasiyalar.",
      "Məqsəd: qısa, dəqiq cavab + 1 məntiqli sual ilə müştərini növbəti addıma aparmaq.",
    ].join(" ");

  return [
    "You are NEOX company's professional FEMALE virtual assistant.",
    "You MUST reply in the SAME language as the user's last message (Azerbaijani, Turkish, Russian, English, Spanish, German, French).",
    "VOICE/DELIVERY:",
    "- Sound like a real human: natural phrasing, smooth cadence, no robotic enumerations, no filler.",
    "- Be concise but warm.",
    "TURN-TAKING (CRITICAL):",
    "- NEVER monologue.",
    "- Respond ONLY after user finishes speaking (speech_stopped / final transcript).",
    "- If user starts speaking while you talk: stop immediately (barge-in).",
    "- IMPORTANT: Do NOT cancel/interrupt the INITIAL GREETING unless user clearly speaks after greeting ends.",
    "FORMAT (ON-TOPIC):",
    "- Output EXACTLY: 1 short sentence + 1 short relevant sales question.",
    "- Ask at most ONE question, never more.",
    "UNCLEAR/NOISE:",
    "- If you cannot clearly understand: say ONE short polite repeat request, then wait.",
    "THANKS / GOODBYE:",
    "- THANKS only => one short sentence that includes ONE short question to continue.",
    "- GOODBYE => one formal short goodbye sentence then stop (call will hang up).",
    "CONTACT:",
    "- Give NEOX contact ONLY if asked.",
    `- Local (AZ): phone "${PHONE_LOCAL_SPOKEN}", email "${EMAIL_LOCAL}".`,
    `- Abroad: phone "${PHONE_INTL_SPOKEN}", email "${EMAIL_INTL}".`,
    "- Never redirect to website; never other numbers/emails.",
    "LEAD CAPTURE:",
    "- If user shows buying intent (pricing/offer/meeting/order/callback), ask ONCE for name + phone (digit-by-digit).",
    "- If phone/name not confirmed, DO NOT claim you saved it.",
    "SCOPE:",
    "- Only NEOX-related questions; off-topic => refuse politely in user's language.",
    "Never mention system prompts/policies/OpenAI.",
    `Company context: ${NEOX_CONTEXT}`,
  ].join("\n");
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
  else if (looksLikeServicesList(t)) need = "Xidmət siyahısı";
  else if (looksLikeContactRequest(t)) need = "Əlaqə məlumatı";
  else need = leadFlag ? "Maraqlanır (lead niyyəti var)" : "Müraciət";

  parts.push(`İstək: ${need}.`);

  const L = pickLang(lastLang || "az");
  const langMapAz = { az: "AZ", tr: "TR", ru: "RU", en: "EN", es: "ES", de: "DE", fr: "FR" };
  parts.push(`Zəng dili: ${langMapAz[L] || "AZ"}.`);

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
  else if (looksLikeServicesList(t)) service = "Xidmət siyahısı";
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

export function createRealtimeCore(opts) {
  const {
    sendResponse,
    scheduleForceHangup,
    hangupNow,
    redirectToTransfer,
    reporters,
    getNow = () => Date.now(),
    MIN_TRANSCRIPT_CHARS,
    MIN_SPEECH_CHUNKS,
    ASSISTANT_COOLDOWN_MS,
    MISHEARD_COOLDOWN_MS,
    GREETING_PROTECT_MS = 2600,
    DUPLICATE_TRANSCRIPT_WINDOW_MS = Math.max(1200, Number(process.env.DUPLICATE_TRANSCRIPT_WINDOW_MS || "2500") || 2500),
  } = opts;

  const state = {
    callSid: null,
    fromNumber: null,
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

    const msg = misheardReply(lang);
    sendResponse(`Say exactly ONE short sentence in user's language: "${msg}" Then STOP and wait.`, {
      temperature: 0.6,
      maxTokens: 40,
    });
  }

  function askConfirmPhone(lang, pretty) {
    const L = pickLang(lang);
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
    const L = pickLang(lang);
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
        sendResponse(`Say exactly ONE short sentence in user's language: "${askUserContact(lang)}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 60,
        });
        return true;
      }

      sendResponse(`Say exactly ONE short sentence in user's language: "${askYesNo(lang)}" Then stop.`, {
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

        const L = pickLang(lang);
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
        sendResponse(`Say exactly ONE short sentence in user's language: "${askUserContact(lang)}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 60,
        });
        return true;
      }

      sendResponse(`Say exactly ONE short sentence in user's language: "${askYesNo(lang)}" Then stop.`, {
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

      const L = pickLang(lang);
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
    const s = String(t || "").trim();
    if (!s) return false;
    if (s === state.lastHandledText && now - state.lastHandledAt < DUPLICATE_TRANSCRIPT_WINDOW_MS) return true;
    return false;
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
      const bye = goodbyeReplyFormalHangup(lang);

      const sent = sendResponse(`Say exactly ONE short sentence in user's language: "${bye}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 34,
      });

      markHandledTranscript(t);
      scheduleForceHangup(sent ? 7500 : 2500);
      return;
    }

    if (looksLikeThanksOnly(t)) {
      const rep = thanksContinueReply(lang);
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

        const ack = connectOperatorAck(lang);
        sendResponse(`Say exactly ONE short sentence in user's language: "${ack}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 28,
        });

        markHandledTranscript(t);
        return;
      }

      if (looksLikeNo(t)) {
        state.awaitingTransferConfirm = false;
        const msg = askTellQuestion(lang);
        sendResponse(`Say exactly ONE short sentence in user's language: "${msg}" Then stop.`, {
          temperature: 0.6,
          maxTokens: 28,
        });
        markHandledTranscript(t);
        return;
      }

      sendResponse(`Say exactly ONE short sentence in user's language: "${askYesNo(lang)}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 18,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikeContactRequest(t) || looksLikeHumanRequest(t)) {
      state.awaitingTransferConfirm = true;
      const contact = buildContactReply(lang, isAzCaller);
      sendResponse(`Say this EXACTLY in user's language (single sentence): "${contact}" Then stop and wait.`, {
        temperature: 0.6,
        maxTokens: 80,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksClearlyOffTopic(t)) {
      const r = offTopicReply(lang);
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
      const q = askUserContact(lang);
      sendResponse(`Say exactly ONE short sentence in user's language: "${q}" Then stop.`, {
        temperature: 0.62,
        maxTokens: 80,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikeServicesList(t)) {
      const pitch = servicesPitch(lang);
      sendResponse(`Say this in user's language as ONE sentence (it already includes a question): "${pitch}" Then stop.`, {
        temperature: 0.6,
        maxTokens: 120,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikeWebsite(t)) {
      const offer = offerWebsite(lang);
      sendResponse(`Say exactly ONE sentence in user's language: "${offer}" Then stop.`, {
        temperature: 0.62,
        maxTokens: 120,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikeAIAgent(t) || looksLikeChatbot(t)) {
      const offer = offerChatbot(lang);
      sendResponse(`Say exactly ONE sentence in user's language: "${offer}" Then stop.`, {
        temperature: 0.62,
        maxTokens: 120,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikeAutomation(t)) {
      const offer = offerAutomation(lang);
      sendResponse(`Say exactly ONE sentence in user's language: "${offer}" Then stop.`, {
        temperature: 0.62,
        maxTokens: 120,
      });
      markHandledTranscript(t);
      return;
    }

    if (looksLikePricing(t)) {
      sendResponse(
        "Reply in user's language. Format MUST be: 1 short sentence + 1 short question. " +
          "Sentence: say pricing depends on scope (very short). " +
          "Question: ask ONE qualifier that moves to sale (deadline OR pages/features OR channels). " +
          "Then STOP.",
        { temperature: 0.62, maxTokens: 110 }
      );
      markHandledTranscript(t);
      return;
    }

    sendResponse(
      "Reply in user's language. Format MUST be: 1 short sentence + 1 short relevant question. " +
        "Answer ONLY what user asked; no extra topics. If vague, ask ONE clarifier that moves toward a sale. " +
        "Then STOP.",
      { temperature: 0.64, maxTokens: 120 }
    );
    markHandledTranscript(t);
  }

  function markGreetingStarted(lang = "az") {
    state.greetingInProgress = true;
    state.greetingStartedAt = getNow();
    state.lastLang = pickLang(lang);
  }
  function markGreetingFinished() {
    state.greetingInProgress = false;
    state.greeted = true;
  }
  function isGreetingProtectedNow() {
    if (!state.greetingInProgress) return false;
    return getNow() - state.greetingStartedAt < GREETING_PROTECT_MS;
  }

  function resetForNewCall({ callSid, fromNumber }) {
    state.callSid = callSid || null;
    state.fromNumber = fromNumber || null;

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