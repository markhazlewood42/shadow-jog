---
type: design
title: "Shadow Jog Command Center — Design"
project: shadow-jog
created: 2026-10-05
updated: 2026-10-11
status: approved by Mark 2026-10-05 (decision inbox and look added the same day). Revision 2 (live feedback of 2026-10-07) approved by Mark 2026-10-07. Revision 3 (live, hosted view) approved by Mark 2026-10-11, in a Claude Code session on that date. Mark's merge of PR #63 is the record in the repo.
tags: [tooling, command-center, design]
---

# Shadow Jog Command Center — Design

A small website that runs on Mark's machine. It is the home base for all Shadow Jog work: the docs, the status, the agents, the work in progress, and the design decisions that wait on Mark, in one place.

**Status:** version 1 is built ([PR #21](https://github.com/markhazlewood42/shadow-jog/pull/21) and [PR #22](https://github.com/markhazlewood42/shadow-jog/pull/22) on `main`). Mark approved it on 2026-10-05 and added the decision inbox (section 5.5) and the look (section 4.2) the same day. Its plan is [plan.md](plan.md).

**Revision 2 is built on branch `command-center-feedback` ([PR #26](https://github.com/markhazlewood42/shadow-jog/pull/26)).** It answers Mark's live feedback of 2026-10-07. Mark approved this spec and its plan on 2026-10-07. It changes four things:
1. All page text becomes labels and links (section 5.8).
2. The Status panel becomes a summary with links (section 5.6).
3. Every doc page gets Copy and Download (section 5.7).
4. The Agents page becomes a live diagram of the active sessions (section 5.4).

Its plan is [plan-revision-2.md](plan-revision-2.md). A section marked "revision 2" replaces the version 1 text.

**Revision 3 is approved (2026-10-11) and built (steps 1 to 5 merged 2026-10-12).** Its source is the strategy draft 4 of 2026-10-11 (not in the repo, summarized in section 11). Mark approved it in a Claude Code session on 2026-10-11. Mark's merge of PR #63 is the record in the repo. It adds a hosted, live view of the project. It changes five things:
1. Each branch gets one workstream file in git, `docs/workstreams/<branch>.md`, where a branch with slashes becomes folders (section 5.9).
2. A hosted copy of the page runs on Vercel. Vercel Authentication with the scope "All Deployments" lets only Mark open it (section 4.3).
3. Vercel functions read GitHub live (section 6).
4. A local reporter writes sessions, agents and worktrees to one Upstash Redis key that expires (section 11).
5. The hosted page polls the functions while its tab is visible (section 4.3).

The build order is in section 11. A section marked "revision 3" adds to or replaces the earlier text.

---

## 1. Why

Mark works on the game and the engine across many sessions. The docs, the tools and the number of agents keep growing, and the markdown files are scattered. He needs one place that shows what is going on now, that lets him read every doc with clear navigation, and that collects the design decisions that wait on him.

**Success criteria for version 1:**
1. One page tells Mark what is going on now and what needs him. He does not need a terminal or GitHub for that.
2. Every doc is two clicks or fewer from `/docs`. Search finds any doc by its title or its text.
3. Mark can review the engine design in reading order, with large diagrams, an outline and backlinks on each page, and one list of all decisions with their status.
4. Nothing needs manual upkeep. The site reads the files live and shows a change within a few seconds.
5. Mark sees every major design decision that waits on him, next to the doc section it concerns, and answers it in the site. Every session can read his answer.
6. Its only write is Mark's answer to a decision. It never changes a file, a branch or a PR.
7. (Revision 2) The chrome of every page shows labels, numbers and links. A sentence appears only where a reader would be lost without it (section 5.8).
8. (Revision 2) The Agents page shows only what is alive now, as a tree of sessions and agents. It changes within 5 seconds when an agent starts or ends (section 5.4).

---

## 2. Decisions so far (Mark, 2026-10-05)

| Question | Answer |
|---|---|
| First jobs | What is going on now, and the docs. The first use is the engine design review. |
| Docs | A `/docs` section that starts with an overview page and has clear navigation. The files stay where they are. |
| Actions | Show only, and link out, with one exception: Mark answers waiting decisions in the site. More actions can come later. |
| Review aids | Reading order with big diagrams, a decision list with status, and an outline with backlinks on each page. |
| Build approach | Our own app: React and a small local server. |
| Dashboard look | PlasmaUI (liquid glass panels) for the Now page. The docs pages can use something else. |
| Look | Match Shadow Jog's other tooling, as the diagrams do: the `shadow-jog` diagram profile (section 4.2). |
| Decisions | Major cross-session design decisions are GitHub Issues in shadow-jog with a `decision` label (section 5.5). |
| Repo visibility | shadow-jog stays public. A private repo would need paid CI minutes (the repo used about 4,400 in the last 30 days) and a paid plan for the branch rule. |

### 2.1 Decisions of revision 2 (Mark, 2026-10-07)

| Question | Answer |
|---|---|
| Which items | All four: the text pass, the Status summary, Copy and Download, and the Agents diagram. |
| Text bar | Labels and links only. A sentence only where a reader would be lost without it. All text in ASD-STE100. |
| Work order | Page by page. Each page gets its feature and its text pass in one task. The data for the Agents page comes first. |
| Agents box | A session shows its title, a state word and its run time. An agent shows its task label, its model and its time. A workflow is one box with a progress chip. A Copy button replaces the file path text. |
| Agents lines | A solid line shows who started an agent. A dashed line with a count shows messages while the agent runs. A final report shows as the state "done". No message text. |
| Active | A session is active while its Claude process runs, working or waiting for Mark. The recent-sessions list leaves the page. |
| Running panel | Sessions only. Each row links to its session on the Agents page. |
| Diagram build | Our own SVG lines and smooth motion. The server checks every 3 seconds. No new dependency. |
| Status panel | Five rows with links, and a milestone strip with one square for each row of the milestone table. |
| Doc buttons | A split button as on the markedup-consulting site: "Copy for LLM", with "Download as markdown" in its menu. The copied text has a 2-line source header. |
| Unknown line (Mark, 2026-10-08) | The Agents page ignores an unknown line in a session file. There is no unknown box. |

### 2.2 Decisions of revision 3 (Mark, 2026-10-11)

| Question | Answer |
|---|---|
| Workstream state | One file per branch in git, `docs/workstreams/<branch>.md`. A database for authored state was rejected: it would drift from the markdown docs. |
| Hosted view | Yes, on Vercel (Hobby plan, account `markhazlewood42`). No Supabase. |
| Live sessions, agents, worktrees | A small store for heartbeats only: Upstash Redis, installed through the Vercel Marketplace. |
| `git fetch` by the local CC | Allowed, every 2 minutes, remote-tracking refs only. The reporter (step 5, section 11.1) needs it to see when `main` changes `tools/command-center/` and to rebuild its pinned copy. |
| Isolation from the game project (Mark, 2026-10-12) | One repo stays for now: a split costs more than it saves, because the workstream files, the design doc and the decision issues live in the game repo. Revisit the split after step 4 if friction shows. The two Vercel projects are isolated by Ignored Build Steps. The CC project builds only when `tools/command-center/` changes on `main`. The game project (`shadow-jog`, production branch `release`) skips a build when the last commit touches only `tools/`, `docs/` or `*.md`: `git diff --quiet HEAD^ HEAD -- . ':(exclude)tools' ':(exclude)docs' ':(exclude)*.md'` (exit 0 skips). Risk: the command checks the last commit only, so a push of several commits can skip a game preview that it should build. The risk is for previews only. It goes in the project's `commandForIgnoringBuildStep`, set through the Vercel API. |
| Where the local CC code runs | Moot for viewing: Mark uses the hosted URL. The local reporter runs from a pinned copy (section 11). |

**Rejected options**
- GitHub Pages: the page is public, and the cache lasts 10 minutes.
- Supabase: the project limits are full.
- A GitHub Action exporter: the functions read GitHub live instead.
- A database for authored state: it would drift from the markdown docs.

**One choice made for Mark:** the reporter runs from a pinned copy of `origin/main`. A branch switch in the shared checkout then cannot change its code. Mark can change this.

---

## 3. Scope

**Version 1:** the Now page, the docs site, the engine review aids, the decision inbox, and live updates.

**Not in version 1:** write actions other than answering decisions, a login, access from another device, other projects, and the game's design tools (they stay in the game's DEV tab, and the Now page links to them).

**Later (the design keeps room for these):** more actions (tick review items, leave notes for agents, start agents), the visual editors from `docs/IDEAS.md` entry 1, and other projects.

**Revision 2 does not change:** the decision inbox, the docs navigation, the engine review aids, the PlasmaUI panels, the look, and the one write route.

**Revision 3 (changed scope):** a hosted view on Vercel is now in scope (section 4.3). It shows Shadow Jog only.
- **Still out of scope:** write actions on the hosted page, including decision answers. Heartbeats from cloud sessions. Other projects.
- **A cloud session** shows only through what it pushes. Its pushes show through `/api/snapshot`.

---

## 4. Architecture

- **Where:** `tools/command-center/` in the shadow-jog repo, with its own `package.json`. The game's dependencies and bundle do not change. `npm run cc` at the repo root starts it.
- **Address:** `http://localhost:3009`. The server listens on `127.0.0.1` only. (Ports 3007 and 3008 are the game's. Ports 3002 to 3006 belong to other projects.)
- **Server:** Node and TypeScript. It has one module for each source: docs, status, git, GitHub, decisions, Claude sessions, and (revision 2) live agents. Each module builds its part of an index in memory and serves it through a JSON API (`/api/...`). A file watcher rebuilds only the part that changed and pushes an event to the open page (server-sent events).
- **Page app:** React, Vite, Tailwind v4 and Lucide icons. The Now page draws its panels with PlasmaUI (section 4.1). The docs pages use HeroUI v3, with a theme from the shared tokens (section 4.2). The routes are `/` (Now), `/docs/...`, `/decisions/<number>`, and `/agents`.
- **Markdown:** the server parses each doc once. One pass gives the HTML, the headings (for the outline), the links (for backlinks), the frontmatter, and the text for search.
- **Safety:** the server reads only from an allow-list: the shadow-jog repo, the `shadow-jog-phaser` checkout, the Shadow Jog session folders under `~/.claude/projects/`, and (revision 2) the process list folder `~/.claude/sessions` (files named `<pid>.json`, read only). No API route takes a raw file path. The doc source route (section 5.7) takes the slug of an indexed doc. The only write route is `POST /api/decisions/<number>/answer`. It posts Mark's answer through `gh` and changes the issue's labels. It makes no git operation and writes no file. It accepts only a same-origin request that carries a token the server makes at each start, so another web page in the browser cannot call it.
- **Room for actions:** a later write action is a new route in one module. The read side does not change.

### 4.1 PlasmaUI on the Now page

- **What it is:** [PlasmaUI](https://github.com/CruxGarden/plasma-ui) (`@cruxgarden/plasma-ui`) draws "liquid glass" panels for React in WebGL: refraction, frost, rim light and glow. Version 0.7.0, MIT license, started in September 2026 and active. It is before version 1.0, so its API can change.
- **What it is not:** a widget kit. It has no cards, tables, progress bars or charts. It is the panel that holds them. The content inside each panel uses our own small components (Tailwind and Lucide, HeroUI where it fits).
- **Where:** only the Now page loads it, because its canvas covers the whole window. The docs pages do not load it.
- **Look:** a custom mood from the shared tokens (section 4.2), with the glow turned down to match the profile's "no glow". Its built-in "ember" mood is the fallback.
- **Layout:** the panels can be dragged and snap to a 24 px grid. The site keeps Mark's arrangement in the browser (localStorage). This changes no project file.
- **Guards:** we pin the exact version and wrap it in one local component (`GlassPanel`), so an API change touches one file. It uses the GPU, so a "plain panels" switch turns the glass off, for example while the game runs. The site also uses plain panels when the browser has no WebGL2.

### 4.2 Look

- **Rule (Mark, 2026-10-05):** the command center matches Shadow Jog's other tooling, as the diagrams do. Keep things feeling similar.
- **Source:** the `shadow-jog` diagram profile (`docs/diagrams/profile/shadow-jog.md`, with the color mapping and contrast ratios in `docs/diagrams/profile/NOTES.md`).
- **In short:** a dark skin from the game's own UI colors: navy panels, a lavender frame, white text, amber for the one or two focal items on a screen, cyan for links, and no glow. The fonts are Geist and Geist Mono, as in the diagrams.
- **One token set:** CSS variables copied from the profile feed both the HeroUI theme on the docs pages and the PlasmaUI mood on the Now page. A change to the profile then needs a change to one token file.
- **Contrast:** the ratios in `NOTES.md` are the floor for all text.

### 4.3 Hosted mode (revision 3)

A Vercel project hosts the page and a few functions. The functions read GitHub live. A local reporter writes what only this machine knows to Upstash Redis. All code paths are under `tools/command-center/`.

```
sessions --push--> GitHub <--GraphQL, 15 s cache-- Vercel functions <--poll-- page (Vercel Authentication: Mark only)
sessions --files--> local reporter --write, keys expire--> Upstash Redis <--read-- Vercel functions
```

| Change | Shows on the page after |
|---|---|
| Session starts, goes busy or idle, starts an agent | about 5 to 15 s (reporter 5 s, page poll 10 s) |
| An edit to a workstream file in a checkout on this machine, committed or not | about 5 to 15 s |
| A push, PR, CI result or decision, from any session or the cloud | about 15 to 30 s if the cache holds (cache 15 s, page poll 15 s) |

- **Poll, not push.** On Hobby a function runs at most 300 s, and SSE from a Vercel function is not confirmed in the docs. A poll of a small JSON every 5 to 15 s, only while the tab is visible, is simple and inside the limits (section 11).
- **Data layer switch.** On Vercel the page polls `/api/snapshot` (15 s) and `/api/live` (10 s), only while the tab is visible. Locally it keeps `/api/*` and SSE. The look does not change.
- **Login.** Vercel Authentication with the scope "All Deployments" (free on Hobby). Source: Vercel docs, checked 2026-10-11: "Protecting all deployments is available on all plans" (https://vercel.com/docs/deployment-protection). Password Protection is not available on Hobby, so Vercel Authentication is the method. The default scope, "Standard Protection", does not protect the production URL. Same-origin `fetch('/api/...')` carries the login cookie. Hobby has no teams. Only the login of the owning Vercel account gets through to the page or its functions.
- **Deploys.** A separate Vercel project from the game, with root `tools/command-center`. An Ignored Build Step deploys only when `tools/command-center/` changes on `main`.
- **Architecture fit.** The local server reads through the `git` and `gh` CLIs. Vercel has no checkout, so the functions are a new GitHub API adapter (section 6). It returns the same types (`src/shared/types.ts`), so the page and the parsers do not change.

---

## 5. Pages

### 5.1 Now (`/`)

The page reads from top to bottom, in order of importance:

1. **Your move.** Every open action for Mark in one list. The open decision issues come first (section 5.5). Then the last "Your move" box of each active session, the "Next up for Mark" list in `status.md`, and the PRs that wait for his review or merge. Each item links to its source. In hosted mode the source of "Your move" is the `next_for_mark` of the workstream files (section 5.9). `status.md` stays the local-mode source.
2. **Running.** (Revision 2.) One row for each active session, in order of start: its title, a state word, how long it has run, and a link to its session on the Agents page (`/agents#session-<id>`). Agents and workflows show only in the diagram. A label tells how many automated runs are hidden.
3. **Pull requests.** The open PRs, with review state and checks, and one link to the merged PRs (as built in PR #22).
4. **Status.** (Revision 2.) A summary of five rows with links, and a milestone strip (section 5.6).
5. **Links.** One link for each tool: the game and its DEV tools, and the GitHub repo. A link is a label and an icon. The address is not written out.

### 5.2 Docs (`/docs`)

- **Overview page:** what the docs cover, and one card for each section with its key pages and the date each one last changed.
- **Sections** (the navigation): Start here (status, overview), Game design (GDD, setting, glossary, concepts, ideas), Engine design (in the engine README's reading order), Decisions, Architecture and development (architecture, developing, tooling UI), Spikes and research, Quality, Project records (changelog, phase plans), and Command center. A small map file sets the sections. A doc that the map does not list shows under "Other", so no doc gets lost.
- **Layout:** the section tree on the left, the doc in the middle, and on the right the outline (headings) and the backlinks ("linked from").
- **Diagrams** show large. A click opens a zoom view. The link to the editable source stays.
- **Search** is on every page. It looks at titles, headings and text.
- **Header:** each doc shows its frontmatter as a small header: type, status, and last update (from git if the frontmatter has none).
- **Links:** links between docs open inside the site. Links to code open on GitHub.
- **Decision banners:** a doc section that an open decision links to shows a banner with the question and a link to the decision.
- **Copy and Download (revision 2):** each doc page has a split button under its header (section 5.7).

### 5.3 Engine design review

- **Reading order:** the engine docs in the order that `docs/engine/README.md` gives, with Previous and Next buttons.
- **Decision list** (`/docs/decisions`): every decision in one table: the E decisions from `docs/engine/decisions.md` and the decisions in `docs/PHASE-0.2.md`. The columns are number, question, answer, milestone, who decides, and status.
- **Status:** approved, open for Mark, or changed since approved. "Changed since approved" compares the decision's text now with its text at the approval commit. The approval commit is a git ref in the site's config file.

### 5.4 Agents (`/agents`)

**Revision 2.** The page shows what is alive now, as a diagram of sessions and agents. It replaces the list of recent sessions. The sessions module keeps that list for the Your move panel. No page shows it.

**What is active** (Mark, 2026-10-07)
- A session is active while its Claude process runs. The process list is the folder `~/.claude/sessions`. It holds one `<pid>.json` file for each running process.
- The server reads four keys of a file: `sessionId`, `pid`, `startedAt` and `status` (`busy` or `idle`). It checks that the pid is alive. No other key leaves the server.
- Only sessions about Shadow Jog count. The rule of version 1 applies: the session folder or the working directory is inside an allow-listed root. Automated runs (SDK) stay hidden, and a label gives their count.
- The state word follows `status`. `busy` is "working". `idle` is "waiting".
- An agent runs until it has an end record. If it has none and its file did not change for 5 minutes, it still counts as running while its session is `busy`, because a long tool call writes nothing. After 30 minutes without a change (`agents.staleSeconds`), it counts as stopped even then, because an agent that Mark stops writes no end record. While the session is `idle`, it counts as stopped and leaves the diagram.
- A finished agent stays for 5 minutes, dimmed, and then leaves. A closed session leaves at once.
- If the process list cannot be read, the page uses the file ages of version 1 and shows the label "Process list unavailable". In this fallback, the version 1 state decides: "working" counts as `busy` and "waiting" counts as `idle`.
- With no active session, the page shows one label: "No active session".
- A link from Your move to a session that is not in the diagram (for example a session that closed a moment ago) still opens the page. The page shows the label "Session not active" (ruling R42).

**Boxes**
- A session box has its title (as in version 1: the custom title, else the agent name, else the start of the first prompt), a state word and its run time. A Copy button copies the path of its session file.
- An agent box has its task label (the `description` in its `.meta.json`), its model as a family name (for example "fable"), and its run time, or "done". A Copy button copies the path of its file.
- A workflow is one box with its name and a progress chip: the phase, and the agents done of the agents started. Its agents have no boxes.
- A box is small: one title line and one detail line. A long label is cut, and the full text sits in its tooltip.
- A parent shows at most 12 children and then a label "+N more". N counts the children of that parent that are hidden. The agents under a hidden child do not add to it: 13 children, where the last one has 5 agents, say "+1 more".

**Lines**
- A solid line with an arrow runs from a parent to each agent or workflow that it started. An agent can start agents, so the tree can have more than two levels.
- A dashed line with a count shows the messages that passed between the parent and the agent while it runs, in either direction. A final report is not a message line: the box shows "done".
- No message text appears on the page.
- A message from one agent to another agent is not in the files. The page cannot show it.

**Layout and motion**
- Each session is one cluster: the session box on top and its children below it on a trunk line. Clusters sit side by side and wrap when the window is narrow. Sessions keep their order of start, so boxes do not jump when the activity changes.
- A pure function turns the data of one cluster into box positions, and a second one turns it into line paths. Boxes have fixed sizes. Both functions have unit tests.
- Boxes are HTML. The lines are one SVG layer behind them. The text of a box can be selected.
- A box slides to its new place, fades in when an agent starts, and fades out when it leaves. A dashed line flashes for one second when its count grows. The setting `prefers-reduced-motion` turns the motion off.
- A hidden list under the diagram names every session and agent in text. Screen readers and tests read it.

**Data** (module `agents`)
- `GET /api/agents` returns `Panel<AgentsLive>`. Its shape:
  - `AgentsLive`: `sessions: LiveSession[]`, `hiddenScripts: number` and `source` (`process-list` or `file-age`).
  - `LiveSession`: `id`, `title`, `state` (`working` or `waiting`), `startedAt`, `filePath` and `nodes: LiveNode[]`.
  - `LiveNode`: `id`, `parentId` (a session, an agent or a workflow), `kind` (`agent` or `workflow`), `label`, `model`, `state` (`running` or `done`), `startedAt`, `endedAt`, `filePath` and `messages: { count, approximate }`. A workflow also has `progress: { phase, done, started }`.
- The module starts from the process list. It does not scan all files. It reads only the files of live sessions and their agents.
- It checks every 3 seconds (config `agents.pollMs`). It sends a live event for the module `agents` only when the data changes.
- The link from a parent to an agent comes from `toolUseId` in the agent's `.meta.json`. It is matched to the `Agent` call in the parent's file. If no call matches, the agent attaches to its session. No agent is dropped for this reason.
- A message count comes from bounded reads of the two files. If a bound cuts the read, `approximate` is true and the page shows "3+".
- The sessions module and its API do not change.
- The Running panel on the Now page reads this API.

**Limits**
- The process list is an internal file of Claude Code. Its format can change. The module falls back to the file ages and says so.
- A session that Mark starts outside the allow-listed folders, with a working directory outside the repo, is not drawn.
- The agents of a workflow have no boxes. The workflow box shows only their count.

### 5.5 Decision inbox (the one two-way feature)

- **What counts:** a major design decision that blocks work, changes an approved design, or touches more than one session or branch. A small question inside one session stays in that session.
- **Where it lives:** a GitHub Issue in shadow-jog with the label `decision`. An issue template (`.github/ISSUE_TEMPLATE/decision.md`) gives the shape: the question, the context in two or three lines, the options with what each one changes, the recommendation, the doc sections it concerns (as `path#heading` links), who raised it (session, branch or PR), and what waits on it.
- **Where it shows:** at the top of "Your move" on the Now page; as a banner on each doc section it links to; and on its own page (`/decisions/<number>`), which shows the linked doc sections inline under the question.
- **How Mark answers:** he picks an option and can add a note. The server posts a comment ("Decision: <option>. <note>") through `gh`, swaps the label `decision` for `decided`, and closes the issue.
- **How agents use it:** a rule in `CLAUDE.md` says how to raise a decision issue, and to read the answer with `gh` before acting on it. Agents trust only comments and labels from Mark's account (`markhazlewood42`), because the repo is public and anyone can comment. The agent that needs the answer records it in the docs through its PR, and links that PR in the issue.
- **Errors:** if `gh` fails, the form keeps Mark's choice, shows the error, and offers a retry.
- **(Revision 3) Hosted page:** a decision links to its issue on GitHub. Mark cannot answer from the hosted page.

### 5.6 Status panel (revision 2)

The panel is a summary. Each row is a label, a value and a link. It does not copy or summarize the text of `status.md`. In hosted mode the "Next up" count comes from the `next_for_mark` of the workstream files (section 5.9). `status.md` stays the local-mode source.

| Row | Value | Link |
|---|---|---|
| Branch | the branch name, and how many commits it is ahead or behind | the branch on GitHub |
| CI on main | passing, failing or running, and its age | the newest run of the `ci.yml` workflow on GitHub |
| Next up | the number of items for Mark | the status doc page |
| status.md | the date of its last update | the status doc page |
| Last commit | its age | the commit on GitHub |

Under the rows, a strip shows the milestones of `docs/engine/migration.md` as small squares, one for each row of its milestone table (today Phase 0, Pre-M0 and M0 to M8).
- A square before the current milestone is filled. The current one has the accent color. Later squares are outlined.
- Each square links to its heading in the doc.
- The current milestone is a new key in the frontmatter of `status.md`: `milestone: M3`. The value is the id of a table row (today `Pre-M0`), or `none` when no milestone has started. Agents update the key at a phase break.
- A value that names no milestone shows an error label on the strip. The page never guesses.

Data:
- `/api/status` gives the update date, the count of Next up items, the milestone key and the milestone list.
- `/api/git` gives the branch, its standing and the last commit.
- `/api/health` gives the repository address for the links.
- CI on main is new. The GitHub module reads `gh run list --workflow ci.yml --branch main --limit 1` with the PRs, every 60 seconds. This adds one exact command to the allow-list of the `gh` runner.
- A row whose source failed shows an error label and a Retry button. The other rows stay.

**Known gap (revision 3).** All sessions edit one `status.md`. The panel reads the "Next up for Mark" list under the first "Right now" heading. When a newer state sits under another heading, the panel shows the older list with no error (seen on 2026-10-11). In hosted mode the workstream files (section 5.9) replace `status.md` as the source of per-branch state and of `next_for_mark`. `status.md` stays the local-mode source. `status.md` keeps the overview and the roster. Other gaps of the local CC: it reads only the checked-out branch, the page does not show worktrees or the session `gitBranch`, no module reads `docs/roadmap/roadmap.json`, and it is local only.

### 5.7 Copy and Download (revision 2)

- **Where:** under the frontmatter header of each doc page. Not on the overview page, the Gone page or `/docs/decisions`. The decision table draws three docs in one table, so it has no single file.
- **Look:** a split button, as on the markedup-consulting site. The main button reads "Copy for LLM" (Lucide `Copy` icon). A small arrow opens a menu with two entries: "Copy for LLM" and "Download as markdown" (`Download` icon). After a copy, the button reads "Copied" (`Check`) or "Copy failed" (`AlertCircle`) for 2 seconds. The menu works with the keyboard and has ARIA roles. The builder checks the HeroUI v3 docs for the menu API.
- **Copied text:** a 2-line source header, a blank line, and then the file text as it is. Line 1 is the doc title. Line 2 is the repo path and its GitHub address. The frontmatter stays in the file text.
- **Downloaded file:** the file text as it is, named like the file (`decisions.md` for `docs/engine/decisions.md`). The page builds it as a Blob link.
- **Data:** a new read-only route, `GET /api/docs/<slug>/source`. It returns the file text as `text/markdown; charset=utf-8` with `X-Content-Type-Options: nosniff`. It takes the slug of an indexed doc, never a path. An unknown slug gives 404. The page fetches the text when the button is pressed, so the page payload does not grow.
- **Errors:** a failed fetch or a failed clipboard write shows "Copy failed". A failed download shows "Download failed".

### 5.8 Page text (revision 2)

Mark's rule (2026-10-07): every page shows labels and links only. All text is ASD-STE100.

- **Allowed:** headings, labels, state words, numbers, dates, names that come from data, and links.
- **A sentence** is allowed only where a reader would be lost without it. It has one line and 20 words or fewer.
- **An empty state** is a label: "Nothing for you", "No open PRs", "No active session".
- **A notice** (the Gone page, a decision notice, a banner) is one line and a link to the doc that explains it. The doc explains. The page does not.
- **No page copies or summarizes a doc.** It links to it.
- **Hidden text** (ARIA labels and tooltips) follows the same rules.
- **Data does not change:** doc text, issue text, commit subjects and session titles.

| Before | After |
|---|---|
| Nothing waits for you right now. | Nothing for you |
| No open pull requests. | No open PRs |
| This doc was moved or deleted, and three more sentences | Doc not found, then the docs with the same file name, then a link to the docs |
| Recent Claude sessions about Shadow Jog, the newest first, with their agents and workflows. The Running panel of the Now page shows only what is live: this is the full list. | No text. The heading "Agents" is enough. |
| This posts a comment on the GitHub issue, swaps its label from "decision" to "decided", and closes it. | Posts your answer to GitHub and closes the issue. |
| A decision waits for Mark on this section | Open decision |

How it is checked: each task report lists the strings that the task changed, with their word counts before and after. The reader verifier checks each new string against these rules.

### 5.9 Workstreams (revision 3)

A workstream is one branch, plus everything that joins to it by branch name: its PR and checks, its roadmap item (`roadmap.json` `branch`), its live sessions, its worktree, and its state file.

```yaml
---
type: workstream
title: M6 flip default
branch: engine-m6-flip
roadmap: M6            # id in roadmap.json
state: review          # active | review | blocked | parked | merged
next_for_mark:
  - Rename the required checks in the main ruleset to e2e (1/4) to e2e (4/4)
blocked_on: [61]       # decision issue numbers
updated: 2026-10-11
---
```

The file path is the branch name: `docs/workstreams/<branch>.md`. A branch with slashes becomes folders, so `spike/foo` gives `docs/workstreams/spike/foo.md`. Branch names stay lowercase kebab-case. Two files cannot collide, because git refuses two branches whose names map to the same path (a branch `spike` and a branch `spike/foo` cannot exist together). One branch has exactly one file.

Branch name rule: the step 1 validator enforces lowercase kebab-case parts separated by `/` (regex `^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$`). This also blocks case-only collisions on Windows, dots, and names that end in `.md`. The rule governs the branches that Mark and sessions create. The check applies only to a branch that carries or needs a workstream file. A branch with no workstream file that does not match the rule (a bot branch such as `dependabot/npm_and_yarn/...`, or `release-1.0`) is skipped and shows a neutral "no workstream" row, never a red invalid row. A branch that has a workstream file and fails the rule gets a red row with the reason, and no file lookup.

Old files: the file of a merged branch stays on `main`. The page hides it 14 days after `mergedAt`. The step 1 validator lists files whose PR merged more than 14 days ago, and any PR can delete the listed files. A new branch that reuses a name replaces the old file in its first commit.

Rules for sessions (they go into `CLAUDE.md` with the build):
- A session writes only the workstream file of its own branch, and commits and pushes it with its work. One file per branch, so two sessions never edit the same file.
- `status.md` keeps the overview and the roster. Only a PR to `main` changes it.
- Lookup order: the file on its branch first. If the branch is gone (merged and deleted), the file at the merge commit of its PR. The page shows merged workstreams for 14 days. (Revision 3) The merged list comes from merged PRs in the same GraphQL query (`headRefName`, `mergedAt`). The 14 days count from `mergedAt`. The function reads the file from the PR's own commit, not from `main:` by branch name: the head commit sha for an open or closed PR, the merge commit for a merged PR. A reused branch name then cannot show an old file. PR state wins: if the PR is merged, the card shows merged, whatever the `state` field of the file says. The page derives "merged" from the PR, not from the file. A branch deleted without a merge has no row, and its closed PR shows on GitHub only.
- A file that fails validation shows as a red row with its path and the error (section 7).

The page:
- A new Workstreams view: one card per workstream, grouped by roadmap lane. A card shows the branch, the PR and checks, live sessions, the worktree and `next_for_mark`.
- "Your move" (section 5.1) also collects `next_for_mark` from every workstream.
- The data comes from `/api/snapshot` on Vercel (section 6). The local CC does not get this view (step 6 was dropped on 2026-10-12).

---

## 6. Data sources

| Source | What the site reads | How |
|---|---|---|
| Docs | `docs/**/*.md`, `status.md`, `CHANGELOG.md`, the root `*.md` files, and the diagram PNGs | File reads and a file watcher |
| git | Branches, recent commits, the date each file last changed | `git` commands |
| GitHub | Open PRs, review state, checks, recent merges, and (revision 2) the newest CI run on `main` | The `gh` CLI (already signed in). Every 60 seconds, and on demand |
| Decisions | Issues with the `decision` or `decided` label, and their comments | The `gh` CLI. Every 60 seconds, on demand, and right after an answer |
| Claude sessions | The session files for Shadow Jog (found by their working folder), and their agent and workflow records | Only files changed in the last 7 days, and only the end of each file |
| Process list (revision 2) | `~/.claude/sessions/<pid>.json`: the session id, the pid, the start time, and `busy` or `idle`. No other key leaves the server | Every 3 seconds, with a pid check |
| GitHub API (revision 3, hosted only) | The same data as the `git` and `gh` rows, for every branch, plus the workstream files | Vercel functions, GitHub GraphQL, read-only token |
| Live key (revision 3, hosted only) | `live` in Upstash Redis: sessions, agents and worktrees from this machine | `/api/live`, read-only token |

The session files take more than 300 MB on disk. The site reads only the end of each recent file, so the size does not slow it down. Their format can change with a Claude Code update, so the session module must not fail on an unknown line. It shows "unknown" instead.

The process list is an internal file of Claude Code, and its format is not promised. The `agents` module must not fail when the format changes. It falls back to the file ages and says so (section 5.4).

**Vercel functions (revision 3).** All paths are under `tools/command-center/`.
- **`/api/snapshot`**: two GitHub GraphQL calls. The first lists every branch (`refs(refPrefix: "refs/heads/")`) with its head commit, the open and recent PRs with checks (`statusCheckRollup`) and review state, and the CI result on `main`. The second reads, with one aliased `object(expression: $e0)` per branch, every workstream file. Each expression (`<sha>:docs/workstreams/<branch>.md`, with the head commit sha, or the merge commit sha for a merged PR) is a GraphQL variable (see the query rules below). The merged list comes from merged PRs in the same query (`headRefName`, `mergedAt`). It also reads `status.md`, `roadmap.json`, `docs/engine/migration.md` and the decision issues from `main`. Each call costs about 1 to 5 of the 5,000 points an hour. Step 2 tests the exact query shape against the real repo.
  - `refs` is paged (100 a page). The function follows the cursors.
  - Aliases are generated (`b0`, `b1`, ...). They are never built from branch names.
  - Each `object(expression:)` takes its expression from a GraphQL variable. It never takes text put into the query.
  - A branch name that fails the name rule (section 5.9) is not looked up. If the branch carries or needs a workstream file, it shows as a red row. Any other branch (a bot branch) shows a neutral "no workstream" row.
- **Cache**: function instances do not share memory, so the cache is the Vercel CDN (`Cache-Control: s-maxage=15, stale-while-revalidate`) or the Vercel Runtime Cache. The CDN bound (`s-maxage` on a protected deployment) is unproven until setup step 3 proves it. Step 3 proves which one works behind Vercel Authentication. Vercel docs do not state whether the CDN caches responses on a protected deployment. If step 3 shows that the CDN does not cache behind the login, the function caches the snapshot itself for 15 s (Vercel Runtime Cache, or one Upstash key), so GraphQL use stays bounded however many tabs poll.
- **`/api/docs/<path>`**: one doc from `main`, fetched on demand and cached. The page keeps its current doc views.
- **`/api/live`**: reads the `live` key from Upstash with a read-only token.
- **Token**: a fine-grained GitHub token, read-only, for `markhazlewood42/shadow-jog` only, in a Vercel environment variable. Vercel must hold only the read-only Upstash token. The Marketplace install also adds the read-write REST token (for example `KV_REST_API_TOKEN`) to the Vercel project. After the install, delete that variable from the project, so only the read-only token stays. The write token lives only in the reporter's own environment (`~/.shadow-jog-cc/upstash.env`, section 11.1). Setup step 3 checks that no read-write token variable exists in the Vercel project.
- **Trust**: the same rule as now. Only issues, comments and labels by `markhazlewood42` count. The GitHub API adapter applies the same filters as the `gh` commands in `CLAUDE.md`: it reads each comment's author and each `LabeledEvent` actor for `decided`, and counts only `markhazlewood42`. Step 2 adds a test where a comment and a label by another account must not count as an answer. The decision parser and the workstream validator are shared code, used locally and on Vercel.
- **Adapter**: it returns the same types as the local modules (section 4.3). No GitHub Action is needed.

---

## 7. Errors and empty states

- Every panel loads on its own and shows its own error state. It never fails silently. Examples: "GitHub: gh is not signed in", "Sessions: unknown file format".
- One broken source never blanks the page.
- Every panel shows when it last updated.
- (Revision 2) The Agents page: an unreadable process list gives the label "Process list unavailable" and the file-age fallback. The page ignores an unknown line in a session file and never throws.
- (Revision 2) A Status row whose source failed shows an error label and Retry. The other rows stay.
- (Revision 2) Copy and Download show "Copy failed" or "Download failed" on the button. They never fail silently.
- (Revision 3) An invalid workstream file shows as a red row with its path and the error. Nothing fails in silence.
- (Revision 3) "Reporter offline": the page marks local rows with this label when `writtenAt` of the `live` key is older than 150 s ("reporter offline since <writtenAt time>"), or "reporter not running" when the key is gone. Pushed work still shows.
- (Revision 3) A 401, a redirect, or a response that is not JSON on any poll shows a banner "Login expired: reload the page". The panels mark their data as stale with its time. Nothing fails in silence.
- (Revision 3) After each deploy, a check without the login cookie (`curl` of the page and of `/api/live`) must return 401 or a redirect to the Vercel login. A 200 with the page or the `/api/live` JSON means the page is public.

---

## 8. Testing and verification

> **Superseded on 2026-10-08 (Mark):** new work follows the lean loop, the rule "Verification loop for every build in this repo" in `CLAUDE.md`. The text below records how this work was verified.

- **Unit tests** (Vitest) for every parser: frontmatter, outline, backlinks, the decision table, the end of a session file, a workflow record, the "Your move" box, and a decision issue (parse it, and ignore an answer from another account). Sample files go in a fixtures folder.
- **End-to-end tests** (Playwright) on the fixtures: the Now page (with the glass on and off), the docs navigation, search, outline, backlinks, the decision list, a decision banner, the answer flow with a stub for `gh` (a success, and a failure that keeps the choice), and one error state.
- **Verification:** a builder agent and 2 independent verifier agents for each feature, with screenshots for Mark at each visual step.
- **Revision 2 unit tests:** the process list reader and the pid check (the pid check is injected), the active set and its fallback, the parent link and the message counts on synthetic fixtures, the box and line layout functions, the milestone key, the CI run parser, the doc source route, and the copy text builder. Fixtures are synthetic. They never hold real session text.
- **Revision 2 end-to-end tests:** the Agents page with fixture sessions (live, closed, a dimmed finished agent, a workflow chip, the empty state, the fallback label), a new agent that appears within 5 seconds through the live event, Copy and Download on a doc page (the test grants the clipboard permission), the Status rows and the strip, and the Running rows that link to `/agents#session-<id>`. Tests that pin old page text change with the text pass.
- **Revision 2 verification:** each task has a builder and 2 fresh verifiers (a runner and a reader), all on the smallest model that fits the task (Sonnet for builders and verifiers). A task passes when every criterion scores 7 or more and the average is 8 or more. A task has up to 3 fix rounds, for Critical and Important findings only. Mark gets screenshots as soon as a builder makes them.
- **Revision 3 verification:** the lean loop in the repo `CLAUDE.md` governs. Steps 3 and 5 of section 11 also get an attacker, because they add a trust boundary and a write path.

---

## 9. Defaults (Mark can change any of them)

1. **Name:** "Shadow Jog Command Center".
2. **Start:** `npm run cc` starts the server and opens a browser tab.
3. **(Revision 2) Live check:** the `agents` module checks every 3 seconds (`agents.pollMs`).
4. **(Revision 2) Finished agents** stay for 5 minutes, dimmed (`agents.lingerSeconds`).
5. **(Revision 2) The process list folder** is `~/.claude/sessions` (`claude.sessionsRoot`).
6. **(Revision 2) A box shows at most 12 children,** and then "+N more".
7. **(Revision 2) A silent agent** counts as stopped after 30 minutes, even in a busy session (`agents.staleSeconds`).

---

## 10. Approaches considered for the Agents data (revision 2)

| Approach | For | Against |
|---|---|---|
| A. Extend the sessions module with links and an active flag | One module. One parser. | The Agents page, the Running panel and Your move share one 10-second check over 7 days of files. A 3-second check would load them all. The session type grows for two views. |
| **B. A new `agents` module** (chosen) | It starts from the process list, so it reads only live files. It has its own 3-second check. The sessions module stays as it is. | Two modules read session files. They share the parsing helpers so the code does not fork. |
| C. Derive the links in the browser from raw files | None | Session files must not leave the server. They hold private text. |

Choice: B. It keeps the live view cheap and leaves Your move untouched.

---

## 11. Revision 3: live, hosted view (approved 2026-10-11)

Mark approved the strategy "Command Center: a live, hosted strategy" (draft 4) on 2026-10-11. This section holds the parts that do not fit in the sections above. The decisions are in section 2.2. The workstream file is in section 5.9. The hosted mode and the latency table are in section 4.3. The functions are in section 6. All code paths are under `tools/command-center/`.

Steps 1 to 4 are built and merged. Step 5 is built and merged (see the status note after section 11.3). Goal (Mark): one hosted URL that Mark always uses. It shows a change soon after Mark or any Claude Code session updates the project. It knows every active branch, worktree and session, and shows how each fits the current workstreams.

### 11.1 Local reporter (this machine)

- **It is the local CC server, run headless** (`CC_NO_OPEN=1`) with a new `publish` module. The server already parses session files, the process list (busy or idle), agents and workflows every 3 s. The reporter adds worktrees (`git worktree list`), their dirty file counts, and the workstream files of checked-out branches as they are on disk.
- **One key, written on change, plus a beat.** The whole live state is one JSON key, `live`, with a 600 s expiry and a `writtenAt` time. The expiry is longer than the offline threshold of 150 s (section 7), so the page can show "reporter offline since" before the key is gone. The reporter writes it when the state changes, at most once each 5 s, and at least once each 60 s as the beat. No cleanup job is needed. The reporter exits after 30 minutes with no live shadow-jog session.
- **Private text.** Uncommitted workstream text is not public, unlike the repo. Only Vercel Authentication and the read-only token protect it.
- **It keeps running on its own.** A `SessionStart` hook starts the reporter if it is not running (a lock file plus a port check). The hook detaches at once with a 1 s budget, so it never slows a session. The hook goes in user-level settings, because sessions often start in `home-base`. It acts only when the session's cwd is inside a shadow-jog checkout or worktree.
- **It runs from a pinned copy of `origin/main`** in a git-ignored folder, rebuilt when `main` changes `tools/command-center/`. To see this, the reporter runs `git fetch` for `origin/main` every 2 minutes (the same allowance as in section 2.2, remote-tracking refs only). A branch switch in the shared checkout then cannot change its code. The fetch runs in the reporter's own pinned clone, never in the shared checkout, so the reporter cannot move `origin/main` under a session.
- **No message text, ever.** Titles, names and counts only, as the local CC does now. The reporter sends only an allow-list of fields: session title, branch, cwd folder name, busy or idle, agent names and counts, worktree folder name (not the full path), branch and dirty count, and the frontmatter fields of the workstream schema. Never message text, never file bodies other than workstream frontmatter.
- **Continuous protection check.** Every 10 minutes the reporter makes one request to `/api/live` without the login cookie. Protected: a 401, or a redirect to the Vercel login (an https address on `vercel.com` or a subdomain, with a login or SSO path or a `next`/`redirect` parameter). Public: a 200 with the JSON body of `/api/live`. If the page is public, the reporter stops publishing, deletes the `live` key, and logs the reason. A network error, a timeout or a 5xx changes nothing. The reporter logs it and checks again at the next 10-minute check.
- **Write token**: the Upstash read-write token, in `~/.shadow-jog-cc/upstash.env`, outside every repo. The reporter writes to Upstash directly, so it does not pass through Vercel Authentication.
- Cloud sessions send no heartbeat. Their pushes still show through `/api/snapshot`.

### 11.2 Limits on Hobby (checked 2026-10-11, vercel.com/docs)

| Item | Hobby limit | This plan, rough use |
|---|---|---|
| Function invocations | 1,000,000 a month | Page open 8 hours a day, one tab: `/api/live` every 10 s is 2,880 calls a day, `/api/snapshot` every 15 s is 1,920 calls a day. Total 4,800 a day, about 144,000 a month (one tab) |
| Function duration | 300 s max | Each call is short |
| Active CPU | 4 hours a month | Small JSON work, cached |
| GitHub GraphQL | 5,000 points an hour | Each snapshot is two GraphQL calls. The cache allows at most one snapshot each 15 s for all tabs together, so at most 480 calls an hour. That is a goal, not a guarantee, until step 3 proves the cache. Without any cache, each poll costs 2 GraphQL calls: one tab at 15 s is 480 calls an hour, and two tabs are 960. At 1 to 5 points each, 480 calls are about 2,400 points at the high end, under the 5,000 limit |
| Upstash free tier (upstash.com/pricing) | 500,000 commands a month, 250 MB | 8 active hours a day: beats 480, change writes up to 5,760 (cap), page reads 2,880 a day. Worst case about 275,000 a month |

The estimate assumes 8 active hours. A tab that stays visible all day triples the reads. Beats run only while a shadow-jog session is live, plus 30 minutes, because the reporter exits then. Each extra open tab or device adds about 2,880 Upstash reads and 4,800 function calls a day. If the self-cache fallback is used (section 6, Cache bullet), it adds one read for each snapshot poll and one write each 15 s. Step 5 measures real use and raises the poll interval if use passes half the cap.

Reads are one `GET` of one key, so they do not grow with the number of sessions. What Upstash does at the cap is not stated. The Marketplace free plan is to confirm at install.

### 11.3 Order of work

Each step is one branch from `main`, one PR, and the lean loop (runner and reader). Steps 3 and 5 also get an attacker: a new trust boundary and a write path.

1. **Workstream contract.** Schema: `docs/workstreams/README.md` (repo root), a shared validator, the first files for the open branches, the session rules in `CLAUDE.md`. Files: repo root: `docs/workstreams/`, repo root: `CLAUDE.md`, a new `src/shared/workstream.ts`.
2. **GitHub API adapter, local dry run.** The GraphQL queries, the shared parsers, output in the shared types. Test it against the real repo from a script. Files: a new `src/github-api/`, `src/shared/`.
3. **Vercel project and functions.** `api/snapshot`, `api/docs`, `api/live`, the cache, the Ignored Build Step (a script: `main` only, and only when `tools/command-center/` changed). First prove that the functions bundle code from `src/` and that the cache works behind the login. **Mark:** create the Vercel project (root `tools/command-center`), add the read-only GitHub token, install Upstash and delete the read-write token variable it adds (then check that it is absent), turn on Vercel Authentication with "All Deployments". Files: a new `api/`, `vercel.json`, an ignore script.
4. **Hosted page.** The data layer switch, the Workstreams view. Files: `src/web/` (a new data layer and `workstreams/`), `vite.config.ts`.
5. **Local reporter.** The `publish` module, the pinned-copy launcher, the `SessionStart` hook. Files: a new `src/server/publish/`, a launcher script, the repo root: `package.json`. The hook entry goes in `~/.claude/settings.json` (Mark approves that change).
6. **Dropped (Mark, 2026-10-12).** The local Workstreams view and the 2-minute `git fetch` in the local CC (`runner.ts` allow-list). Mark uses only the hosted page from now on, so the local CC gets no new views.

After step 4, pushed work is live on the hosted page. After step 5, sessions and worktrees are live too.

**Step 5 status (2026-10-12): built, merged (PR #72) and running against the real Upstash (the reporter log said `publishing started` on 2026-10-12).** What was built, and where it differs from section 11.1:
- **Code.** `src/server/publish/` (the allow-list mapper, the worktree reader, the Upstash writer, the protection check, the loop), `scripts/reporter-launch.mjs` (the pinned copy, the lock, the fetch every 2 minutes) and `scripts/reporter-hook.mjs` (the `SessionStart` hook). `main.ts --reporter` turns the module on. `npm run cc` does not publish.
- **Own port 29417 (was 3011, which `PW_PORT=3011` Playwright runs also use).** The reporter does not use 3009, so `npm run cc` and the reporter can run together.
- **Fail closed at the start.** The first write waits for a check that says "protected". Until then the check repeats every minute. After the first "protected" answer, the 10-minute rule of section 11.1 applies with one change: an error, a timeout or a 5xx is "no answer", and the third "no answer" in a row (30 minutes) fails closed. The reporter then stops writing, deletes the key, and checks every minute until one check says "protected". A "protected" answer resets the count.
- **Titles are redacted.** A session title is prompt text and can hold a pasted secret. `map.ts` replaces secret-shaped text in titles and agent names with `[redacted]` (token prefixes, `Bearer`, JWTs, `KEY=` assignments, long mixed runs of letters and digits) before the length cut.
- **Worktree `path`.** Only the NAME of the last folder leaves this machine, and the branch is redacted like a title (review of PR 72, fixed 2026-10-12). The hosted page joins a worktree to its workstream by branch, so nothing needs the full path. The old known limit (the full path on a page behind the login) is gone.
- **Dirty counts.** The runner list gained one exact `git status --porcelain=v1 --untracked-files=normal` (`GIT_STATUS` in `runner.ts`). Worktrees outside the configured roots are reached by adding the folders that `git worktree list` printed to the roots of one runner call.
- **No workstream frontmatter in `live`.** The contract (`src/shared/live.ts`) has no field for it. The hosted page reads workstream files from GitHub. Uncommitted edits to them do not show until the contract grows a field.
- **The fetch lives in the launcher.** `git fetch` runs in the pinned copy from `reporter-launch.mjs`, so the runner list got no `fetch` entry.

### 11.4 Risks and open points

- **Step 3 result (2026-10-12).** The functions are committed bundles (`api/*.js`, built from `functions/*.ts` by esbuild; a test fails on drift), because Vercel does not resolve extensionless TypeScript imports and cannot see files made by the build. The docs path is carried by a rewrite to `?path=`. Protection check passed: every route answered a 302 to the login without the bypass. The CDN cache behind the login is not yet proven.
- **The page is public if the protection scope is wrong.** "Standard Protection" leaves the production URL open. The 401 check after each deploy catches it (section 7). The reporter also repeats the check every 10 minutes and stops publishing if the page answers with a 200 and the JSON body of `/api/live` (section 11.1). A 401 or a redirect to the login means protected. An error, a timeout or a 5xx changes nothing.
- **Private data leaves this machine.** The allow-list of fields in section 11.1 limits what the reporter sends. The continuous protection check limits how long a wrong scope can matter.
- **Upstash cap behavior is not stated.** The plan uses about half of the free commands in the worst case.
- **The GraphQL query shape is from memory.** Step 2 tests it first.
- **The reporter is a background process on this machine.** If the machine sleeps, local rows show "reporter offline". Pushed work still shows.
- **Public repo.** The functions and the reporter code are public and hold no secrets. Tokens stay in Vercel environment variables and in a local file outside every repo (section 11.1).
- **Vercel Hobby is for personal, non-commercial use.** Shadow Jog's Command Center is a personal tool, so it fits.
