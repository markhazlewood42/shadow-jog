import { handleSnapshot } from '../src/hosted/snapshot';

// Source of the Vercel Function GET /api/snapshot (Node runtime, Web standard handler). `scripts/build-functions.mjs` bundles it into the generated `api/snapshot.js`.
// The logic is in src/hosted/snapshot.ts.
export default {
  fetch: (request: Request): Promise<Response> => handleSnapshot(request, { env: process.env }),
};
