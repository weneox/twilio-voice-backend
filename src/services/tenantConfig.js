import { cfg } from "../config.js";

function s(v, d = "") {
  return String(v ?? d).trim();
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

const LOCAL_TENANTS = {
  default: {
    ok: true,
    tenantKey: s(cfg.DEFAULT_TENANT_KEY, "default"),
    companyName: "NEOX",
    defaultLanguage: "az",

    contact: {
      phoneLocal: "051 800 55 77",
      phoneIntl: "+994 51 800 55 77",
      emailLocal: "info@neox.az",
      emailIntl: "info@weneox.com",
    },

    operator: {
      phone: s(cfg.OPERATOR_PHONE, "+994518005577"),
      callerId: s(cfg.TWILIO_CALLER_ID),
    },

    realtime: {
      model: s(cfg.OPENAI_REALTIME_MODEL, "gpt-4o-realtime-preview"),
      voice: s(cfg.OPENAI_REALTIME_VOICE, "alloy"),
      instructions: s(cfg.OPENAI_REALTIME_INSTRUCTIONS),
      reconnectMax: Number(cfg.OPENAI_REALTIME_RECONNECT_MAX || 2) || 2,
    },

    voiceProfile: {
      companyName: "NEOX",
      assistantName: "Ayla",
      roleLabel: "virtual assistant",
      defaultLanguage: "az",
      purpose: "sales",
      tone: "warm_professional",
      answerStyle: "short_clear",
      askStyle: "single_question",
      businessSummary:
        "NEOX şirkəti veb sayt, AI chatbot, səsli AI agent və biznes avtomatlaşdırma həlləri təqdim edir.",
      allowedTopics: ["xidmətlər", "qiymət", "təklif", "əlaqə", "operator", "görüş"],
      forbiddenTopics: ["politics", "religion"],
      leadCaptureMode: "name_phone",
      transferMode: "operator",
      contactPolicy: {
        sharePhone: true,
        shareEmail: true,
        shareWebsite: false,
      },
      texts: {
        greeting: {
          az: "Salam, mən NEOX şirkətinin virtual asistentiyəm. Sizə necə kömək edə bilərəm?",
          en: "Hello! I’m the virtual assistant for NEOX. How can I help you?",
          ru: "Здравствуйте! Я виртуальный ассистент компании NEOX. Чем могу помочь?",
          tr: "Merhaba, ben NEOX şirketinin sanal asistanıyım. Size nasıl yardımcı olabilirim?",
        },
      },
    },
  },
};

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

function buildLocalResolvedConfig(tenant) {
  const localKey = s(tenant?.tenantKey).toLowerCase();

  if (localKey && LOCAL_TENANTS[localKey]) {
    return clone(LOCAL_TENANTS[localKey]);
  }

  const fallback = clone(LOCAL_TENANTS.default);
  fallback.tenantKey = s(tenant?.tenantKey, fallback.tenantKey || "default");
  return fallback;
}

function finalizeConfig(remoteConfig, tenant) {
  const localBase = buildLocalResolvedConfig(tenant);

  if (!remoteConfig) return localBase;

  const merged = mergeDeep(localBase, remoteConfig);

  merged.ok = true;
  merged.tenantKey = s(
    remoteConfig?.tenantKey || tenant?.tenantKey || localBase.tenantKey || "default"
  );
  merged.companyName = s(
    remoteConfig?.companyName || localBase.companyName || merged.tenantKey
  );
  merged.defaultLanguage = s(
    remoteConfig?.defaultLanguage || localBase.defaultLanguage || "az"
  ).toLowerCase();

  merged.contact = mergeDeep(localBase.contact || {}, remoteConfig?.contact || {});
  merged.operator = mergeDeep(localBase.operator || {}, remoteConfig?.operator || {});
  merged.realtime = mergeDeep(localBase.realtime || {}, remoteConfig?.realtime || {});
  merged.voiceProfile = mergeDeep(localBase.voiceProfile || {}, remoteConfig?.voiceProfile || {});

  merged.voiceProfile.companyName = s(
    merged.voiceProfile.companyName || merged.companyName || "Company"
  );
  merged.voiceProfile.defaultLanguage = s(
    merged.voiceProfile.defaultLanguage || merged.defaultLanguage || "az"
  ).toLowerCase();

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