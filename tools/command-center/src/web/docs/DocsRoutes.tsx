import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import type { DocPageData, DocsListing, ModuleName } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import { usePanel } from '../usePanel';
import { visibleNav } from '../hosted/mode';
import { Decisions } from './Decisions';
import { TitleSlotProvider } from './DocTitle';
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
 * The docs site, mounted at /docs and everything under it: the section tree on the left, and on the right the page that the address names (the overview at /docs, a doc below it)
 * under one row that holds the title of the page (its h1, at the left) and the search (at the right). A page puts its title in the row with <DocTitle>.
 *
 * The list of docs and the nav are loaded once here and shared by the tree and the overview, so the
 * two never disagree. Each of them still shows its own error state and its own time of update.
 */
export function DocsRoutes() {
  const location = useLocation();
  const listing = usePanel<DocsListing>('/api/docs', DOCS_MODULES);
  const slug = slugFromPath(location.pathname);
  // The element that holds the title of the page (see DocTitle). It is state and not a ref, so the page draws its title in it as soon as it exists.
  const [titleSlot, setTitleSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid max-w-[96rem] items-start gap-6 px-4 pt-4 pb-6 sm:px-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
          <PanelFrame title="Sections" result={listing}>
            {(data) => <SectionTree nav={visibleNav(data.nav)} activeSlug={slug} activePath={location.pathname} />}
          </PanelFrame>
        </div>
        <main className="min-w-0">
          {/* The title of the page at the left and the search at the right. On a phone the search wraps under the title. A page with no title leaves the left side empty (it takes no room), and the search stays at the right. */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div ref={setTitleSlot} className="min-w-0 empty:hidden" />
            <div className="w-full sm:ml-auto sm:w-80 sm:shrink-0">
              <SearchBox />
            </div>
          </div>
          {/* Another page of the docs site is one more <Route> here, above the one for a doc. */}
          <TitleSlotProvider value={titleSlot}>
            <Routes>
              <Route index element={<Overview listing={listing} />} />
              <Route path="decisions" element={<Decisions />} />
              {/* A key makes each doc start fresh: its own panel, with no trace of the doc before it. */}
              <Route path="*" element={slug === null ? <Overview listing={listing} /> : <DocRoute key={slug} slug={slug} />} />
            </Routes>
          </TitleSlotProvider>
        </main>
      </div>
    </div>
  );
}
