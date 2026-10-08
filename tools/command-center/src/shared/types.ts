// Types shared by the server and the page app. They are the contract between the two: the
// server writes these shapes as JSON and the page reads them. This folder imports nothing from
// the game's own src/ folder, and nothing outside this tool.

/** The name shown in the tab title, the page header and the health reply. */
export const APP_NAME = 'Shadow Jog Command Center';

/** The sources of data. The server has one module for each. */
export type ModuleName = 'docs' | 'engine' | 'status' | 'git' | 'github' | 'ci' | 'sessions' | 'decisions' | 'agents';

/**
 * What a data endpoint answers: either the data, or the reason there is none.
 *
 * A failed panel still carries the last data that did load (`lastGood`), so a page can show an
 * error and the older data together instead of an empty box. `updatedAt` is when the data on
 * offer was made: the time of the last good load, or null when nothing ever loaded.
 */
export type Panel<T> =
  | { ok: true; data: T; updatedAt: string }
  | {
      ok: false;
      error: { code: string; message: string };
      updatedAt: string | null;
      lastGood: { data: T; updatedAt: string } | null;
    };

/** "This module's data changed." The page reloads the panels that listen to that module. */
export type ChangeEvent = {
  module: ModuleName;
  /** When it happened, as an ISO time. */
  at: string;
  /** What changed, when the module knows (for example the ids of the docs that changed). */
  ids?: string[];
};

/** The reply of `GET /api/health`. The Links panel reads the game address and the links from it, and the Pull requests panel reads the repo name (for its link to the merged ones). */
export type Health = {
  ok: true;
  name: string;
  version: string;
  startedAt: string;
  gameUrl: string;
  /** The repo on GitHub, as `owner/name` (the config checks that it has this shape, so it is safe in an address). */
  githubRepo: string;
  links: { label: string; url: string }[];
};

/** The body of every error answer from the server (a refusal, a missing route, a failed write). */
export type ApiErrorBody = {
  ok: false;
  error: { code: string; message: string };
};

// ---- docs ----
// The shapes of the docs module (src/server/docs). The server builds them and the docs pages read
// them. A doc has two names: its `id` is its path in the repo (`docs/engine/decisions.md`), which
// is what every other module uses to point at it, and its `slug` is its address on the site
// (`/docs/engine/decisions`): the path without `.md` and without a leading `docs/`.

/** Where a doc's last-changed date came from. */
export type UpdatedFrom = 'frontmatter' | 'git' | 'file';

/** A doc as the lists show it. */
export type DocSummary = {
  /** The path in the repo, with forward slashes. It is what a `changed` event names. */
  id: string;
  slug: string;
  /** The `title` of the frontmatter, else the first `#` heading, else the file name. */
  title: string;
  /** The frontmatter `type`, or "" when there is none. */
  type: string;
  /** The frontmatter `status`, or "" when there is none. */
  status: string;
  /** The day the doc last changed, as YYYY-MM-DD. `updatedFrom` says where it was read. */
  updated: string;
  updatedFrom: UpdatedFrom;
};

/** A link to another doc: its address and its title. */
export type DocRef = { slug: string; title: string };

/** One entry of a doc's outline (h2 to h4). `id` is the id of the heading in the html. */
export type DocHeading = { level: 2 | 3 | 4; text: string; id: string };

/** One doc, with its html. The html is safe to put into the page as it is. */
export type DocPage = DocSummary & {
  html: string;
  headings: DocHeading[];
  /** The docs that link here, each once, not the doc itself, and no link that is broken. */
  backlinks: DocRef[];
  /** The addresses of the links in this doc that go nowhere, each once, as the doc wrote them. */
  brokenLinks: string[];
  /** What is wrong with the frontmatter, or null. */
  frontmatterError: string | null;
};

/** One entry in a section of the navigation: a doc, or a page of the site that is not a doc. */
export type NavItem = { kind: 'doc'; slug: string; title: string; updated: string } | { kind: 'page'; path: string; title: string };

/** A section of the navigation. A section holds items and nothing else: the navigation is two levels deep. */
export type NavSection = { id: string; title: string; items: NavItem[] };

/** One hit of a search. One hit for each doc: the section of it that matched best. */
export type SearchHit = {
  slug: string;
  title: string;
  /** The heading of the section that matched, or the doc's title when it has no heading there. Plain text. */
  heading: string;
  /** A few words of that section around the match. Plain text, not html: show it as text. */
  snippet: string;
  score: number;
};

