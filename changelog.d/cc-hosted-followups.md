### Fixed
- The hosted Command Center no longer shows "GitHub sent a reply that this server does not know" when GitHub answers the snapshot in part. The server asks again once. If the second answer is also partial, the page shows a retryable "GitHub answered in part, try again" error (503, with `Retry-After: 5`).
- The server also asks again once after a GitHub 502, 503 or 504 reply to the first snapshot call.
- The whole snapshot (every call and page) now shares one 25 second deadline, so it ends inside the 30 second limit of the Vercel function. A call is not started when the deadline has passed.
- The snapshot function writes one log line when it fails, with the error code and the field name. It never logs the token or the reply.
- The answer form on the decision page always leaves the "sending" state, even if the send throws.

### Changed
- The snapshot query reads 30 recent pull requests (was 100). It measured about 3 seconds. With fewer pull requests, the "recent PRs truncated" note can show more often.
