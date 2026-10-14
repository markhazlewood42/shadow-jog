import { Chip } from '@heroui/react';
import { CircleCheck, CircleDashed, CircleX, Clock, ExternalLink, FolderGit2, GitBranch, GitPullRequest, GitPullRequestDraft, MessageSquare, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { APP_NAME, type ModuleName, type PullRequest } from '../../shared/types';
import type { WorkstreamState } from '../../shared/workstream';
import { PanelFrame } from '../PanelFrame';
import { useDocumentTitle } from '../docs/useDocumentTitle';
import { clock } from '../hosted/panels';
import { type InvalidRow, type LiveStatus, type NoWorkstreamRow, type WorkstreamCard, type WorkstreamsView, cardAnchor } from '../hosted/workstreams';
import { Age, formatDuration, msSince, useNow } from '../now/time';
import { usePanel } from '../usePanel';
import { WorkstreamsNavLink } from './WorkstreamsNavLink';

// The Workstreams view (design.md section 5.9): one card for each workstream (a branch with its PR, checks, live sessions, worktree and the lines it asks of Mark),
// grouped by the lane of the roadmap item that the file names. The data is `/api/workstreams`, which the hosted data layer makes from the snapshot and the live key.
// Every word that comes from a file, from GitHub or from a session is shown as text.

/** The view reloads when the snapshot (GitHub) or the live key (agents) changes. */
const WORKSTREAM_MODULES: readonly ModuleName[] = ['github', 'agents'];

/** The state of a workstream, as a word. The Look has no red or green, so a state is told by its word. */
const STATE_LABELS: Record<WorkstreamState, string> = { active: 'Active', review: 'In review', blocked: 'Blocked', parked: 'Parked', merged: 'Merged' };

const CHECKS: Record<PullRequest['checksSummary'], { label: string; Icon: typeof CircleCheck }> = {
  pass: { label: 'Checks passed', Icon: CircleCheck },
  fail: { label: 'Checks failed', Icon: CircleX },
  pending: { label: 'Checks running', Icon: Clock },
  none: { label: 'No checks', Icon: CircleDashed },
};

const REVIEWS: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' };

/** The top bar: the name of the tool and the pages of the site. This page is the current one. */
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
          <Link to="/docs/roadmap/README" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Roadmap
          </Link>
          <Link to="/docs" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Docs
          </Link>
          <Link to="/agents" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Agents
          </Link>
          <WorkstreamsNavLink current />
        </nav>
      </div>
    </header>
  );
}

function PullRequestLine({ pr, now }: { pr: PullRequest; now: number }) {
  const checks = CHECKS[pr.checksSummary];
  const failing = pr.checks.filter((check) => check.status === 'fail');
  const Icon = pr.isDraft ? GitPullRequestDraft : GitPullRequest;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="flex items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />
        <span className="min-w-0 flex-1">
          <span className="font-mono text-cc-muted">#{pr.number}</span>{' '}
          {pr.url === '' ? (
            <span className="break-words">{pr.title}</span>
          ) : (
            <a href={pr.url} target="_blank" rel="noreferrer" className="break-words text-cc-link underline underline-offset-2 cc-focus-ring">
              {pr.title}
              <ExternalLink aria-hidden className="mb-0.5 ml-1 inline size-3.5" />
            </a>
          )}
        </span>
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-xs text-cc-soft">
        {pr.state === 'MERGED' ? <span>Merged{pr.mergedAt !== null && <> <Age iso={pr.mergedAt} now={now} /></>}</span> : pr.state === 'CLOSED' ? <span>Closed</span> : null}
        {pr.isDraft && <span>Draft</span>}
        {pr.state === 'OPEN' && pr.reviewDecision !== null && <span>{REVIEWS[pr.reviewDecision] ?? pr.reviewDecision}</span>}
        {pr.state === 'OPEN' && (
          <span className="inline-flex items-center gap-1">
            <checks.Icon aria-hidden className="size-3 shrink-0" />
            <span className="break-words">{failing.length > 0 ? `${checks.label}: ${failing.map((check) => check.name).join(', ')}` : checks.label}</span>
          </span>
        )}
      </p>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium tracking-wide text-cc-soft uppercase">{label}</h4>
      {children}
    </div>
  );
}

