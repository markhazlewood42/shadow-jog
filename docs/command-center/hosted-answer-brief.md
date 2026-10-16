---
type: design
title: "Command Center: hosted decision answers (brief)"
---

# Brief: answer decisions on the hosted Command Center

Status: DRAFT for Mark's approval, revision 3.1 (engineer verifier: round 1 6.5, fix round 2 PASS). Mark chose option B on 2026-10-16: reuse the existing fine-grained token and give it Issues write. Revision 2 (option A, a GitHub App sign-in) passed an engineer verifier. It is in the history section at the end. No code before approval.

## Goal

Mark answers a decision 100% from the hosted Command Center (Mark, 2026-10-16: "I NEVER WANT TO RUN COMMAND CENTER LOCALLY"). The issue must end in the exact state that the "Decisions for Mark" rule in `CLAUDE.md` reads as an answer:

1. A newest comment by `markhazlewood42` that starts with `Decision: <option id>.` (with an optional note).
2. A `labeled` event for `decided` with actor `markhazlewood42`.
3. The label `decision` removed, and the issue `CLOSED`.

Nobody else may answer through the hosted page. The repo is public.

## What exists today (origin/main, read 2026-10-16)

Paths are under `tools/command-center/`.

- **Local write path.** `POST /api/decisions/:n/answer` (`src/server/routes/decisions.ts:152`). The guard checks a per-run token, same-origin and JSON (`src/server/guard.ts:96`). An in-memory set refuses a second submit for the same issue (`decisions.ts:140,163`). The route re-reads the issue (`src/server/decisions/module.ts:194`), checks the option against the parsed options (`src/server/decisions/answer.ts:112`), then runs `gh issue comment`, `gh issue edit --add-label decided --remove-label decision` (first `--remove-label decided` when another account set it: `clearDecided`), and `gh issue close` (`answer.ts:64`). `nextStep` (`answer.ts:97`) resumes a partial failure without a duplicate comment. The runner allows only these three write shapes and pins `--repo` (`src/server/runner.ts:177`).
- **Hosted page.** Vercel project `shadow-jog-command-center`, root `tools/command-center`, Vite build with `VITE_HOSTED=1`, Hobby plan. Vercel Git integration deploys `main` only (`vercel.json`), so **a merge to `main` is a deploy**. URL: `the production URL of the Vercel project `shadow-jog-command-center` (the value of `CC_ORIGIN`)`. Vercel Authentication is on: `/` and `/api/snapshot` return 302 to `vercel.com/sso-api` without a cookie (checked 2026-10-16).
- **Hosted functions.** `functions/*.ts` are bundled by `scripts/build-functions.mjs` into committed `api/*.js` files. A test fails when a committed bundle is out of date. All three functions only read. `snapshot` and `docs` use `GITHUB_TOKEN`, described as "a fine-grained, read-only token for `markhazlewood42/shadow-jog` only" (`README.md:237`, `src/hosted/env.ts:6`). `live` uses the Upstash read-only token and refuses to run if a write token is in the env (`env.ts:15`).
- **Protection check.** The live reporter already has a check that a URL is protected, with a strict redirect rule (`README.md:386`: a 302 to `vercel.com` with path `/login`, `/sso` or `/sso-api`). The reporter stops when the hosted page is public.
- **Hosted fetch.** `src/web/hosted/fetch.ts:54` turns every 401 or redirect into the "Login expired" banner (the Vercel login). It is GET-only.
- **Why hosted is read-only now.** Scope only: `docs/command-center/design.md:114` and `:265`.

## Design (option B)

### Whose account writes

A fine-grained token always acts as the user who made it. `GITHUB_TOKEN` is Mark's token, so a comment or label change made with it is by `markhazlewood42`. Mark adds "Issues: Read and write" to it. Its repo scope stays `shadow-jog` only.

### The gates, in order

Vercel Authentication is the gate that says who clicked. It lets in Mark's Vercel login, and also anyone with a Shareable Link, a request with the Protection Bypass for Automation secret, and any external user Mark gives access (vercel.com/docs/deployment-protection). The function cannot read who passed it, so Mark keeps those three off (setup step 3), and the design adds checks that fail closed when the gate is gone:

