function s(v, d = "") {
  return String(v ?? d).trim();
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function postJson(fetchFn, url, token, payload, timeoutMs = 8000) {
  if (!url) {
    return { ok: false, status: 0, data: null, text: "missing_url" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-internal-token": s(token),
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });

    const text = await resp.text().catch(() => "");
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return {
      ok: resp.ok,
      status: resp.status,
      data,
      text,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: String(err?.message || err || "request_failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createAihqVoiceClient({
  fetchFn,
  baseUrl,
  internalToken,
  timeoutMs = 8000,
  debug = false,
}) {
  const root = s(baseUrl).replace(/\/+$/, "");
  const token = s(internalToken);

  function log(...args) {
    if (!debug) return;
    console.log("[aihqVoiceClient]", ...args);
  }

  function canUse() {
    return !!(root && token && fetchFn);
  }

  async function call(path, payload = {}) {
    if (!canUse()) {
      log("skipped", {
        hasBaseUrl: !!root,
        hasToken: !!token,
        hasFetch: !!fetchFn,
        path,
      });

      return {
        ok: false,
        skipped: true,
        status: 0,
        data: null,
        text: "client_not_configured",
      };
    }

    const url = `${root}${path.startsWith("/") ? path : `/${path}`}`;
    const result = await postJson(fetchFn, url, token, payload, timeoutMs);

    if (!result.ok) {
      log("request failed", {
        path,
        status: result.status,
        text: s(result.text).slice(0, 300),
      });
    } else {
      log("request ok", {
        path,
        status: result.status,
      });
    }

    return result;
  }

  async function upsertSession(payload = {}) {
    return call("/api/internal/voice/session/upsert", payload);
  }

  async function appendTranscript(payload = {}) {
    return call("/api/internal/voice/session/transcript", payload);
  }

  async function updateSessionState(payload = {}) {
    return call("/api/internal/voice/session/state", payload);
  }

  async function markOperatorJoin(payload = {}) {
    return call("/api/internal/voice/session/operator-join", payload);
  }

  async function fetchTenantConfig(payload = {}) {
    return call("/api/internal/voice/tenant-config", payload);
  }

  return {
    canUse,
    upsertSession,
    appendTranscript,
    updateSessionState,
    markOperatorJoin,
    fetchTenantConfig,
  };
}