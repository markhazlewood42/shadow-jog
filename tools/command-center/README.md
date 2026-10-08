---
type: reference
title: Shadow Jog Command Center — README
project: shadow-jog
created: 2026-10-06
updated: 2026-10-08
tags: [tooling, command-center]
---

# Shadow Jog Command Center

One local website for Shadow Jog. It shows what is going on now (the live Claude Code sessions with their agents and workflows, pull requests, CI, `status.md`), lets Mark read every doc in one place, and lets him answer design decisions. It reads the repo, `git`, `gh`, Claude Code's session files and its process list. It writes one thing: Mark's answer to a decision, as a comment and a label on a GitHub issue. The design is in `docs/command-center/design.md`.

Every page shows labels and links, in simple technical English (ASD-STE100). A sentence is one line of 20 words or fewer. The docs explain, and the page links to them (section 5.8 of the design).

The tool lives in `tools/command-center/` with its own `package.json`, lock file and `node_modules`. It imports nothing from the game's `src/`, and the game does not depend on it.

## Install and start

You need Node 24 (`engines` asks for 24.2 or later), Git, and the GitHub CLI (`gh`) signed in with `gh auth login`. Run this from the repo root, in Git Bash on Windows:

```bash
npm run cc
```

That one command installs the tool's packages, builds the page app, starts the server and opens a tab at http://localhost:3009. Stop it with Ctrl+C. Every run builds the page again, so a change to the page source shows after a restart.

| Port | Used by |
|---|---|
| 3009 | The command center itself (`port` in `command-center.config.json`) |
| 3010 | The end-to-end server that Playwright starts (`e2e/server.ts`). It never reuses a running one. |
| 3007, 3008 | The game's dev server and preview. The command center only links to 3007. |

The server listens on `127.0.0.1` only, and answers 403 to any `Host` header except `localhost:<port>` and `127.0.0.1:<port>`. If the port is busy, it prints one line and exits. It never stops the program that holds the port.

To run on another port, copy `command-center.config.json` to a file outside the repo, change `port` (and make the paths absolute, because a relative path starts at the config file), then start with `--config`:

```bash
npm --prefix tools/command-center install --no-audit --no-fund
npm --prefix tools/command-center run cc -- --config /path/to/other.config.json
```

Other commands, from the repo root (add `--prefix tools/command-center` as shown):

| Command | What |
|---|---|
| `npm --prefix tools/command-center run dev` | The server with the page rebuilt on every source change (`--dev`). Reload the tab to see it. |
| `npm --prefix tools/command-center run check` | Typecheck and the Vitest unit tests |
| `npm --prefix tools/command-center run e2e` | The Playwright tests, against the fixture server on 3010 (Microsoft Edge locally, bundled Chromium on CI) |
| `CC_NO_OPEN=1 npm run cc` | Start without opening a browser tab. Every test and automated run sets `CC_NO_OPEN=1`. |

Four checks run against the real repo or the real machine and not against fixtures, so they run only on demand: `CC_REAL_NAV=1` (every real doc sits in a nav section, so "Other" is empty; the source route sends the exact bytes of every doc; `status.md` has a valid `milestone:` key), `CC_REAL_ENGINE=1` (the engine decisions read as expected), `CC_REAL_AGENTS=1` (the real process list in `claude.sessionsRoot` has the shape that the agents module expects), and `CC_REAL_URL=<address>` (a Playwright check against a running server).

## The pages

| Address | What |
|---|---|
| `/` | Now: five panels. Your move (what waits for Mark), Running (the active Claude sessions only: each row links to `/agents`), Pull requests (with their checks), Status (five rows and a milestone strip, see below) and Links. The panels are glass (PlasmaUI) that you can drag. The "Glass panels" switch turns the glass off, which also saves the GPU while the game runs. |
| `/docs` | Every doc, in the sections of `nav.json`, with search, an outline, backlinks and a banner on a section that an open decision concerns. A doc page has the Copy and Download split button (see below). |
| `/docs/decisions` | Every engine and Phase 0.2 decision in one table, with its status: approved, open for Mark, or changed since approval |
| `/decisions/<n>` | One decision issue, with its options, the form that answers it, and a link for each linked doc section (the page does not copy the section text) |
| `/agents` | A live diagram of the Claude Code sessions that run now, checked every 3 seconds. Each session is a cluster: its box on top, and a small box for each agent below it. A workflow is one box with a progress chip (the phase, and the agents done of the agents started). A solid line with an arrow runs from a parent to what it started. A dashed line with a count shows the messages between a parent and an agent. A parent shows at most 12 children, then "+N more". A box has a Copy button for the path of its file. No message text appears. |

