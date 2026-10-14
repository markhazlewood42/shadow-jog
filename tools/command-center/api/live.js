// GENERATED FILE. Do not edit. It is built from functions/live.ts by scripts/build-functions.mjs.
// After editing functions/ or src/, run: node scripts/build-functions.mjs   and commit api/*.js (Vercel finds functions in the uploaded source, before any build).
import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);

// src/shared/your-move.ts
var ASK_MAX_AGE_MS = 12 * 60 * 60 * 1e3;
var FUTURE_SLACK_MS = 60 * 1e3;

// src/shared/live.ts
var LIVE_OFFLINE_AFTER_SECONDS = 150;

// src/hosted/env.ts
var UPSTASH_URL_VAR = "KV_REST_API_URL";
var UPSTASH_READ_ONLY_TOKEN_VAR = "KV_REST_API_READ_ONLY_TOKEN";
var READ_WRITE_TOKEN_VARS = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"];
var readWriteVarIn = (env) => READ_WRITE_TOKEN_VARS.find((name) => env[name] !== void 0) ?? null;
var valueOf = (env, name) => {
  const value = env[name]?.trim();
  return value === void 0 || value === "" ? null : value;
};
function readUpstash(env) {
  const readWrite = readWriteVarIn(env);
  if (readWrite !== null) return { ok: false, reason: "misconfigured", detail: `${readWrite} (a read-write token) must be deleted from this project` };
  const url = valueOf(env, UPSTASH_URL_VAR);
  const token = valueOf(env, UPSTASH_READ_ONLY_TOKEN_VAR);
  if (url === null || token === null) return { ok: false, reason: "not-configured" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return { ok: false, reason: "misconfigured", detail: "the Upstash URL is not an https address" };
    return { ok: true, url: parsed.origin, token };
  } catch {
    return { ok: false, reason: "misconfigured", detail: "the Upstash URL is not an https address" };
  }
}

// src/hosted/http.ts
var CACHE = {
  snapshot: "s-maxage=15, stale-while-revalidate",
  docs: "s-maxage=60, stale-while-revalidate",
  /** For `/api/live`, and for every error answer. */
  none: "no-store"
};
var baseHeaders = (cache) => ({ "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
function jsonResponse(body, status, cache, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...baseHeaders(cache), "Content-Type": "application/json; charset=utf-8", ...extra } });
}
function errorResponse(status, error, kind, extra = {}) {
  return jsonResponse({ error, kind }, status, CACHE.none, extra);
}
function methodNotAllowed(request) {
  return request.method === "GET" || request.method === "HEAD" ? null : errorResponse(405, "method not allowed", "method", { Allow: "GET, HEAD" });
}
var notConfigured = () => errorResponse(500, "not configured", "not-configured");

// src/hosted/live.ts
var LIVE_KEY = "live";
var OFFLINE_AFTER_SECONDS = LIVE_OFFLINE_AFTER_SECONDS;
var TIMEOUT_MS = 1e4;
function reporterOf(live, now) {
  if (live === null || live === void 0) return { state: "not-running", writtenAt: null, ageSeconds: null, offlineAfterSeconds: OFFLINE_AFTER_SECONDS };
  const writtenAt = typeof live === "object" && !Array.isArray(live) ? live.writtenAt : void 0;
  const time = typeof writtenAt === "string" ? Date.parse(writtenAt) : Number.NaN;
  if (!Number.isFinite(time)) return { state: "offline", writtenAt: typeof writtenAt === "string" ? writtenAt : null, ageSeconds: null, offlineAfterSeconds: OFFLINE_AFTER_SECONDS };
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - time) / 1e3));
  return { state: ageSeconds > OFFLINE_AFTER_SECONDS ? "offline" : "online", writtenAt, ageSeconds, offlineAfterSeconds: OFFLINE_AFTER_SECONDS };
}
async function handleLive(request, deps) {
  const refused = methodNotAllowed(request);
  if (refused !== null) return refused;
  const settings = readUpstash(deps.env);
  if (!settings.ok) {
    if (settings.reason === "not-configured") return notConfigured();
    console.error(`misconfigured: ${settings.detail ?? "see the environment variables"}`);
    return errorResponse(500, "misconfigured", "misconfigured");
  }
  const send = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  let text;
  try {
    const reply = await send(`${settings.url}/get/${LIVE_KEY}`, { method: "GET", headers: { Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!reply.ok) return errorResponse(502, reply.status === 401 || reply.status === 403 ? "the store does not accept the read token" : "the store refused the request", "store-error");
    text = await reply.text();
  } catch (error) {
    console.error(`live read failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return errorResponse(504, "the store could not be reached", "store-unreachable");
  }
  let result;
  try {
    const body = JSON.parse(text);
    if (typeof body !== "object" || body === null || !("result" in body)) throw new Error("no result");
    result = body.result;
    if (typeof result === "string") result = JSON.parse(result);
    if (result !== null && result !== void 0 && (typeof result !== "object" || Array.isArray(result))) throw new Error("not an object");
  } catch {
    return errorResponse(502, "the stored value is not JSON", "bad-stored-value");
  }
  const live = result ?? null;
  const answer = { reporter: reporterOf(live, (deps.now ?? (() => /* @__PURE__ */ new Date()))()), live };
  return jsonResponse(answer, 200, CACHE.none);
}

// functions/live.ts
var live_default = {
  fetch: (request) => handleLive(request, { env: process.env })
};
export {
  live_default as default
};
