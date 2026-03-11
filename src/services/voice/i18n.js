import { s } from "./shared.js";

function pickLangFromMap(map, fallback = "en") {
  const m = map && typeof map === "object" ? map : {};
  const f = String(fallback || "en").toLowerCase();

  if (m[f]) return f;
  if (m.en) return "en";

  const first = Object.keys(m)[0];
  return first || "en";
}

function getVoiceProfile(tenantConfig = null) {
  const vp =
    tenantConfig?.voiceProfile && typeof tenantConfig.voiceProfile === "object"
      ? tenantConfig.voiceProfile
      : {};

  const companyName = s(vp.companyName || tenantConfig?.companyName, "Company");
  const assistantName = s(vp.assistantName, "Virtual Assistant");
  const roleLabel = s(vp.roleLabel, "virtual assistant");
  const defaultLang = s(vp.defaultLanguage || tenantConfig?.defaultLanguage, "en").toLowerCase();

  const contactPhoneLocal = s(tenantConfig?.contact?.phoneLocal, "");
  const contactPhoneIntl = s(tenantConfig?.contact?.phoneIntl, "");
  const contactEmailLocal = s(tenantConfig?.contact?.emailLocal, "");
  const contactEmailIntl = s(tenantConfig?.contact?.emailIntl, "");
  const website = s(tenantConfig?.contact?.website, "");

  const texts = vp.texts && typeof vp.texts === "object" ? vp.texts : {};

  return {
    companyName,
    assistantName,
    roleLabel,
    defaultLang,
    contactPhoneLocal,
    contactPhoneIntl,
    contactEmailLocal,
    contactEmailIntl,
    website,
    texts,
  };
}

