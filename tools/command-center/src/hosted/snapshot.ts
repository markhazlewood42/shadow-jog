import { type FetchLike, fetchSnapshot } from '../github-api';
import { type Env, readGithubToken } from './env';
import { responseOf, mapAdapterError } from './errors';
import { CACHE, errorResponse, jsonResponse, methodNotAllowed, notConfigured } from './http';

// `GET /api/snapshot` (design.md section 6): the snapshot of the repo from the GitHub API adapter, as JSON.
// The Vercel CDN keeps the answer for 15 seconds (`s-maxage=15`), so many tabs share one pair of GraphQL calls. An error is never cached.

export type SnapshotDeps = { env: Env; fetchImpl?: FetchLike; now?: () => Date; sleep?: (ms: number) => Promise<void> };

/** The field name in the message of a shape problem ("... (call 1: refs.nodes is missing ...)"), or "unknown". Letters, digits, dots and spaces only, so no value can pass through. */
function fieldLabelOf(message: string): string {
  const found = /\(call 1(?:: |\): )([\w. -]{1,60}?)(?: is missing| has no)/.exec(message);
  return found?.[1] ?? 'unknown';
}

export async function handleSnapshot(request: Request, deps: SnapshotDeps): Promise<Response> {
  const refused = methodNotAllowed(request);
  if (refused !== null) return refused;
  const token = readGithubToken(deps.env);
  if (token === null) return notConfigured();
  try {
    const result = await fetchSnapshot({ token, ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }), ...(deps.now === undefined ? {} : { now: deps.now }), ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }) });
    if (!result.ok) {
      // One line for the log: the code, and for a shape problem only the label of the field (a name from this code, never a value of the reply, the token or a header).
      const label = result.error.code === 'bad-response' || result.error.code === 'graphql-incomplete' ? ` (field: ${fieldLabelOf(result.error.message)})` : '';
      console.error(`snapshot failed: ${result.error.code}${label}`);
      return responseOf(mapAdapterError(result.error));
    }
    return jsonResponse(result.data, 200, CACHE.snapshot);
  } catch (error) {
    // Only the name of the error is logged: its message could hold anything.
    console.error(`snapshot failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return errorResponse(500, 'internal error', 'internal');
  }
}
