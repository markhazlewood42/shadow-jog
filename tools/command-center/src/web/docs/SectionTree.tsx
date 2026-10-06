import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import type { NavItem, NavSection } from '../../shared/types';
import { docPath } from './paths';

type SectionTreeProps = {
  nav: readonly NavSection[];
  /** The slug of the doc that is open, or null. Its section starts open and its link is marked. */
  activeSlug: string | null;
  /** The address of the page that is open. An item that is a page of the site (not a doc) is marked by it. */
  activePath: string;
};

/** The section that holds the open page (a doc, or a page of the site such as the list of decisions), or null when no section lists it. */
function sectionHolding(nav: readonly NavSection[], slug: string | null, path: string): string | null {
  const holds = (item: NavItem) => (item.kind === 'doc' ? item.slug === slug : item.path === path);
  return nav.find((section) => section.items.some(holds))?.id ?? null;
}

function SectionItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link
        to={item.kind === 'doc' ? docPath(item.slug) : item.path}
        aria-current={active ? 'page' : undefined}
        // The open doc is the one amber item of the tree ("you are here"). Every row has a left edge, so the text does not move.
        className={`block rounded-r-md border-l-2 px-2 py-1 text-sm cc-focus-ring ${
          active ? 'border-cc-accent bg-cc-accent-tint font-medium text-cc-ink' : 'border-transparent text-cc-muted hover:text-cc-ink'
        }`}
      >
        {item.title}
      </Link>
    </li>
  );
}

function Section({
  section,
  open,
  onToggle,
  activeSlug,
  activePath,
}: {
  section: NavSection;
  open: boolean;
  onToggle: () => void;
  activeSlug: string | null;
  activePath: string;
}) {
  // The button names the list it opens, so a screen reader can say so. useId makes a name that no doc heading can have.
  const listId = useId();
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-cc-paper cc-focus-ring"
      >
        <ChevronRight aria-hidden className={`size-4 shrink-0 text-cc-soft motion-safe:transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">{section.title}</span>
        {/* How many items. The button's name is the title alone: a count read out before every section would be noise. */}
        <span aria-hidden className="font-mono text-xs text-cc-soft">
          {section.items.length}
        </span>
      </button>
      {/* `hidden` takes a folded list out of the page, so the keyboard and a screen reader skip it as well. */}
      <ul id={listId} hidden={!open} className="mt-0.5 mb-1 ml-4 flex flex-col">
        {section.items.map((item) => {
          const key = item.kind === 'doc' ? `doc:${item.slug}` : `page:${item.path}`;
          const active = item.kind === 'doc' ? item.slug === activeSlug : item.path === activePath;
          return <SectionItem key={key} item={item} active={active} />;
        })}
      </ul>
    </li>
  );
}

/**
 * The section tree on the left of every docs page: the sections of the nav, each one a fold that
 * holds its docs. Two levels, as nav.json makes it. The section of the open page starts open; the
 * others start folded, so the tree stays short, and any doc is two clicks away: open its section,
 * then the doc.
 */
export function SectionTree({ nav, activeSlug, activePath }: SectionTreeProps) {
  const holder = sectionHolding(nav, activeSlug, activePath);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(holder === null ? [] : [holder]));

  // A page can be opened from outside the tree (the search, a link in a doc). Its section opens then.
  // The effect watches the section's id, not the nav: the nav is a new object at every reload, and
  // a section that a person folded by hand must stay folded.
  useEffect(() => {
    if (holder !== null) setOpen((before) => (before.has(holder) ? before : new Set(before).add(holder)));
  }, [holder]);

  const toggle = (id: string) =>
    setOpen((before) => {
      const after = new Set(before);
      if (!after.delete(id)) after.add(id);
      return after;
    });

  return (
    <nav aria-label="Docs sections">
      <ul className="flex flex-col gap-0.5">
        {nav.map((section) => (
          <Section
            key={section.id}
            section={section}
            open={open.has(section.id)}
            onToggle={() => toggle(section.id)}
            activeSlug={activeSlug}
            activePath={activePath}
          />
        ))}
      </ul>
    </nav>
  );
}