function makeDefaultTexts(profile) {
  const { companyName, assistantName, roleLabel } = profile;

  return {
    greeting: {
      az: `Salam, mən ${companyName} şirkətinin ${roleLabel}iyəm. Sizə necə kömək edə bilərəm?`,
      tr: `Merhaba, ben ${companyName} şirketinin ${roleLabel}ıyım. Size nasıl yardımcı olabilirim?`,
      ru: `Здравствуйте! Я ${roleLabel} компании ${companyName}. Чем могу помочь?`,
      en: `Hello! I’m the ${roleLabel} for ${companyName}. How can I help you?`,
      es: `¡Hola! Soy la ${roleLabel} de ${companyName}. ¿En qué puedo ayudarte?`,
      de: `Hallo! Ich bin die ${roleLabel} von ${companyName}. Wie kann ich helfen?`,
      fr: `Bonjour ! Je suis la ${roleLabel} de ${companyName}. Comment puis-je vous aider ?`,
    },

    misheard: {
      az: "Bağışlayın, sizi aydın eşitmədim. Zəhmət olmasa bir daha təkrar edin.",
      tr: "Kusura bakmayın, net duyamadım. Lütfen bir kez daha tekrar eder misiniz?",
      ru: "Извините, я не расслышал(а). Повторите, пожалуйста, ещё раз.",
      en: "Sorry, I couldn’t hear that clearly. Could you please repeat it once more?",
      es: "Perdón, no lo escuché bien. ¿Podrías repetirlo una vez más?",
      de: "Entschuldigung, ich habe das nicht klar gehört. Können Sie es bitte wiederholen?",
      fr: "Désolé(e), je n’ai pas bien entendu. Pouvez-vous répéter une fois, s’il vous plaît ?",
    },

    off_topic: {
      az: `Bağışlayın, mən yalnız ${companyName} ilə bağlı mövzularda kömək edə bilərəm.`,
      tr: `Üzgünüm, yalnızca ${companyName} ile ilgili konularda yardımcı olabilirim.`,
      ru: `Извините, я могу помочь только по вопросам, связанным с ${companyName}.`,
      en: `Sorry, I can only help with topics related to ${companyName}.`,
      es: `Lo siento, solo puedo ayudar con temas relacionados con ${companyName}.`,
      de: `Entschuldigung, ich kann nur bei Themen rund um ${companyName} helfen.`,
      fr: `Désolé(e), je peux aider uniquement sur les sujets liés à ${companyName}.`,
    },

    goodbye: {
      az: "Çox sağ olun. Gününüz xoş keçsin.",
      tr: "Çok teşekkürler. İyi günler dilerim.",
      ru: "Спасибо большое. Хорошего вам дня.",
      en: "Thank you. Have a nice day.",
      es: "Muchas gracias. Que tenga un buen día.",
      de: "Vielen Dank. Ich wünsche Ihnen einen schönen Tag.",
      fr: "Merci beaucoup. Je vous souhaite une excellente journée.",
    },

    thanks_continue: {
      az: `Buyurun — ${companyName} ilə bağlı başqa sualınız var?`,
      tr: `Rica ederim — ${companyName} ile ilgili başka bir sorunuz var mı?`,
      ru: `Пожалуйста — у вас есть ещё вопрос по ${companyName}?`,
      en: `You’re welcome — do you have another question about ${companyName}?`,
      es: `De nada — ¿tienes otra pregunta sobre ${companyName}?`,
      de: `Gern — haben Sie noch eine Frage zu ${companyName}?`,
      fr: `Avec plaisir — avez-vous une autre question sur ${companyName} ?`,
    },

    ask_contact: {
      az: "Başa düşdüm. Əlaqə üçün adınızı və telefon nömrənizi rəqəm-rəqəm deyin.",
      tr: "Anladım. İletişim için adınızı ve telefon numaranızı rakam rakam söyleyin.",
      ru: "Понял(а). Для связи назовите, пожалуйста, имя и номер телефона цифра за цифрой.",
      en: "Got it. Please say your name and phone number digit by digit so we can contact you.",
      es: "Entendido. Dime tu nombre y tu número de teléfono dígito por dígito para poder contactarte.",
      de: "Verstanden. Bitte nennen Sie Ihren Namen und Ihre Telefonnummer Ziffer für Ziffer, damit wir Sie kontaktieren können.",
      fr: "Compris. Dites votre nom et votre numéro de téléphone chiffre par chiffre pour que nous puissions vous contacter.",
    },

    ask_yes_no: {
      az: 'Zəhmət olmasa "bəli" və ya "yox" deyin.',
      tr: 'Lütfen "evet" ya da "hayır" deyin.',
      ru: 'Скажите "да" или "нет", пожалуйста.',
      en: 'Please say "yes" or "no".',
      es: 'Por favor di "sí" o "no".',
      de: 'Bitte sagen Sie "ja" oder "nein".',
      fr: 'Veuillez dire "oui" ou "non".',
    },

    transfer_offer: {
      az: "İstəsəniz, sizi operatora yönləndirə bilərəm. Qoşum?",
      tr: "İsterseniz sizi operatöre bağlayabilirim. Bağlayayım mı?",
      ru: "Если хотите, я могу соединить вас с оператором. Соединить?",
      en: "If you want, I can connect you to an operator. Should I do that?",
      es: "Si quieres, puedo conectarte con un operador. ¿Lo hago?",
      de: "Wenn Sie möchten, kann ich Sie mit einem Operator verbinden. Soll ich das tun?",
      fr: "Si vous voulez, je peux vous mettre en relation avec un opérateur. Je le fais ?",
    },

    transfer_ack: {
      az: "Yaxşı, sizi operatora yönləndirirəm.",
      tr: "Tamam, sizi operatöre bağlıyorum.",
      ru: "Хорошо, соединяю с оператором.",
      en: "Okay, I will connect you to an operator.",
      es: "De acuerdo, te conecto con un operador.",
      de: "Okay, ich verbinde Sie mit einem Operator.",
      fr: "D’accord, je vous mets en relation avec un opérateur.",
    },

    ask_user_question: {
      az: "Oldu. Buyurun, sualınızı deyin.",
      tr: "Tamam. Lütfen sorunuzu söyleyin.",
      ru: "Хорошо. Скажите ваш вопрос.",
      en: "Okay. Please tell me your question.",
      es: "De acuerdo. Dime tu pregunta.",
      de: "Okay. Bitte sagen Sie Ihre Frage.",
      fr: "D’accord. Dites votre question.",
    },

    fallback_short: {
      az: `${assistantName} olaraq sizə kömək etməyə hazıram. Buyurun, davam edin.`,
      tr: `${assistantName} olarak size yardımcı olmaya hazırım. Buyurun, devam edin.`,
      ru: `Я готов(а) помочь вам как ${roleLabel}. Продолжайте, пожалуйста.`,
      en: `I’m ready to help you as the ${roleLabel}. Please continue.`,
      es: `Estoy listo/a para ayudarte como ${roleLabel}. Continúa, por favor.`,
      de: `Ich bin bereit, Ihnen als ${roleLabel} zu helfen. Bitte fahren Sie fort.`,
      fr: `Je suis prêt(e) à vous aider en tant que ${roleLabel}. Continuez, s’il vous plaît.`,
    },

    contact_unavailable: {
      az: "Hazırda əlaqə məlumatı mövcud deyil.",
      tr: "Şu anda iletişim bilgileri mevcut değil.",
      ru: "Контактные данные сейчас недоступны.",
      en: "Contact details are not currently available.",
      es: "Los datos de contacto no están disponibles en este momento.",
      de: "Kontaktdaten sind derzeit nicht verfügbar.",
      fr: "Les coordonnées ne sont pas disponibles pour le moment.",
    },
  };
}

