import { GitBranch } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { GitInfo, ModuleName, Panel, StatusInfo } from '../../shared/types';
import { PanelContent } from '../PanelFrame';
import { type PanelResult, usePanel } from '../usePanel';
import { GlassPanel, type PanelPlacement } from './GlassPanel';
import { Age, useNow } from './time';

// "Status": where the project stands. It has two sources, and one panel: the current "Right now" section of status.md and the milestones (the status
// module), and the branch with its newest commits (the git module). The panel is one box with one error state, so the two results are put together first.

const STATUS_MODULES: readonly ModuleName[] = ['status'];
const GIT_MODULES: readonly ModuleName[] = ['git'];

/** What the panel draws. A part is null when its source gave nothing, not even older data: the panel then draws the other part, and its error says why. */
export type StatusData = { status: StatusInfo | null; git: GitInfo | null };

/** The data of a panel, or the last good data of a failed one. */
function dataOf<T>(panel: Panel<T>): T | null {
  return panel.ok ? panel.data : (panel.lastGood?.data ?? null);
}

/** The older of two times (ISO texts), and the one that exists when the other is null. */
function older(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return a ?? b;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/**
 * Puts the results of two panels into the result of one. The panel is loading until both have answered. It is good when both are good, and its time is the
 * older of the two (the data on offer is as old as its oldest part). When one fails, or both do, the panel is failed: the error says what each said, and
 * the data of the panel is what the two have (their last good data), so the box shows the error and what is still known. Retry asks both again.
 */
export function combinePanels(status: PanelResult<StatusInfo>, git: PanelResult<GitInfo>): PanelResult<StatusData> {
  const reload = () => {
    status.reload();
    git.reload();
  };
  const [a, b] = [status.panel, git.panel];
  if (a === null || b === null) return { state: 'loading', panel: null, reload };

  const data: StatusData = { status: dataOf(a), git: dataOf(b) };
  const updatedAt = older(a.updatedAt, b.updatedAt);
  if (a.ok && b.ok) return { state: 'ready', panel: { ok: true, data, updatedAt: updatedAt as string }, reload };

  const failures = [a, b].flatMap((panel) => (panel.ok ? [] : [panel.error]));
  return {
    state: 'error',
    panel: {
      ok: false,
      error: { code: failures.map((failure) => failure.code).join(', '), message: failures.map((failure) => failure.message).join(' ') },
      updatedAt,
      lastGood: data.status === null && data.git === null ? null : { data, updatedAt: updatedAt ?? '' },
    },
    reload,
  };
}

/** The label of a part of the panel: small, in capitals. */
function PartLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium tracking-wide text-cc-soft uppercase">{children}</h3>;
}

/**
 * The "Right now" section of status.md. The server made its html from the markdown and escaped every tag of the text itself (see the doc index), so the html can be
 * put into the page as it is, as the doc pages do. It can be long (it is the page's whole current state), so it scrolls inside the panel. A link to another doc moves the
 * router, as it does on the doc pages, and loads no new page.
 */
function RightNow({ status }: { status: StatusInfo }) {
  const navigate = useNavigate();

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href') ?? '';
    if (href === '/docs' || href.startsWith('/docs/')) {
      event.preventDefault();
      navigate(href);
    }
  }

  return (
    <section aria-label="Right now" className="flex flex-col gap-2">
      <PartLabel>{status.rightNow.heading}</PartLabel>
      {status.rightNow.html === '' ? (
        <p className="text-cc-muted">This section of status.md has no text.</p>
      ) : (
        // `data-plasma-nodrag`: a press here is for selecting the text and for the scroll bar, and does not drag the panel (the header does).
        // The scroll area is a tab stop so that a person with a keyboard can scroll it.
        <div tabIndex={0} data-plasma-nodrag className="doc-html max-h-72 overflow-y-auto pr-2 cc-focus-ring" onClick={onClick} dangerouslySetInnerHTML={{ __html: status.rightNow.html }} />
      )}
    </section>
  );
}

function Milestones({ status }: { status: StatusInfo }) {
  return (
    <section aria-label="Milestones" className="flex flex-col gap-2">
      <PartLabel>Milestones</PartLabel>
      {status.milestones.length === 0 ? (
        <p className="text-cc-muted">No milestones are listed.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-sm">
          {status.milestones.map((milestone, index) => (
            // The doc is written by hand, and two rows could carry the same id: the place in the table keeps the keys apart.
            <li key={`${index}:${milestone.id}`} className="break-words">
              <span className="font-mono text-cc-muted">{milestone.id}</span> {milestone.name}
              {milestone.scope !== '' && <span className="text-cc-soft"> – {milestone.scope}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** How the branch stands against the one it follows, in words. git counts it as of the last `git fetch`, so a branch that Mark has not fetched can be behind more than it says. */
function Standing({ git }: { git: GitInfo }) {
  const upstream = git.branches.find((branch) => branch.name === git.current)?.upstream ?? null;
  if (git.ahead === null || git.behind === null) {
    return <span>{upstream === null ? 'follows no branch' : `follows ${upstream}, which is gone`}</span>;
  }
  if (git.ahead === 0 && git.behind === 0) return <span>level with {upstream ?? 'its upstream'}</span>;
  return (
    <>
      <span title="As of the last git fetch">ahead {git.ahead}</span>
      <span title="As of the last git fetch">behind {git.behind}</span>
      {upstream !== null && <span>of {upstream}</span>}
    </>
  );
}

function Branch({ git }: { git: GitInfo }) {
  return (
    <section aria-label="Branch" className="flex flex-col gap-2">
      <PartLabel>Branch</PartLabel>
      {git.current === null ? (
        <p className="text-cc-muted">No branch is checked out (HEAD is detached, or the repo has no commit yet).</p>
      ) : (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <GitBranch aria-hidden className="size-4 text-cc-muted" />
            <span className="font-mono break-all">{git.current}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 text-xs text-cc-muted">
            <Standing git={git} />
          </span>
        </p>
      )}
    </section>
  );
}

function Commits({ git, now }: { git: GitInfo; now: number }) {
  return (
    <section aria-label="Recent commits" className="flex flex-col gap-2">
      <PartLabel>Recent commits</PartLabel>
      {git.commits.length === 0 ? (
        <p className="text-cc-muted">This branch has no commits yet.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-sm">
          {git.commits.map((commit) => (
            <li key={commit.sha} className="flex flex-col">
              <p className="break-words">
                <span className="font-mono text-cc-muted">{commit.sha.slice(0, 7)}</span> {commit.subject}
              </p>
              <p className="text-xs text-cc-soft">
                {commit.author} · <Age iso={commit.date} now={now} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StatusSections({ data, now }: { data: StatusData; now: number }) {
  return (
    <div className="flex flex-col gap-6">
      {data.status !== null && <RightNow status={data.status} />}
      {data.status !== null && <Milestones status={data.status} />}
      {data.git !== null && <Branch git={data.git} />}
      {data.git !== null && <Commits git={data.git} now={now} />}
    </div>
  );
}

export function StatusPanel(placement: PanelPlacement) {
  const result = combinePanels(usePanel<StatusInfo>('/api/status', STATUS_MODULES), usePanel<GitInfo>('/api/git', GIT_MODULES));
  const now = useNow();
  return (
    <GlassPanel id="status" title="Status" {...placement}>
      <PanelContent title="Status" result={result}>
        {(data) => <StatusSections data={data} now={now} />}
      </PanelContent>
    </GlassPanel>
  );
}
