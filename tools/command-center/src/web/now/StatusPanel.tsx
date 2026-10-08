import { Button } from '@heroui/react';
import { ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { type CiMain, type GitInfo, type Health, MIGRATION_DOC_SLUG, type ModuleName, type Panel, STATUS_DOC_SLUG, type StatusInfo } from '../../shared/types';
import { loadHealthPanel } from '../api';
import { docPath } from '../docs/paths';
import { PanelContent } from '../PanelFrame';
import { type PanelResult, useLoadedPanel, usePanel } from '../usePanel';
import { GlassPanel, type PanelPlacement } from './GlassPanel';
import { Age, useNow } from './time';

// "Status": where the project stands, as a summary. Five rows (a label, a value and a link) and a strip of the milestones. It copies no text of status.md: it says how
// many items wait for Mark and when the file was updated, and links to the doc for the rest. Every string on it is a label, a number, a date or a link (design 5.8).
//
// The panel reads four sources, each on its own: the status module (the date, the count of the Next up list, the milestone key and the milestones), the git module
// (the branch and its last commit), the CI source (the newest run on main) and the health reply (the name of the repo on GitHub, for the links). A row whose source
// failed shows "Unavailable" and a Retry button for that source, and the other rows go on, so one broken source never blanks the panel.

const STATUS_MODULES: readonly ModuleName[] = ['status'];
const GIT_MODULES: readonly ModuleName[] = ['git'];
const CI_MODULES: readonly ModuleName[] = ['ci'];
/** The name of the repo does not change while the server runs, so the page reads it once and never loads it again for a "changed" event. */
const NO_MODULES: readonly ModuleName[] = [];

// ---- the four sources, put together ----

/** One source of the panel after it has answered: its panel (good or failed), and the function that asks it again. */
export type Source<T> = { panel: Panel<T>; reload: () => void };

/** The four sources of the panel, all answered. This is the data of the panel. */
export type StatusSources = { status: Source<StatusInfo>; git: Source<GitInfo>; ci: Source<CiMain>; health: Source<Health> };

/** What `usePanel` gave for each of the four sources. */
export type SourceResults = { status: PanelResult<StatusInfo>; git: PanelResult<GitInfo>; ci: PanelResult<CiMain>; health: PanelResult<Health> };

/** The earliest of some ISO times, for a list that is not empty. */
const earliest = (times: string[]): string => times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
/** The latest of some ISO times, for a list that is not empty. */
const latest = (times: string[]): string => times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));

/**
 * Puts the results of the four sources into the result of one panel.
 *
 * - It is loading until all four have answered, so that rows do not appear one by one.
 * - When at least one is good, the panel is good, and the failed sources show as rows (see Unavailable). Its time is the oldest time of the good ones: the data on
 *   offer is as old as its oldest part.
 * - When none is good, nothing can be shown, and the panel is failed in the way of every panel: the error names what each source said (a message that two sources
 *   share is said once), and Retry asks all four again. A panel with five rows of "Unavailable" would say less.
 */
export function combineSources(results: SourceResults): PanelResult<StatusSources> {
  const reload = () => {
    for (const result of Object.values(results)) result.reload();
  };
  const { status, git, ci, health } = results;
  if (status.panel === null || git.panel === null || ci.panel === null || health.panel === null) return { state: 'loading', panel: null, reload };

  const sources: StatusSources = {
    status: { panel: status.panel, reload: status.reload },
    git: { panel: git.panel, reload: git.reload },
    ci: { panel: ci.panel, reload: ci.reload },
    health: { panel: health.panel, reload: health.reload },
  };
  const panels: Panel<unknown>[] = [status.panel, git.panel, ci.panel, health.panel];

  const goodTimes = panels.flatMap((panel) => (panel.ok ? [panel.updatedAt] : []));
  if (goodTimes.length > 0) return { state: 'ready', panel: { ok: true, data: sources, updatedAt: earliest(goodTimes) }, reload };

  const failures = panels.flatMap((panel) => (panel.ok ? [] : [panel.error]));
  const knownTimes = panels.flatMap((panel) => (panel.ok || panel.updatedAt === null ? [] : [panel.updatedAt]));
  return {
    state: 'error',
    panel: {
      ok: false,
      error: { code: [...new Set(failures.map((failure) => failure.code))].join(', '), message: [...new Set(failures.map((failure) => failure.message))].join(' ') },
      updatedAt: knownTimes.length === 0 ? null : latest(knownTimes),
      lastGood: null,
    },
    reload,
  };
}

/** A source that failed, as a row needs to say it: the code of the failure, and how to ask the source again. */
type Failed = { code: string; reload: () => void };

