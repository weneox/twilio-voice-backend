import { cfg } from "../config.js";

function s(v, d = "") {
  return String(v ?? d).trim();
}

function clone(x) {
  return x ? JSON.parse(JSON.stringify(x)) : x;
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
  if (!cfg.AIHQ_BASE_URL || !cfg.AIHQ_INTERNAL_TOKEN) return null;

  try {
    const url = `${cfg.AIHQ_BASE_URL}/api/internal/voice/tenant-config`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "x-internal-token": cfg.AIHQ_INTERNAL_TOKEN,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        tenantKey: s(tenantKey),
        toNumber: s(toNumber),
      }),
    });

    if (!resp.ok) return null;

    const json = await resp.json().catch(() => null);
    if (!json?.ok) return null;

    return json;
  } catch {
    return null;
  }
}

export async function getTenantVoiceConfig({ tenant }) {
  const aiTenant = await tryFetchTenantFromAiHq({
    tenantKey: tenant?.tenantKey || null,
    toNumber: tenant?.toNumber || null,
  });

  if (aiTenant) return aiTenant;

  const localKey = s(tenant?.tenantKey).toLowerCase();
  if (localKey && LOCAL_TENANTS[localKey]) {
    return clone(LOCAL_TENANTS[localKey]);
  }

  return clone(LOCAL_TENANTS.default);
}