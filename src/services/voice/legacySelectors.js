import { norm } from "./shared.js";

export function looksLikeServicesList(text) {
  const x = norm(text);
  return (
    x.includes("xidmət") ||
    x.includes("xidmet") ||
    x.includes("services") ||
    x.includes("nə edirsiniz") ||
    x.includes("ne edirsiniz") ||
    x.includes("what do you do") ||
    x.includes("offer") ||
    x.includes("servicios") ||
    x.includes("leistungen") ||
    x.includes("prestations")
  );
}

export function looksLikeWebsite(text) {
  const x = norm(text);
  return (
    x.includes("veb") ||
    x.includes("web") ||
    x.includes("sayt") ||
    x.includes("site") ||
    x.includes("website") ||
    x.includes("landing")
  );
}

export function looksLikeChatbot(text) {
  const x = norm(text);
  return (
    x.includes("chatbot") ||
    x.includes("catbot") ||
    x.includes("assistent") ||
    x.includes("assistant") ||
    x.includes("бот")
  );
}

export function looksLikeAIAgent(text) {
  const x = norm(text);
  return (
    x.includes("ai agent") ||
    (x.includes("ai") && x.includes("agent")) ||
    x.includes("səsli agent") ||
    x.includes("sesli agent") ||
    x.includes("voice agent")
  );
}

export function looksLikeAutomation(text) {
  const x = norm(text);
  return (
    x.includes("avtomat") ||
    x.includes("automation") ||
    x.includes("inteqr") ||
    x.includes("crm") ||
    x.includes("erp") ||
    x.includes("integration")
  );
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
    x.includes("quote")
  );
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