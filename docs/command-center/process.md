---
type: process
title: "Shadow Jog Command Center — Build process"
project: shadow-jog
created: 2026-10-08
updated: 2026-10-08
status: record of how the Command Center was built and checked (2026-10-05 to 2026-10-08)
tags: [tooling, command-center, process]
---

# Shadow Jog Command Center — Build process

This page keeps the rules of the build for a future maintainer. The working record of the build (the ledger, the briefs and the reviews) was a git-ignored folder. Mark removed it after this page was written. The rulings it held are in `design.md`, the tool README, the code comments and the description of PR #26.

## Roles

- **Builder.** One for each task. It writes the code and the tests.
- **Runner.** A fresh verifier. It runs the checks and the E2E suite and judges the screenshots.
- **Reader.** A fresh verifier. It reads the diff and runs only the unit tests.
- **Controller.** The main session. It dispatches the work, reads the scores and pushes a task that passed.

## Rules for builders

- Write the tests first. Use the test names from the brief.
- Commit the work. Do not push.
- Stage by explicit path. Never use `git add .` or `git add -A`.
- Use synthetic fixtures only. Never read real sessions or write to GitHub in a test.
- Send screenshots to Mark at once. Delete them after the runner judges them.
- Use the test titles of the brief word for word, so a verifier can find each test.
- Run every test with `CC_NO_OPEN=1`. The end-to-end server uses port 3010. Never use ports 3002 to 3009.
- Stop only the processes that you started, by process id. Never stop a process by its name.
- Do not dispatch subagents.

## Rules for verifiers

- A verifier is read-only. It changes no file.
- It scores every criterion from 1 to 10.
- A task passes if every score is 7 or more and the average is 8 or more.
- A test with the right name that does not check the named behavior scores 5 or less.
- Good practice, not a rule: break the code on purpose in a scratch copy and check that the key tests fail.

## Fix rounds

- A task has up to 3 fix rounds.
- A fix round covers Critical and Important findings only.
- Minor findings go in the PR text.
- The controller pushes after a task passes. Only verified work reaches `origin`.

## After the last task

One fresh reviewer reads the whole branch. The review package is the commit list, the stat and the full diff, without lock files. One fix wave closes the Important findings.

## Public writes

A write to the public repo needs Mark's go-ahead. Examples are the labels `decision` and `decided` and the live answer test.

## Models

- Builders and verifiers run on Sonnet.
- Read-only work runs on Haiku.
- Do not use Opus or Fable unless Mark asks.

## Reviews of the pull request

See section 10 of `docs/DEVELOPING.md`. The workflow `claude-code-review.yml` posts a new set of comments on each push.
