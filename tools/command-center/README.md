---
type: reference
title: Shadow Jog Command Center — README
project: shadow-jog
created: 2026-10-06
updated: 2026-10-06
tags: [tooling, command-center]
---

# Shadow Jog Command Center

One local website for Shadow Jog. It shows what is going on now (sessions, workflows, pull requests, CI, `status.md`), lets Mark read every doc in one place, and lets him answer design decisions. It reads the repo, `git`, `gh` and Claude Code's session files. It writes one thing: Mark's answer to a decision, as a comment and a label on a GitHub issue. The design is in `docs/command-center/design.md`.

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

Three checks run against the real repo and not against fixtures, so they run only on demand: `CC_REAL_NAV=1` (every real doc sits in a nav section, so "Other" is empty), `CC_REAL_ENGINE=1` (the engine decisions read as expected), and `CC_REAL_URL=<address>` (a Playwright check against a running server).

## The pages

| Address | What |
|---|---|
| `/` | Now: Your move, Running now, pull requests and CI, project status, links. The panels are glass (PlasmaUI) that you can drag. The "Glass panels" switch turns the glass off, which also saves the GPU while the game runs. |
| `/docs` | Every doc, in the sections of `nav.json`, with search, an outline, backlinks and a banner on a section that an open decision concerns |
| `/docs/decisions` | Every engine and Phase 0.2 decision in one table, with its status: approved, open for Mark, or changed since approval |
| `/decisions/<n>` | One decision issue, with the linked doc sections inline and the form that answers it |
| `/agents` | The Claude Code sessions of the last 7 days, with their agents and workflows |

## Config keys

All settings are in `command-center.config.json`. A path in the file is relative to the file itself (`~` is the home folder), so the file holds no machine-specific path. A wrong, missing or unknown key stops the start with a message that names it, because a typo in a safety setting must not be ignored. The loader is `src/server/config.ts`.

| Key | What |
|---|---|
| `port` | The port to listen on, 3009 |
| `repoRoot` | The Shadow Jog repo: where `git` runs and where the docs are read |
| `roots` | The folders the server may read or run commands in: the repo and the `shadow-jog-phaser` checkout |
| `githubRepo` | `owner/name` of the repo that `gh` talks to. Every `gh` call is pinned to it. |
| `approvalRef` | The commit at which Mark approved the engine design. A decision is "changed" when its text differs from its text at this commit. |
| `gameUrl` | The address of the game's dev server |
| `links` | The links of the Links panel: `{ "label": "...", "url": "..." }` |
| `claude.projectsRoot` | Where Claude Code keeps its session files (`~/.claude/projects`) |
| `claude.folders` | Session folders (by exact name) that belong to Shadow Jog: every session in them counts |
| `claude.cwdMatchFolders` | Session folders (by exact name) that mix projects, such as the home-base folder. A session counts only when the working folder of its newest line is inside a root. |
| `claude.includeSdk` | Optional, default `false`. A session whose entrypoint starts with `sdk` was started by a script (`claude -p`, the Agent SDK). Those are hidden and counted in `hiddenSdk`, which the Agents page shows. Set `true` to list them. |
| `claude.recentSeconds` | A session file older than this is left out (604800 is 7 days) |
| `claude.workingSeconds` | A session written to within this time, and not waiting for Mark, is "working" |
| `claude.waitingSeconds` | A session whose last reply ended its turn is "waiting for Mark" for this long, then "idle" |

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
| A panel says "gh is not installed" or "not signed in" | Install the GitHub CLI and run `gh auth login`, then press Retry on the panel. |
| "GitHub cannot be reached" | The network is down. The panel shows the last good data and its time. Press Retry. |
| The answer form says the label "decided" does not exist | Your answer is already posted as a comment. Create the label in GitHub (Issues, Labels), then press Retry. |
| The Agents page is empty | Check that `claude.folders` names the exact folder under `~/.claude/projects`, and that sessions are newer than `claude.recentSeconds`. A count of hidden automated runs means `claude.includeSdk` is `false`. |
| `/docs/decisions` shows an error that names a column | Someone edited the decision table in `docs/engine/decisions.md`. The parser finds columns by header name, so restore the named column. |
| A doc is missing from its section, or "Other" is not empty | Add it to `nav.json` (see above). The Docs overview lists broken links and nav mistakes. |
| The Now page shows plain panels first, then glass | PlasmaUI compiles its shaders on the page's main thread, and plain panels paint first. In a headless run under software GL the block lasts about 5.5 seconds. On a real GPU it is shorter. Turn off "Glass panels" to skip it. |
| A page looks stale | The page reloads a panel when its module reports a change. If a source is quiet, press Retry on the panel, or reload the tab. |

## Tests

Vitest holds the units (`tests/`) and Playwright holds the browser tests (`e2e/`). Both use synthetic fixtures (`fixtures/`): a throwaway git repo, made-up Claude session files and a fake `gh`. No test reads your real sessions or writes to GitHub, and none opens a browser tab. Never leave a server running: stop what you start, by its process id.
