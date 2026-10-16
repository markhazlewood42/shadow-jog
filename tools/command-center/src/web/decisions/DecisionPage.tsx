import { Link, useParams } from 'react-router';
import { type DecisionAnswer, type DecisionDetail, type DecisionDocLink, type DocsListing, type ModuleName, type Panel } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import { docPath } from '../docs/paths';
import { useDocumentTitle } from '../docs/useDocumentTitle';
import { usePanel } from '../usePanel';
import { AnswerForm, useAnswerDraft } from './AnswerForm';
import { DecisionCard, Notice, OptionList, SectionLabel } from './DecisionCard';

/**
 * The page of a decision reloads when the decisions change (an answer, a new decision) and when the docs change: whether a linked
 * heading is in its doc is read from the docs as they are now, so an edit of a doc must show here without a reload by hand.
 */
const DECISION_MODULES: readonly ModuleName[] = ['decisions', 'docs'];

/** The doc listing changes when a doc is added, renamed or retitled. */
const DOC_MODULES: readonly ModuleName[] = ['docs'];

/** Whether the panel is the server's "no open decision has this number" answer (status 404). */
function isMissing(panel: Panel<DecisionDetail> | null): boolean {
  return panel !== null && !panel.ok && panel.error.code === 'decision-not-found';
}

/**
 * The page for a number that the lists do not have. The decisions that the page can show are the open ones and the ones answered in
 * the last week, so an older answer, an issue of another account and a number that is no issue all look like this. It is a label and
 * two links (design 5.8), and it offers no retry that would change nothing (the page still follows the server's events, so a decision
 * that an agent raises a moment later shows up on its own). `number` is null when the address is not a number at all.
 */
function NotFound({ number }: { number: number | null }) {
  return (
    <section aria-label="Decision not found" className="rounded-lg border border-cc-rule-solid bg-cc-paper-2 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{number === null ? 'Invalid decision number' : 'Decision not found'}</h1>
      {number !== null && <p className="mt-2 font-mono text-sm text-cc-muted">#{number}</p>}
      <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link to="/docs/decisions" className="text-cc-link underline underline-offset-2 cc-focus-ring">
          Decisions
        </Link>
        <Link to="/docs" className="text-cc-link underline underline-offset-2 cc-focus-ring">
          Docs overview
        </Link>
      </p>
    </section>
  );
}

/** The titles of the docs by slug, from the doc listing. The decision page reads it only to name the links, so a listing that cannot be read gives an empty map: the id of the doc names the link then. */
function useDocTitles(): ReadonlyMap<string, string> {
  const listing = usePanel<DocsListing>('/api/docs', DOC_MODULES);
  return new Map(listing.panel?.ok ? listing.panel.data.docs.map((doc) => [doc.slug, doc.title]) : []);
}

/**
 * One line for a doc that the issue links to: the title of the doc and the heading, as a link to that heading in the docs. A heading that the doc does
 * not have is a notice, not an error, with a link to the doc so that Mark can look for it. The text of the section is not copied here: the doc page has it.
 */
function LinkedDoc({ link, heading, title }: { link: DecisionDocLink; heading: string | null; title: string | undefined }) {
  if (heading === null) {
    const where = `${link.docId}${link.anchor === '' ? '' : `#${link.anchor}`}`;
    return (
      <Notice>
        Section not found: {where}{' '}
        <Link to={docPath(link.slug)} className="text-cc-link underline underline-offset-2 cc-focus-ring">
          Open doc
        </Link>
      </Notice>
    );
  }
  return (
    <Link to={docPath(link.slug, link.anchor)} className="text-sm text-cc-link underline underline-offset-2 break-words cc-focus-ring">
      {title ?? link.docId} › {heading}
    </Link>
  );
}

/** The docs that the issue links to, one line for each, under the Docs label. */
function LinkedDocs({ detail }: { detail: DecisionDetail }) {
  const titles = useDocTitles();
  if (detail.docs.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Docs</SectionLabel>
      <ul aria-label="Linked docs" className="flex flex-col gap-2">
        {detail.docs.map((link, index) => (
          <li key={`${link.docId}#${link.anchor}`}>
            {/* The heading comes from `sections`, which the server reads from the doc index at each request. The heading in `docs` is as old as the last load of the list (up to a minute). */}
            <LinkedDoc link={link} heading={detail.sections[index]?.heading ?? null} title={titles.get(link.slug)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The decision as the page shows it. On the hosted page, right after Mark's answer is written, the function's reply is the truth and the snapshot can be 15 s old (the CDN
 * keeps it that long), so the decision is shown as answered from the reply until the snapshot says so itself. The local page never has such a reply (`answered` is null).
 */
function shownDecision(detail: DecisionDetail, answered: DecisionAnswer | null): DecisionDetail {
  return answered !== null && detail.state === 'open' ? { ...detail, state: 'answered', answer: answered } : detail;
}

/** A decision in full: what the issue says, the form (or the options, when it cannot be answered), and the links to the docs under it. */
function DecisionView({ detail, draft }: { detail: DecisionDetail; draft: ReturnType<typeof useAnswerDraft> }) {
  const shown = shownDecision(detail, draft.answered);
  const answerable = shown.state === 'open' && shown.options.length > 0;
  return (
    <div className="flex flex-col gap-8">
      <DecisionCard issue={shown} />
      {/* Two tabs can post different options, and the newest comment wins, so the page asks Mark to confirm what GitHub holds. */}
      {draft.answered !== null && <Notice>Reload to confirm.</Notice>}
      {answerable ? <AnswerForm issue={shown} draft={draft} /> : <OptionList issue={shown} />}
      <LinkedDocs detail={shown} />
    </div>
  );
}

/**
 * The page of one decision (`/decisions/<n>`): the question, the options with the recommendation, a form to answer, and under them the docs
 * that the issue links to, as links into the doc page (the text of a doc is not copied here). It loads the decision as a
 * panel, so it has the loading, error and updated-at states of every panel, and it follows the server's events.
 *
 * What Mark has typed in the form lives here and not in the form (see useAnswerDraft): the panel draws its data in another place of the tree
 * when a reload fails, and the form must keep his choice and his note then. After every try to answer, the page reads the decision again.
 */
export function DecisionPage({ number }: { number: number }) {
  useDocumentTitle(`Decision #${number}`);
  const result = usePanel<DecisionDetail>(`/api/decisions/${number}`, DECISION_MODULES);
  const draft = useAnswerDraft(number, result.reload);

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {isMissing(result.panel) ? (
          <NotFound number={number} />
        ) : (
          <PanelFrame title="Decision" result={result}>
            {(detail) => <DecisionView detail={detail} draft={draft} />}
          </PanelFrame>
        )}
      </main>
    </div>
  );
}

/** The route `/decisions/:number`. A number that is not a plain issue number shows the not-found page and asks the server nothing. */
export function DecisionRoute() {
  const { number } = useParams();
  const parsed = number !== undefined && /^[1-9]\d{0,9}$/.test(number) ? Number(number) : null;
  if (parsed === null) {
    return (
      <div className="min-h-screen">
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <NotFound number={null} />
        </main>
      </div>
    );
  }
  // A key makes each decision start fresh: its own panel and its own form, with no trace of the decision before it.
  return <DecisionPage key={parsed} number={parsed} />;
}
