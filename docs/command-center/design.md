---
type: design
title: "Shadow Jog Command Center — Design"
project: shadow-jog
created: 2026-10-05
updated: 2026-10-05
status: approved by Mark 2026-10-05 (decision inbox and look added the same day)
tags: [tooling, command-center, design]
---

# Shadow Jog Command Center — Design

A small website that runs on Mark's machine. It is the home base for all Shadow Jog work: the docs, the status, the agents, the work in progress, and the design decisions that wait on Mark, in one place.

**Status:** approved by Mark (2026-10-05). The same day he added the decision inbox (section 5.5) and the look (section 4.2). Nothing is built yet. The implementation plan is [plan.md](plan.md).

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

---

## 3. Scope

**Version 1:** the Now page, the docs site, the engine review aids, the decision inbox, and live updates.

**Not in version 1:** write actions other than answering decisions, a login, access from another device, other projects, and the game's design tools (they stay in the game's DEV tab, and the Now page links to them).

**Later (the design keeps room for these):** more actions (tick review items, leave notes for agents, start agents), the visual editors from `docs/IDEAS.md` entry 1, and other projects.

---

## 4. Architecture

- **Where:** `tools/command-center/` in the shadow-jog repo, with its own `package.json`. The game's dependencies and bundle do not change. `npm run cc` at the repo root starts it.
- **Address:** `http://localhost:3009`. The server listens on `127.0.0.1` only. (Ports 3007 and 3008 are the game's. Ports 3002 to 3006 belong to other projects.)
- **Server:** Node and TypeScript. It has one module for each source: docs, status, git, GitHub, decisions, and Claude sessions. Each module builds its part of an index in memory and serves it through a JSON API (`/api/...`). A file watcher rebuilds only the part that changed and pushes an event to the open page (server-sent events).
- **Page app:** React, Vite, Tailwind v4 and Lucide icons. The Now page draws its panels with PlasmaUI (section 4.1). The docs pages use HeroUI v3, with a theme from the shared tokens (section 4.2). The routes are `/` (Now), `/docs/...`, `/decisions/<number>`, and `/agents`.
- **Markdown:** the server parses each doc once. One pass gives the HTML, the headings (for the outline), the links (for backlinks), the frontmatter, and the text for search.
- **Safety:** the server reads only from an allow-list: the shadow-jog repo, the `shadow-jog-phaser` checkout, and the Shadow Jog session folders under `~/.claude/projects/`. No API route takes a raw file path. The only write route is `POST /api/decisions/<number>/answer`. It posts Mark's answer through `gh` and changes the issue's labels. It makes no git operation and writes no file. It accepts only a same-origin request that carries a token the server makes at each start, so another web page in the browser cannot call it.
- **Room for actions:** a later write action is a new route in one module. The read side does not change.

### 4.1 PlasmaUI on the Now page

- **What it is:** [PlasmaUI](https://github.com/CruxGarden/plasma-ui) (`@cruxgarden/plasma-ui`) draws "liquid glass" panels for React in WebGL: refraction, frost, rim light and glow. Version 0.7.0, MIT licence, started in September 2026 and active. It is before version 1.0, so its API can change.
- **What it is not:** a widget kit. It has no cards, tables, progress bars or charts. It is the panel that holds them. The content inside each panel uses our own small components (Tailwind and Lucide, HeroUI where it fits).
- **Where:** only the Now page loads it, because its canvas covers the whole window. The docs pages do not load it.
- **Look:** a custom mood from the shared tokens (section 4.2), with the glow turned down to match the profile's "no glow". Its built-in "ember" mood is the fallback.
- **Layout:** the panels can be dragged and snap to a 24 px grid. The site keeps Mark's arrangement in the browser (localStorage). This changes no project file.
- **Guards:** we pin the exact version and wrap it in one local component (`GlassPanel`), so an API change touches one file. It uses the GPU, so a "plain panels" switch turns the glass off, for example while the game runs. The site also uses plain panels when the browser has no WebGL2.

### 4.2 Look

- **Rule (Mark, 2026-10-05):** the command center matches Shadow Jog's other tooling, as the diagrams do. Keep things feeling similar.
- **Source:** the `shadow-jog` diagram profile (`docs/diagrams/profile/shadow-jog.md`, with the colour mapping and contrast ratios in `docs/diagrams/profile/NOTES.md`).
- **In short:** a dark skin from the game's own UI colours: navy panels, a lavender frame, white text, amber for the one or two focal items on a screen, cyan for links, and no glow. The fonts are Geist and Geist Mono, as in the diagrams.
- **One token set:** CSS variables copied from the profile feed both the HeroUI theme on the docs pages and the PlasmaUI mood on the Now page. A change to the profile then needs a change to one token file.
- **Contrast:** the ratios in `NOTES.md` are the floor for all text.

---

## 5. Pages

### 5.1 Now (`/`)

The page reads from top to bottom, in order of importance:

1. **Your move.** Every open action for Mark in one list. The open decision issues come first (section 5.5). Then the last "Your move" box of each active session, the "Next up for Mark" list in `status.md`, and the PRs that wait for his review or merge. Each item links to its source.
2. **Running now.** One row for each active session, agent and workflow: its name, its state, a bar, and how long it has run. A workflow's bar shows real progress (phases and agents done). An agent's bar moves while the agent runs and fills when it ends, because agents report no percent done.
3. **Pull requests and CI.** The open PRs, with review state and checks, and the PRs merged in the last 7 days.
4. **Project status.** The current section of `status.md` ("Right now") and the milestone list.
5. **Links.** The game (`localhost:3007`) and its DEV tools, the GitHub repo.

### 5.2 Docs (`/docs`)

- **Overview page:** what the docs cover, and one card for each section with its key pages and the date each one last changed.
- **Sections** (the navigation): Start here (status, overview), Game design (GDD, setting, glossary, concepts, ideas), Engine design (in the engine README's reading order), Decisions, Architecture and development (architecture, developing, tooling UI), Spikes and research, Quality, Project records (changelog, phase plans), and Command center. A small map file sets the sections. A doc that the map does not list shows under "Other", so no doc gets lost.
- **Layout:** the section tree on the left, the doc in the middle, and on the right the outline (headings) and the backlinks ("linked from").
- **Diagrams** show large. A click opens a zoom view. The link to the editable source stays.
- **Search** is on every page. It looks at titles, headings and text.
- **Header:** each doc shows its frontmatter as a small header: type, status, and last update (from git if the frontmatter has none).
- **Links:** links between docs open inside the site. Links to code open on GitHub.
- **Decision banners:** a doc section that an open decision links to shows a banner with the question and a link to the decision.

### 5.3 Engine design review

- **Reading order:** the engine docs in the order that `docs/engine/README.md` gives, with Previous and Next buttons.
- **Decision list** (`/docs/decisions`): every decision in one table: the E decisions from `docs/engine/decisions.md` and the decisions in `docs/PHASE-0.2.md`. The columns are number, question, answer, milestone, who decides, and status.
- **Status:** approved, open for Mark, or changed since approved. "Changed since approved" compares the decision's text now with its text at the approval commit. The approval commit is a git ref in the site's config file.

### 5.4 Agents (`/agents`)

The full list behind "Running now": the sessions of the last 7 days, their agents and workflows, with links to their files.

### 5.5 Decision inbox (the one two-way feature)

- **What counts:** a major design decision that blocks work, changes an approved design, or touches more than one session or branch. A small question inside one session stays in that session.
- **Where it lives:** a GitHub Issue in shadow-jog with the label `decision`. An issue template (`.github/ISSUE_TEMPLATE/decision.md`) gives the shape: the question, the context in two or three lines, the options with what each one changes, the recommendation, the doc sections it concerns (as `path#heading` links), who raised it (session, branch or PR), and what waits on it.
- **Where it shows:** at the top of "Your move" on the Now page; as a banner on each doc section it links to; and on its own page (`/decisions/<number>`), which shows the linked doc sections inline under the question.
- **How Mark answers:** he picks an option and can add a note. The server posts a comment ("Decision: <option>. <note>") through `gh`, swaps the label `decision` for `decided`, and closes the issue.
- **How agents use it:** a rule in `CLAUDE.md` says how to raise a decision issue, and to read the answer with `gh` before acting on it. Agents trust only comments and labels from Mark's account (`markhazlewood42`), because the repo is public and anyone can comment. The agent that needs the answer records it in the docs through its PR, and links that PR in the issue.
- **Errors:** if `gh` fails, the form keeps Mark's choice, shows the error, and offers a retry.

---

## 6. Data sources

| Source | What the site reads | How |
|---|---|---|
| Docs | `docs/**/*.md`, `status.md`, `CHANGELOG.md`, the root `*.md` files, and the diagram PNGs | File reads and a file watcher |
| git | Branches, recent commits, the date each file last changed | `git` commands |
| GitHub | Open PRs, review state, checks, recent merges | The `gh` CLI (already signed in). Every 60 seconds, and on demand |
| Decisions | Issues with the `decision` or `decided` label, and their comments | The `gh` CLI. Every 60 seconds, on demand, and right after an answer |
| Claude sessions | The session files for Shadow Jog (found by their working folder), and their agent and workflow records | Only files changed in the last 7 days, and only the end of each file |

The session files take more than 300 MB on disk. The site reads only the end of each recent file, so the size does not slow it down. Their format can change with a Claude Code update, so the session module must not fail on an unknown line. It shows "unknown" instead.

---

## 7. Errors and empty states

- Every panel loads on its own and shows its own error state. It never fails silently. Examples: "GitHub: gh is not signed in", "Sessions: unknown file format".
- One broken source never blanks the page.
- Every panel shows when it last updated.

---

## 8. Testing and verification

- **Unit tests** (Vitest) for every parser: frontmatter, outline, backlinks, the decision table, the end of a session file, a workflow record, the "Your move" box, and a decision issue (parse it, and ignore an answer from another account). Sample files go in a fixtures folder.
- **End-to-end tests** (Playwright) on the fixtures: the Now page (with the glass on and off), the docs navigation, search, outline, backlinks, the decision list, a decision banner, the answer flow with a stub for `gh` (a success, and a failure that keeps the choice), and one error state.
- **Verification:** a builder agent and 2 independent verifier agents for each feature, with screenshots for Mark at each visual step.

---

## 9. Defaults (Mark can change any of them)

1. **Name:** "Shadow Jog Command Center".
2. **Start:** `npm run cc` starts the server and opens a browser tab.
