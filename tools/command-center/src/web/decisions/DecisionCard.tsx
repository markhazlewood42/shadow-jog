import { Chip } from '@heroui/react';
import { Check, CircleDot, Clock, ExternalLink, Info, Lock, MessageSquareText, Star } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import type { DecisionIssue, DecisionThreadEntry } from '../../shared/types';

// The pieces of a decision page that show what the issue says. Every word that comes from the issue (its
// title, the question, the options, the notes) is text that GitHub holds and that any account could have
// written in a place that Mark's account wrote, so it is put into the page as text, never as html: React
// escapes it, and a script tag in an issue shows as the characters `<script>`.

/**
 * The title of a decision issue without the "Decision:" that the template puts in front of it ("Decision: <the question>"): the page
 * already says that this is a decision. A title that is only that word is shown as it is.
 */
export function titleOf(title: string): string {
  const stripped = title.replace(/^\s*decision\s*:\s*/i, '').trim();
  return stripped === '' ? title.trim() : stripped;
}

/** The day of a time as `YYYY-MM-DD`, as the docs show their dates (a time zone must not move it, and a test must not depend on the locale). A text that is not a time is shown as it is. */
function dayOf(iso: string): string {
  return /^\d{4}-\d\d-\d\d/.test(iso) ? iso.slice(0, 10) : iso;
}

