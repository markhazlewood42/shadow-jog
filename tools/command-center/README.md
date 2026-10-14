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

CI runs `check` and `e2e` in its own workflow, `.github/workflows/command-center.yml` (job `command-center`), on a pull request or a push to `main` that changes this folder, a file under `docs/`, a markdown file at the root, or the decision issue template (the tests render the real docs). `ci.yml` still skips this folder. The CI runner has no GPU, so CI turns the glass background off and skips the tests that need a drawn glass canvas. A green job does not prove that the glass works: run both commands here before you push.

Four checks run against the real repo or the real machine and not against fixtures, so they run only on demand: `CC_REAL_NAV=1` (every real doc sits in a nav section, so "Other" is empty; the source route sends the exact bytes of every doc; `status.md` has a valid `milestone:` key), `CC_REAL_ENGINE=1` (the engine decisions read as expected), `CC_REAL_AGENTS=1` (the real process list in `claude.sessionsRoot` has the shape that the agents module expects), and `CC_REAL_URL=<address>` (a Playwright check against a running server).

## The pages

Every page has the same header, `SiteHeader` in `src/web/SiteHeader.tsx`, drawn once by `App`: the small title on the left and the links (Now, Roadmap, Docs, Agents, and Workstreams on the hosted page) at the right edge, sticky at the top. A page names itself with a heading in its body. The docs search box is in the Docs page body, not in the header.

| Address | What |
|---|---|
| `/` | Now: five panels. Your move (only what clears itself: the open decision issues and the live asks of the sessions that run now. It lists no pull request: the Pull requests panel does; a live ask hides when its session ends, when Mark answers, when the box says nothing or is replaced, or after 12 hours; the hosted page says "Reporter offline" and hides all live asks when its reporter stops), Running (the active Claude sessions only: each row links to its session at `/agents#session-<id>`), Pull requests (with their checks; the draft PRs from `spike/` branches, which are never merged, are hidden and not counted), Status (five rows and a milestone strip, see below) and Links. The panels are glass (PlasmaUI) that you can drag. The "Glass panels" switch turns the glass off, which also saves the GPU while the game runs. |
| `/docs` | Every doc, in the sections of `nav.json`, with search, an outline, backlinks and a banner on a section that an open decision concerns. A doc page has the Copy and Download split button (see below). |
| `/docs/decisions` | Every engine and Phase 0.2 decision (E, D and the Phase 0 choices C1 to C7) in one table, with its status: approved, open for Mark, or changed since approval |
| `/decisions/<n>` | One decision issue, with its options, the form that answers it, and a link for each linked doc section (the page does not copy the section text) |
| `/agents` | A live diagram of the Claude Code sessions that run now, checked every 3 seconds. Each session is a cluster: its box on top, and a small box for each agent below it. A workflow is one box with a progress chip (the phase, and the agents done of the agents started). A solid line with an arrow runs from a parent to what it started. A dashed line with a count shows the messages between a parent and an agent. A parent shows at most 12 children, then "+N more" (N counts the hidden children of that parent only). A box has a Copy button for the path of its file. No message text appears. A link from Your move to a session that is not in the diagram opens the page with the label `Session not active`. |

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

Under the rows, a strip shows the milestones of the table in `docs/engine/migration.md`: one small square for each row of that table (12 today: Phase 0, Pre-M0, M0, M1, M1b, M2 to M8). The table is the source, so a new row adds a square. A square is filled when the item with the same id in `docs/roadmap/roadmap.json` has the status `done` (whatever the row order and the key). The square that the `milestone:` key names has the accent color, and it wins over filled. All other squares are outlined. Each square links to its heading in the doc. The current milestone shows as a link beside the squares. The strip is never blank: finished milestones show with any key.

The current milestone is the `milestone:` key in the frontmatter of `status.md`. It says which milestone a session is working on now:

```yaml
---
milestone: Pre-M0
---
```

| Value | What the strip shows |
|---|---|
| The id of a table row, as the table writes it in bold (`Pre-M0`, `M3`, `M1b`; case matters) | That milestone is current |
| `none` | No square is current, and the label `None active`. Squares that are done stay filled. |
| No key, or an empty one | The label `Milestone key missing`. Squares that are done stay filled. |
| Anything else (`m3`, an id the table does not have, a number) | The label `Unknown milestone`. The page never guesses which milestone you meant. Squares that are done stay filled. |

Where each part comes from:

- Squares and their order: the rows of the table in `docs/engine/migration.md`.
- Done: the roadmap item with the same id (kind `milestone`) has the status `done`. A row with no item is not done. A test checks that the table and the roadmap have the same ids.
- Current: the `milestone:` key. Current wins over done, so a key left on a finished milestone shows that milestone as current. Set the key to `none` when the work on a milestone ends.
- Mark a milestone done in `docs/roadmap/roadmap.json` and run `npm run roadmap`. Then the strip fills its square.

`tests/roadmap.test.ts` at the repo root (not in this package) also checks the key against `docs/roadmap/roadmap.json`: the key must name a milestone item with the status `active`, or be `none` when no milestone item is active. One exception: `Pre-M0` may also be `done`. So a session that starts a milestone sets the item to `active` and the key to its id in the same change.

If `docs/roadmap/roadmap.json` is missing or is not a roadmap, the strip shows `Unavailable` with the code and a Retry button, and draws no squares. The other rows stay. The same happens, with the code `milestones-table-empty`, when the milestone table of `docs/engine/migration.md` has a header and no rows.

