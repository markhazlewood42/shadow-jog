import type { MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { APP_NAME, type DecisionDetail, type ModuleName, type Panel } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import { docPath } from '../docs/paths';
import { useDocumentTitle } from '../docs/useDocumentTitle';
import { usePanel } from '../usePanel';
import { AnswerForm, useAnswerDraft } from './AnswerForm';
import { DecisionCard, Notice, OptionList, SectionLabel } from './DecisionCard';

/**
 * The page of a decision reloads when the decisions change (an answer, a new decision) and when the docs change: the linked
 * sections are the text of the docs as they are now, so an edit of a doc must show here without a reload by hand.
 */
const DECISION_MODULES: readonly ModuleName[] = ['decisions', 'docs'];

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

/** One linked section of a doc, with the doc and the heading it comes from and a link to it in the docs. A heading that the doc does not have is a notice, not an error. */
function LinkedSection({ detail, index }: { detail: DecisionDetail; index: number }) {
  const navigate = useNavigate();
  const section = detail.sections[index];
  const link = detail.docs[index];
  if (section === undefined || link === undefined) return null;
  const where = `${section.docId}${section.anchor === '' ? '' : `#${section.anchor}`}`;

  // A link to another doc inside the section moves inside the app, as it does on the doc pages. Other links are the browser's own (a heading link scrolls here, an outside link opens).
  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return;
    const href = target.getAttribute('href') ?? '';
    if (href === '/docs' || href.startsWith('/docs/')) {
      event.preventDefault();
      navigate(href);
    }
  }

  return (
    <section aria-label={where} className="rounded-lg border border-cc-rule-solid bg-cc-paper-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-cc-rule px-4 py-3">
        {/* The doc and the heading id that the issue names. The heading itself is the first line of the section below (or the notice says that it is missing). */}
        <p className="min-w-0 font-mono text-sm break-words">
          <span className="text-cc-muted">{section.docId}</span>
          {section.anchor !== '' && <span className="text-cc-soft">#{section.anchor}</span>}
        </p>
        <Link to={docPath(link.slug, section.anchor)} className="inline-flex items-center gap-1 text-sm text-cc-link underline underline-offset-2 cc-focus-ring">
          Open in the docs
        </Link>
      </header>
      <div className="px-4 py-4">
        {section.html === null ? (
          <Notice>
            This section was not found in the docs: {where}. The doc or its heading may have been renamed, moved or deleted. The link in the issue names a heading that the doc does not have now.
          </Notice>
        ) : (
          // The html is the doc index's own rendering of the doc (src/server/docs/render.ts): every tag of the doc's text is escaped there,
          // so a doc cannot run script, and it is put into the page as it is, as on the doc pages. The rules of a doc's text (doc-html) apply.
          // The first heading of the section sits at the top of the box, so it loses the space and the rule above it that it has between sections of a doc.
          // The click handler only routes clicks on links, which can be reached and used with the keyboard by themselves.
          <div className="doc-html [&>:first-child]:mt-0 [&>h2:first-child]:border-t-0 [&>h2:first-child]:pt-0" onClick={onClick} dangerouslySetInnerHTML={{ __html: section.html }} />
        )}
      </div>
    </section>
  );
}

/** The sections that the issue links to, as the docs have them now, one under the other. */
function LinkedSections({ detail }: { detail: DecisionDetail }) {
  if (detail.sections.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Linked doc sections</SectionLabel>
      <div className="flex flex-col gap-4">
        {detail.sections.map((section, index) => (
          <LinkedSection key={`${section.docId}#${section.anchor}`} detail={detail} index={index} />
        ))}
      </div>
    </section>
  );
}

/** A decision in full: what the issue says, the form (or the options, when it cannot be answered), and the linked doc sections under it. */
function DecisionView({ detail, draft }: { detail: DecisionDetail; draft: ReturnType<typeof useAnswerDraft> }) {
  const answerable = detail.state === 'open' && detail.options.length > 0;
  return (
    <div className="flex flex-col gap-8">
      <DecisionCard issue={detail} />
      {answerable ? <AnswerForm issue={detail} draft={draft} /> : <OptionList issue={detail} />}
      <LinkedSections detail={detail} />
    </div>
  );
}

/**
 * The page of one decision (`/decisions/<n>`): the question, the options with the recommendation, a form to answer, and under them the doc
 * sections that the issue links to, shown in full so that Mark need not leave the page to read what he decides on. It loads the decision as a
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
