### Added
- Command Center, hosted page: Mark answers a decision on the hosted page. The new function `POST /api/answer` writes the comment, the label swap and the close with the token of his account, so the issue ends in the state that the "Decisions for Mark" rule reads. The page shows the decision as answered at once, and a failed step names itself and offers Retry.
- Command Center: `/api/answer` writes only after it proves that the page is private. It checks the host, the same origin, a strict probe of the Vercel login, that the bypass secret is off, and that the token belongs to `markhazlewood42`. Setup: `CC_ORIGIN` in the Vercel project, and "Issues: Read and write" on the token.

### Changed
- Command Center: the rules of an answer (steps, order, checks, resume) moved to `src/server/decisions/answer-core.ts`, shared by the local `gh` executor and the hosted REST executor. The local behavior does not change.
- Command Center: the hosted page no longer says "Read-only on the hosted page". The `GITHUB_TOKEN` of the hosted project now needs write access to issues.
