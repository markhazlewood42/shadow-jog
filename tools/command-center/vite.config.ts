import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the page app. Its source is src/web (index.html is the entry) and the build goes to
// dist/, which the server serves (see src/server/app.ts). `npm run cc` runs this build first.
//
// The hosted build (Vercel) is the same app built with VITE_HOSTED=1 (vercel.json): the page then reads /api/snapshot and /api/live and not the local
// server (src/web/hosted). `CC_OUT_DIR` moves the output, so the end-to-end tests of the hosted page build next to dist/ and not over it.
export default defineConfig({
  root: join(import.meta.dirname, 'src', 'web'),
  plugins: [react(), tailwindcss()],
  resolve: {
    // The doc renderer of the server imports `posix` from node:path. A browser has no node:path, so the hosted page gets four small functions of its own (it renders docs).
    // Only the hosted build (VITE_HOSTED=1, read from the environment of the build, as vercel.json and playwright.hosted.config.ts set it) has the alias. The local build keeps the real node:path.
    alias: process.env.VITE_HOSTED === '1' ? [{ find: /^node:path$/, replacement: join(import.meta.dirname, 'src', 'web', 'hosted', 'posix.ts') }] : [],
  },
  build: {
    outDir: process.env.CC_OUT_DIR ?? join(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Never turn a font or an image into a data: URL. The server's content policy asks for files.
    assetsInlineLimit: 0,
    // Writes dist/.vite/manifest.json: which chunk holds which source file, and what each chunk imports. A test reads it to prove that the glass of the Now page
    // (PlasmaUI) is in a chunk of its own that no other page loads. The server serves only dist/index.html and dist/assets/, so the manifest is not served.
    manifest: true,
  },
});
