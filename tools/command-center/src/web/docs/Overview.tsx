import { Button } from '@heroui/react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { DocsListing, NavItem, NavSection } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import type { PanelResult } from '../usePanel';
import { docPath } from './paths';
import { useDocumentTitle } from './useDocumentTitle';

/** How many pages a card lists before "Show all". The nav lists the main page of a section first, so the first ones are the key pages. */
const KEY_PAGES = 5;

// Cyan, as every link. A list of links needs no line under each one: the color and the place say that they are links.
const LINK_CLASS = 'text-cc-link underline-offset-2 hover:underline cc-focus-ring';

function PageRow({ item }: { item: NavItem }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <Link to={item.kind === 'doc' ? docPath(item.slug) : item.path} className={`min-w-0 ${LINK_CLASS}`}>
        {item.title}
      </Link>
      {item.kind === 'doc' ? (
        // The day the doc last changed, as the server wrote it. A time zone must not move it, so it is shown as text.
        <time dateTime={item.updated} className="shrink-0 font-mono text-xs text-cc-soft">
          {item.updated}
        </time>
      ) : (
        <span className="shrink-0 font-mono text-xs text-cc-soft">page</span>
      )}
    </li>
  );
}

/** One section of the nav: its key pages with the day each one last changed, and a way to see the rest. */
function SectionCard({ section }: { section: NavSection }) {
  const titleId = useId();
  const listId = useId();
  const [showAll, setShowAll] = useState(false);
  const items = showAll ? section.items : section.items.slice(0, KEY_PAGES);
  const rest = section.items.length - KEY_PAGES;

  return (
    <section aria-labelledby={titleId} className="flex flex-col rounded-lg border border-cc-rule-solid bg-cc-paper p-4">
      <h3 id={titleId} className="text-base font-semibold">
        {section.title}
      </h3>
      <ul id={listId} className="mt-2 flex flex-col divide-y divide-cc-rule">
        {items.map((item) => (
          <PageRow key={item.kind === 'doc' ? `doc:${item.slug}` : `page:${item.path}`} item={item} />
        ))}
      </ul>
      {rest > 0 && (
        <Button size="sm" variant="tertiary" className="mt-3 self-start" aria-expanded={showAll} aria-controls={listId} onPress={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${section.items.length} pages`}
        </Button>
      )}
    </section>
  );
}

/** What is wrong with the docs (a broken link, a name clash, a mistake in nav.json), folded so it does not crowd the page. */
function Problems({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null;
  return (
    <details className="rounded-md border border-cc-rule bg-cc-paper px-3 py-2 text-sm">
      <summary className="cursor-pointer text-cc-muted cc-focus-ring">
        {problems.length} {problems.length === 1 ? 'problem' : 'problems'} found in the docs
      </summary>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-xs break-words text-cc-muted">
        {problems.map((problem, i) => (
          // A line can appear twice, so the position is part of the key.
          <li key={`${i}:${problem}`}>{problem}</li>
        ))}
      </ul>
    </details>
  );
}

function Cards({ listing }: { listing: DocsListing }) {
  if (listing.nav.length === 0) return <p className="text-cc-muted">No docs yet. Add a markdown file under docs/ and it shows here.</p>;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-cc-muted">
        {listing.docs.length} {listing.docs.length === 1 ? 'doc' : 'docs'} in {listing.nav.length} {listing.nav.length === 1 ? 'section' : 'sections'}.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {listing.nav.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>
      <Problems problems={listing.problems} />
    </div>
  );
}

/**
 * The page at /docs: what the docs cover, and one card for each section of the nav with its key
 * pages and the day each one last changed. The title and the introduction are static, so they show
 * even when the docs cannot be loaded; the cards sit in a panel that has its own error state.
 */
export function Overview({ listing }: { listing: PanelResult<DocsListing> }) {
  useDocumentTitle('Docs');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
        <p className="mt-2 max-w-prose text-cc-muted">
          The design, the engine, the decisions and the quality records of Shadow Jog, in one place. Pick a section below, or search.
        </p>
      </div>
      <PanelFrame title="Overview" result={listing}>
        {(data) => <Cards listing={data} />}
      </PanelFrame>
    </div>
  );
}
