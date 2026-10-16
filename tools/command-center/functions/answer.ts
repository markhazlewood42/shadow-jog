import { handleAnswer } from '../src/hosted/answer';

// Source of the Vercel Function POST /api/answer (Node runtime, Web standard handler). `scripts/build-functions.mjs` bundles it into the generated `api/answer.js`.
// The logic is in src/hosted/answer.ts. This is the one function that writes to GitHub.
export default {
  fetch: (request: Request): Promise<Response> => handleAnswer(request, { env: process.env }),
};