function Card({ card, now }: { card: WorkstreamCard; now: number }) {
  return (
    <article id={cardAnchor(card.branch)} aria-label={card.title} className="flex scroll-mt-20 flex-col gap-3 rounded-lg border border-cc-rule-solid bg-cc-paper-2 p-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-base font-semibold">{card.title}</h3>
          <Chip size="sm" className="shrink-0 border border-cc-rule-solid">
            <Chip.Label>{STATE_LABELS[card.state]}</Chip.Label>
          </Chip>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-cc-muted">
          <span className="inline-flex items-center gap-1 font-mono break-all">
            <GitBranch aria-hidden className="size-3 shrink-0" />
            {card.branch}
          </span>
          <span>Roadmap {card.roadmap}</span>
          <span>
            Updated <time dateTime={card.updated}>{card.updated}</time>
          </span>
        </p>
      </header>

      {card.pr === null ? <p className="text-sm text-cc-muted">No PR</p> : <PullRequestLine pr={card.pr} now={now} />}

      {card.blockedOn.length > 0 && (
        <Detail label="Blocked on">
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {card.blockedOn.map((number) => (
              <li key={number}>
                <Link to={`/decisions/${number}`} className="text-cc-link underline underline-offset-2 cc-focus-ring">
                  Decision #{number}
                </Link>
              </li>
            ))}
          </ul>
        </Detail>
      )}

      {card.sessions.length > 0 && (
        <Detail label="Sessions">
          <ul aria-label="Live sessions" className="flex flex-col gap-1 text-sm">
            {card.sessions.map((session) => {
              const runMs = msSince(session.startedAt, now);
              return (
                <li key={session.id} className="flex items-start gap-2">
                  <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />
                  <span className="min-w-0 flex-1 break-words">{session.title}</span>
                  <span className="shrink-0 text-xs text-cc-muted">
                    {session.state}
                    {runMs !== null && <span className="ml-1 font-mono text-cc-soft">{formatDuration(runMs)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Detail>
      )}

      {card.worktrees.length > 0 && (
        <Detail label="Worktree">
          <ul className="flex flex-col gap-1 text-sm">
            {card.worktrees.map((worktree) => (
              <li key={worktree.path} className="flex items-start gap-2">
                <FolderGit2 aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />
                <span className="min-w-0 flex-1 font-mono text-xs break-all">{worktree.path}</span>
                <span className="shrink-0 text-xs text-cc-muted">{worktree.dirty === 0 ? 'clean' : `${worktree.dirty} changed`}</span>
              </li>
            ))}
          </ul>
        </Detail>
      )}
    </article>
  );
}

/** The state of the live rows (sessions and worktrees) as one line. Nothing about them is hidden when the reporter is away. */
function liveLine(live: LiveStatus): string | null {
  switch (live.state) {
    case 'online':
      return null;
    case 'offline':
      return live.writtenAt === null ? 'Reporter offline. Sessions and worktrees show their last state.' : `Reporter offline since ${clock(live.writtenAt)}. Sessions and worktrees show their last state.`;
    case 'not-running':
      return 'Reporter not running. Sessions and worktrees show only while it runs.';
    case 'unreadable':
      return `Live data is unreadable: ${live.reason}.`;
    case 'error':
      return `Live data failed to load: ${live.message}`;
  }
}

function LiveNotice({ live }: { live: LiveStatus }) {
  const line = liveLine(live);
  if (line === null) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-md border border-cc-rule-solid px-3 py-2 text-xs text-cc-muted">
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-cc-ink" />
      <span className="min-w-0 break-words">{line}</span>
    </p>
  );
}

/** A file that failed the validator: the path and the error. This is the focal item of the page (amber), because a bad file hides a workstream. */
function InvalidRows({ rows }: { rows: InvalidRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Invalid workstream files" className="rounded-lg border border-cc-accent cc-focal p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        Invalid workstream files ({rows.length})
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-cc-rule">
        {rows.map((row) => (
          <li key={row.path} className="py-2">
            <p className="font-mono text-xs break-all">{row.path}</p>
            <p className="mt-1 text-sm break-words">{row.message.startsWith(`${row.path}: `) ? row.message.slice(row.path.length + 2) : row.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Branches with no workstream file (a bot branch, or a branch that has not written one yet): neutral rows, never an error. */
function NoWorkstreamRows({ rows }: { rows: NoWorkstreamRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Branches with no workstream" className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">No workstream ({rows.length})</h2>
      <ul className="divide-y divide-cc-rule rounded-lg border border-cc-rule-solid">
        {rows.map((row) => (
          <li key={row.branch} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2 text-sm">
            <span className="font-mono text-xs break-all">{row.branch}</span>
            <span className="text-cc-muted">no workstream</span>
            {row.pr !== null && (
              <a href={row.pr.url} target="_blank" rel="noreferrer" className="text-cc-link underline underline-offset-2 cc-focus-ring">
                PR #{row.pr.number}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkstreamsBody({ view, now }: { view: WorkstreamsView; now: number }) {
  const cardCount = view.lanes.reduce((sum, lane) => sum + lane.cards.length, 0);
  return (
    <div className="flex flex-col gap-6">
      <LiveNotice live={view.live} />
      {view.roadmapProblem !== null && (
        <p role="status" className="text-xs text-cc-muted">
          Lanes unavailable: {view.roadmapProblem}. Every workstream is under "No roadmap lane".
        </p>
      )}
      {view.snapshotProblems.length > 0 && (
        <p role="status" className="text-xs text-cc-muted">
          Snapshot incomplete: {view.snapshotProblems.join(' ')}
        </p>
      )}
      <InvalidRows rows={view.invalid} />
      {cardCount === 0 && view.invalid.length === 0 ? <p className="text-cc-muted">No workstreams</p> : null}
      {view.lanes.map((lane) => (
        <section key={lane.id} aria-label={lane.title} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {lane.title} <span className="font-mono text-xs text-cc-soft">{lane.cards.length}</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {lane.cards.map((card) => (
              <Card key={card.branch} card={card} now={now} />
            ))}
          </div>
        </section>
      ))}
      <NoWorkstreamRows rows={view.none} />
      {view.hiddenMerged > 0 && (
        <p className="text-xs text-cc-soft">
          {view.hiddenMerged} merged {view.hiddenMerged === 1 ? 'row' : 'rows'} older than 14 days {view.hiddenMerged === 1 ? 'is' : 'are'} hidden
        </p>
      )}
    </div>
  );
}

export function WorkstreamsPage() {
  useDocumentTitle('Workstreams');
  const result = usePanel<WorkstreamsView>('/api/workstreams', WORKSTREAM_MODULES);
  const now = useNow();
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-[96rem] flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Workstreams</h1>
        <PanelFrame title="Workstreams" result={result}>
          {(view) => <WorkstreamsBody view={view} now={now} />}
        </PanelFrame>
      </main>
    </div>
  );
}
