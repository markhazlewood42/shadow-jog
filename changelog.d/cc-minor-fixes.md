### Added
- The hosted Command Center sends a Content-Security-Policy header: it loads only from its own origin and it cannot be framed (`frame-ancestors 'none'`).

### Changed
- The snapshot deadline reads its own monotonic clock, apart from the calendar clock. A snapshot that runs out of time after call 1 now returns what it has, with a problem note, instead of an error.
- `AdapterError` has a `field` label for a shape problem, so the log line no longer parses a message. Call 1 and its one retry are a helper without a `page!` assignment.

### Fixed
- A question of only zero-width characters is refused on the server and in the question box, with the normal error state.
- "Flag again" on a hand-written `Question:` comment over 2000 characters shows a clear error that names the limit, and no longer ends in a raw 422.
