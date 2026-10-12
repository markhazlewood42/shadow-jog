import { handleLive } from '../src/hosted/live';

// Vercel Function (Node runtime, Web standard handler): GET /api/live. The logic is in src/hosted/live.ts.
export default {
  fetch: (request: Request): Promise<Response> => handleLive(request, { env: process.env }),
};
