### Added
- Command Center: Mark can ask for more info on a decision from the hosted page, without answering. His question is a `Question:` comment and the label `needs-info`, the issue stays open, and the decision shows as "Waiting for info" until a session answers with an `Info:` comment.
  - The decision page has a separate "Ask for more info" box, a thread of questions and info as plain text, "More info posted" when a session has answered, and "Question sent, label missing" with a Retry when the label step failed.
  - The Now page splits Your move into "Waiting for you" and "Waiting for info".
  - `POST /api/answer` takes an allowlisted `action` (`answer` or `ask`), and an answer on a decision that has `needs-info` takes the label off first.
  - The rule in `CLAUDE.md` ("Decisions for Mark") tells sessions to answer asked decisions at session start.
