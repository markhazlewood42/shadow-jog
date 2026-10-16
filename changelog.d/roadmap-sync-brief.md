### Added
- `npm run roadmap:sync` reads the GitHub project board (user project 2) and rewrites `docs/roadmap/roadmap.json`, then regenerates the chart. It keeps hand-written fields, appends new board items, reports stale ones, and supports `--check`.
- `roadmap.json` items may carry `issue`, `title`, `boardKind`, `state`, `url`, `parent`, `group` and `decisions` fields. The chart generator ignores them.
