// GENERATED FILE. Do not edit. It is built from functions/docs.ts by scripts/build-functions.mjs.
// After editing functions/ or src/, run: node scripts/build-functions.mjs   and commit api/*.js (Vercel finds functions in the uploaded source, before any build).
import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);

// src/server/github/github.ts
var MERGED_KEPT_MS = 7 * 24 * 60 * 60 * 1e3;

// src/github-api/queries.ts
var OWNER = "markhazlewood42";
var REPO = "shadow-jog";
var COMMENTS_PAGE = 100;
var REFS_FRAGMENT = `
fragment RefsPage on RefConnection {
  totalCount
  pageInfo { hasNextPage endCursor }
  nodes {
    name
    target { __typename oid ... on Commit { committedDate messageHeadline } }
  }
}`;
var PR_FRAGMENT = `
fragment PrFields on PullRequest {
  number title url state isDraft headRefName headRefOid isCrossRepository updatedAt mergedAt reviewDecision
  author { login }
  mergeCommit { oid }
  latestReviews(first: 20) { totalCount nodes { author { login } state submittedAt } }
  files(first: 50) { totalCount nodes { path } }
  statusCheckRollup {
    contexts(first: 100) {
      totalCount
      nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      }
    }
  }
}`;
var ISSUE_FRAGMENT = `
fragment DecisionFields on Issue {
  number title url state body createdAt
  author { login }
  labels(first: 20) { nodes { name } }
  comments(first: ${COMMENTS_PAGE}) {
    pageInfo { hasNextPage endCursor }
    nodes { author { login } body createdAt }
  }
  timelineItems(itemTypes: [LABELED_EVENT], last: 100) {
    nodes { __typename ... on LabeledEvent { createdAt label { name } actor { login } } }
  }
}`;
var SNAPSHOT_QUERY = `
query Snapshot($owner: String!, $name: String!, $refsFirst: Int!, $openFirst: Int!, $recentFirst: Int!, $waitingFirst: Int!, $decidedFirst: Int!, $historyFirst: Int!, $author: String!, $mainRef: String!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: $refsFirst, orderBy: {field: ALPHABETICAL, direction: ASC}) { ...RefsPage }
    open: pullRequests(first: $openFirst, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage }
      nodes { ...PrFields }
    }
    recent: pullRequests(first: $recentFirst, states: [MERGED, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage }
      nodes { ...PrFields }
    }
    ci: ref(qualifiedName: $mainRef) {
      target {
        ... on Commit {
          history(first: $historyFirst) {
            nodes {
              oid
              checkSuites(first: 20) {
                nodes { status conclusion workflowRun { createdAt url workflow { name } } }
              }
            }
          }
        }
      }
    }
    waiting: issues(first: $waitingFirst, labels: ["decision"], states: [OPEN], filterBy: {createdBy: $author}, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      nodes { ...DecisionFields }
    }
    decided: issues(first: $decidedFirst, labels: ["decided"], states: [OPEN, CLOSED], filterBy: {createdBy: $author}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { ...DecisionFields }
    }
  }
}
${REFS_FRAGMENT}
${PR_FRAGMENT}
${ISSUE_FRAGMENT}`;
var REFS_PAGE_QUERY = `
query RefsPage($owner: String!, $name: String!, $first: Int!, $after: String!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: $first, after: $after, orderBy: {field: ALPHABETICAL, direction: ASC}) { ...RefsPage }
  }
}
${REFS_FRAGMENT}`;

// src/hosted/env.ts
var GITHUB_TOKEN_VAR = "GITHUB_TOKEN";
var valueOf = (env, name) => {
  const value = env[name]?.trim();
  return value === void 0 || value === "" ? null : value;
};
var readGithubToken = (env) => valueOf(env, GITHUB_TOKEN_VAR);

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
var SVG_HEADERS = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" };
function bytesResponse(bytes, contentType, cache, extra = {}) {
  return new Response(bytes, { status: 200, headers: { ...baseHeaders(cache), "Content-Type": contentType, ...extra } });
}
var notConfigured = () => errorResponse(500, "not configured", "not-configured");

// src/hosted/errors.ts
var DEFAULT_RETRY_SECONDS = 60;
var MAX_RETRY_SECONDS = 3600;
function mapAdapterError(error) {
  switch (error.code) {
    case "rate-limited": {
      const wanted = error.retryAfter ?? DEFAULT_RETRY_SECONDS;
      return { status: 503, kind: "rate-limited", error: "GitHub rate limit is used up", retryAfter: Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.ceil(wanted))) };
    }
    case "unauthorized":
      return { status: 502, kind: "unauthorized", error: "GitHub does not accept the server token" };
    case "network":
      return { status: 504, kind: "network", error: "GitHub could not be reached" };
    case "http-error":
      return { status: 502, kind: "http-error", error: "GitHub refused the request" };
    case "bad-response":
      return { status: 502, kind: "bad-response", error: "GitHub sent a reply that this server does not know" };
    case "graphql-error":
      return { status: 502, kind: "graphql-error", error: "GitHub reported an error" };
    case "graphql-partial":
      return { status: 503, kind: "graphql-partial", error: "GitHub answered in part, try again", retryAfter: 5 };
  }
}
function responseOf(map) {
  return errorResponse(map.status, map.error, map.kind, map.retryAfter === void 0 ? {} : { "Retry-After": String(map.retryAfter) });
}