function mergeTextMaps(defaults, custom) {
  const out = { ...defaults };
  const c = custom && typeof custom === "object" ? custom : {};

  for (const key of Object.keys(c)) {
    if (c[key] && typeof c[key] === "object" && !Array.isArray(c[key])) {
      out[key] = { ...(defaults[key] || {}), ...c[key] };
    } else {
      out[key] = c[key];
    }
  }

  return out;
}

export function makeI18n(tenantConfig = null) {
  const profile = getVoiceProfile(tenantConfig);
  const defaults = makeDefaultTexts(profile);
  const mergedTexts = mergeTextMaps(defaults, profile.texts);

  return {
    companyName: profile.companyName,
    assistantName: profile.assistantName,
    roleLabel: profile.roleLabel,
    defaultLang: profile.defaultLang,
    contactPhoneLocal: profile.contactPhoneLocal,
    contactPhoneIntl: profile.contactPhoneIntl,
    contactEmailLocal: profile.contactEmailLocal,
    contactEmailIntl: profile.contactEmailIntl,
    website: profile.website,
    texts: mergedTexts,
  };
}

export function pickLang(lang, dict) {
  const L = String(lang || dict?.defaultLang || "en").toLowerCase();
  const greetingMap = dict?.texts?.greeting || {};

  if (greetingMap[L]) return L;
  return pickLangFromMap(greetingMap, dict?.defaultLang || "en");
}

function readText(bucket, lang, tenantConfig = null) {
  const dict = makeI18n(tenantConfig);
  const L = pickLang(lang, dict);
  const map = dict?.texts?.[bucket] || {};

  return map[L] || map.en || Object.values(map)[0] || "";
}

export function getGreeting(lang, tenantConfig = null) {
  return readText("greeting", lang, tenantConfig);
}

export function misheardReply(lang, tenantConfig = null) {
  return readText("misheard", lang, tenantConfig);
}

export function offTopicReply(lang, tenantConfig = null) {
  return readText("off_topic", lang, tenantConfig);
}

export function goodbyeReplyFormalHangup(lang, tenantConfig = null) {
  return readText("goodbye", lang, tenantConfig);
}

export function thanksContinueReply(lang, tenantConfig = null) {
  return readText("thanks_continue", lang, tenantConfig);
}

export function askUserContact(lang, tenantConfig = null) {
  return readText("ask_contact", lang, tenantConfig);
}

export function askYesNo(lang, tenantConfig = null) {
  return readText("ask_yes_no", lang, tenantConfig);
}

export function connectOperatorAck(lang, tenantConfig = null) {
  return readText("transfer_ack", lang, tenantConfig);
}

export function askTellQuestion(lang, tenantConfig = null) {
  return readText("ask_user_question", lang, tenantConfig);
}

export function fallbackShort(lang, tenantConfig = null) {
  return readText("fallback_short", lang, tenantConfig);
}

export function contactUnavailableReply(lang, tenantConfig = null) {
  return readText("contact_unavailable", lang, tenantConfig);
}

export function buildContactReply(lang, isAz, tenantConfig = null) {
  const dict = makeI18n(tenantConfig);
  const L = pickLang(lang, dict);

  const phone = isAz ? dict.contactPhoneLocal : dict.contactPhoneIntl;
  const email = isAz ? dict.contactEmailLocal : dict.contactEmailIntl;

  const parts = [];
  if (phone) parts.push({ key: "phone", value: phone });
  if (email) parts.push({ key: "email", value: email });

  if (!parts.length) {
    return contactUnavailableReply(lang, tenantConfig);
  }

  const phoneValue = phone || "-";
  const emailValue = email || "-";
  const companyName = dict.companyName;

  if (L === "ru") {
    return `Контакты ${companyName}: телефон ${phoneValue}, email ${emailValue}. Соединить с оператором?`;
  }
  if (L === "tr") {
    return `${companyName} iletişim: telefon ${phoneValue}, e-posta ${emailValue}. Operatöre bağlayayım mı?`;
  }
  if (L === "en") {
    return `${companyName} contact: phone ${phoneValue}, email ${emailValue}. Connect you to an operator?`;
  }
  if (L === "es") {
    return `Contacto de ${companyName}: teléfono ${phoneValue}, email ${emailValue}. ¿Te conecto con un operador?`;
  }
  if (L === "de") {
    return `${companyName} Kontakt: Telefon ${phoneValue}, E-Mail ${emailValue}. Soll ich Sie mit einem Operator verbinden?`;
  }
  if (L === "fr") {
    return `Contact ${companyName} : téléphone ${phoneValue}, email ${emailValue}. Voulez-vous être mis en relation avec un opérateur ?`;
  }

  return `${companyName} əlaqə: telefon ${phoneValue}, email ${emailValue}. Operatora qoşum?`;
}