## The Status panel and the `milestone:` key

The Status panel on the Now page is a summary. Each row is a label, a value and a link. It does not copy `status.md`.

| Row | Value | Link |
|---|---|---|
| Branch | The checked-out branch, and `ahead 3`, `behind 1`, `level` or `no upstream` | The branch on GitHub |
| CI on main | `passing`, `failing` or `running`, and its age (`no run` when `main` has none) | The run on GitHub |
| Next up | How many "Next up for Mark" items wait (`3 for you`, or `Nothing for you`) | The `status.md` doc page |
| status.md | The date in its `updated` key | The `status.md` doc page |
| Last commit | Its age | The commit on GitHub |

A row whose source failed shows `Unavailable`, the error code and a Retry button. The other rows stay.

Under the rows, a strip shows the milestones of the table in `docs/engine/migration.md`: one small square for each row of that table (12 today: Phase 0, Pre-M0, M0, M1, M1b, M2 to M8). The table is the source, so a new row adds a square. A square before the current milestone is filled, the current one has the accent color, and later ones are outlined. Each square links to its heading in the doc. The current milestone shows as a link beside the squares.

The current milestone is the `milestone:` key in the frontmatter of `status.md`:

```yaml
---
milestone: Pre-M0
---
```

| Value | What the strip shows |
|---|---|
| The id of a table row, as the table writes it in bold (`Pre-M0`, `M3`, `M1b`; case matters) | That milestone is current |
| `none` | No square is current, and the label `Not started` |
| No key, or an empty one | The label `Milestone key missing` |
| Anything else (`m3`, an id the table does not have, a number) | The label `Unknown milestone`. The page never guesses which milestone you meant. |

Set the key when a milestone starts. The loader is `parseMilestoneKey` in `src/server/status/status.ts`.

## Copy and Download

Every doc page has a split button under its header. The overview, the "Doc not found" page and `/docs/decisions` have none: the decision table draws three docs, so it has no single file.

- The main button, `Copy for LLM`, copies a two-line header, a blank line and the file text as it is. Line 1 is the doc title. Line 2 is the repo path and its GitHub address. The frontmatter stays in the file text.
- The small arrow opens a menu with two entries: `Copy for LLM` and `Download as markdown`. The download is the file text as it is, named like the file (`decisions.md` for `docs/engine/decisions.md`).
- After a copy the main button reads `Copied` or `Copy failed` for 2 seconds. A failed download reads `Download failed`. Nothing fails silently.

The page fetches the text from `GET /api/docs/<slug>/source` when you press the button, so a page that nobody copies never loads it.

## Data routes added in revision 2

| Route | What |
|---|---|
| `GET /api/agents` | The live Claude sessions with their agents and workflows, as a panel. It starts from the process list (the folder `claude.sessionsRoot`) and reads only the files of live sessions. The server reads four keys of a process file: the session id, the pid, the start time and `busy` or `idle`. It uses the pid to check that the process runs, and the pid does not leave the server. The module looks every `agents.pollMs`. |
| `GET /api/ci` | The newest CI run on `main` (`passing`, `failing`, `running` or `none`, with its time and address), as a panel. The server runs one exact command, `gh run list --branch main --limit 1`, every 60 seconds. |
| `GET /api/docs/<slug>/source` | The file text of one indexed doc as `text/markdown; charset=utf-8`, with `X-Content-Type-Options: nosniff`. It takes the slug of a doc, never a path. An unknown slug answers 404. |

The two panel routes accept `?refresh=1`, which makes the server read again, at most once in 10 seconds. `GET /api/sessions` (the sessions of the last 7 days) stays. The server makes the Your move panel from it, and no page lists it.

## Config keys

All settings are in `command-center.config.json`. A path in the file is relative to the file itself (`~` is the home folder), so the file holds no machine-specific path. A wrong, missing or unknown key stops the start with a message that names it, because a typo in a safety setting must not be ignored. The keys marked optional may be left out, so a config file from before the agents module keeps working. The `agents` object may be left out whole. The loader is `src/server/config.ts`.

