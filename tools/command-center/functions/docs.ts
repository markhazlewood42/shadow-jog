import { handleDocs } from '../src/hosted/docs';

// Source of the Vercel Function GET /api/docs/<repo path> (Node runtime, Web standard handler). It is NOT a function by itself: `scripts/build-functions.mjs`
// bundles it into the generated `api/docs.js`. The handler takes the doc path from the `path` query parameter (vercel.json rewrites /api/docs/:path* to it),
// or from the URL path, and checks it against the allow-list. The logic is in src/hosted/docs.ts.
export default {
  fetch: (request: Request): Promise<Response> => handleDocs(request, { env: process.env }),
};
