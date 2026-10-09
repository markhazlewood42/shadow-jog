import { useId } from 'react';
import { Link } from 'react-router';
import type { DocPage, DocRef, Panel } from '../../shared/types';
import { docPath } from './paths';
import { useDocumentTitle } from './useDocumentTitle';

function isDocRef(value: unknown): value is DocRef {
  return typeof value === 'object' && value !== null && typeof (value as DocRef).slug === 'string' && typeof (value as DocRef).title === 'string';
}

/**
 * Tells whether a doc's panel is the server's "no doc has this address" answer, and if it is, which
 * docs have the same file name (the answer carries them in `suggestions`, next to the usual panel
 * fields). Returns null for every other panel: loading, a good doc, or any other error.
 *
 * The panel comes from the network, so its `suggestions` are checked here, not trusted.
 */
export function missingDocOf(panel: Panel<DocPage> | null): DocRef[] | null {
  if (panel === null || panel.ok || panel.error.code !== 'doc-not-found') return null;
  const { suggestions } = panel as typeof panel & { suggestions?: unknown };
  return Array.isArray(suggestions) ? suggestions.filter(isDocRef) : [];
}

/**
 * The page for an address that no doc has. A doc that Mark has open can be renamed, moved or
 * deleted behind his back (an agent does it in a branch), and the page finds out from the server's
 * change events. It is a label (the page is not found), the address, the docs that have the same
 * file name (a move keeps the name and changes the folder), and a link to the docs overview. It does
 * not explain: the site shows labels and links only (design 5.8).
 */
export function Gone({ slug, suggestions }: { slug: string; suggestions: readonly DocRef[] }) {
  useDocumentTitle('Doc not found');
  const titleId = useId();
  const fileName = slug.split('/').pop() ?? slug;
  return (
    // Amber border: this is the one thing on the page that matters, so it is the focal item.
    <section aria-labelledby={titleId} className="rounded-lg border border-cc-accent cc-focal p-6">
      <h1 id={titleId} className="text-2xl font-semibold tracking-tight">
        Doc not found
      </h1>
      <p className="mt-3 text-cc-muted">
        No doc has this address. <code className="font-mono text-sm text-cc-ink">{`/docs/${slug}`}</code>
      </p>
      {suggestions.length > 0 ? (
        <div className="mt-5">
          <p className="text-sm font-medium">Same file name</p>
          <ul className="mt-2 flex flex-col gap-1">
            {suggestions.map((ref) => (
              <li key={ref.slug} className="flex flex-wrap items-baseline gap-x-3">
                <Link to={docPath(ref.slug)} className="text-cc-link underline underline-offset-2 cc-focus-ring">
                  {ref.title}
                </Link>
                <code className="font-mono text-xs text-cc-soft">{`/docs/${ref.slug}`}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-5 text-sm text-cc-muted">{`No doc has the file name "${fileName}"`}</p>
      )}
      <p className="mt-6 text-sm">
        <Link to="/docs" className="text-cc-link underline underline-offset-2 cc-focus-ring">
          Docs overview
        </Link>
      </p>
    </section>
  );
}
