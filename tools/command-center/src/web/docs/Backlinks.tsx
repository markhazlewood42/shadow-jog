import { Link } from 'react-router';
import type { DocRef } from '../../shared/types';
import { docPath } from './paths';

/**
 * The docs that link to the open doc ("linked from", the right side of a doc page). The server
 * lists each doc once, never the doc itself and never a link that is broken.
 */
export function Backlinks({ refs }: { refs: readonly DocRef[] }) {
  return (
    <nav aria-label="Linked from">
      <p className="mb-2 text-xs font-medium tracking-wide text-cc-soft uppercase">Linked from</p>
      {refs.length === 0 ? (
        <p className="text-sm text-cc-muted">No links here</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {refs.map((ref) => (
            <li key={ref.slug}>
              <Link to={docPath(ref.slug)} className="block rounded-md py-0.5 text-sm text-cc-muted hover:text-cc-ink cc-focus-ring">
                {ref.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
