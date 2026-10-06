import { Button } from '@heroui/react';
import { LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { Component, type ReactNode, Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router';
import { AgentsPage } from './agents/AgentsPage';
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
 * Catches an error of the Now page, so that a page that cannot be drawn shows what is wrong and is not left blank. The error that matters most is the file of the page
 * failing to load: the server may have been restarted with a new build while this tab was open, and the file name that the old page asks for (it has a hash in it) is gone.
 * React offers no hook for this: an error boundary has to be a class.
 */
class NowErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-2xl flex-wrap items-start gap-3 px-6 py-10">
        {/* Ink, not amber: the Look keeps amber for the one or two focal items of a page. */}
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-ink" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">The Now page could not be shown.</p>
          <p className="mt-1 text-sm break-words text-cc-muted">{error.message}</p>
          <p className="mt-1 text-sm text-cc-muted">If the server was restarted while this page was open, the file of the page has a new name. Reload to get the new one.</p>
        </div>
        <Button size="sm" variant="tertiary" onPress={() => window.location.reload()}>
          <RefreshCw aria-hidden className="size-3.5" />
          Reload
        </Button>
      </div>
    );
  }
}

/**
 * The pages of the app, by address. /docs and everything under it is the docs site, /decisions/<n> is the page of one
 * decision, and /agents is the list of the sessions with their agents. Every other address shows the Now page, so a page
 * that a later task adds is one more <Route> above the last.
 * The router itself (BrowserRouter) is in main.tsx, so a test can put this under a router of its own.
 */
export function App() {
  return (
    <Routes>
      <Route path="/docs/*" element={<DocsRoutes />} />
      <Route path="/decisions/:number" element={<DecisionRoute />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route
        path="*"
        element={
          <NowErrorBoundary>
            <Suspense fallback={<NowLoading />}>
              <NowPage />
            </Suspense>
          </NowErrorBoundary>
        }
      />
    </Routes>
  );
}
