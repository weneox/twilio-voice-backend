import { cfg } from "../config.js";

function s(v, d = "") {
  return String(v ?? d).trim();
}

function n(v, d) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function clone(x) {
  return x ? JSON.parse(JSON.stringify(x)) : x;
}

function isObj(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function mergeDeep(base, extra) {
  const out = clone(base) || {};

  if (!isObj(extra)) return out;

  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) {
      out[k] = [...v];
      continue;
    }

    if (isObj(v)) {
      out[k] = mergeDeep(isObj(out[k]) ? out[k] : {}, v);
      continue;
    }

    if (v !== undefined && v !== null && String(v) !== "") {
      out[k] = v;
    } else if (!(k in out)) {
      out[k] = v;
    }
  }

  return out;
}

function buildGenericBaseConfig(tenant = {}) {
  const tenantKey = s(tenant?.tenantKey || cfg.DEFAULT_TENANT_KEY || "default").toLowerCase();
  const defaultLanguage = s(cfg.DEFAULT_LANGUAGE || "en").toLowerCase();

  return {
    ok: true,
    tenantKey,
    companyName: s(tenant?.companyName || "Company"),
    defaultLanguage,

    contact: {
      phoneLocal: "",
      phoneIntl: "",
      emailLocal: "",
      emailIntl: "",
      website: "",
    },

    operator: {
      phone: s(cfg.OPERATOR_PHONE),
      callerId: s(cfg.TWILIO_CALLER_ID),
    },

    realtime: {
      model: s(cfg.OPENAI_REALTIME_MODEL, "gpt-4o-realtime-preview"),
      voice: s(cfg.OPENAI_REALTIME_VOICE, "alloy"),
      instructions: s(cfg.OPENAI_REALTIME_INSTRUCTIONS),
      reconnectMax: n(cfg.OPENAI_REALTIME_RECONNECT_MAX, 2),
    },

    voiceProfile: {
      companyName: s(tenant?.companyName || "Company"),
      assistantName: "",
      roleLabel: "virtual assistant",
      defaultLanguage,
      purpose: "general",
      tone: "professional",
      answerStyle: "short_clear",
      askStyle: "single_question",
      businessSummary: "",
      allowedTopics: [],
      forbiddenTopics: [],
      leadCaptureMode: "none",
      transferMode: "manual",
      contactPolicy: {
        sharePhone: false,
        shareEmail: false,
        shareWebsite: false,
      },
      texts: {
        greeting: {},
      },
    },
  };
}

async function tryFetchTenantFromAiHq({ tenantKey, toNumber }) {
  if (!cfg.AIHQ_BASE_URL || !cfg.AIHQ_INTERNAL_TOKEN) {
    console.log("[tenantConfig] AIHQ fetch skipped: missing AIHQ_BASE_URL or AIHQ_INTERNAL_TOKEN");
    return null;
  }

  try {
    const url = `${s(cfg.AIHQ_BASE_URL).replace(/\/+$/, "")}/api/internal/voice/tenant-config`;

    console.log("[tenantConfig] fetching from AIHQ", {
      url,
      tenantKey: s(tenantKey),
      toNumber: s(toNumber),
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "x-internal-token": s(cfg.AIHQ_INTERNAL_TOKEN),
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        tenantKey: s(tenantKey),
        toNumber: s(toNumber),
      }),
    });

    const text = await resp.text().catch(() => "");
    let json = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!resp.ok) {
      console.log("[tenantConfig] AIHQ fetch non-200", {
        status: resp.status,
        body: text || null,
      });
      return null;
    }

    if (!json?.ok) {
      console.log("[tenantConfig] AIHQ fetch invalid payload", {
        body: json || text || null,
      });
      return null;
    }

    console.log("[tenantConfig] AIHQ fetch success", {
      tenantKey: json?.tenantKey || null,
      companyName: json?.companyName || null,
    });

    return json;
  } catch (err) {
    console.log("[tenantConfig] AIHQ fetch failed", {
      error: String(err?.message || err || "unknown"),
    });
    return null;
  }
}

function finalizeConfig(remoteConfig, tenant) {
  const base = buildGenericBaseConfig(tenant);

  if (!remoteConfig) return base;

  const merged = mergeDeep(base, remoteConfig);

  merged.ok = true;
  merged.tenantKey = s(
    remoteConfig?.tenantKey || tenant?.tenantKey || base.tenantKey || "default"
  ).toLowerCase();

  merged.companyName = s(
    remoteConfig?.companyName || tenant?.companyName || base.companyName || "Company"
  );

  merged.defaultLanguage = s(
    remoteConfig?.defaultLanguage || base.defaultLanguage || "en"
  ).toLowerCase();

  merged.contact = mergeDeep(base.contact || {}, remoteConfig?.contact || {});
  merged.operator = mergeDeep(base.operator || {}, remoteConfig?.operator || {});
  merged.realtime = mergeDeep(base.realtime || {}, remoteConfig?.realtime || {});
  merged.voiceProfile = mergeDeep(base.voiceProfile || {}, remoteConfig?.voiceProfile || {});

  merged.voiceProfile.companyName = s(
    merged.voiceProfile.companyName || merged.companyName || "Company"
  );

  merged.voiceProfile.defaultLanguage = s(
    merged.voiceProfile.defaultLanguage || merged.defaultLanguage || "en"
  ).toLowerCase();

  if (!isObj(merged.voiceProfile.contactPolicy)) {
    merged.voiceProfile.contactPolicy = {
      sharePhone: false,
      shareEmail: false,
      shareWebsite: false,
    };
  }

  if (!isObj(merged.voiceProfile.texts)) {
    merged.voiceProfile.texts = {};
  }

  if (!isObj(merged.voiceProfile.texts.greeting)) {
    merged.voiceProfile.texts.greeting = {};
  }

  return merged;
}

export async function getTenantVoiceConfig({ tenant }) {
  const aiTenant = await tryFetchTenantFromAiHq({
    tenantKey: tenant?.tenantKey || null,
    toNumber: tenant?.toNumber || null,
  });

  const resolved = finalizeConfig(aiTenant, tenant);

  console.log("[tenantConfig] resolved config", {
    tenantKey: resolved?.tenantKey || null,
    companyName: resolved?.companyName || null,
    hasRemote: !!aiTenant,
    operatorPhone: resolved?.operator?.phone || null,
    contactPhoneIntl: resolved?.contact?.phoneIntl || null,
  });

  return resolved;
}