/** A note that is the site's own words, not the issue's: why the page cannot show something, or what state the issue is in. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-md border border-cc-rule-solid bg-cc-paper px-3 py-2 text-sm text-cc-muted">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-ink" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A link to the issue on GitHub. It opens in a new tab, so the icon says that it leaves the site. */
export function IssueLink({ url, className = '', children }: { url: string; className?: string; children: ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-cc-link underline underline-offset-2 cc-focus-ring ${className}`}>
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}

/** The state of the decision in a word and an icon, so that it is never told by color alone. */
function StateChip({ issue }: { issue: DecisionIssue }) {
  if (issue.state === 'answered') {
    return (
      <Chip variant="tertiary" size="sm" className="gap-1 text-cc-muted">
        <Check aria-hidden className="size-3" />
        <Chip.Label>Answered</Chip.Label>
      </Chip>
    );
  }
  if (issue.state === 'closed') {
    return (
      <Chip size="sm" className="gap-1 border border-cc-rule-solid">
        <Lock aria-hidden className="size-3" />
        <Chip.Label>Closed</Chip.Label>
      </Chip>
    );
  }
  // Asked for more info: it waits for a session, not for Mark.
  if (issue.phase === 'needs-info' || issue.phase === 'needs-info-empty') {
    return (
      <Chip size="sm" className="gap-1 border border-cc-rule-solid">
        <Clock aria-hidden className="size-3" />
        <Chip.Label>Waiting for info</Chip.Label>
      </Chip>
    );
  }
  // A session answered Mark's question: he can decide now.
  if (issue.phase === 'info-posted') {
    return (
      <Chip color="accent" variant="primary" size="sm" className="gap-1">
        <MessageSquareText aria-hidden className="size-3" />
        <Chip.Label>More info posted</Chip.Label>
      </Chip>
    );
  }
  // Open: it waits for Mark. Amber, as the open decisions are on the list of the engine decisions.
  return (
    <Chip color="accent" variant="primary" size="sm" className="gap-1">
      <CircleDot aria-hidden className="size-3" />
      <Chip.Label>Open</Chip.Label>
    </Chip>
  );
}

/** The label of a section of the page: small, in capitals, and a heading for a screen reader. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-medium tracking-wide text-cc-soft uppercase">
      {children}
    </h2>
  );
}

/** What a thread comment is called on the page. A `Decision:` comment is the ask point of a backfilled decision: Mark's note from the answer that was reopened. */
const THREAD_LABEL: Record<DecisionThreadEntry['kind'], string> = {
  question: 'Your question',
  info: 'Info posted',
  decision: 'Your note from the earlier answer',
};

/**
 * The thread of the ask for more info: the ask point and the later questions and infos, oldest first. Every word is the text of a comment and is put into the page as text: a link
 * shows as its address, so an `Info:` that points at a committed picture does not make a live link, and markup shows as the characters. A comment over 4000 characters is cut, with a link to the rest on GitHub.
 */
export function AskThread({ issue }: { issue: DecisionIssue }) {
  const thread = issue.thread ?? [];
  if (thread.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Questions and info</SectionLabel>
      <ol aria-label="Questions and info" className="flex flex-col gap-2">
        {thread.map((entry, index) => (
          // A thread is made again as a whole, so the place in it is the key.
          <li key={`${index}:${entry.kind}:${entry.at}`} className="flex flex-col gap-1 rounded-md border border-cc-rule bg-cc-paper px-4 py-3">
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-cc-soft">
              <span className="font-medium tracking-wide uppercase">{THREAD_LABEL[entry.kind]}</span>
              {entry.at !== '' && <time dateTime={entry.at}>{dayOf(entry.at)}</time>}
            </p>
            <p className="break-words whitespace-pre-line">{entry.text}</p>
            {entry.cut && issue.url !== '' && (
              <p className="text-sm">
                <IssueLink url={issue.url}>Read the rest on GitHub</IssueLink>
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The id of an option (`A`) in a small frame. */
export function OptionBadge({ id }: { id: string }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-md border border-cc-rule-solid font-mono text-sm font-medium">{id}</span>;
}

/** The mark of the option that the issue recommends. */
export function RecommendedChip() {
  return (
    <Chip size="sm" className="gap-1 border border-cc-rule-solid">
      <Star aria-hidden className="size-3" />
      <Chip.Label>Recommended</Chip.Label>
    </Chip>
  );
}

/**
 * The options of a decision that is not open (answered, or closed), or whose issue is not a decision that can be answered here: the same
 * list that the answer form shows, with no buttons. The option that Mark answered is marked.
 */
export function OptionList({ issue }: { issue: DecisionIssue }) {
  const chosen = issue.state === 'answered' ? issue.answer?.option : undefined;
  if (issue.options.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Options</SectionLabel>
      <ol aria-label="Options" className="flex flex-col gap-2">
        {issue.options.map((option) => (
          <li key={option.id} className={`flex items-start gap-3 rounded-md border bg-cc-paper px-4 py-3 ${chosen === option.id ? 'border-cc-rule-solid' : 'border-cc-rule'}`}>
            <OptionBadge id={option.id} />
            <div className="min-w-0 flex-1">
              <p className="break-words whitespace-pre-line">{option.text}</p>
              {(issue.recommended === option.id || chosen === option.id) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {issue.recommended === option.id && <RecommendedChip />}
                  {chosen === option.id && (
                    <Chip variant="tertiary" size="sm" className="gap-1 text-cc-muted">
                      <Check aria-hidden className="size-3" />
                      <Chip.Label>Mark's answer</Chip.Label>
                    </Chip>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A line of the facts of a decision: a small label and its words. Nothing is drawn for a fact that the issue does not give. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium tracking-wide text-cc-soft uppercase">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

/**
 * What the issue says, without the options and the answer form: its number and state, its title, the question and the
 * context, who raised it and what waits on it, and a link to the issue on GitHub. It also says what is wrong when the issue
 * cannot be shown as a decision (`problem`), when an answer stopped half way, and when the issue is closed with no answer.
 */
export function DecisionCard({ issue }: { issue: DecisionIssue }) {
  const titleId = useId();
  const halfAnswer = issue.state === 'open' && issue.answer !== null && !issue.answer.complete;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="font-mono text-cc-muted">Decision #{issue.number}</span>
          <StateChip issue={issue} />
          {issue.createdAt !== '' && (
            <span className="text-cc-soft">
              opened{' '}
              <time dateTime={issue.createdAt} className="font-mono">
                {dayOf(issue.createdAt)}
              </time>
            </span>
          )}
          {issue.url !== '' && (
            <IssueLink url={issue.url} className="sm:ml-auto">
              Open the issue on GitHub
            </IssueLink>
          )}
        </div>
        <h1 id={titleId} className="text-2xl font-semibold tracking-tight break-words">
          {titleOf(issue.title)}
        </h1>
      </header>

      {issue.problem !== null && <Notice>{issue.problem}</Notice>}
      {issue.state === 'open' && issue.phase === 'needs-info' && <Notice>You asked for more info. A session will answer on the issue.</Notice>}
      {issue.state === 'open' && issue.phase === 'needs-info-empty' && <Notice>Waiting for info: no question found. A session will remove the label.</Notice>}
      {issue.state === 'open' && issue.phase === 'info-posted' && <Notice>More info posted. Read it below, then answer or ask again.</Notice>}
      {halfAnswer && issue.answer !== null && (
        <Notice>The comment for option {issue.answer.option} is on GitHub. The issue is still open. Send the answer to finish.</Notice>
      )}
      {issue.state === 'closed' && (
        <Notice>
          Closed with no answer from Mark.
          {issue.url !== '' && (
            <>
              {' '}
              <IssueLink url={issue.url}>Reopen on GitHub</IssueLink>
            </>
          )}
        </Notice>
      )}

      {issue.state === 'answered' && issue.answer !== null && (
        <section aria-label="Answer" className="flex flex-col gap-2 rounded-md border border-cc-rule-solid bg-cc-paper px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">Answered {issue.answer.option}</span> · <time dateTime={issue.answer.at}>{dayOf(issue.answer.at)}</time>
          </p>
          {issue.answer.note !== null && <p className="break-words whitespace-pre-line text-cc-muted">{issue.answer.note}</p>}
        </section>
      )}

      {issue.question !== '' && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Question</SectionLabel>
          <p className="text-lg leading-snug font-medium break-words whitespace-pre-line">{issue.question}</p>
        </section>
      )}
      {issue.context !== null && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Context</SectionLabel>
          <p className="break-words whitespace-pre-line text-cc-muted">{issue.context}</p>
        </section>
      )}

      {(issue.raisedBy !== null || issue.waitsOn !== null) && (
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {issue.raisedBy !== null && <Fact label="Raised by">{issue.raisedBy}</Fact>}
          {issue.waitsOn !== null && <Fact label="Waits on this">{issue.waitsOn}</Fact>}
        </dl>
      )}
    </article>
  );
}
