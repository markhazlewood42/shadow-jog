import { Chip } from '@heroui/react';
import { CircleCheck, CircleDashed, CircleX, Clock, ExternalLink, GitPullRequest, GitPullRequestDraft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GithubInfo, ModuleName, PullRequest } from '../../shared/types';
import { loadHealthPanel } from '../api';
import { PanelContent } from '../PanelFrame';
import { useLoadedPanel, usePanel } from '../usePanel';
import { GlassPanel, type PanelPlacement } from './GlassPanel';
import { Age, useNow } from './time';

// "Pull requests": the open pull requests with their review state and their checks, and one link to the merged ones (design 5.1, and Mark's change on the live tool:
// the merged ones are a click away on GitHub and are not listed here). Every word that
// comes from GitHub (a title, a branch, the name of a check) is shown as text, and an address becomes a link only when the server checked that it is http or https.

/** The panel loads again when the GitHub module says that something changed (it looks every 60 seconds, and when a panel asks). */
const GITHUB_MODULES: readonly ModuleName[] = ['github'];

/** The repo name does not change while the server runs, so the page reads it once and never loads it again for a "changed" event. */
const NO_MODULES: readonly ModuleName[] = [];

/** The state of the checks, as a word and a shape. The Look has no red or green, so a state is never told by color alone. */
const CHECKS: Record<PullRequest['checksSummary'], { label: string; Icon: LucideIcon }> = {
  pass: { label: 'Checks passed', Icon: CircleCheck },
  fail: { label: 'Checks failed', Icon: CircleX },
  pending: { label: 'Checks running', Icon: Clock },
  none: { label: 'No checks', Icon: CircleDashed },
};

/** GitHub's words for a review decision, in words for a person. Another word that GitHub may add is shown as GitHub wrote it. */
const REVIEWS: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' };

/** What waits for Mark on a pull request (the server decides, see `attention` in the shared types). */
const ATTENTION: Record<NonNullable<PullRequest['attention']>, string> = { merge: 'Ready to merge', fix: 'Needs a fix' };

/** The title of a pull request, as a link to it on GitHub when the address is usable. */
function PullRequestTitle({ pr }: { pr: PullRequest }) {
  if (pr.url === '') return <span className="break-words">{pr.title}</span>;
  return (
    <a href={pr.url} target="_blank" rel="noreferrer" className="break-words text-cc-link underline underline-offset-2 cc-focus-ring">
      {pr.title}
      <ExternalLink aria-hidden className="mb-0.5 ml-1 inline size-3.5" />
    </a>
  );
}

function Row({ icon: Icon, pr, chip, children }: { icon: LucideIcon; pr: PullRequest; chip?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-mono text-cc-muted">#{pr.number}</span> <PullRequestTitle pr={pr} />
        </p>
        {chip}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-xs text-cc-soft">{children}</div>
    </li>
  );
}

function OpenRow({ pr, now }: { pr: PullRequest; now: number }) {
  const checks = CHECKS[pr.checksSummary];
  const failing = pr.checks.filter((check) => check.status === 'fail');
  return (
    <Row
      icon={pr.isDraft ? GitPullRequestDraft : GitPullRequest}
      pr={pr}
      chip={
        pr.attention === null ? undefined : (
          <Chip size="sm" className="shrink-0 border border-cc-rule-solid">
            <Chip.Label>{ATTENTION[pr.attention]}</Chip.Label>
          </Chip>
        )
      }
    >
      {pr.isDraft && <span>Draft</span>}
      {pr.reviewDecision !== null && <span>{REVIEWS[pr.reviewDecision] ?? pr.reviewDecision}</span>}
      <span className="inline-flex items-center gap-1">
        <checks.Icon aria-hidden className="size-3 shrink-0" />
        {/* The words of the state, and for a failure the names of the checks that failed, so that Mark sees which one without opening the pull request. */}
        <span className="break-words">{failing.length > 0 ? `${checks.label}: ${failing.map((check) => check.name).join(', ')}` : checks.label}</span>
      </span>
      <span>
        updated <Age iso={pr.updatedAt} now={now} />
      </span>
    </Row>
  );
}

/** The label of a group of pull requests: small, in capitals, with the count. */
function GroupLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium tracking-wide text-cc-soft uppercase">{children}</h3>;
}

/** Where GitHub lists the merged pull requests of the repo: its own search for the pull requests that are merged (`is:pr is:merged`, written as it goes in an address). */
function mergedAddress(repo: string): string {
  return `https://github.com/${repo}/pulls?q=is%3Apr+is%3Amerged`;
}

/**
 * The one line under the open pull requests that leads to the merged ones, on GitHub. `repo` is null until the health reply has come, and when it could not be read:
 * then the label "Repo unknown" stands where the link would be, so the panel does not look as if nothing were missing.
 */
function MergedLink({ repo, failed }: { repo: string | null; failed: boolean }) {
  if (repo === null) {
    return failed ? <p className="text-xs text-cc-muted">Repo unknown</p> : null;
  }
  return (
    <p>
      <a href={mergedAddress(repo)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-cc-link underline underline-offset-2 cc-focus-ring">
        Merged pull requests
        <ExternalLink aria-hidden className="size-3.5" />
      </a>
    </p>
  );
}

function PullRequestList({ info, now, repo, repoFailed }: { info: GithubInfo; now: number; repo: string | null; repoFailed: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Open pull requests">
        <GroupLabel>Open ({info.open.length})</GroupLabel>
        {info.open.length === 0 ? (
          <p className="mt-2 text-cc-muted">No open PRs</p>
        ) : (
          <ul className="mt-1 divide-y divide-cc-rule">
            {info.open.map((pr) => (
              <OpenRow key={pr.number} pr={pr} now={now} />
            ))}
          </ul>
        )}
      </section>
      <MergedLink repo={repo} failed={repoFailed} />
    </div>
  );
}

export function PullRequestsPanel(placement: PanelPlacement) {
  const result = usePanel<GithubInfo>('/api/github', GITHUB_MODULES);
  // The name of the repo comes from the health reply (the config), as the Links panel gets its addresses. The server's list of pull requests is not changed for it.
  const health = useLoadedPanel(loadHealthPanel, NO_MODULES);
  const repo = health.panel?.ok ? health.panel.data.githubRepo : null;
  const now = useNow();
  return (
    <GlassPanel id="pull-requests" title="Pull requests" {...placement}>
      <PanelContent title="Pull requests" result={result}>
        {(info) => <PullRequestList info={info} now={now} repo={repo} repoFailed={health.panel !== null && !health.panel.ok} />}
      </PanelContent>
    </GlassPanel>
  );
}
