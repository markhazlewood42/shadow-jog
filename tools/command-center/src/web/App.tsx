import { LoaderCircle } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router';
import { DecisionRoute } from './decisions/DecisionPage';
import { DocsRoutes } from './docs/DocsRoutes';

// The Now page is loaded when it is first asked for, and not with the rest of the app. It is the one page that draws glass (PlasmaUI, which brings a WebGL
// renderer), so a chunk of its own keeps that code out of the docs pages and the decision pages: they never download it. (A test scans the build for this.)
const NowPage = lazy(() => import('./now/NowPage').then((module) => ({ default: module.NowPage })));

/** What the page shows for the moment that the file of the Now page is on its way. It is local, so this is short. */
function NowLoading() {
  return (
    <p role="status" className="flex items-center gap-2 px-6 py-10 text-cc-muted">
      <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
      Loading…
    </p>
  );
}

/**
 * The pages of the app, by address. /docs and everything under it is the docs site, and /decisions/<n> is the page of one
 * decision. Every other address shows the Now page, so a page that a later task adds is one more <Route> above the last.
 * The router itself (BrowserRouter) is in main.tsx, so a test can put this under a router of its own.
 */
export function App() {
  return (
    <Routes>
      <Route path="/docs/*" element={<DocsRoutes />} />
      <Route path="/decisions/:number" element={<DecisionRoute />} />
      <Route
        path="*"
        element={
          <Suspense fallback={<NowLoading />}>
            <NowPage />
          </Suspense>
        }
      />
    </Routes>
  );
}