/** What `GET /api/docs` holds (inside a Panel). */
export type DocsListing = {
  docs: DocSummary[];
  nav: NavSection[];
  /** What is wrong with the docs, one line each: broken links, a bad frontmatter, a name clash, a nav.json mistake. */
  problems: string[];
};

/**
 * The answer of `GET /api/docs/<slug>` for an address that no doc has (status 404). It is a failed
 * Panel, so a page that loads it as a panel shows its error; `suggestions` holds the docs that have
 * the same file name, for a doc that was moved.
 */
export type DocNotFound = {
  ok: false;
  error: { code: 'doc-not-found'; message: string };
  updatedAt: null;
  lastGood: null;
  suggestions: DocRef[];
};

// ---- engine review ----
// The shapes of the engine module (src/server/engine) and of the reading order of the engine docs.

/**
 * Where a decision is written. `engine`: the table of docs/engine/decisions.md (E1 to E25).
 * `phase-0.2`: the numbered lines of docs/PHASE-0.2.md (D1 to D17: the docs call them "decision 1"
 * and so on). `engine-update`: the quoted table of the Phase 0 update in docs/engine/README.md (C1 to C7).
 */
export type DecisionSource = 'engine' | 'phase-0.2' | 'engine-update';

/** `open`: it waits for Mark. `changed`: its text is not what it was at the approval commit. `approved`: answered, and unchanged since. */
export type DecisionStatus = 'approved' | 'open' | 'changed';

/** One decision of the engine docs, with its status. */
export type Decision = {
  /** A name that no other decision has: `E12`, `D5` or `C1`. It is also what the first column shows. */
  id: string;
  number: string;
  source: DecisionSource;
  question: string;
  /** What the doc recommends (the "Recommendation" cell of a table row), or, for a PHASE-0.2 line, the bold words after the dash ("decided 2026-10-02: (a)"). Plain text. */
  answer: string;
  /** The milestone that the decision is needed before ("Phase 0", "M2"), when the doc says. */
  milestone: string | null;
  /** Who decides: "Mark", or "Agent (FYI)". */
  who: string;
  /** What Mark answered, in the "Your answer" cell of a table row ("A"), when there is a cell and it is not empty. */
  option: string | null;
  status: DecisionStatus;
  /** How a `changed` decision differs from the approval commit: its text is `edited`, or it is `added` (it was not there). Null for any other status. */
  change: 'edited' | 'added' | null;
  /** The address of the doc that holds the decision (`engine/decisions`). */
  docSlug: string;
  /** The id of the heading to open the doc at, or null when the page has none for this decision. */
  anchor: string | null;
};

/** The doc before and the doc after a doc in the reading order of the engine docs. Null where there is none. */
export type ReadingOrder = { prev: DocRef | null; next: DocRef | null };

/** What `GET /api/docs/<slug>` holds (inside a Panel): the doc, and what the route adds to it. */
export type DocPageData = DocPage & {
  /** Where the doc sits in the reading order of the engine docs, or null when it is not in that order. */
  readingOrder: ReadingOrder | null;
  /**
   * The open decisions that link to a heading of this doc, one entry for each link (a decision that links two
   * headings of the doc has two). The page shows a banner above each linked heading. Empty when none does, and
   * null when the decisions could not be read from GitHub (so the page can say that the banners are missing).
   */
  decisions: DocDecision[] | null;
};

// ---- project status, git and GitHub ----
// The shapes of the status, git and GitHub modules (src/server/status, git and github). The Now page
// reads them. All text in them comes from files, from git or from GitHub, so a page must show it as
// text. The one exception is a field that is called `html`: the server made it, and it is safe to
// put into the page as it is.

/**
 * The addresses of the two docs that the Status panel links to: status.md and docs/engine/migration.md (see `slugOf` in the doc index for how a path becomes one).
 * The status module reads the same two files (STATUS_DOC_PATH and MIGRATION_DOC_PATH), and a test checks that these slugs are the ones of those paths.
 */
export const STATUS_DOC_SLUG = 'status';
export const MIGRATION_DOC_SLUG = 'engine/migration';