| Key | What |
|---|---|
| `port` | The port to listen on, 3009 |
| `repoRoot` | The Shadow Jog repo: where `git` runs and where the docs are read |
| `roots` | The folders the server may read or run commands in: the repo and the `shadow-jog-phaser` checkout |
| `githubRepo` | `owner/name` of the repo that `gh` talks to. Every `gh` call is pinned to it. |
| `approvalRef` | The commit at which Mark approved the engine design. A decision is "changed" when its text differs from its text at this commit. After Mark merges a PR that edits `docs/engine/` (a spelling pass, for example), move `approvalRef` to that merge commit. Else the Decisions page flags those docs as changed. |
| `gameUrl` | The address of the game's dev server |
| `links` | The links of the Links panel: `{ "label": "...", "url": "..." }` |
| `claude.projectsRoot` | Where Claude Code keeps its session files (`~/.claude/projects`) |
| `claude.sessionsRoot` | Optional, default `~/.claude/sessions`. Where Claude Code lists its running processes: one `<pid>.json` file for each. The Agents page and the Running panel treat a session as active while its process runs. |
| `claude.folders` | Session folders (by exact name) that belong to Shadow Jog: every session in them counts |
| `claude.cwdMatchFolders` | Session folders (by exact name) that mix projects, such as the home-base folder. A session counts only when the working folder of its newest line is inside a root. |
| `claude.includeSdk` | Optional, default `false`. A session whose entrypoint starts with `sdk` was started by a script (`claude -p`, the Agent SDK). Those are hidden. The Agents page and the Running panel show their count as the label "N script runs hidden" (`hiddenScripts` in `GET /api/agents`), and `GET /api/sessions` counts them in `hiddenSdk`. Set `true` to list them. |
| `claude.recentSeconds` | A session file older than this is left out (604800 is 7 days) |
| `claude.workingSeconds` | A session written to within this time, and not waiting for Mark, is "working" |
| `claude.waitingSeconds` | A session whose last reply ended its turn is "waiting for Mark" for this long, then "idle" |
| `agents.pollMs` | Optional, default `3000`, from 100 to 3600000. How often the agents module looks at the process list, in milliseconds. |
| `agents.lingerSeconds` | Optional, default `300` (5 minutes), from 0 to 31536000. How long a finished agent stays on the Agents page, dimmed. `0` removes it at once. |
| `agents.staleSeconds` | Optional, default `1800` (30 minutes), from 1 to 31536000. An agent with no end record counts as running while its session is busy. After this many seconds without a change to its file, it counts as stopped. An agent that Mark stops writes no end record, so this limit ends it. |

The shapes that the server answers with are in `src/shared/types.ts`. `docs/command-center/plan.md` shows older shapes of `Config` and `SessionInfo`: the code and this README are current.

## Add a nav section

`nav.json` sorts the docs into the sections on the left of the docs pages. It is two levels deep: sections, and items in them. Add a section (or an item to a section) and reload the page. The server watches the file.

```json
{ "id": "command-center", "title": "Command center", "items": ["docs/command-center/", "tools/command-center/README.md"] }
```

An item is one of these forms:

| Item | Meaning |
|---|---|
| `"docs/GDD.md"` | One file, with a path from the repo root and forward slashes |
| `"docs/quality/"` | A folder (the path ends with a slash): every doc below it |
| `{ "readingOrder": "docs/engine/README.md" }` | The docs in the order of that doc's "Reading order" list |
| `{ "page": "/docs/decisions", "title": "All decisions" }` | A page of the site that is not a doc |

A doc that no section names shows under a last section, "Other", so no doc is lost. A mistake in `nav.json` leaves out that section or item and is listed as a problem on the Docs overview. When you add a doc, check that "Other" stays empty.

## How decisions work

A decision is a GitHub issue in `markhazlewood42/shadow-jog` with the label `decision`. Only a major decision goes there: one that blocks work, changes an approved design, or touches more than one session or branch. The rule for agents is in the root `CLAUDE.md` ("Decisions for Mark"), and the design is in section 5.5 of `docs/command-center/design.md`.

