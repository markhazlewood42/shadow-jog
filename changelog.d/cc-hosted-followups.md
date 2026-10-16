### Fixed
- The hosted Command Center no longer shows "GitHub sent a reply that this server does not know" when GitHub answers the snapshot in part. The server waits a second and asks again once. If the second answer is also partial, the page shows a retryable "GitHub answered in part, try again" error (503, with `Retry-After: 5`).
- The server also asks again once, after the same short wait, when GitHub answers the first snapshot call with 502, 503 or 504.
- The whole snapshot (every call and page) now shares one 25 second deadline, so it ends inside the 30 second limit of the Vercel function. When the deadline has passed, the page shows "The snapshot ran out of time before GitHub answered" (504) instead of a network error.
- The snapshot function writes one log line when it fails, with the error code and the name of the field. It never logs a value from the reply, the token or a header.
- The answer form on the decision page always leaves the "sending" state, even if the send throws.