/**
 * What `GET /api/status` holds (inside a Panel): what the Status panel of the Now page reads from status.md (its date and the number of items that wait for Mark),
 * the `milestone` key of its frontmatter, and the milestones of the engine migration. It holds no text of status.md besides the items of the "Next up for Mark" list.
 */
export type StatusInfo = {
  /** The `updated` date of the frontmatter of status.md, as written there, or null when there is none. */
  updated: string | null;
  /** The items of the first "Next up for Mark" list in the current "Right now" section, in order. `text` is plain words and `html` is the item as html. */
  nextUpForMark: { text: string; html: string }[];
  /**
   * The `milestone` key of the frontmatter of status.md, checked against the ids of `milestones`. `current` is the id it names, and null for the value `none`
   * (no milestone has started) and when there is a problem. `problem` is `missing` when the key is not there (or has no value), `unknown` when its value is not
   * `none` and not an id of the table (ids are case sensitive), and null when the key is good. The page never guesses a milestone from a bad key.
   */
  milestone: { current: string | null; problem: 'missing' | 'unknown' | null };
  /**
   * The milestones of the table in docs/engine/migration.md, in the order of the table. The table has no state column, so there are names and scope only.
   * `anchor` is the id of the heading of the milestone in the page of that doc (the ids that the docs site gives its headings), or null when the doc has no heading for it.
   */
  milestones: { id: string; name: string; scope: string; anchor: string | null }[];
};

/** A local branch. `date` is when its newest commit was made (an ISO time). */
export type GitBranch = {
  name: string;
  date: string;
  /** The branch it follows, as `origin/main`, or null when it follows none. */
  upstream: string | null;
  /** How it differs from `upstream`, in git's words: `ahead 2`, `behind 1`, `ahead 2, behind 1` or `gone` (the upstream no longer exists). Null when it is level, or when there is no upstream. */
  track: string | null;
  /** The folder where the branch is checked out, when it is checked out in a working folder (this one, or another one made with `git worktree`). */
  worktree: string | null;
};

/** A commit. `date` is when it was made (an ISO time), `sha` is the full id. */
export type GitCommit = { sha: string; date: string; author: string; subject: string };

/** What `GET /api/git` holds (inside a Panel). */
export type GitInfo = {
  /** The branch that is checked out here, or null for a detached HEAD, and for a repo with no commit yet. */
  current: string | null;
  /** How many commits the current branch has that its upstream lacks. Null when there is no current branch, no upstream, or the upstream is gone. Counted as of the last `git fetch`. */
  ahead: number | null;
  /** How many commits the upstream has that the current branch lacks. Null in the same cases as `ahead`. */
  behind: number | null;
  /** The local branches, the newest first. */
  branches: GitBranch[];
  /** The newest commits of the checked-out HEAD, the newest first. */
  commits: GitCommit[];
};

/** One check of a pull request (a GitHub Actions job, or a status that another service reports). */
export type PullRequestCheck = {
  name: string;
  /** `pass`, `fail`, `pending` (not finished), or `skipped` (it did not run, or it has no verdict). */
  status: 'pass' | 'fail' | 'pending' | 'skipped';
  /** Where to read it (an http or https address), or null. */
  url: string | null;
};

/** The latest review of one reviewer. The words of the review are not kept. */
export type PullRequestReview = { by: string; state: string; at: string };

export type PullRequest = {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  /** The branch the pull request comes from. */
  branch: string;
  author: string;
  updatedAt: string;
  mergedAt: string | null;
  /** GitHub's word for the review state (`APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`), or null when there is none. */
  reviewDecision: string | null;
  reviews: PullRequestReview[];
  checks: PullRequestCheck[];
  /** All the checks in one word: `fail` when one failed, else `pending` when one is not done, else `pass`; `none` when nothing counts (there are no checks, or all were skipped). */
  checksSummary: 'pass' | 'fail' | 'pending' | 'none';
  /**
   * What waits for Mark. `fix`: an open pull request of Mark's (not a draft) whose check failed, or that a reviewer asked changes of.
   * `merge`: one whose checks all pass and that nobody asked changes of. Null for every other pull request, always for one of another
   * account (the repo is public, and the agents work through Mark's login): it shows in the list and never in "Your move".
   */
  attention: 'merge' | 'fix' | null;
};

/** What `GET /api/github` holds (inside a Panel): the open pull requests, and the ones merged in the last 7 days. */
export type GithubInfo = { open: PullRequest[]; merged: PullRequest[] };

