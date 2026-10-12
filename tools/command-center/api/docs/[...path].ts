import { handleDocs } from '../../src/hosted/docs';

// Vercel Function (Node runtime, Web standard handler): GET /api/docs/<repo path>. The file name `[...path].ts` is a catch-all segment.
// The handler reads the path from the request URL (not from a framework parameter) and checks it against the allow-list. The logic is in src/hosted/docs.ts.
export default {
  fetch: (request: Request): Promise<Response> => handleDocs(request, { env: process.env }),
};
