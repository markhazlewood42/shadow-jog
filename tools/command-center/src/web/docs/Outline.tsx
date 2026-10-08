import { Link } from 'react-router';
import type { DocHeading } from '../../shared/types';
import { docPath } from './paths';

/** How far each level of heading is pushed in. The outline holds h2 to h4 (the h1 is the title). */
const INDENT: Record<DocHeading['level'], string> = {
  2: 'pl-0',
  3: 'pl-3',
  4: 'pl-6',
};

/**
 * The headings of the open doc, as links to them (the right side of a doc page). Each link goes to
 * the doc's own address with the heading's id as the hash, so it can be copied and shared, and the
 * doc view scrolls to the heading when the address changes (see DocView).
 */
export function Outline({ slug, headings }: { slug: string; headings: readonly DocHeading[] }) {
  return (
    <nav aria-label="Outline">
      <p className="mb-2 text-xs font-medium tracking-wide text-cc-soft uppercase">On this page</p>
      {headings.length === 0 ? (
        <p className="text-sm text-cc-muted">No headings</p>
      ) : (
        <ul className="flex flex-col gap-1 border-l border-cc-rule">
          {headings.map((heading) => (
            <li key={heading.id} className={INDENT[heading.level]}>
              <Link
                to={docPath(slug, heading.id)}
                className="block rounded-r-md py-0.5 pl-3 text-sm text-cc-muted hover:text-cc-ink cc-focus-ring"
              >
                {heading.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