/**
 * What `GET /api/ci` holds (inside a Panel): the newest run of the workflows on the branch `main`, as the Status panel shows it.
 * `passing`: it finished and passed. `failing`: it finished and failed, ran out of time, did not start, or waits for an approval. `running`: it is queued or
 * still runs. `none`: there is no run, or the newest one has no verdict (it was canceled or skipped); then there is no time and no address either.
 */
export type CiMain = {
  state: 'passing' | 'failing' | 'running' | 'none';
  /** When the run was made (an ISO time), or null when `state` is `none` or GitHub gave no usable time. */
  createdAt: string | null;
  /** Where to read the run on GitHub (an http or https address), or null when `state` is `none` or the address is not usable. */
  url: string | null;
};

// ---- Claude sessions ----
// The shapes of the sessions module (src/server/sessions). The Now page and the Agents page read them.
// They come from Claude Code's own session files, which a Claude Code update can change, so the module
// reads only the end of each file and says "unknown" where it cannot tell. The only transcript text in
// them is the title of a session, the lines of a "Your move" box and the description of an agent. A page
// must show every string as text.

/** The words of a session's state. `unknown`: the file could not be read as a Claude Code session file. */
export type SessionState = 'working' | 'waiting' | 'idle' | 'unknown';

/**
 * A "Your move" box: the checklist that ends a reply of a session when Mark has something to do
 * ("### 👉 Your move"). Only the last one of a session is kept, and only one from a reply that was
 * written inside the project (see `extractYourMove`).
 */
export type YourMoveBox = {
  /** The status light that starts the reply (🟢 green, 🟡 yellow, 🔴 red), or null when the reply does not start with one. */
  light: 'green' | 'yellow' | 'red' | null;
  /** The lines of the checklist, as the reply wrote them (markdown marks stay). Empty when `nothing` is true. */
  items: string[];
  /** The box says that there is nothing for Mark ("### 👉 Your move: nothing"). */
  nothing: boolean;
  /** When the reply was written, as an ISO time ("" when its line has no time, which the files of Claude Code 2.1 do not have). */
  at: string;
  /** A prompt of Mark's came after the box. A message from a background task or from another session does not count as one. */
  answered: boolean;
};

/** One agent of a session. A workflow's agents have a `workflowId`. */
export type AgentInfo = {
  /** The id of the agent: the file name `agent-<id>.jsonl` without the frame. */
  id: string;
  sessionId: string;
  /** What the agent was asked to do, in a few words (from its `.meta.json`), or "" when the file is missing. This is transcript text: show it as text. */
  description: string;
  /** The kind of agent (`general-purpose`, `Explore`, `workflow-subagent`, ...), or "". */
  agentType: string;
  /** The model that was asked for, or "" when the agent runs on the default. */
  model: string;
  /**
   * `running`: it has not ended and its file was written in the last `workingSeconds`.
   * `done`: it ended (it handed its result back or ended its turn), or its workflow has its result.
   * `stopped`: it has not ended and nothing has been written for `workingSeconds`.
   */
  state: 'running' | 'done' | 'stopped';
  /** The time of the first line of the agent's file, or the time the file was made when that line is too long to read. */
  startedAt: string;
  /** When it ended (the time of its last line), or null while it runs. */
  endedAt: string | null;
  /** The workflow that started it, or null for an agent that the session started itself. */
  workflowId: string | null;
};

/** One run of a workflow (a `journal.jsonl`). A journal has no times and no total, so progress is agents done of agents started. */
export type WorkflowInfo = {
  /** The id of the run (`wf_...`): the name of its folder. */
  id: string;
  /** The name of the workflow script, or the id when the script file is not found. */
  name: string;
  sessionId: string;
  /**
   * `done`: every agent that started has a result. `running`: not done, and an agent file was written in the last `workingSeconds`.
   * `stopped`: not done, and nothing is being written. `unknown`: the journal has no row that this tool knows.
   */
  state: 'running' | 'done' | 'stopped' | 'unknown';
  /** The phases in the order the journal first names them, each with its agents started and done. */
  phases: { name: string; started: number; done: number }[];
  /** All the agents that started, and all that have a result. */
  started: number;
  done: number;
  /** When the journal file was made (a journal has no times of its own), or null when the file system does not say. */
  startedAt: string | null;
  /** The last write to the journal or to one of the agent files of the run. */
  lastEventAt: string;
};

