import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the page app. Its source is src/web (index.html is the entry) and the build goes to
// dist/, which the server serves (see src/server/app.ts). `npm run cc` runs this build first.
export default defineConfig({
  root: join(import.meta.dirname, 'src', 'web'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: join(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Never turn a font or an image into a data: URL. The server's content policy asks for files.
    assetsInlineLimit: 0,
  },
});
