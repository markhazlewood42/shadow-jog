import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import { getMimeType } from 'hono/utils/mime';
import { APP_NAME, type Health } from '../shared/types';
import type { Config } from './config';
import { isMissing } from './fs-errors';
import { apiError, createHostGuard, createMethodGate } from './guard';
import type { Hub } from './hub';

/** What the app needs from the rest of the server. The composition root (compose.ts) provides it. */
export type AppDeps = {
  config: Config;
  hub: Hub;
  /** The secret of this run. It is put into the page as <meta name="cc-token">. */
  token: string;
  /** When this run started, as an ISO time. */
  startedAt: string;
  /** The tool's version, from its package.json. */
  version: string;
  /** The folder that holds the built page: index.html and assets/. */
  webRoot: string;
};

/** The tag in index.html that the server fills with the token. A page without it could never write. */
const TOKEN_TAG = /<meta\s+name="cc-token"[^>]*>/;

/**
 * Paths that belong to the server. An unknown one under them is a 404, not the page: a missing
 * script or image must not come back as HTML. Every other path is a page route, and the page
 * app (React) decides what it shows.
 */
const SERVER_PATHS = ['/api', '/assets', '/files'];
const isServerPath = (path: string) => SERVER_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/** The page, with this run's token in it. Null when the page is not built. */
async function readPage(webRoot: string, token: string): Promise<string | null> {
  let html: string;
  try {
    html = await readFile(join(webRoot, 'index.html'), 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!TOKEN_TAG.test(html)) throw new Error('index.html has no <meta name="cc-token"> tag, so its page could not send a write.');
  // A function as the replacement, so no "$" in the text is read as a pattern.
  return html.replace(TOKEN_TAG, () => `<meta name="cc-token" content="${token}">`);
}

/**
 * The HTTP app: guards, the API routes of the shell, the page and its files. Modules add their
 * own routes to it in compose.ts. Hono matches routes in the order they are added, and the page
 * is served by the not-found handler, so a route added later is never hidden by it.
 */
export function createApp(deps: AppDeps): Hono {
  const { config, hub, token, startedAt, version, webRoot } = deps;
  const app = new Hono();

  // 1. Security headers on every answer, the refusals below included. The page holds this run's
  //    write token, so no script that the page did not ship may run in it: the policy lets scripts
  //    load from this server only, and allows no inline script, no plugin and no <base> tag.
  const pageHeaders = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // React and the UI library set inline style attributes
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'self'"],
    },
    // The server speaks plain http on localhost, so a note to always use https would only confuse.
    strictTransportSecurity: false,
  });
  // The files of the repo that the site serves under /files (pictures, and the HTML and SVG sources of
  // diagrams) get a stricter policy, because one of them can be opened as a page of this site. An HTML or
  // SVG file can hold a script, and a script on this origin could read the token out of the main page.
  // `sandbox` (with nothing allowed back) turns scripts off and gives the file a made-up origin of its
  // own; `default-src 'none'` stops it from loading anything but its own styles and pictures.
  const fileHeaders = secureHeaders({
    contentSecurityPolicy: {
      sandbox: [],
      defaultSrc: ["'none'"],
      styleSrc: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
    },
    strictTransportSecurity: false,
  });
  app.use((c, next) => (c.req.path === '/files' || c.req.path.startsWith('/files/') ? fileHeaders(c, next) : pageHeaders(c, next)));

  // 2. Who may ask, and with what method.
  app.use(createHostGuard(config.port));
  app.use(createMethodGate());

  // 3. Data answers are never cached: a panel must show what is true now.
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // ---- routes ----

  app.get('/api/health', (c) => {
    const health: Health = { ok: true, name: APP_NAME, version, startedAt, gameUrl: config.gameUrl, links: config.links };
    return c.json(health);
  });

  // Server-sent events: one long answer that the server keeps writing to. The page opens it once
  // and reloads a panel whenever a "changed" event names that panel's module.
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      // The first thing a page gets. It shows the connection works, and a page that gets a second
      // one knows it was cut off and reconnected, so it may have missed events and reloads.
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ startedAt }) });

      const unsubscribe = hub.subscribe((change) => {
        void stream.writeSSE({ event: 'changed', data: JSON.stringify(change) });
      });
      stream.onAbort(unsubscribe);

      // Keep the answer open until the page goes away (a closed tab, or a lost connection).
      if (!stream.aborted) await new Promise<void>((done) => stream.onAbort(done));
      unsubscribe();
    }),
  );

  // The files Vite built: scripts, styles and fonts, with a hash in each name. The name is one
  // plain file name, never a path, so nothing outside assets/ can be asked for.
  app.get('/assets/:name', async (c) => {
    const name = c.req.param('name');
    if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) return c.json(apiError('not-found', 'No such file.'), 404);
    try {
      const file = await readFile(join(webRoot, 'assets', name));
      return c.body(new Uint8Array(file), 200, {
        'Content-Type': getMimeType(name) ?? 'application/octet-stream',
        // The hash in the name changes with the content, so a file can be kept for good.
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
    } catch (error) {
      if (isMissing(error)) return c.json(apiError('not-found', 'No such file.'), 404);
      throw error;
    }
  });

  // Everything else is a page route: the same index.html, and the page app shows the right page.
  app.notFound(async (c) => {
    if (isServerPath(c.req.path)) return c.json(apiError('not-found', 'No such route.'), 404);
    const html = await readPage(webRoot, token);
    if (html === null) {
      return c.text('The page app is not built yet (there is no index.html). Stop the server and start it again with "npm run cc"; that builds the page first.', 503);
    }
    c.header('Cache-Control', 'no-store'); // the token changes at each start
    return c.html(html);
  });

  app.onError((error, c) => {
    // The cause goes to the console, where Mark can read it. The page gets a short, safe message.
    console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, error);
    return c.json(apiError('internal-error', 'The server hit a problem. Its console has the details.'), 500);
  });

  return app;
}
