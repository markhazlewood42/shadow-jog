### Fixed
- The hosted Command Center no longer shows "GitHub sent a reply that this server does not know" when GitHub answers the snapshot in part. The server asks again once. If the second answer is also partial, the page shows a retryable "GitHub answered in part, try again" error (503).
- The snapshot function writes one log line when it fails, with the error code and the field name. It never logs the token or the reply.
- The snapshot function also asks again once after a GitHub 502, 503 or 504 reply, inside the time limit of the function.

### Changed
- The snapshot query is lighter: 30 recent pull requests (was 100) and 5 CI history commits (was 10). It now takes about 3 seconds (was about 6).