/** The sources, of those that a row needs, that failed. Empty when the row can be drawn. */
function failedOf(...sources: Source<unknown>[]): Failed[] {
  return sources.flatMap((source) => (source.panel.ok ? [] : [{ code: source.panel.error.code, reload: source.reload }]));
}

// ---- what the rows say ----

/**
 * How the checked-out branch stands against the one it follows: `ahead 3`, `behind 1`, `ahead 3, behind 1` or `level`. A branch that follows none, and one whose
 * upstream is gone, have `no upstream`. git counts as of the last `git fetch`, so a branch that has not been fetched can be behind more than this says.
 */
export function standingOf(git: GitInfo): string {
  if (git.ahead === null || git.behind === null) return 'no upstream';
  if (git.ahead === 0 && git.behind === 0) return 'level';
  if (git.behind === 0) return `ahead ${git.ahead}`;
  if (git.ahead === 0) return `behind ${git.behind}`;
  return `ahead ${git.ahead}, behind ${git.behind}`;
}

/** A name with slashes (`feature/widget`) as the end of an address: each part is encoded, the slashes stay. */
const pathOf = (name: string): string => name.split('/').map(encodeURIComponent).join('/');

/**
 * The address of the branch on GitHub, when the checked-out branch follows a branch of origin that still exists (git knows the counts then). It is the address of the
 * origin branch that is followed, which has the name of the local branch in the usual case. Null for a branch that follows none, for one that follows a branch of
 * another remote (the repo on GitHub is origin's), and for one whose upstream is gone (the page would not be there).
 */
export function branchHref(repo: string, git: GitInfo): string | null {
  const upstream = git.branches.find((branch) => branch.name === git.current)?.upstream ?? null;
  if (upstream === null || git.ahead === null || !upstream.startsWith('origin/')) return null;
  return `https://github.com/${repo}/tree/${pathOf(upstream.slice('origin/'.length))}`;
}

/** The address of a commit on GitHub. Null when the id is not a hex id (the text comes from git, and an address is built only from what is known to be safe). */
export function commitHref(repo: string, sha: string): string | null {
  return /^[0-9a-f]{7,64}$/i.test(sha) ? `https://github.com/${repo}/commit/${sha}` : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The row "status.md": `updated Oct 7` for the date of its frontmatter (`2026-10-07`), with the year (`updated Oct 7, 2025`) only when it is not the year of `now`.
 * The date is read from its text and not through a time zone, so it never moves a day. A date in another shape is shown as it was written, and none is `No date`.
 */
export function updatedLabel(updated: string | null, now: Date): string {
  if (updated === null) return 'No date';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(updated);
  if (match === null) return `updated ${updated}`;
  const [, year, monthNumber, day] = match.map(Number);
  const month = MONTHS[(monthNumber ?? 0) - 1];
  if (month === undefined || day === undefined || day < 1 || day > 31) return `updated ${updated}`;
  return `updated ${month} ${day}${year === now.getFullYear() ? '' : `, ${year}`}`;
}

/** The words of the row "Next up": the number of items that wait for Mark, or `Nothing for you`. */
export function nextUpLabel(count: number): string {
  return count === 0 ? 'Nothing for you' : `${count} for you`;
}

/** What a square of the strip is: before the current milestone (`done`), the current milestone, or after it (`later`). */
export type SquareState = 'done' | 'current' | 'later';

/** The state of each of `total` squares, in the order of the table. `current` is the place of the current milestone; with none (the key is `none`, or it has a problem) every square is `later`. */
export function squareStates(total: number, current: number | null): SquareState[] {
  return Array.from({ length: total }, (_unused, index) => (current === null || index > current ? 'later' : index < current ? 'done' : 'current'));
}

/** What stands beside the strip: the current milestone (a link), `Not started`, or an error label for a key that is missing or names no milestone. */
export type Beside = { kind: 'current'; index: number } | { kind: 'not-started' } | { kind: 'error'; label: 'Milestone key missing' | 'Unknown milestone' };

/** Decides what stands beside the strip. A key that names a milestone the list does not have is as unknown as one that the server flagged. */
export function besideOf(info: Pick<StatusInfo, 'milestone' | 'milestones'>): Beside {
  const { current, problem } = info.milestone;
  if (problem === 'missing') return { kind: 'error', label: 'Milestone key missing' };
  if (problem === 'unknown') return { kind: 'error', label: 'Unknown milestone' };
  if (current === null) return { kind: 'not-started' };
  const index = info.milestones.findIndex((milestone) => milestone.id === current);
  return index === -1 ? { kind: 'error', label: 'Unknown milestone' } : { kind: 'current', index };
}

/** The words of a milestone: its id and its name (`M3 Battle stage`). Some rows of the table have no name. */
const milestoneName = (milestone: StatusInfo['milestones'][number]): string => `${milestone.id} ${milestone.name}`.trim();

/** The address of a milestone in the doc of the migration plan: its heading, or the top of the doc when the doc has no heading for it. */
const milestoneHref = (milestone: StatusInfo['milestones'][number]): string => docPath(MIGRATION_DOC_SLUG, milestone.anchor ?? undefined);

// ---- the parts ----

const LINK_CLASS = 'text-cc-link underline underline-offset-2 cc-focus-ring';

/** A value that is a link. An address on this site moves the router and loads no new page; an address elsewhere (GitHub) opens another tab, and says so with its icon. */
function ValueLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={LINK_CLASS}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {children}
      <ExternalLink aria-hidden className="mb-0.5 ml-1 inline size-3.5" />
    </a>
  );
}