/** One Claude Code session about Shadow Jog. */
export type SessionInfo = {
  /** The session id: the file name without `.jsonl`. */
  id: string;
  /**
   * The title that Mark gave it (`/rename`), else the name of its agent, else the first line of its first prompt (white space collapsed, at
   * most 80 characters, cut with an ellipsis), else its slug, else "Session" and the first 8 characters of the id. Most sessions have no title
   * of their own, so most are titled by their first prompt. This is transcript text: show it as text.
   */
  title: string;
  /** The name of the folder under `~/.claude/projects` that holds the session file. */
  folder: string;
  /** `folder`: the folder is all Shadow Jog's (it is in `claude.folders`). `cwd`: the folder mixes projects, and the session is here because its working folder is inside a root. */
  matchedBy: 'folder' | 'cwd';
  /** The working folder of its newest line that has one, or null when no line in the part that was read has one. */
  cwd: string | null;
  /**
   * How the session was started, from the newest line that says so (`claude-desktop`, `cli`, `sdk-py`, ...; at most 40 characters), or null when
   * no line in the part that was read says so (the older files have none). A session that a script started (`sdk-py`, `sdk-ts`, `sdk-cli`: the
   * entrypoint starts with "sdk") is listed only when the config says `claude.includeSdk` is true, so with the default setting this is never one.
   */
  entrypoint: string | null;
  /** The git branch of that line, or "" when no line in the part that was read names one. */
  branch: string;
  /** The time of the first line of the file, or the time the file was made when that line is too long to read. */
  startedAt: string;
  /** The last write to the session file, or to one of the agent files of the session when that is later. */
  lastActivityAt: string;
  state: SessionState;
  /** The pull requests of this repository that the session opened or linked. */
  prs: { number: number; url: string }[];
  /** The last "Your move" box that the session wrote inside the project, or null when it wrote none. */
  yourMove: YourMoveBox | null;
  agents: AgentInfo[];
  workflows: WorkflowInfo[];
};

/**
 * What `GET /api/sessions` holds (inside a Panel): the sessions of the last `recentSeconds` that are about
 * Shadow Jog, the newest first. `scanned` is how many session files of that time were looked at.
 * `skipped` is how many of them are not Shadow Jog's (outside the roots) or not readable.
 * `hiddenSdk` is how many Shadow Jog sessions were left out because a script started them (the entrypoint starts with "sdk": `sdk-py`, `sdk-ts`,
 * `sdk-cli`). No page shows this number: the Agents page and the Running panel show `AgentsLive.hiddenScripts`, the same count for the live sessions only
 * (the Your move list is made from this answer, and the live view from the process list). It is 0 when the config says `claude.includeSdk` is true: then they are listed.
 * Every file is counted once: `scanned` = `sessions.length` + `hiddenSdk` + `skipped`. The sessions that were left out never appear in the answer,
 * not even by their id.
 */
export type SessionsInfo = { sessions: SessionInfo[]; scanned: number; skipped: number; hiddenSdk: number };

/**
 * The id of a session's cluster on the Agents page (the session box and the agents under it). An address that ends in `#<this id>` leads to the cluster of a session that is live.
 * The server writes such an address into the "Your move" list (src/server/now/yourMove.ts), and the page finds the cluster by it (src/web/agents), so the two share this one function
 * and cannot drift apart.
 */
export function sessionAnchor(sessionId: string): string {
  return `session-${sessionId}`;
}

/** The address of a session's cluster on the Agents page. It is an address of this site (it starts with "/"), so a link to it moves inside the app. */
export function sessionHref(sessionId: string): string {
  return `/agents#${sessionAnchor(sessionId)}`;
}

// ---- live agents (revision 2) ----
// The shapes of the agents module (src/server/agents): what is alive now, as a tree of sessions and agents. A session is alive while its
// Claude process runs, so the module starts from the process list of Claude Code (one small file for each process) and reads only the
// files of those sessions. Only the session id, the start time and busy or idle leave the process file: the process id and every other key stay on
// the server. The words in a node (a title, a label) come from session files, so a page must show them as text.