1. **Raise.** An agent builds the body from the headings of `.github/ISSUE_TEMPLATE/decision.md` (Question, Context, Options, Recommendation, Docs, Raised by, Waits on this) in a scratchpad file, and runs `gh issue create` with `--label decision`. The issue body is public: it holds no secrets and no private session text. The page reads the headings, so they stay as they are. Options are written `- A: what it is and what it changes`.
2. **Show.** The open decision appears at the top of "Your move" on the Now page, as a banner on each doc section it links to (`path#heading` lines under Docs), and on its own page `/decisions/<n>`.
3. **Answer.** Mark picks an option and may add a note. The server re-reads the issue through `gh`, then posts the comment `Decision: <option id>. <note>`, swaps the label `decision` for `decided`, and closes the issue. If a step fails, the form keeps the choice, names the step and offers Retry. A retry starts at the first step that is not done, so it never posts the comment twice.
4. **Read.** The agent that waits runs the two commands in `CLAUDE.md` and acts only when all three parts are there: a `Decision:` comment by Mark, the closed state, and a `labeled` event for `decided` by Mark. Then it records the answer in the docs through its PR and links the PR in the issue.

The repo is public, so anyone can write on an issue. Only issues, comments and labels by `markhazlewood42` count, and issue text always shows as plain text. The one write route is `POST /api/decisions/<n>/answer`. It accepts only a same-origin JSON request that carries the token that the server makes at each start (the page holds it). Every other method answers 405. The runner has an exact list of read commands and these three write shapes, and no path of the server writes a file or runs a git operation (the test `no-fs-write.test.ts` scans for that).

The two labels `decision` and `decided` must exist in the GitHub repo. Creating them is a write to the public repo: ask Mark first.

## Trouble signs

| What you see | Why, and what to do |
|---|---|
| `git clone` ends with "Filename too long" and an empty checkout | Windows stops at 260 characters, and the longest tracked path of the tool is 162 characters. Clone into a short folder (such as `C:\code\shadow-jog`), or run `git config --global core.longpaths true` first. |
| "Port 3009 is already in use" | Another program holds the port. Stop that program, or start with another config (see above). The command center never stops it for you. |
| 403 `forbidden-host` | You reached the server by another name, such as a LAN address. Use `http://localhost:3009` or `http://127.0.0.1:3009`. |
| A panel says "gh is not installed" or "gh is not signed in to GitHub" | Install the GitHub CLI and run `gh auth login`, then press Retry on the panel. |
| "gh cannot reach GitHub" | The network is down. The panel shows the last good data and its time. Press Retry. |
| The answer form says the label "decided" does not exist | Your answer is already posted as a comment. Create the label in GitHub (Issues, Labels), then press Retry. |
| The Agents page says "No active session" | No Claude Code process runs for Shadow Jog, or the folder of its session is not named in `claude.folders` or `claude.cwdMatchFolders` (by exact name, under `~/.claude/projects`). A session counts only while its process runs. A label such as "1 script run hidden" means `claude.includeSdk` is `false`. |
| The label "Process list unavailable" | The agents module cannot read the folder `claude.sessionsRoot` (it is missing or unreadable), or none of its files has the keys the module needs. The page falls back to the file ages: a session that works (wrote within `claude.workingSeconds`) or waits for Mark (up to `claude.waitingSeconds`) counts as active. Check the folder and the config key. |
| The Status strip says "Milestone key missing" or "Unknown milestone" | `status.md` has no `milestone:` key, or its value is not `none` or an id of the milestone table in `docs/engine/migration.md`. Case matters. See the `milestone:` key above. |
| `/docs/decisions` shows an error that names a column | Someone edited the decision table in `docs/engine/decisions.md`. The parser finds columns by header name, so restore the named column. An error that names an id (such as `E 5`) or a verdict (such as `deferred`) means a table row or a PHASE-0.2 decision line is mistyped: fix the line. The page never drops a decision silently. |
| A doc is missing from its section, or "Other" is not empty | Add it to `nav.json` (see above). The Docs overview lists broken links and nav mistakes. |
| The Now page shows plain panels first, then glass | PlasmaUI compiles its shaders on the page's main thread, and plain panels paint first. In a headless run under software GL the block lasts about 5.5 seconds. On a real GPU it is shorter. Turn off "Glass panels" to skip it. |
| A page looks stale | The page reloads a panel when its module reports a change. If a source is quiet, press Retry on the panel, or reload the tab. |

## Tests

Vitest holds the units (`tests/`) and Playwright holds the browser tests (`e2e/`). Both use synthetic fixtures (`fixtures/`): a throwaway git repo, made-up Claude session files and a fake `gh`. No test reads your real sessions or writes to GitHub, and none opens a browser tab. Never leave a server running: stop what you start, by its process id.
