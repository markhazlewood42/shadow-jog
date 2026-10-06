import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import type { DocRef, ReadingOrder } from '../../shared/types';
import { docPath } from './paths';

/** One of the two buttons: a link to the neighbour doc, with the direction and the title of the doc. */
function Neighbour({ doc, direction }: { doc: DocRef; direction: 'prev' | 'next' }) {
  const previous = direction === 'prev';
  const Arrow = previous ? ArrowLeft : ArrowRight;
  return (
    <Link
      to={docPath(doc.slug)}
      // The browser knows from `rel` which way this link goes, as it does for the page links of a search engine.
      rel={direction}
      className={`flex min-w-0 max-w-sm flex-1 items-center gap-3 rounded-lg border border-cc-rule-solid px-4 py-3 hover:bg-cc-paper cc-focus-ring ${
        // The Next button sits at the right even when there is no Previous.
        previous ? '' : 'ml-auto flex-row-reverse text-right'
      }`}
    >
      <Arrow aria-hidden className="size-4 shrink-0 text-cc-muted" />
      <span className="min-w-0">
        <span className="block text-xs font-medium tracking-wide text-cc-soft uppercase">{previous ? 'Previous' : 'Next'}</span>
        <span className="block font-medium">{doc.title}</span>
      </span>
    </Link>
  );
}

/**
 * The Previous and Next buttons at the end of an engine doc: the docs on each side of it in the
 * reading order. The first doc has no Previous and the last no Next. The server sends a reading
 * order only for a doc that has a neighbour, so at least one of the two is there.
 */
export function PrevNext({ order }: { order: ReadingOrder }) {
  return (
    <nav aria-label="Reading order" className="flex flex-wrap gap-3">
      {order.prev !== null && <Neighbour doc={order.prev} direction="prev" />}
      {order.next !== null && <Neighbour doc={order.next} direction="next" />}
    </nav>
  );
}