/** A box in the tree under a session: an agent, or a workflow run. */
export type LiveNode = {
  /** The id of an agent (the file name `agent-<id>.jsonl` without the frame), or of a workflow run (`wf_...`: its folder name). */
  id: string;
  /**
   * What started it, and so what its solid line comes from: the id of its session, of another agent, or of a workflow. The id always names
   * the session of this node or another node in the same list, so a page can draw the line. An agent that no call was found for hangs on its session.
   */
  parentId: string;
  kind: 'agent' | 'workflow';
  /** What the agent was asked to do (the `description` in its `.meta.json`, at most 300 characters), or the name of the workflow. This is transcript text: show it as text. */
  label: string;
  /** The model as a family name (`fable`, `sonnet`), or null when the agent does not say (and for a workflow). Any value that is not a Claude model id stays as given, cut to 12 characters. */
  model: string | null;
  /** `running`: it has no end record, and it was written in the last `claude.workingSeconds`, or its session is busy and it was written in the last `agents.staleSeconds`. `done`: it ended, and it stays for `agents.lingerSeconds`. */
  state: 'running' | 'done';
  /** The time of the first line of the agent's file (an ISO time), or the time the file was made. Null for a workflow whose journal does not say. */
  startedAt: string | null;
  /** When it ended (the time of its last line, an ISO time), or null while it runs. */
  endedAt: string | null;
  /** The file of the agent, or the journal of the workflow (null when the workflow has none), for a Copy button. It is a path on this machine. */
  filePath: string | null;
  /**
   * The messages that passed between the parent and the agent while it ran, in either direction: the `SendMessage` calls of the parent to the agent, and the
   * messages of the agent to the parent. The final report is not one of them. `approximate`: the file of the parent is larger than the part that was read, so the
   * count may be short (a page shows "3+"). A workflow has none: 0, and not approximate. No message text leaves the server.
   */
  messages: { count: number; approximate: boolean };
  /** A workflow only: the newest phase, the agents that have a result, and the agents that started. A journal has no total. */
  progress?: { phase: string | null; done: number; started: number };
};

/** One session that is alive now. */
export type LiveSession = {
  /** The session id: the file name without `.jsonl`. */
  id: string;
  /** The title, by the same rule as `SessionInfo.title`. This is transcript text: show it as text. */
  title: string;
  /** `working`: the process is busy. `waiting`: it is idle, and waits for Mark. */
  state: 'working' | 'waiting';
  /** When the process started (an ISO time), or null when the process file does not say. */
  startedAt: string | null;
  /** The session file, for a Copy button. It is a path on this machine. */
  filePath: string;
  /** The agents and workflows of the session that are alive, or finished less than `agents.lingerSeconds` ago. In order of start. */
  nodes: LiveNode[];
};

/**
 * What `GET /api/agents` holds (inside a Panel): the live sessions in order of start, the oldest first. `hiddenScripts` is how many live sessions about
 * Shadow Jog were left out because a script started them (the entrypoint starts with "sdk"). `source` says where the list came from: `process-list`
 * (the folder where Claude Code lists its processes), or `file-age` (that folder cannot be read, so the file ages of the sessions module decide, and a page says so).
 */
export type AgentsLive = { sessions: LiveSession[]; hiddenScripts: number; source: 'process-list' | 'file-age' };

// ---- decisions (the decision inbox) ----
// The shapes of the decisions module (src/server/decisions). A decision is a GitHub issue of the
// repo with the label `decision`, and only an issue, a comment and a label by Mark's account count
// (the repo is public, so anyone can write there). Everything in them that comes from the issue
// (the title, the question, the options, the notes) is text that anyone could have typed in a
// place that Mark's account wrote: a page must show it as plain text, never as html. The one
// exception is a field called `html`: the doc index made it, and it is safe to put into the page.

/** One option that Mark can pick: the id he picks (`A`) and the text of what it is and what it changes. */
export type DecisionOption = { id: string; text: string };

/**
 * A link from a decision to a section of a doc. The issue writes it as `path#heading`.
 * `docId` is the path in the repo (the id that the doc index uses), `slug` is the doc's address on the
 * site, `anchor` is the id that the page gives the heading (the issue's words, put through the same
 * slugger as the docs, so `5.5 Decisions` and `55-decisions` both give `55-decisions`), and `heading` is the
 * words of that heading in the doc, or null when the doc has no such heading (then the page shows a notice).
 */
export type DecisionDocLink = { docId: string; slug: string; anchor: string; heading: string | null };

