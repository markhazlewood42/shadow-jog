import { Link, useParams } from 'react-router';
import { APP_NAME, type DecisionDetail, type DecisionDocLink, type DocsListing, type ModuleName, type Panel } from '../../shared/types';
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

/** The top bar: the name of the tool and the parts of the site. The decision page is none of them, so none is marked as the current page. */
function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-cc-rule-solid bg-cc-paper">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link to="/" className="font-semibold tracking-tight cc-focus-ring">
          {APP_NAME}
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          <Link to="/" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Now
          </Link>
          <Link to="/docs" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Docs
          </Link>
          <Link to="/agents" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Agents
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Whether the panel is the server's "no open decision has this number" answer (status 404). */
function isMissing(panel: Panel<DecisionDetail> | null): boolean {
  return panel !== null && !panel.ok && panel.error.code === 'decision-not-found';
}

/**
 * The page for a number that the lists do not have. The decisions that the page can show are the open ones and the ones answered in
 * the last week, so an older answer, an issue of another account and a number that is no issue all look like this. It says so, and
 * does not offer a retry that would change nothing (the page still follows the server's events, so a decision that an agent raises a moment
 * later shows up on its own).
 */
function NotFound({ number, message }: { number: number | null; message: string }) {
  return (
    <section aria-label="Decision not found" className="rounded-lg border border-cc-rule-solid bg-cc-paper-2 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{number === null ? 'This is not the number of a decision' : `No decision has the number ${number}`}</h1>
      <p className="mt-3 max-w-prose text-cc-muted">{message}</p>
      <p className="mt-5 text-sm text-cc-muted">
        <Link to="/" className="text-cc-link underline underline-offset-2 cc-focus-ring">
          Back to the start page
        </Link>
        , or open{' '}
        <Link to="/docs/decisions" className="text-cc-link underline underline-offset-2 cc-focus-ring">
          the list of the engine decisions
        </Link>
        .
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
        This section was not found in the docs: {where}.{' '}
        <Link to={docPath(link.slug)} className="text-cc-link underline underline-offset-2 cc-focus-ring">
          Open the doc
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

/** A decision in full: what the issue says, the form (or the options, when it cannot be answered), and the links to the docs under it. */
function DecisionView({ detail, draft }: { detail: DecisionDetail; draft: ReturnType<typeof useAnswerDraft> }) {
  const answerable = detail.state === 'open' && detail.options.length > 0;
  return (
    <div className="flex flex-col gap-8">
      <DecisionCard issue={detail} />
      {answerable ? <AnswerForm issue={detail} draft={draft} /> : <OptionList issue={detail} />}
      <LinkedDocs detail={detail} />
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
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {isMissing(result.panel) ? (
          <NotFound number={number} message={result.panel !== null && !result.panel.ok ? result.panel.error.message : ''} />
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
        <Header />
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <NotFound number={null} message="A decision is an issue of the repository, and its number is a whole number (for example /decisions/58)." />
        </main>
      </div>
    );
  }
  // A key makes each decision start fresh: its own panel and its own form, with no trace of the decision before it.
  return <DecisionPage key={parsed} number={parsed} />;
}
