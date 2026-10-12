import { handleLive } from '../src/hosted/live';

// Source of the Vercel Function GET /api/live (Node runtime, Web standard handler). `scripts/build-functions.mjs` bundles it into the generated `api/live.js`.
// The logic is in src/hosted/live.ts.
export default {
  fetch: (request: Request): Promise<Response> => handleLive(request, { env: process.env }),
};
