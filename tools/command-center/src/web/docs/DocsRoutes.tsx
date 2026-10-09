import { Link, Route, Routes, useLocation } from 'react-router';
import type { DocPageData, DocsListing, ModuleName } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import { usePanel } from '../usePanel';
import { Decisions } from './Decisions';
import { DocView } from './DocView';
import { Gone, missingDocOf } from './Gone';
import { Overview } from './Overview';
import { docApiPath, slugFromPath } from './paths';
import { PrevNext } from './PrevNext';
import { SearchBox } from './SearchBox';
import { SectionTree } from './SectionTree';

/** The docs pages reload when the docs module says something changed (a doc was edited, added, moved or removed). */
const DOCS_MODULES: readonly ModuleName[] = ['docs'];

/** A doc also reloads when the decisions change, because the banners above its headings are the open decisions: an answer must take its banner away. */
const DOC_MODULES: readonly ModuleName[] = ['docs', 'decisions'];

/**
 * The top bar of every docs page: the name of the tool (a link to the start page), the parts of
 * the site, and the search. It stays at the top while a long doc scrolls.
 */
function DocsHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-cc-rule-solid bg-cc-paper">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link to="/" className="font-semibold tracking-tight cc-focus-ring">
          Shadow Jog Command Center
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          <Link to="/" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Now
          </Link>
          <Link to="/docs/roadmap/README" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Roadmap
          </Link>
          <Link to="/docs" aria-current="page" className="text-cc-ink cc-focus-ring">
            Docs
          </Link>
          <Link to="/agents" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Agents
          </Link>
        </nav>
        {/* On a narrow window the search takes a row of its own, instead of shrinking to nothing. */}
        <div className="flex min-w-0 basis-full justify-end sm:flex-1 sm:basis-0">
          <SearchBox />
        </div>
      </div>
    </header>
  );
}

/**
 * The page of one doc, by the address. It loads the doc as a panel (so it has the loading, error and
 * updated-at states of every panel) and keeps it current: the server says when a doc changes. An
 * address that no doc has is not an error of the panel but a page of its own (Gone).
 *
 * A doc in the reading order of the engine docs ends with the Previous and Next buttons. The footer
 * is given only when there is something to put in it: an empty footer would still draw its ruled box.
 */
function DocRoute({ slug }: { slug: string }) {
  const result = usePanel<DocPageData>(docApiPath(slug), DOC_MODULES);
  const suggestions = missingDocOf(result.panel);
  if (suggestions !== null) return <Gone slug={slug} suggestions={suggestions} />;
  return (
    <PanelFrame title="Document" result={result}>
      {(doc) => <DocView doc={doc} footer={doc.readingOrder ? <PrevNext order={doc.readingOrder} /> : undefined} />}
    </PanelFrame>
  );
}

/**
 * The docs site, mounted at /docs and everything under it: the header with the search, the section
 * tree on the left, and the page that the address names (the overview at /docs, a doc below it).
 *
 * The list of docs and the nav are loaded once here and shared by the tree and the overview, so the
 * two never disagree. Each of them still shows its own error state and its own time of update.
 */
export function DocsRoutes() {
  const location = useLocation();
  const listing = usePanel<DocsListing>('/api/docs', DOCS_MODULES);
  const slug = slugFromPath(location.pathname);

  return (
    <div className="min-h-screen">
      <DocsHeader />
      <div className="mx-auto grid max-w-[96rem] items-start gap-6 px-4 py-6 sm:px-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
          <PanelFrame title="Sections" result={listing}>
            {(data) => <SectionTree nav={data.nav} activeSlug={slug} activePath={location.pathname} />}
          </PanelFrame>
        </div>
        <main className="min-w-0">
          {/* Another page of the docs site is one more <Route> here, above the one for a doc. */}
          <Routes>
            <Route index element={<Overview listing={listing} />} />
            <Route path="decisions" element={<Decisions />} />
            {/* A key makes each doc start fresh: its own panel, with no trace of the doc before it. */}
            <Route path="*" element={slug === null ? <Overview listing={listing} /> : <DocRoute key={slug} slug={slug} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
