### Added
- Engine: a UI kit in `src/sje/ui` (`TextObject`, `NineSlice`, `ListMenu`, bar and cursor) with unit tests and a 10-cycle leak test.
- Shop, dialogue and speaker content now loads from JSON data (`src/data/shops.json`, `dialogue.json`, `speakers.json`) through loaders, with checkers. The values are the same as before.

### Changed
- Bundle budget: first play cap 395.9 to 402.1 kB, total gzip cap 456 to 462.5 kB.
