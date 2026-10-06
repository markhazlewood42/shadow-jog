import { ArrowRight, Gavel } from 'lucide-react';
import { Link } from 'react-router';
import type { DocDecision } from '../../shared/types';
import { titleOf } from './DecisionCard';

/**
 * The banner of a doc page: an open decision links to the heading that this banner stands in front of. It says so, gives the question (the title of the
 * issue, as text), and links to the page of the decision. It is the one thing on the doc page that waits for Mark, so its frame is the amber one.
 */
export function DecisionBanner({ decision }: { decision: DocDecision }) {
  return (
    <aside aria-label={`Open decision ${decision.number}`} className="my-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-cc-accent cc-focal px-4 py-3 text-sm">
      <Gavel aria-hidden className="size-4 shrink-0 text-cc-accent" />
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-medium text-cc-ink">A decision waits for Mark on this section</p>
        <p className="mt-0.5 text-cc-muted break-words">{titleOf(decision.title)}</p>
      </div>
      <Link to={`/decisions/${decision.number}`} className="inline-flex shrink-0 items-center gap-1 font-medium cc-focus-ring">
        Decision #{decision.number}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </aside>
  );
}
