---
type: design
title: "Shadow Jog Command Center — Design"
project: shadow-jog
created: 2026-10-05
updated: 2026-10-07
status: approved by Mark 2026-10-05 (decision inbox and look added the same day). Revision 2 (live feedback of 2026-10-07) waits for Mark's review.
tags: [tooling, command-center, design]
---

# Shadow Jog Command Center — Design

A small website that runs on Mark's machine. It is the home base for all Shadow Jog work: the docs, the status, the agents, the work in progress, and the design decisions that wait on Mark, in one place.

**Status:** version 1 is built ([PR #21](https://github.com/markhazlewood42/shadow-jog/pull/21) and [PR #22](https://github.com/markhazlewood42/shadow-jog/pull/22) on `main`). Mark approved it on 2026-10-05 and added the decision inbox (section 5.5) and the look (section 4.2) the same day. Its plan is [plan.md](plan.md).

**Revision 2 is not built yet.** It answers Mark's live feedback of 2026-10-07 and waits for his review. It changes four things:
1. All page text becomes labels and links (section 5.8).
2. The Status panel becomes a summary with links (section 5.6).
3. Every doc page gets Copy and Download (section 5.7).
4. The Agents page becomes a live diagram of the active sessions (section 5.4).

Its plan is [plan-revision-2.md](plan-revision-2.md). A section marked "revision 2" replaces the version 1 text.

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
| Running panel | Sessions only. Each row links to the Agents page. |
| Diagram build | Our own SVG lines and smooth motion. The server checks every 3 seconds. No new dependency. |
| Status panel | Five rows with links, and a milestone strip from M0 to M8. |
| Doc buttons | A split button as on the markedup-consulting site: "Copy for LLM", with "Download as markdown" in its menu. The copied text has a 2-line source header. |

---

## 3. Scope

**Version 1:** the Now page, the docs site, the engine review aids, the decision inbox, and live updates.

**Not in version 1:** write actions other than answering decisions, a login, access from another device, other projects, and the game's design tools (they stay in the game's DEV tab, and the Now page links to them).

**Later (the design keeps room for these):** more actions (tick review items, leave notes for agents, start agents), the visual editors from `docs/IDEAS.md` entry 1, and other projects.

**Revision 2 does not change:** the decision inbox, the docs navigation, the engine review aids, the PlasmaUI panels, the look, and the one write route.

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

---

## 5. Pages

### 5.1 Now (`/`)

The page reads from top to bottom, in order of importance:

1. **Your move.** Every open action for Mark in one list. The open decision issues come first (section 5.5). Then the last "Your move" box of each active session, the "Next up for Mark" list in `status.md`, and the PRs that wait for his review or merge. Each item links to its source.
2. **Running.** (Revision 2.) One row for each active session, in order of start: its title, a state word, how long it has run, and a link to the Agents page. Agents and workflows show only in the diagram. A label tells how many automated runs are hidden.
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
- An agent runs until it has an end record. If it has none and its file did not change for 5 minutes, it still counts as running while its session is `busy`, because a long tool call writes nothing. While the session is `idle`, it counts as stopped and leaves the diagram.
- A finished agent stays for 5 minutes, dimmed, and then leaves. A closed session leaves at once.
- If the process list cannot be read, the page uses the file ages of version 1 and shows the label "Process list unavailable". In this fallback, the version 1 state decides: "working" counts as `busy` and "waiting" counts as `idle`.
- With no active session, the page shows one label: "No active session".

**Boxes**
- A session box has its title (as in version 1: the custom title, else the agent name, else the start of the first prompt), a state word and its run time. A Copy button copies the path of its session file.
- An agent box has its task label (the `description` in its `.meta.json`), its model as a family name (for example "fable"), and its run time, or "done". A Copy button copies the path of its file.
- A workflow is one box with its name and a progress chip: the phase, and the agents done of the agents started. Its agents have no boxes.
- A box is small: one title line and one detail line. A long label is cut, and the full text sits in its tooltip.
- A parent shows at most 12 children and then a label "+N more".

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

### 5.6 Status panel (revision 2)

The panel is a summary. Each row is a label, a value and a link. It does not copy or summarize the text of `status.md`.

| Row | Value | Link |
|---|---|---|
| Branch | the branch name, and how many commits it is ahead or behind | the branch on GitHub |
| CI on main | passing, failing or running, and its age | the run on GitHub |
| Next up | the number of items for Mark | the status doc page |
| status.md | the date of its last update | the status doc page |
| Last commit | its age | the commit on GitHub |

Under the rows, a strip shows the milestones of `docs/engine/migration.md`, M0 to M8, as small squares.
- A square before the current milestone is filled. The current one has the accent color. Later squares are outlined.
- Each square links to its heading in the doc.
- The current milestone is a new key in the frontmatter of `status.md`: `milestone: M3`. The value `none` means that no milestone has started. Agents update the key at a phase break.
- A value that names no milestone shows an error label on the strip. The page never guesses.

Data:
- `/api/status` gives the update date, the count of Next up items, the milestone key and the milestone list.
- `/api/git` gives the branch, its standing and the last commit.
- `/api/health` gives the repository address for the links.
- CI on main is new. The GitHub module reads `gh run list --branch main --limit 1` with the PRs, every 60 seconds. This adds one exact command to the allow-list of the `gh` runner.
- A row whose source failed shows an error label and a Retry button. The other rows stay.

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

The session files take more than 300 MB on disk. The site reads only the end of each recent file, so the size does not slow it down. Their format can change with a Claude Code update, so the session module must not fail on an unknown line. It shows "unknown" instead.

The process list is an internal file of Claude Code, and its format is not promised. The `agents` module must not fail when the format changes. It falls back to the file ages and says so (section 5.4).

---

## 7. Errors and empty states

- Every panel loads on its own and shows its own error state. It never fails silently. Examples: "GitHub: gh is not signed in", "Sessions: unknown file format".
- One broken source never blanks the page.
- Every panel shows when it last updated.
- (Revision 2) The Agents page: an unreadable process list gives the label "Process list unavailable" and the file-age fallback. An unknown line in a session file gives a box with the state "unknown". It never crashes the page.
- (Revision 2) A Status row whose source failed shows an error label and Retry. The other rows stay.
- (Revision 2) Copy and Download show "Copy failed" or "Download failed" on the button. They never fail silently.

---

## 8. Testing and verification

- **Unit tests** (Vitest) for every parser: frontmatter, outline, backlinks, the decision table, the end of a session file, a workflow record, the "Your move" box, and a decision issue (parse it, and ignore an answer from another account). Sample files go in a fixtures folder.
- **End-to-end tests** (Playwright) on the fixtures: the Now page (with the glass on and off), the docs navigation, search, outline, backlinks, the decision list, a decision banner, the answer flow with a stub for `gh` (a success, and a failure that keeps the choice), and one error state.
- **Verification:** a builder agent and 2 independent verifier agents for each feature, with screenshots for Mark at each visual step.
- **Revision 2 unit tests:** the process list reader and the pid check (the pid check is injected), the active set and its fallback, the parent link and the message counts on synthetic fixtures, the box and line layout functions, the milestone key, the CI run parser, the doc source route, and the copy text builder. Fixtures are synthetic. They never hold real session text.
- **Revision 2 end-to-end tests:** the Agents page with fixture sessions (live, closed, a dimmed finished agent, a workflow chip, the empty state, the fallback label), a new agent that appears within 5 seconds through the live event, Copy and Download on a doc page (the test grants the clipboard permission), the Status rows and the strip, and the Running rows that link to `/agents`. Tests that pin old page text change with the text pass.
- **Revision 2 verification:** each task has a builder and 2 fresh verifiers (a runner and a reader), all on Fable. A task passes when every criterion scores 7 or more and the average is 8 or more. A task has up to 3 fix rounds, for Critical and Important findings only. Mark gets screenshots as soon as a builder makes them.

---

## 9. Defaults (Mark can change any of them)

1. **Name:** "Shadow Jog Command Center".
2. **Start:** `npm run cc` starts the server and opens a browser tab.
3. **(Revision 2) Live check:** the `agents` module checks every 3 seconds (`agents.pollMs`).
4. **(Revision 2) Finished agents** stay for 5 minutes, dimmed (`agents.lingerSeconds`).
5. **(Revision 2) The process list folder** is `~/.claude/sessions` (`claude.sessionsRoot`).
6. **(Revision 2) A box shows at most 12 children,** and then "+N more".

---

## 10. Approaches considered for the Agents data (revision 2)

| Approach | For | Against |
|---|---|---|
| A. Extend the sessions module with links and an active flag | One module. One parser. | The Agents page, the Running panel and Your move share one 10-second check over 7 days of files. A 3-second check would load them all. The session type grows for two views. |
| **B. A new `agents` module** (chosen) | It starts from the process list, so it reads only live files. It has its own 3-second check. The sessions module stays as it is. | Two modules read session files. They share the parsing helpers so the code does not fork. |
| C. Derive the links in the browser from raw files | None | Session files must not leave the server. They hold private text. |

Choice: B. It keeps the live view cheap and leaves Your move untouched.