// src/hosted/doc-path.ts
var PREFIX = "/api/docs/";
var SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var bad = (reason) => ({ ok: false, status: 400, reason });
function parseDocPath(pathname) {
  if (!pathname.startsWith(PREFIX)) return bad("not a docs path");
  const rest = pathname.slice(PREFIX.length);
  if (rest === "") return bad("empty path");
  if (rest.includes("%")) return bad("encoded characters are not allowed");
  if (rest.includes("\\") || rest.includes("\0")) return bad("backslash or null byte");
  const segments = rest.split("/");
  for (const segment of segments) {
    if (segment === "") return bad("empty part (an absolute path, a double slash or a trailing slash)");
    if (segment === "." || segment === ".." || segment.includes("..")) return bad("dot segment");
    if (!SEGMENT.test(segment)) return bad("character outside the plain set");
  }
  const last = segments[segments.length - 1];
  if (segments.length === 1) {
    return last.endsWith(".md") ? { ok: true, path: rest, type: "markdown" } : { ok: false, status: 404, reason: "not in the allow-list" };
  }
  if (segments[0] === "docs") {
    if (last.endsWith(".md")) return { ok: true, path: rest, type: "markdown" };
    if (last.endsWith(".png")) return { ok: true, path: rest, type: "png" };
    if (last.endsWith(".svg")) return { ok: true, path: rest, type: "svg" };
  }
  return { ok: false, status: 404, reason: "not in the allow-list" };
}
function docPathnameOf(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, reason: "bad URL" };
  }
  const queryValues = url.searchParams.getAll("path");
  if (queryValues.length > 1) return { ok: false, reason: "more than one path parameter" };
  const fromQuery = queryValues[0];
  const fromPath = url.pathname.startsWith(PREFIX) && url.pathname.length > PREFIX.length ? url.pathname.slice(PREFIX.length) : void 0;
  if (url.pathname !== "/api/docs" && url.pathname !== PREFIX && fromPath === void 0) return { ok: false, reason: "not a docs path" };
  if (fromQuery !== void 0 && fromPath !== void 0 && fromQuery !== fromPath) return { ok: false, reason: "the path and the path parameter differ" };
  const value = fromQuery ?? fromPath;
  if (value === void 0 || value === "") return { ok: false, reason: "empty path" };
  return { ok: true, pathname: `${PREFIX}${value}` };
}

// src/hosted/docs.ts
var DOCS_REF = "main";
var MAX_BYTES = 4e6;
var TIMEOUT_MS = 2e4;
var mediaTypeOf = (contentType) => (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
var CONTENT_TYPE = { markdown: "text/markdown; charset=utf-8", png: "image/png", svg: "image/svg+xml" };
var contentsUrl = (path) => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${DOCS_REF}`;
function failureOf(status, headers, now) {
  if (status === 404) return errorResponse(404, "not found", "not-found");
  if (status === 401) return responseOf(mapAdapterError({ code: "unauthorized" }));
  const retryAfter = headers.get("retry-after");
  const exhausted = headers.get("x-ratelimit-remaining") === "0";
  if (status === 429 || status === 403 && (exhausted || retryAfter !== null)) {
    const reset = Number(headers.get("x-ratelimit-reset"));
    const fromReset = exhausted && headers.get("x-ratelimit-reset") !== null && Number.isFinite(reset) ? reset - now.getTime() / 1e3 : void 0;
    const fromRetry = retryAfter !== null && retryAfter !== "" && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : void 0;
    const seconds = fromRetry ?? fromReset;
    return responseOf(mapAdapterError({ code: "rate-limited", ...seconds === void 0 ? {} : { retryAfter: seconds } }));
  }
  const map = mapAdapterError({ code: "http-error" });
  return responseOf(map);
}
async function readCapped(reply, max) {
  if (reply.body === null || reply.body === void 0) {
    const all = await reply.arrayBuffer();
    return all.byteLength > max ? null : all;
  }
  const reader = reply.body.getReader();
  const chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}
async function handleDocs(request, deps) {
  if (request.method !== "GET") return errorResponse(405, "method not allowed", "method", { Allow: "GET" });
  const requested = docPathnameOf(request.url);
  const parsed = requested.ok ? parseDocPath(requested.pathname) : { ok: false, status: 400, reason: requested.reason };
  if (!parsed.ok) return errorResponse(parsed.status, parsed.status === 404 ? "not found" : "bad path", parsed.status === 404 ? "not-found" : "bad-path");
  const token = readGithubToken(deps.env);
  if (token === null) return notConfigured();
  const send = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  try {
    const reply = await send(contentsUrl(parsed.path), {
      headers: {
        Authorization: `Bearer ${token}`,
        // The raw media type: GitHub sends the file bytes (text, PNG or SVG) and not a JSON wrapper with base64.
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "shadow-jog-command-center"
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!reply.ok) return failureOf(reply.status, reply.headers, (deps.now ?? (() => /* @__PURE__ */ new Date()))());
    if (mediaTypeOf(reply.headers.get("content-type")) === "application/json") return responseOf(mapAdapterError({ code: "bad-response" }));
    const announced = Number(reply.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > MAX_BYTES) return errorResponse(502, "file is too large", "too-large");
    const bytes = await readCapped(reply, MAX_BYTES);
    if (bytes === null) return errorResponse(502, "file is too large", "too-large");
    return bytesResponse(bytes, CONTENT_TYPE[parsed.type], CACHE.docs, parsed.type === "svg" ? SVG_HEADERS : {});
  } catch (error) {
    console.error(`docs failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return responseOf(mapAdapterError({ code: "network" }));
  }
}

// functions/docs.ts
var docs_default = {
  fetch: (request) => handleDocs(request, { env: process.env })
};
export {
  docs_default as default
};