/**
 * What Mark answered, from the newest `Decision:` comment that his account wrote. `complete` says that the two
 * other parts of an answer are there too: the issue is closed, and the label `decided` is on it and Mark's
 * account put it there. An answer that is not complete is one that stopped half way (a retry finishes it).
 */
export type DecisionAnswer = { option: string; note: string | null; at: string; complete: boolean };

/**
 * One decision issue. `state` is `open` (it waits for Mark, also when an answer stopped half way), `answered`
 * (a closed issue, a trusted `Decision:` comment, and a `decided` label that Mark's account set) or `closed`
 * (closed, and not a complete answer: someone closed it, or the label came from another account).
 *
 * `problem` says why the page cannot show the issue as a decision (the body is not the template, or it is the
 * template with nothing filled in), or is null. The issue is still listed then, with an empty question and no
 * options when the body gave none, because an agent may write its own body.
 */
export type DecisionIssue = {
  number: number;
  title: string;
  /** The issue on GitHub (an http or https address), for the "open on GitHub" link. */
  url: string;
  state: 'open' | 'answered' | 'closed';
  question: string;
  context: string | null;
  options: DecisionOption[];
  /** The id of the recommended option, or null when the issue names none (or names one that is not listed). */
  recommended: string | null;
  docs: DecisionDocLink[];
  raisedBy: string | null;
  waitsOn: string | null;
  createdAt: string;
  answer: DecisionAnswer | null;
  problem: string | null;
};

/** One linked section of a decision page: the heading and the html of its section as the docs have it now, or nulls when the heading is not in the doc. */
export type DecisionSection = { docId: string; anchor: string; heading: string | null; html: string | null };

/** What `GET /api/decisions/<n>` holds (inside a Panel): the decision, and the linked sections as they are in the docs now. `sections` is in the order of `docs`. */
export type DecisionDetail = DecisionIssue & { sections: DecisionSection[] };

/** What `GET /api/decisions` holds (inside a Panel): the decisions that wait for Mark, and the ones he answered in the last week. */
export type DecisionsInfo = { open: DecisionIssue[]; recent: DecisionIssue[] };

/** One banner of a doc page: an open decision that links to the heading with the id `anchor` of that doc. */
export type DocDecision = { number: number; title: string; anchor: string };

/**
 * The longest note that an answer takes, in characters. A comment can be long, but a note is a few words, and the limit keeps one call small. The server refuses a longer
 * note, and the text box of the form stops at the same number, so the two are one number kept in one place.
 */
export const MAX_NOTE_CHARS = 2000;

/** The three writes of an answer, in the order the server makes them. */
export type AnswerStep = 'comment' | 'label' | 'close';

/** The body of a failed `POST /api/decisions/<n>/answer`. `step` names the write that failed, when the failure came from a write (the steps before it are done). */
export type AnswerErrorBody = ApiErrorBody & { step?: AnswerStep };

// ---- the Now page ----
// The shape of the one route that the Now page owns (`GET /api/now/your-move`, src/server/now). The other panels of the page read the
// shapes above (sessions, GitHub, status and git). The words in an item come from files, from GitHub and from session files, so a page
// must show them as text.

/** Where an item of "Your move" comes from. The page names the source in the notice for a source that could not be read. */
export type YourMoveSource = 'decision-issue' | 'session' | 'pr' | 'doc-decision' | 'status';

/**
 * One thing that waits for Mark. `text` is plain words. `href` is where its source is: an address of this site (it starts with `/`), an
 * address on GitHub (https), or null when the source has no page to link to. A session's items link to its place on the Agents page (`/agents#session-<id>`). `light` is the status light that the reply of a
 * session started with, and null for every other item: only a reply has one. `at` is the time of the item, as an ISO time, or null.
 */
export type YourMoveItem = {
  source: YourMoveSource;
  text: string;
  href: string | null;
  light: 'green' | 'yellow' | 'red' | null;
  at: string | null;
};

/**
 * What `GET /api/now/your-move` holds (inside a Panel): the list, and the sources that could not be read. A source that failed
 * is named in `missing` with its own message, so the list is known to be incomplete (the items it still has from that source are
 * the last ones that were read). The panel itself never fails because a source did.
 */
export type YourMoveInfo = { items: YourMoveItem[]; missing: { source: YourMoveSource; message: string }[] };
