import { type FetchLike, fetchSnapshot } from '../github-api';
import { type Env, readGithubToken } from './env';
import { responseOf, mapAdapterError } from './errors';
import { CACHE, errorResponse, jsonResponse, methodNotAllowed, notConfigured } from './http';

// `GET /api/snapshot` (design.md section 6): the snapshot of the repo from the GitHub API adapter, as JSON.
// The Vercel CDN keeps the answer for 15 seconds (`s-maxage=15`), so many tabs share one pair of GraphQL calls. An error is never cached.

export type SnapshotDeps = { env: Env; fetchImpl?: FetchLike; now?: () => Date };

export async function handleSnapshot(request: Request, deps: SnapshotDeps): Promise<Response> {
  const refused = methodNotAllowed(request);
  if (refused !== null) return refused;
  const token = readGithubToken(deps.env);
  if (token === null) return notConfigured();
  try {
    const result = await fetchSnapshot({ token, ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }), ...(deps.now === undefined ? {} : { now: deps.now }) });
    if (!result.ok) return responseOf(mapAdapterError(result.error));
    return jsonResponse(result.data, 200, CACHE.snapshot);
  } catch (error) {
    // Only the name of the error is logged: its message could hold anything.
    console.error(`snapshot failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return errorResponse(500, 'internal error', 'internal');
  }
}