1. **Host.** The `Host` header must equal the host of `CC_ORIGIN` (403 `wrong-host`, before any other work). So the probe below always tests the same host that took the request. A request on another alias or a deployment URL is refused, with the text "Answer from <CC_ORIGIN>".
2. **Protection probe.** The function requests `CC_ORIGIN + '/api/snapshot'` with no cookie, `Accept: text/html`, `redirect: 'manual'` and a 5 s timeout. It continues only on a 302 or 307 whose `Location` has host exactly `vercel.com` and a path that starts with `/sso-api`, `/sso` or `/login`. Any other answer (200, 401, another redirect, a network error, a timeout) gives 503 `protection-unproven` and no GitHub call. This is a new strict check (`isStrictVercelLogin`) next to the reporter's looser rule in `src/server/publish/protection.ts`. The reporter's rule does not change. (The reporter sends `Accept: application/json` and counts a 401 as protected. The probe must not copy that request shape: with it, a JSON 401 would make every answer 503.)
3. **Bypass secret.** If `VERCEL_AUTOMATION_BYPASS_SECRET` is set in the function env (the system variable that Vercel adds when the bypass is on; the build confirms the name in Vercel docs), the function returns 503 `bypass-on`. It checks the name only, never the value.
4. **Same-origin.** `Origin` must equal `CC_ORIGIN` exactly, and `Sec-Fetch-Site` must be present and `same-origin` (403). This stops another site in Mark's browser from posting with his Vercel cookie. (These headers are easy to forge with curl, which is why the Host check and the probe carry the weight for a non-browser caller.)
5. **JSON only.** `Content-Type: application/json` (415). A plain HTML form cannot send it.
6. **Token owner.** `GET /user` with the token must return login `markhazlewood42` and id `79615015` (Mark's numeric id). Another owner gives 500 `misconfigured`. A failed call gives 502 `github`. Both stop before any write.
7. **Fixed repo and three writes.** The repo is a constant in code. The body has only `number`, `option` and `note`. Every write goes through one `ghWrite()` gate that allows only the three method-and-path shapes below, on the constant repo (like `runner.ts` does for `gh`).

### Functions

- `POST /api/answer`, body `{ number, option, note? }`. Checks in order: method POST (405); Host (403); `Content-Type` (415); `Origin` and `Sec-Fetch-Site` (403); body limit 16 KB (413); body shape as today, with `number` a positive integer, extra fields ignored (422 for a bad shape); env config (500 `misconfigured`); bypass secret (503); protection probe (503); token owner (500 or 502); re-read the issue (below); `checkAnswer` (404 for a PR, a missing issue, or an issue not by Mark; 409; 422); the writes with `nextStep` resume (502 with `{ ok: false, step, error }`). Response `Cache-Control: no-store`.
- **Time.** Each GitHub call has a 10 s timeout. The whole request has a 25 s deadline (`maxDuration` is 30 s). On the deadline the function stops before the next write and returns 502 with the step, so a Retry resumes.
- **Re-read.** Reuse the existing GraphQL read in `src/github-api/` (the path that `snapshot` uses). It already pages comments and reads `LABELED` events, and maps them to the shapes that the parser uses. Cap: 10 pages of each. If the cap is hit, return 502 `too-many` and write nothing.
- **Fail closed on config.** If `GITHUB_TOKEN` or `CC_ORIGIN` is absent, or `CC_ORIGIN` is not an `https` origin without a path, the answer function returns 500 `misconfigured` with no GitHub call. Checked in `src/hosted/env.ts`.
- `snapshot` and `docs` do not change. They still make only GET calls. Their comments and the README stop saying the token is read-only.

### Shared answer logic

Split `src/server/decisions/answer.ts` into:

1. **A pure core**: `checkAnswer`, `nextStep`, the comment format, the `clearDecided` rule. No I/O.
2. **Two executors** with the same three-write interface (comment, label edit, close):
   - the local `gh` executor (today's code, behavior unchanged, runner whitelist unchanged);
   - a hosted REST executor with the constant repo and exactly three writes: `POST .../issues/{n}/comments`, the label changes (`DELETE .../labels/decided` first when `clearDecided` applies, then `POST .../labels` for `decided` and `DELETE .../labels/decision`), and `PATCH .../issues/{n}` with `state: closed`. A 404 on `DELETE` of a label that is not on the issue counts as done.

### Page

- The hosted decision page shows the existing `AnswerForm`. It posts to `/api/answer` through a new `postHostedJson` helper in `src/web/hosted/fetch.ts`. A redirect or a 401 stays the Vercel "Login expired" banner, as for reads.
- New error text: 503 says "Not answered: the page could not prove that it is private. Nothing was written." 500 `misconfigured` says "Not answered: the hosted setup is incomplete." 403 `wrong-host` says "Answer from <CC_ORIGIN>." 502 names the step that failed and offers Retry. Other errors as today.
- On success the page shows the answer from the answer response at once. The snapshot can lag up to about 15 s (CDN cache), so the page does not wait for it.
- The "Read-only on the hosted page" notice (`DecisionPage.tsx:106`) goes.
- The submit button is disabled while a request runs. On failure the form keeps the choice and note and offers Retry, as today.
- **Concurrent submits.** Functions have no shared memory and this brief adds no store, so the local 409 for a second submit cannot be copied. The disabled button and the `nextStep` re-read stop almost all doubles. Two tabs that submit in the same second can post two identical comments. The read rule still reads one answer (the newest `Decision:` comment), so this is accepted.

### What stays at risk (accepted by choosing B)

- Anyone who passes Vercel Authentication can answer as Mark: Mark's Vercel login, and also a holder of a Shareable Link or an external user given access, if Mark ever makes one. The function cannot see these. Setup step 3 keeps them off. The automation bypass is refused by gate 3.
- The token with Issues write sits in Vercel for its whole life, and `snapshot` and `docs` now hold a write-capable token too (they still make only GET calls). A leak of it lets the holder write issues and comments on `shadow-jog` as Mark, outside this page. Keep an expiry on the token.
- The probe and the Host check together cover only `CC_ORIGIN`. A request on any other host is refused (fail closed).
- **Rollback.** Revert the PR (the merge redeploys the old read-only page), and set Issues back to read-only on the token.

## Hard pass lines

Tests mock GitHub and the probe. No test calls real GitHub. A test uses a sentinel token value, for example `github_pat_SENTINEL_DO_NOT_LEAK`.

1. **Answer.** On the hosted build, with the probe protected and the token owner correct, pick an option and submit: the mock receives, in order, one comment `Decision: <id>. <note>`, the label changes (add `decided`, remove `decision`) and one close, all on the constant repo. The page shows the decision as answered.
2. **clearDecided.** When `decided` was set by another account, the executor removes it first, then adds it (one remove call before the add).
3. **Protection off.** The probe gets a 200, a 401, a redirect to `evil.vercel.com/sso-api` or to `vercel.com/` with a `next=` query, a network error, or a timeout: 503, and no GitHub call of any kind.
4. **Probe shape.** The mock sees the probe request with no `Cookie` header, `Accept: text/html`, and manual redirects. A probe answer of a JSON 401 (the reporter's case) gives 503, not success.
5. **Host.** A request whose `Host` is not the host of `CC_ORIGIN` (another alias, a deployment URL): 403 `wrong-host`, no probe and no GitHub call.
6. **Bypass on.** `VERCEL_AUTOMATION_BYPASS_SECRET` set: 503 `bypass-on`, no GitHub call.
7. **Cross-site.** A missing or foreign `Origin`, a missing `Sec-Fetch-Site`, or one other than `same-origin`: 403, no probe and no GitHub call. A non-JSON body: 415.
8. **Token owner.** `GET /user` returns another login, or the right login with another id: 500 `misconfigured`. `GET /user` fails or times out: 502. No write in any case.
9. **Fixed repo.** A test sends extra fields (`repo`, `owner`, `labels`) and checks that the mock sees only the constant repo and the three write shapes. A unit test of `ghWrite()` refuses any other method or path.
10. **Re-read.** An issue with more than 100 comments and events reads correctly (paging). The page cap gives 502 `too-many` with no write. A PR number, a missing issue, or an issue not by Mark gives 404 with no write.
11. **Rules as local.** Unknown option 422, an answered or closed issue 409, a failed step returns 502 with its step name, the page shows the step and Retry, and the Retry resumes without a second comment.
12. **Config.** `GITHUB_TOKEN` absent, `CC_ORIGIN` absent, or `CC_ORIGIN` with a path or `http`: 500 `misconfigured`, no GitHub call.
13. **No leak.** A test with the sentinel token checks every response body and every logged line for it. A build check scans every file of the hosted build output and of `api/*.js` for `github_pat_`, `ghp_` and `X-CC-Token`, and fails on a match. The answer response carries `Cache-Control: no-store`.
14. **Page states.** 503, 500, 403 `wrong-host` and 502 show their texts. A redirect or a 401 still shows "Login expired". The form keeps its values after any failure. Checked in headless Playwright at 1280 px and 390 px.
15. **No regressions.** The bundle freshness test passes with the new `api/answer.js`. The existing hosted e2e and unit tests pass. The old check "the hosted build has no `/answer` string" (`e2e/hosted/hosted.spec.ts:362-373`) is replaced by checks 1 to 14, not deleted without a replacement. Local `e2e/decisions.spec.ts` and the reporter protection-check tests pass unchanged.
16. **Live acceptance (Mark, after the deploy).** Mark answers one real decision on the hosted page. Then the two read commands from `CLAUDE.md` return his comment and his `labeled decided` event. This is the only proof of the real attribution, because no session may post a `Decision:` comment.

## Files the build touches

- New: `functions/answer.ts` and its committed `api/answer.js`; its entry in the list of `scripts/build-functions.mjs`; the REST executor with `ghWrite()`; the probe with `isStrictVercelLogin`.
- Changed: `src/server/decisions/answer.ts` (core plus gh executor), `src/server/publish/protection.ts` (exports the strict check beside the reporter's rule, which does not change), `src/github-api/` (a read of one issue for the answer, if the snapshot read cannot be reused as is), `src/hosted/env.ts` (`CC_ORIGIN`, bypass check, token comment), `src/hosted/http.ts` (the comment at line 33 that says the functions only read), `src/web/hosted/fetch.ts`, `src/web/decisions/DecisionPage.tsx` and `AnswerForm.tsx`, `e2e/hosted/mock-api.ts`, `e2e/hosted/hosted.spec.ts`, unit tests.
- `vercel.json`: the rewrite of everything to `/index.html` must not catch `/api/answer`.

## Docs to change in the same PR

`docs/command-center/design.md` (lines 114 and 265, plus a short section on the hosted write, its gates and the accepted risks), `tools/command-center/README.md` (the `GITHUB_TOKEN` row, the new `CC_ORIGIN` row, the post-deploy check, the one-URL limit of `CC_ORIGIN`), the "Workstream file" rule in `CLAUDE.md` ("Mark answers a decision on its GitHub issue"), a `changelog.d/<branch>.md` entry, and the branch's workstream file.

## Verification (lean loop: write path and trust rule)

Three fresh verifiers against these pass lines, each with the engineer pack through `/verifier-persona`:

- A runner (Sonnet, effort medium): runs `tsc` and `biome lint` (judged by exit code), the hosted build, the function bundle build, the touched unit and e2e specs, the bundle freshness test, and a headless run at 1280 px and 390 px.
- A reader (Sonnet, effort medium): the diff has a trust rule, which a Haiku reader can miss.
- An attacker (Sonnet, effort medium): tries to post cross-site, skip or fool the probe, change the repo, add a fourth write, and leak the token.

## What Mark must do (after approval, before the merge)

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → open the token that the Command Center uses → Edit.
   - Repository access: keep "Only select repositories" with `shadow-jog` only.
   - Repository permissions → Issues → Read and write. Leave the other permissions as they are.
   - Check the expiry date. Keep an expiry.
   - Save. An edit should keep the token value (not proven in GitHub docs). If GitHub shows you a new value, put it into the Vercel `GITHUB_TOKEN` variable.
2. Vercel → project `shadow-jog-command-center` → Settings → Environment Variables, Production: add `CC_ORIGIN` with the hosted URL, no trailing slash. Env vars apply only to a new deploy, so set it before the merge.
3. Vercel → project `shadow-jog-command-center` → Settings → Deployment Protection. Check:
   - Vercel Authentication is on, for all deployments, production included.
   - No Shareable Links exist.
   - Protection Bypass for Automation is off.
   - No external users have access.
   - After any change here, redeploy. The bypass variable is seen only by a new deployment.
4. Do not paste a token into chat, issues or commits.

## Where to build

The `projects/shadow-jog` checkout is busy (another session, branch `roadmap-sync-brief`). This needs a decision from Mark: wait for that build, or build in a temporary worktree (his rule: no extra worktree folders without his yes). The merge of the PR deploys, so the merge is Mark's deploy go-ahead.

## Named Minor fixes for the build (fix round 2)

- Parse the env config first: a missing or bad `CC_ORIGIN` gives 500 `misconfigured` before the Host compare.
- Each call timeout is the smaller of 10 s and the time left. Refuse to start a write with less than 5 s left.
- The probe path must be exactly `/sso-api`, `/sso` or `/login`, or one of them followed by `/` (so `/ssoX` fails).
- Pass line 13 forces the error paths (a GitHub 401, a 502 body, a thrown error) and spies on the console. `ghWrite()` pins the `PATCH` body to `{ state: "closed" }`.
- Add the new executor files to the bundle test's FORBIDDEN check where it applies.

## Out of scope

Other write actions on the hosted page. Changes to the local CC behavior. Changes to Vercel Authentication. A shared store for locks. CSP and frame-ancestors headers on the hosted page (named for a later PR, attacker finding M1).

## History

- Revision 1 (option A, GitHub App sign-in): engineer verifier round 1, 7.0, five Majors.
- Revision 2 (option A, fixes): fix round 2 PASS.
- Revision 3 (option B, Mark's choice on 2026-10-16): Mark asked why the page needs an app when it already calls the GitHub API. Answer: the API is the same. The app only proves who clicked. Mark chose to keep Vercel Authentication as the gate for who clicked. This revision adds the protection probe and the token-owner check so the write fails closed when that gate is gone. Engineer verifier round 1: 6.5, five Majors (probe request shape, no Host check, Vercel bypass paths, re-read path, weak pass lines), all fixed in revision 3.1.
