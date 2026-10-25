// Shared JSON transport. Independent of editor state and UI initialization.
export async function requestJson(path, opts = {}) {
  const res = await fetch(path, { ...opts, signal: opts.signal ?? AbortSignal.timeout(15000) });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const detail = Array.isArray(body?.detail) ? body.detail.map((e) => `${e.loc.slice(1).join(".")}: ${e.msg}`).join("; ") : body?.detail;
    const error = new Error(detail || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = body?.error?.code;
    error.requestId = body?.error?.request_id;
    throw error;
  }
  return body;
}
