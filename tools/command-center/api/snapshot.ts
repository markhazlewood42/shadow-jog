import { handleSnapshot } from '../src/hosted/snapshot';

// Vercel Function (Node runtime, Web standard handler): GET /api/snapshot. The logic is in src/hosted/snapshot.ts.
export default {
  fetch: (request: Request): Promise<Response> => handleSnapshot(request, { env: process.env }),
};