The loaders are `parseMilestoneKey`, `parseMilestones` and `parseRoadmapDone` in `src/server/status/status.ts`.

## Copy and Download

Every doc page has a split button under its header. The overview, the "Doc not found" page and `/docs/decisions` have none: the decision table draws three docs, so it has no single file.

- The main button, `Copy for LLM`, copies a two-line header, a blank line and the file text as it is. Line 1 is the doc title. Line 2 is the repo path and its GitHub address. The frontmatter stays in the file text.
- The small arrow opens a menu with two entries: `Copy for LLM` and `Download as markdown`. The download is the file text as it is, named like the file (`decisions.md` for `docs/engine/decisions.md`).
- After a copy the main button reads `Copied` or `Copy failed` for 2 seconds. A failed download reads `Download failed`. Nothing fails silently.

The page fetches the text from `GET /api/docs/<slug>/source` when you press the button, so a page that nobody copies never loads it.

## Data routes added in revision 2

| Route | What |
|---|---|
| `GET /api/agents` | The live Claude sessions with their agents and workflows, as a panel. It starts from the process list (the folder `claude.sessionsRoot`) and reads only the files of live sessions. The server reads five keys of a process file: the session id, the pid, the start time, the status and the launch folder (`cwd`, used only to decide which sessions are Shadow Jog's, and never sent to a page). The status shows as `busy` (the file says `busy` or `shell`) or `idle` (any other word), and a session is live in both cases. It uses the pid to check that the process runs, and the pid does not leave the server. The module looks every `agents.pollMs`. |
| `GET /api/ci` | The newest run of the `ci.yml` workflow on `main` (`passing`, `failing`, `running` or `none`, with its time and address), as a panel. The server runs one exact command, `gh run list --repo <githubRepo> --workflow ci.yml --branch main --limit 1 --json status,conclusion,url,createdAt`, every 60 seconds. |
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
| `claude.cwdMatchFolders` | Session folders (by exact name) that mix projects, such as the home-base folder. A session counts only when its working folder is inside a root (the "No active session" row in Troubleshooting says how that folder is found). |
| `claude.folderPrefixes` | Optional, default none. Name prefixes of session folders that belong wholly to Shadow Jog. Claude Code keeps the sessions of each worktree in its own folder, `<project folder>--claude-worktrees-<branch>`, and a new one appears with each worktree. Every folder under `~/.claude/projects` whose name starts with a prefix counts like a folder in `claude.folders`. Each prefix must end in `--claude-worktrees-` (the config is rejected otherwise): a prefix such as `C--Users-markh-home-base-projects-shadow-jog` would also match the sibling folder `...shadow-jog-phaser`. The shipped config has `C--Users-markh-home-base-projects-shadow-jog--claude-worktrees-`. |
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

## Known limits

- The server does not set the language of `gh`. The panel recognizes the causes of a `gh` failure (not signed in, offline, not installed) from English text. In another language the panel shows the generic message with the first line of what `gh` said.
- The list of recent decisions counts an answer as recent by the time of the answer comment. It does not use the time when the issue closed.
- The scan of a live session file reads up to 1 MiB of its end (`MESSAGE_WINDOW_BYTES` in `src/server/agents/tree.ts`) at every look. A look runs every 3 seconds (`agents.pollMs`).
- A process id that Windows reuses after a crash can show a ghost session on the Agents page.
- The motion of the diagram lines works in Chromium and Edge only. Firefox and Safari are untested. A browser without it redraws the line at once.

## Trouble signs

| What you see | Why, and what to do |
|---|---|
| `git clone` ends with "Filename too long" and an empty checkout | Windows stops at 260 characters, and the longest tracked path of the tool is 162 characters. Clone into a short folder (such as `C:\code\shadow-jog`), or run `git config --global core.longpaths true` first. |
| "Port 3009 is already in use" | Another program holds the port. Stop that program, or start with another config (see above). The command center never stops it for you. |
| 403 `forbidden-host` | You reached the server by another name, such as a LAN address. Use `http://localhost:3009` or `http://127.0.0.1:3009`. |
| A panel says "gh is not installed" or "gh is not signed in to GitHub" | Install the GitHub CLI and run `gh auth login`, then press Retry on the panel. |
| "gh cannot reach GitHub" | The network is down. The panel shows the last good data and its time. Press Retry. |
| The answer form says the label "decided" does not exist | Your answer is already posted as a comment. Create the label in GitHub (Issues, Labels), then press Retry. |
| The Agents page says "No active session" | No Claude Code process runs for Shadow Jog, or the folder of its session is not named in `claude.folders` or `claude.cwdMatchFolders` (by exact name, under `~/.claude/projects`) and does not start with a `claude.folderPrefixes` entry (worktree folders). A session counts only while its process runs, and its working folder must be inside a root. Three rules decide that. (1) On Windows a Git Bash path such as `/c/Users/x/shadow-jog` is the same folder as `C:/Users/x/shadow-jog`. (2) The shell goes back to the folder where Claude was launched (`cwd` in `~/.claude/sessions/<pid>.json`, often `home-base`) after tool calls, so lines that name that folder are skipped and the newest other folder decides. A session that only works in its launch folder is not Shadow Jog's when that folder is outside the roots; when the session's own folder is inside them, a reply that names the launch folder still counts for the Your move box. Two limits apply: only the newest 200 lines that have a working folder decide (an older stint is stale), and the search for another folder reads at most 256 KB of the file. The sessions list (Your move panel) has no process list, so there the newest line decides. (3) Every git worktree of `repoRoot` (`git worktree list`, asked again every 30 seconds) counts as a root, so sessions in sibling worktrees show. If git fails, only `roots` count. A label such as "1 script run hidden" means `claude.includeSdk` is `false`. |
| The Agents page shows the label "Session not active" | You followed a link from Your move to a session that is not in the diagram. Its process ended, or it is not active (rule R42). The page opens and does not scroll. Check Your move again. |
| The label "Process list unavailable" | The agents module cannot read the folder `claude.sessionsRoot` (it is missing or unreadable), or none of its files has the keys the module needs. The page falls back to the file ages: a session that works (wrote within `claude.workingSeconds`) or waits for Mark (up to `claude.waitingSeconds`) counts as active. Check the folder and the config key. |
| The Status strip says "Milestone key missing" or "Unknown milestone" | `status.md` has no `milestone:` key, or its value is not `none` or an id of the milestone table in `docs/engine/migration.md`. Case matters. See the `milestone:` key above. |
| The Status strip says "None active" and a finished milestone shows as current | Done squares come from `docs/roadmap/roadmap.json`. If a finished milestone shows as current, the key still names it: set `milestone:` to `none`. If a finished milestone is not filled, set its roadmap item to `done`. |
| The Status strip says Unavailable with `milestones-roadmap-unreadable` or `milestones-roadmap-missing` | `docs/roadmap/roadmap.json` is missing, is not valid JSON, or has no `items` list. Fix the file, then press Retry. |
| `/docs/decisions` shows an error that names a column | Someone edited the decision table in `docs/engine/decisions.md`. The parser finds columns by header name, so restore the named column. An error that names an id (such as `E 5`) or a verdict (such as `deferred`) means a table row or a PHASE-0.2 decision line is mistyped: fix the line. The page never drops a decision silently. |
| A doc is missing from its section, or "Other" is not empty | Add it to `nav.json` (see above). The Docs overview lists broken links and nav mistakes. |
| The Now page shows plain panels first, then glass | PlasmaUI compiles its shaders on the page's main thread, and plain panels paint first. In a headless run under software GL the block lasts about 5.5 seconds. On a real GPU it is shorter. Turn off "Glass panels" to skip it. |
| A page looks stale | The page reloads a panel when its module reports a change. If a source is quiet, press Retry on the panel, or reload the tab. |

## Hosted mode (Vercel, revision 3)

A second way to run the site: a Vercel project with the root `tools/command-center`. It serves the built page and three functions. The local server does not run there. Design: `docs/command-center/design.md` sections 4.3, 6 and 11. This section is the setup for step 3 (the code is here; Mark creates the project). Nothing here deploys by itself.

| Function | File | What |
|---|---|---|
| `GET /api/snapshot` | `functions/snapshot.ts` | The GitHub API adapter (`src/github-api/`) as JSON. `Cache-Control: s-maxage=15, stale-while-revalidate`. |
| `GET /api/docs/<repo path>` | `functions/docs.ts` | One file from `main` of `markhazlewood42/shadow-jog`: `docs/**/*.md`, the root `*.md` files and the PNGs and SVGs under `docs/`. An SVG is sent as `image/svg+xml` with a sandbox policy and `nosniff`, so a script in it cannot run. Any other path is a 400 or 404. `s-maxage=60`. |
| `GET /api/live` | `functions/live.ts` | The `live` key from Upstash Redis, plus `reporter.state` (`online`, `offline` after 150 s, `not-running` when the key is gone). `no-store`. |

The shared code is in `src/hosted/`. The function sources are in `functions/` (`snapshot.ts`, `live.ts`, `docs.ts`). `scripts/build-functions.mjs` bundles each with esbuild into one file with every import inlined: `api/snapshot.js`, `api/live.js` and `api/docs.js`. **Those three built files are committed** and are the files Vercel runs. **After editing `functions/` or `src/`, run `node scripts/build-functions.mjs` and commit `api/*.js`.** A test (`tests/vercel-bundle.test.ts`) rebuilds into a temp folder and fails when a committed file is out of date. The build is the same on Windows and Linux (paths in the comments are relative to the package, no license comments). Why bundles: `package.json` says `"type": "module"` and our TypeScript has extensionless imports, which Vercel does not resolve when it compiles an `api/*.ts` file on its own (the first deploy failed with `ERR_MODULE_NOT_FOUND`). Why committed: Vercel finds the functions in the uploaded source before the build runs, so files made by the build are invisible to it (a try with git-ignored files failed with "The pattern `api/*.js` defined in functions doesn't match any Serverless Functions"). `vercel.json` sets the vite build (the build command is only `vite build`), `maxDuration` 30, the ignore script and two rewrites. The first sends `/api/docs/:path*` to `/api/docs?path=:path*`, because a multi-segment catch-all file (`[...path].ts`) was not matched on Vercel. The docs function reads the path from the `path` parameter or from the URL path, refuses a request where both are present and differ, and checks the result against the same allow-list. The second rewrite sends every other path except `/api/*` to the page. `scripts/vercel-ignore.mjs` skips every build unless the branch is `main` and `tools/command-center/` changed.

Environment variables of the Vercel project (set them in the Vercel settings, never in a file):

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | A fine-grained, read-only token for `markhazlewood42/shadow-jog` only |
| `KV_REST_API_URL` | The Upstash REST URL (added by the Marketplace install) |
| `KV_REST_API_READ_ONLY_TOKEN` | The Upstash read-only token (added by the Marketplace install) |

Do not keep `KV_REST_API_TOKEN` (the read-write token) in the project. The install adds it. Delete it. `/api/live` answers 500 `{"error":"misconfigured"}` while the variable exists, and logs the name of the variable. A missing variable gives 500 `{"error":"not configured"}`.

Post-deploy checks (design.md section 7), after every deploy:

1. Request the page and `/api/live` without the login cookie (`curl -i`). Both must answer 401 or redirect to the Vercel login. A 200 with the page or the JSON means the page is public: set Vercel Authentication to "All Deployments" at once.
2. Signed in, `/api/snapshot` answers 200 JSON. Two requests within 15 s: the second shows `x-vercel-cache: HIT` (the CDN cache works behind the login). If it does not, the function must cache the snapshot itself (design.md section 6, Cache).
3. Signed in, `/api/live` answers 200 with `reporter.state` `not-running` until the reporter (step 5) writes the key.
4. `/api/docs/docs/GDD.md` (a path with several segments) answers 200 `text/markdown`. `/api/docs/package.json` answers 404. `/api/docs/%2e%2e/CLAUDE.md` answers 400.
5. In the project settings, no read-write token variable exists.

Results of the deploys so far (2026-10-12): protection works (the page and every `/api` route answered a 302 to the Vercel login). Deploy 1: the functions failed with `ERR_MODULE_NOT_FOUND` (extensionless imports), and `/api/docs/docs/GLOSSARY.md` (two segments) got a platform NOT_FOUND while `/api/docs/docs` reached the function. Deploy 2 (bundles generated by the build, git-ignored): the build failed because `api/*.js` matched no function, since Vercel looks at the uploaded source. The fix is the committed bundles above. Deploy 3 (the committed bundles, deployed by CLI on 2026-10-12): with the bypass header `/api/live` 200 (`not-running`), `/api/snapshot` 200, `/api/docs/docs/GLOSSARY.md` (several segments) 200, `/api/docs/status.md` 200 and `/` 200; without it every route answered a 302 to the login. The rewrite carries a multi-segment path. The CDN cache check (check 2) is still open. Preview builds are skipped on purpose: the ignore script builds only `main`.

Local proof without a deploy: `npx vitest run tests/vercel-*.test.ts` (handlers with a fake GitHub and a fake Upstash, the path allow-list, the ignore decision, `vercel.json`, and the real function build: each built file must hold no `hono`, `chokidar`, `minisearch` or local server module, must have no relative import, and must run when it is imported in a plain Node ESM process).

## Tests

Vitest holds the units (`tests/`) and Playwright holds the browser tests (`e2e/`). Both use synthetic fixtures (`fixtures/`): a throwaway git repo, made-up Claude session files and a fake `gh`. No default test reads your real sessions or writes to GitHub, and none opens a browser tab. Never leave a server running: stop what you start, by its process id.

## Hosted page: the data layer (step 4)

The same page app runs on Vercel with no local server. The two builds differ in one place, the data layer. Code: `src/web/hosted/`. Tests: `tests/hosted-*.test.ts(x)` and `e2e/hosted/hosted.spec.ts`.

**How the page picks its mode.** A build flag, set once, when the page is built. The Vercel build runs `VITE_HOSTED=1 vite build` (`vercel.json`). `npm run cc` builds without the flag. Vite writes the value into the code, so the local build contains no hosted code and behaves as before. Why a flag and not a probe at run time: a probe needs a request before the first paint, and it cannot tell a local server that is down from a host that never had one. A wrong guess would poll the wrong endpoints and look broken. The two builds also go to two different places, so the flag cannot be wrong for the place. `CC_OUT_DIR` moves the build output (the tests of the hosted page build into `dist-hosted/`).

**What the hosted page reads.**

| Source | Poll | Used for |
|---|---|---|
| `/api/snapshot` | every 15 s | Pull requests, CI, branches, decisions, `status.md` and the milestone table, the workstream rows, the roadmap lanes |
| `/api/live` | every 10 s | Sessions and worktrees from the local reporter, and the state of the reporter |
| `/api/docs/<repo path>` | on demand, kept 60 s | One doc. The browser renders it with the renderer of the local page |

A poll runs only while the tab is visible. A hidden tab pauses the polls. A tab that shows again polls at once. The next poll starts after the last one ended, so two polls never overlap (`poller.ts`). The store (`store.ts`) keeps the last good answer of each source and sends the same `changed` events as the local event stream, so every panel reloads as before.

**Panel states.** Every panel shows the same states as on the local page: loading, error with a Retry button, stale (the error above the last good data, with its time), and empty. The error kinds:

| Case | What the page shows |
|---|---|
| 401, a redirect to the login page, or an answer that is not JSON | The banner "Login expired. Reload the page to sign in again." The panels keep their data and mark it as stale. The request uses `redirect: 'manual'`, so a redirect is not mistaken for a lost connection. |
| A lost connection, or a status such as 502 | The panel error with the status and the sentence of the function, and Retry. |
| `reporter.state` is `not-running` | "Reporter not running" on the Running panel, the Agents page and the Workstreams view. Pushed work still shows. |
| `reporter.state` is `offline` | "Reporter offline since HH:MM:SS", with the last rows shown below. |
| The `live` value breaks the contract in `src/shared/live.ts` | "The live value is unreadable" and the first problem. |

**What the hosted page does not have.**

- Decisions are read-only. The page shows the options and a note. Answering stays on the local Command Center.
- Search says "Search needs the local server."
- The Agents page lists the sessions the reporter sends, with one box for each agent: label, running or done, model family and run time (from 2026-10-14). The boxes come from `agents.items`. A reporter from before that date sends only names and counts, and the page then draws the names with the state from the counts, with no model and no time. Message lines between agents and the Copy path button stay local, because the reporter sends no session file path and no message. The label of an agent is the description that a prompt gave it. It is redacted like a title and cut to 80 characters, so it can still hold a file path or an email address that the redaction does not catch. Run times on the hosted page use the clock of the viewer against the start time that the reporter wrote, so a viewer clock that is off shows a wrong time.
- The docs navigation lists the files and pages that `nav.json` names. A folder entry is left out with a note, because the page has no file list. A doc that `/api/docs` does not serve (`tools/...`) is left out with a note. Adding a file list to the snapshot is the way to close this gap.
- Doc dates show a dash unless the frontmatter has `updated`. There is no git history. Backlinks and broken-link marks need the full file list, so they are empty.
- `/docs/decisions` lists the decisions without the "changed since approval" flags. They need git.

**Workstreams (`/workstreams`).** One card for each workstream, grouped by the roadmap lane of the item that the file names. A card shows the branch, the PR with review and checks, the live sessions and worktree of the branch (matched by branch name), and the decision issues it is blocked on. A bad file is a row with its path and the error. A branch with no file (for example a bot branch) is a neutral "no workstream" row. A merged PR decides the state "merged", whatever the file says. The page hides a card 14 days after `mergedAt` (the shared `staleWorkstreamPaths`) and says how many it hid. The cards add nothing to "Your move" (a list that a session writes and leaves does not clear itself). The local build has no data for this page never (step 6 was dropped on 2026-10-12): it hides the link and the `nav.json` entry, and `/workstreams` there says that the hosted page has the view.

**The live contract.** `src/shared/live.ts` is the shape of the `live` key that the reporter of step 5 writes (`writtenAt`, `sessions`, `worktrees`: titles, names and counts only). `parseLive` refuses any other shape.

**Tests.** `npm run check` runs the unit tests. `npm run e2e` runs the local specs. `npm run e2e:hosted` builds the page with `VITE_HOSTED=1` and runs `e2e/hosted/` against `vite preview` on port 3010: each test plays the Vercel functions with `page.route()` and fails on any request to an endpoint that the hosted page should not use. Set `CC_SHOTS_DIR` to a folder outside the repo to save two pictures (the Workstreams view and an error state).

## The local reporter (step 5)

The reporter is the local server, run headless with `--reporter`. It reads the live sessions, their agents and the worktrees of this machine, and writes one JSON value to the Upstash key `live` (600 s expiry). The hosted page reads it through `/api/live`. Design: `docs/command-center/design.md` section 11.1. Code: `src/server/publish/`, `scripts/reporter-launch.mjs`, `scripts/reporter-hook.mjs`.

**What leaves this machine (the allow-list).** Per session: id, title, git branch, the NAME of the working folder (never its path), busy or idle, start time, agent names and counts, for each agent (at most 20, the running ones kept first, listed in the order of the session) its label, running or done, model family (one of `opus`, `sonnet`, `haiku` or `fable`, else none; any other model text is dropped, never cut) and start and end time (Mark approved the model family and the times on 2026-10-14, so the hosted Agents page can draw the agent boxes), and the live ask (below). Workflows are not sent as boxes, only counted and named. Per worktree: the NAME of its folder (never its path), the branch and the number of changed files. Never a prompt, a result or a file body. Of a message, only the live ask leaves, and only as follows (Mark approved this on 2026-10-13, `docs/command-center/your-move-redesign.md` section 4): for each LIVE session, at most 6 lines of its newest "Your move" box, with the time of the reply that wrote the box (`yourMove: { at, lines }`). Each line is plain text (markdown marks stripped), goes through the same secret redaction as a title, and is then cut to 160 characters. The lines are sent only when the box passes four rules: the session is live (the reporter sends only the sessions of the process list, and only from a fresh read of the sessions module), Mark has not sent a message after the box, the box does not say "Your move: nothing" and no newer box replaced it, and the box is less than 12 hours old. Otherwise `yourMove` is `null`. Nothing else of any message is sent: not the light, not the other lines, not the text around the box. `map.ts` writes each field by hand, and `parseLive` checks the value before every write, and holds the lines to the same caps. A value that fails is never sent. The protection check (below) is unchanged: no write happens until the hosted page is confirmed as protected. A session title is the text of a prompt, so it can hold a pasted secret: `map.ts` replaces secret-shaped text in titles, in agent names and in the lines of the live ask with `[redacted]` before the 120-character (title) or 160-character (ask line) cut. It covers `ghp_`/`gho_`/`github_pat_` tokens, `sk-` keys, `sb_secret_`/`sb_publishable_` keys, `Bearer <token>`, `AKIA...` ids, `xoxb-`/`xoxp-` tokens, JWTs (`eyJ...`), `KEY=`/`TOKEN=`/`SECRET=`/`PASSWORD=` assignments, `password: x` / `pwd = x` / `api key: x` / "my token is x" in prose, `scheme://user:pass@` URLs, any run of 32 or more token characters (even all letters or all digits, so a 40 character git hash goes too), and any run of 24 or more that mixes letters and digits. A path with slashes is judged piece by piece, so a file path passes. Branch and folder names are checked the same way, but piece by piece between `-`, `_` and `/`, so a long kebab-case branch name still joins its workstream. The rules lean toward redacting: a plain title passes unchanged, and a long code-like word can be redacted by mistake.

**What it does.**

| Rule | Value |
|---|---|
| Write on change | At most once in 5 s |
| Beat | At least once in 60 s |
| Key expiry | 600 s |
| Exit | After 30 minutes with no live shadow-jog session (code 0), only when the hook started it. A reporter that the tray app started (`--manual`) has no idle exit and runs until Quit. |
| Protection check | Every 10 minutes: one request to `<hosted page>/api/live` with no cookie and no token. 401 or a redirect to the Vercel login is protected. A 200 with JSON means the page is public: it stops, deletes the key and exits with code 3. An error, a timeout or a 5xx is "no answer": one or two in a row change nothing. The third "no answer" in a row (30 minutes without a confirmation) fails closed: the reporter stops writing, deletes the key, and checks every minute until one check says protected. A protected answer resets the count. |
| Start | No write happens until one check says protected. Until then the check repeats every minute. |
| Port | 29417 (its own, far from the 3000s that dev servers and Playwright use; 3011 clashed with `PW_PORT=3011` runs). `npm run cc` stays on 3009. |

**Setup (once).**

1. Make the settings file `~/.shadow-jog-cc/upstash.env`. It lives outside every repo. Never commit it, never paste its content into a chat. It has three lines:

   ```
   KV_REST_API_URL=https://<your database>.upstash.io
   KV_REST_API_TOKEN=<the READ-WRITE token of that database>
   CC_HOSTED_URL=https://<the address of the hosted Command Center>
   ```

   `KV_REST_API_URL` is the same variable the Vercel project has. `KV_REST_API_TOKEN` is the read-write token (the one you deleted from the Vercel project). `CC_HOSTED_URL` is where the protection check looks. Without the file, or with a missing line, the reporter logs one line and does not write.
2. Start the tray app by hand: **double-click the shortcut** (step 3). It starts the reporter and the local Command Center and keeps them running until you choose Quit. The first start makes the pinned copy and installs its packages. That takes a minute or two, and the icon says "starting" meanwhile.
3. Make the shortcut once. The tray script lives in the pinned copy, which exists after the first reporter start and follows `origin/main` (see "The pinned copy"). Right-click the desktop, choose New, then Shortcut, and paste this as the target:

   ```
   powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\markh\home-base\projects\shadow-jog\.cc-reporter\pinned\tools\command-center\scripts\command-center-tray.ps1"
   ```

   Name it "Shadow Jog Command Center". It opens no window: look for a round icon in the notification area (the `^` group at the right of the taskbar). Drag the icon out of the group to keep it visible. To start it with Windows, put the same shortcut in `shell:startup`.
4. **The SessionStart hook is no longer needed.** It saw only the folder where a session started, so a session that began in `home-base` and moved into shadow-jog later never started the reporter, and the reporter then ended after 30 idle minutes (2026-10-13). Remove the `SessionStart` entry that runs `reporter-hook.mjs` from `~/.claude/settings.json` (the main session does it). `scripts/reporter-hook.mjs` stays in the repo; with the entry gone nothing runs it. If the hook still runs and starts a reporter first, the tray finds the lock, shows its icon, and a balloon tip says that a copy it did not start already runs. That reporter still has the idle exit; Restart services stops it and starts one without the idle exit. Do this step after the tray test of this README.

**The tray app (`scripts/command-center-tray.ps1`).** Windows PowerShell 5.1 with `System.Windows.Forms`; no other dependency.

| Part | Behavior |
|---|---|
| Start | Two hidden children, with their process ids in `.cc-reporter/tray.pids.json`. (1) `node reporter-launch.mjs --repo <main checkout> --manual`: the launcher with the lock, the port check and the pinned copy, and a reporter with no idle exit. (2) When the pinned copy is ready: `reporter-launch.mjs --prepare-local` (writes `.cc-reporter/local.config.json` and builds the page, like `npm run cc`), then `main.ts --config local.config.json`: the local Command Center on port 3009. It runs the code of the pinned copy with the docs and the status of your real checkout, so a branch switch cannot break it. |
| Icon | Green: both ports answer (29417 and 3009). Amber: one answers. Gray: none. The tooltip says which one is up. The poll runs every 3 s. |
| Menu | Open Command Center (http://localhost:3009). Open hosted page (`CC_HOSTED_URL` from `~/.shadow-jog-cc/upstash.env`; the script reads only that key and never logs the file). Show log (opens `reporter.log`, `tray.log` and the local server log in Notepad). Restart services. Quit. A double click opens the local page. |
| Quit and Restart | Both always run `reporter-launch.mjs --stop` first (verified stop, deletes the `live` key), also when this tray's own launcher is not running, so a reporter left by an older tray or by the hook is stopped too. Then `taskkill /PID <kept id> /T /F` for each kept child id (an exit code of 128, "no such process", is fine), then the job ends (below). Never by process name or by port. The wait runs on a timer: the icon says "stopping..." and the menu stays alive. Quit removes the icon only when the children have ended (up to about 40 s). |
| Job object | Every child, and every process that a child starts, runs in a Windows job object with `KILL_ON_JOB_CLOSE`. If the tray dies without Quit (a crash, End task in Task Manager), the system ends the whole job within a second: no reporter and no port 3009 server stay behind. No child can break away from the job. Only a child that starts a grandchild within the first milliseconds, before the tray adds it to the job, could escape; node needs far longer to start. If the job cannot be made, a balloon tip says the services are not tied to the tray. |
| Foreign copies | A reporter or a server on port 29417 or 3009 that this tray did not start (left by a tray from before this fix, or by the hook) is not touched on start. The launcher ends ("another copy already runs") and the balloon tip says so: use Restart services, which runs `--stop` and starts a fresh reporter. A foreign server on port 3009 gives a balloon tip too; the tray cannot end it (never by port or name), so end it in Task Manager (the `node` process with `local.config.json`), then use Restart services. |
| Errors | A failed page open, a failed Notepad start and a failing status poll each show an error balloon tip (the poll one at most once in 10 minutes) and a line in `tray.log`. |
| One copy | A named mutex (`Local\ShadowJogCommandCenterTray`). A second start shows a balloon tip "It already runs" and exits. The launcher lock also stops a second reporter. |
| A child ends | One balloon tip and the icon changes. It is not started again. "Restart services" starts both again. |
| Logs | `.cc-reporter/tray.log` (the tray's own lines), `reporter.log` (launcher and server), `local-server.out.log` and `local-server.err.log`, `tray-launcher.*.log`, `tray-prepare.*.log`. |

**Manual test list for the tray** (the tray is not run by the unit tests; `tests/reporter-manual.test.ts` checks the script text: that it parses, that it never kills by name, the mutex, the one read of `upstash.env`, the job object and that Quit always runs `--stop`. The job object itself was tested in isolation with a holder process that was killed; the tray window was not run. The command-center folder is outside the repo's biome config, so no lint covers the script):

1. Double-click the shortcut. A gray, then amber, then green icon appears within a few minutes (first start) or seconds. The tooltip says "reporter up, local up". http://localhost:3009 opens from the menu.
2. Start the shortcut a second time. A balloon tip says it already runs. There is still one icon.
3. Leave it for over 30 minutes with no Claude Code session. The icon stays green (no idle exit).
4. Menu, Open hosted page: the hosted page opens. Show log: up to four Notepad windows open (one for each log file that exists).
5. Menu, Restart services: the icon goes gray with the tooltip "stopping...", the menu still opens meanwhile, then it goes green again. `.cc-reporter/tray.pids.json` has new ids.
6. End the local server by its id from Task Manager (`local-server` is the `node` process with `--config ...local.config.json`). A balloon tip says it ended, the icon is amber, and nothing restarts by itself.
7. Menu, Quit. The icon disappears. Ports 29417 and 3009 no longer answer, no `node` process of the reporter is left, and `.cc-reporter/reporter.lock` is gone.
8. With the tray running, run `npm run reporter:stop`. The reporter stops, the tray shows amber and a balloon tip, and the local server keeps running.
9. Kill the tray without Quit: in Task Manager, End task on the `powershell.exe` of the tray (the one with `command-center-tray.ps1` in its command line). Within 5 seconds the icon is gone, ports 29417 and 3009 no longer answer, and no `node` process of the reporter or the local server is left. The killed launcher leaves its lock file. The new launcher checks the owner named in the lock: when that process is gone (or its pid now has another start time), it takes the lock over at once, if the reporter port is free. If the check cannot tell, the lock counts as held for 2 minutes (`LOCK_STALE_MS`), and the new launcher ends with "another copy already runs"; then wait, or use Restart services.

**The pinned copy.** `<main checkout>/.cc-reporter/pinned` is a sparse, shallow clone of `origin/main` (only `tools/command-center`). The folder is in `.gitignore`. The launcher runs `git fetch` in that clone every 2 minutes, never in your checkout. When `main` changed `tools/command-center/`, it updates the clone (and runs `npm ci` when the lock file changed) and starts the server again. So a change like the tray script reaches the pinned copy within about 2 minutes of its merge to `main`, while a launcher is running. A running tray keeps the old script and the old local server until you choose Restart services (the server restarts; to load a new tray script, Quit and start the shortcut again). Before the merge, start the tray from the worktree with `-Branch`: `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<worktree>\tools\command-center\scripts\command-center-tray.ps1" -Branch <branch>`. The tray then starts the launcher with `--branch <branch>`, and the pinned copy follows that branch. Without `-Branch` this does not work before the merge: the launcher follows `origin/main`, and the server of `main` does not know `--no-idle-exit` and ends with "Unknown option". (`node scripts/reporter-launch.mjs --branch <branch>` does the same for the reporter alone, but it has the idle exit and does not start the local server.) `-Branch` takes only letters, digits, `.`, `_`, `/` and `-`, with no leading `-`. A name that is not safe gives the "services could not start" balloon tip. Push the branch first: the copy fetches it from `origin`. After the test, the pinned copy stays on the branch until a launcher without `-Branch` runs. Its next fetch of `main` moves the copy back, but only when `tools/command-center/` differs between the two. So Quit the test tray and start the normal shortcut after the merge. Two launches at once: the second finds the lock (`.cc-reporter/reporter.lock`, touched every 30 s) or the open port and does nothing.

**Failure rules of the launcher.** Git runs without blocking, so the lock heartbeat keeps going during a long clone. The copy counts as ready only with the marker file `pinned/.cc-ready`, which is written after the clone, the checkout and `npm ci` all worked. A `.git` folder without the marker is removed and made again. When the lock file changed, the marker `pinned/.cc-needs-install` is set before the code moves and removed after `npm ci` worked, so a failed install is tried again at the next round and the server never starts with new code and old packages. With no settings file the launcher logs one line and ends: it does not fetch the copy at every session start. A server that exits by itself is never started again by the update step. `npm ci` has a limit of 5 minutes: a hung install is ended, the log says `npm ci did not finish`, the launcher ends and the lock is released (before, the heartbeat kept the lock fresh for ever). The heartbeat writes only into a lock that still names this launcher (process id and start stamp). A launcher that slept with the laptop and finds its lock taken over by another launcher stops its own server, ends, logs why, and leaves the other lock alone.

**Start, stop, look.**

| Task | How |
|---|---|
| Start | Double-click the shortcut of the tray app (setup step 3). `npm run reporter` still starts the reporter alone, with the idle exit, as the hook did. |
| Stop | `npm run reporter:stop`. It reads the process ids in the lock and kills a process only when the process start time in the lock matches the system and the command line is the launcher or the server. If it cannot verify a process, it kills nothing for it, writes the reason to the log and leaves the lock. It never kills by name. After it ended the server, it runs `main.ts --clear-live` from the pinned copy (at most 20 s), which deletes the `live` key, because a hard kill gives the server no time to do it. |
| See the log | `.cc-reporter/reporter.log` (launcher lines and server lines, each with a time; the reporter never writes a token to it) |
| Is it running? | The hosted page shows "Reporter offline" or "not running" when it is not. Or check that `.cc-reporter/reporter.lock` changed in the last minute. |
| Test a branch before the merge | `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<worktree>\tools\command-center\scripts\command-center-tray.ps1" -Branch <branch>`. The pinned copy follows `origin/main` otherwise, and the server of `main` rejects `--no-idle-exit` until the merge. The copy stays on the branch until a launcher without `-Branch` fetches `main` (see "The pinned copy"). |

**Exit codes of the server.** 0: no session for 30 minutes. 3: the hosted page was public (the key was deleted). 4: no settings file or an incomplete one. Any other code is a crash: the launcher starts the server again, at most 3 restarts in 10 minutes (the 4th crash in that time ends the launcher with code 1). Codes 0, 3 and 4 end the launcher too.

**The live key on a normal end.** The idle exit, SIGINT and SIGTERM delete the `live` key before the process exits (best effort: at most 3 s, logged on failure, so a slow store never blocks the exit). `--stop` does it through `main.ts --clear-live`. After a hard kill without `--stop` (power cut, Task Manager) the key expires by itself within 600 s. The page shows "Reporter offline" from 150 s.

**A failing source.** When the agents source cannot read the sessions, the reporter writes nothing and logs one line (it used to publish the last good sessions, which looked live). The stored value then goes stale, the page says offline, and the 30 minute idle exit still counts.

**Protection check, redirect rule.** A redirect proves protection only when the `Location` is `https://vercel.com` or a subdomain, and the path is `/login`, `/sso` or `/sso-api` (or starts with one of them), or the query has a `next` or `redirect...` parameter. Other redirects (the marketing page, a transfer page) are "no answer". No real `Location` of a protected deployment is recorded in the design, so this rule is an assumption: if a protected page stays "no answer" in the log, the log line names the place of the redirect (without its query), and the rule can be narrowed to it. A 200 with a body that is not JSON stays "no answer" and counts toward the 3-in-a-row fail-closed rule.

**Node version.** `package.json` asks for Node 24.2 or later (`engines`) for the server and the tests. The hook (`reporter-hook.mjs`), the launcher (`reporter-launch.mjs`) and the server entry (`main.ts`) no longer use `import.meta.main` (it exists from Node 24.2 only: on Node 22 the hook did nothing and logged nothing). They use `scripts/is-main.mjs` (the real path of `process.argv[1]` against the real path of the file) and `dirname(fileURLToPath(import.meta.url))`, so the hook and the launcher need only Node 20.11 or later, and the hook starts the launcher on whatever `node` the PATH of Claude Code holds. The server in the pinned copy runs with the same `node` as the launcher; below Node 24.2 it is untested.

**Tests.** `tests/publish-*.test.ts` (mapper, loop with a fake clock and store, protection check, store client, worktrees), `tests/reporter-launch.test.ts` and `tests/reporter-launch-fixes.test.ts` (lock, heartbeat, `npm ci` limit, crash cap, `--stop`, main guard, hook, config), `tests/publish-clear-live.test.ts` and `tests/reporter-main.test.ts` (the real server process against a fake store on this machine, with a temporary home folder). No test reads the real settings file or calls the real Upstash.
