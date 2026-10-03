# Spikes

A spike is a small, time-boxed experiment that answers one question ("does a side-view battle look right at 480×270?") so a big change isn't committed to blind. It is throwaway by design: the code is never merged, only the answer and anything worth rebuilding properly.

Background and the decisions behind this: `docs/PHASE-0.2.md`, "Versioning and releases". Workflow: `docs/DEVELOPING.md`, section 9.

## Rules

- One spike, one branch named `spike/<topic>`, with a **draft PR that is never merged**.
- `docs/spikes/<topic>.md` is committed **before any spike code**, with the exit criteria written and dated up front. Criteria written after seeing the result don't count.
- If the spike is GO, rebuild the good parts on a normal feature branch (with a `CHANGELOG.md` entry). Large changes then land on `main` behind a query flag (like `?battle=side`) until good enough to be the default.
- If it is NO-GO or ABANDONED, fill in Result, tag the branch tip `archive/<topic>-YYYY-MM-DD`, close the draft PR and delete the branch. `main` never saw it, so nothing needs reverting.
- Tags, GitHub Releases and any deploy (including a preview URL) need Mark's explicit go-ahead.
- Spike builds run on their own origins, so their `localStorage` can't touch real saves.

## Template

Copy this into `docs/spikes/<topic>.md`.

```markdown
# Spike: <topic>

## Question
One sentence, answerable yes or no.

## Why now
What decision this unblocks, and what it costs to get it wrong.

## Time box
Hours or days, and the date the box closes. Stop at the box even if unfinished.

## Exit criteria (written before any code, dated YYYY-MM-DD)
- GO if: concrete, checkable conditions (numbers, screenshots, frame times, bundle size).
- NO-GO if: concrete conditions that end the spike.

## Steps
1. The smallest sequence that could answer the question.

## Assets and cost
Any paid generation, subscriptions, new dependencies and their size, and anything that needs Mark to buy or approve.

## Result (filled in at the end)
- Outcome: GO / NO-GO / ABANDONED
- Date:
- Numbers:
- Draft PR:
- Archive tag:
- Notes: what was learned and what to rebuild.
```