/** The width of the column of labels, for the rows and for the strip under them. */
const LABEL_CLASS = 'w-28 shrink-0 text-sm text-cc-soft';

/** One row: a label and its value (a `dt` and a `dd`). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 first:pt-0">
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">{children}</dd>
    </div>
  );
}

/**
 * What a row shows when a source that it needs failed: an error label, the code of the failure (the full message is the server's, and the code is what a person
 * can look up), and a Retry button that asks the failed sources again. The icon is ink and not amber: the Look keeps amber for the one or two things that matter.
 */
function Unavailable({ failed, what }: { failed: Failed[]; what: string }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 font-medium">
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-cc-ink" />
        Unavailable
      </span>
      <span className="font-mono text-xs text-cc-muted">{[...new Set(failed.map((source) => source.code))].join(', ')}</span>
      <Button
        size="sm"
        variant="tertiary"
        aria-label={`Retry ${what}`}
        onPress={() => {
          for (const source of failed) source.reload();
        }}
      >
        <RefreshCw aria-hidden className="size-3.5" />
        Retry
      </Button>
    </>
  );
}

function BranchRow({ git, health }: { git: Source<GitInfo>; health: Source<Health> }) {
  if (!git.panel.ok || !health.panel.ok) {
    return (
      <Row label="Branch">
        <Unavailable failed={failedOf(git, health)} what="Branch" />
      </Row>
    );
  }
  const info = git.panel.data;
  if (info.current === null) {
    return (
      <Row label="Branch">
        <span className="text-cc-muted">No branch</span>
      </Row>
    );
  }
  const href = branchHref(health.panel.data.githubRepo, info);
  const name = <span className="font-mono break-all">{info.current}</span>;
  return (
    <Row label="Branch">
      {href === null ? name : <ValueLink href={href}>{name}</ValueLink>}
      <span className="text-cc-muted" title="As of last fetch">
        {standingOf(info)}
      </span>
    </Row>
  );
}

function CiRow({ ci, now }: { ci: Source<CiMain>; now: number }) {
  if (!ci.panel.ok) {
    return (
      <Row label="CI on main">
        <Unavailable failed={failedOf(ci)} what="CI on main" />
      </Row>
    );
  }
  const run = ci.panel.data;
  if (run.state === 'none') {
    return (
      <Row label="CI on main">
        <span className="text-cc-muted">no run</span>
      </Row>
    );
  }
  const words = (
    <>
      {run.state}
      {run.createdAt !== null && (
        <>
          {' '}
          <Age iso={run.createdAt} now={now} />
        </>
      )}
    </>
  );
  return <Row label="CI on main">{run.url === null ? <span>{words}</span> : <ValueLink href={run.url}>{words}</ValueLink>}</Row>;
}

function NextUpRow({ status }: { status: Source<StatusInfo> }) {
  if (!status.panel.ok) {
    return (
      <Row label="Next up">
        <Unavailable failed={failedOf(status)} what="Next up" />
      </Row>
    );
  }
  return (
    <Row label="Next up">
      <ValueLink href={docPath(STATUS_DOC_SLUG)}>{nextUpLabel(status.panel.data.nextUpForMark.length)}</ValueLink>
    </Row>
  );
}

function UpdatedRow({ status, now }: { status: Source<StatusInfo>; now: number }) {
  if (!status.panel.ok) {
    return (
      <Row label="status.md">
        <Unavailable failed={failedOf(status)} what="status.md" />
      </Row>
    );
  }
  return (
    <Row label="status.md">
      <ValueLink href={docPath(STATUS_DOC_SLUG)}>{updatedLabel(status.panel.data.updated, new Date(now))}</ValueLink>
    </Row>
  );
}

