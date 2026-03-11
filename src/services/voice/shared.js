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

export function s(v, d = "") {
  return String(v ?? d).trim();
}