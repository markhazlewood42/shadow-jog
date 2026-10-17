### Added
- The hosted Command Center sends a Content-Security-Policy header for its pages: they load only from their own origin and cannot be framed (`frame-ancestors 'none'`). The `/api` functions keep their own headers. Inline styles stay allowed (`style-src 'unsafe-inline'`), because React sets style attributes.
- A decision whose comments the snapshot could not all read (the time limit, or too many comments) shows a notice on its page, so a newer answer or question that is missing is not hidden.

### Changed
- The snapshot deadline and the hosted answer deadline read a monotonic clock, apart from the calendar clock. A snapshot that runs out of time after call 1, also in the middle of a request, returns what it has with a problem note, instead of an error.
- `AdapterError` has a `field` label for a shape problem (also for a reply with no `data`), so the log line no longer parses a message. Call 1 and its one retry are a helper without a `page!` assignment.
- The question box, the local route and the hosted function share one blank check, one length count and one control-character rule (`src/shared/types.ts`). The two messages of the question box are in the `say()` module.

### Fixed
- A question of only invisible characters (zero-width, format, bidi, filler, variation selector, blank braille) is refused on the server and in the question box, which keeps Send question disabled.
- A question with a control character shows its error before it is sent.
- "Flag again" on a hand-written `Question:` comment over 2000 characters shows a clear error that names the limit, and no longer ends in a raw 422.