function LastCommitRow({ git, health, now }: { git: Source<GitInfo>; health: Source<Health>; now: number }) {
  if (!git.panel.ok || !health.panel.ok) {
    return (
      <Row label="Last commit">
        <Unavailable failed={failedOf(git, health)} what="Last commit" />
      </Row>
    );
  }
  const [newest] = git.panel.data.commits;
  if (newest === undefined) {
    return (
      <Row label="Last commit">
        <span className="text-cc-muted">No commits</span>
      </Row>
    );
  }
  const href = commitHref(health.panel.data.githubRepo, newest.sha);
  const age = <Age iso={newest.date} now={now} />;
  return <Row label="Last commit">{href === null ? age : <ValueLink href={href}>{age}</ValueLink>}</Row>;
}

/** The look of a square, by its state. A filled square is muted, the current one is amber (the one focal item of the panel), the rest are outlined. */
const SQUARE_CLASS: Record<SquareState, string> = {
  done: 'border-cc-muted bg-cc-muted',
  current: 'border-cc-accent bg-cc-accent',
  later: 'border-cc-rule-solid bg-transparent',
};

/**
 * The strip of the milestones: the label, one small square for each row of the table in the migration doc (each a link to the heading of its milestone), and,
 * beside the squares, the current milestone as a link, `Not started`, or an error label. A key that is missing or names no milestone leaves every square outlined:
 * the strip never guesses which milestone was meant.
 */
function MilestoneStrip({ status }: { status: Source<StatusInfo> }) {
  let body: ReactNode;
  if (!status.panel.ok) {
    body = <Unavailable failed={failedOf(status)} what="Milestone" />;
  } else {
    const info = status.panel.data;
    const beside = besideOf(info);
    // An error beside the strip means that no square is current, whatever the key was.
    const states = squareStates(info.milestones.length, beside.kind === 'current' ? beside.index : null);
    let note: ReactNode;
    if (beside.kind === 'current') {
      const milestone = info.milestones[beside.index];
      note = milestone === undefined ? null : <ValueLink href={milestoneHref(milestone)}>{milestoneName(milestone)}</ValueLink>;
    } else if (beside.kind === 'not-started') {
      note = <span className="text-cc-muted">Not started</span>;
    } else {
      note = (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-cc-ink" />
          {beside.label}
        </span>
      );
    }
    body = (
      <>
        <ol aria-label="Milestones" className="flex flex-wrap items-center gap-1.5">
          {info.milestones.map((milestone, index) => {
            const state = states[index] ?? 'later';
            return (
              // The doc is written by hand, and two rows could carry the same id: the place in the table keeps the keys apart.
              <li key={`${index}:${milestone.id}`}>
                <Link
                  to={milestoneHref(milestone)}
                  aria-label={milestoneName(milestone)}
                  title={milestoneName(milestone)}
                  aria-current={state === 'current' ? 'step' : undefined}
                  data-state={state}
                  className={`block size-4 rounded-xs border hover:border-cc-ink cc-focus-ring ${SQUARE_CLASS[state]}`}
                />
              </li>
            );
          })}
        </ol>
        {note}
      </>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-cc-rule pt-2.5">
      <span className={LABEL_CLASS}>Milestone</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-sm">{body}</div>
    </div>
  );
}

function StatusSummary({ sources, now }: { sources: StatusSources; now: number }) {
  const { status, git, ci, health } = sources;
  return (
    <div className="flex flex-col">
      <dl className="divide-y divide-cc-rule">
        <BranchRow git={git} health={health} />
        <CiRow ci={ci} now={now} />
        <NextUpRow status={status} />
        <UpdatedRow status={status} now={now} />
        <LastCommitRow git={git} health={health} now={now} />
      </dl>
      <MilestoneStrip status={status} />
    </div>
  );
}

export function StatusPanel(placement: PanelPlacement) {
  const status = usePanel<StatusInfo>('/api/status', STATUS_MODULES);
  const git = usePanel<GitInfo>('/api/git', GIT_MODULES);
  const ci = usePanel<CiMain>('/api/ci', CI_MODULES);
  // The name of the repo comes from the health reply (the config), as the Pull requests panel gets it: it is the base of the links to the branch and the commit.
  const health = useLoadedPanel(loadHealthPanel, NO_MODULES);
  const result = combineSources({ status, git, ci, health });
  const now = useNow();
  return (
    <GlassPanel id="status" title="Status" {...placement}>
      <PanelContent title="Status" result={result}>
        {(sources) => <StatusSummary sources={sources} now={now} />}
      </PanelContent>
    </GlassPanel>
  );
}
