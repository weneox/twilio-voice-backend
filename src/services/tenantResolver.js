import { cfg } from "../config.js";

function s(v, d = "") {
  return String(v ?? d).trim();
}

function normalizePhone(v) {
  return s(v).replace(/[^\d+]/g, "");
}

export async function resolveTenantFromRequest(req) {
  const tenantKey =
    s(req.headers["x-tenant-key"]) ||
    s(req.query?.tenantKey) ||
    s(req.body?.tenantKey);

  const toNumber =
    normalizePhone(req.body?.To) ||
    normalizePhone(req.query?.To) ||
    normalizePhone(req.body?.Called) ||
    normalizePhone(req.query?.Called);

  if (tenantKey) {
    return {
      ok: true,
      tenantKey,
      matchedBy: "tenantKey",
      toNumber: toNumber || null,
    };
  }

  if (toNumber) {
    return {
      ok: true,
      tenantKey: null,
      matchedBy: "toNumber",
      toNumber,
    };
  }

  return {
    ok: true,
    tenantKey: s(cfg.DEFAULT_TENANT_KEY || "default"),
    matchedBy: "default",
    toNumber: null,
  };
}