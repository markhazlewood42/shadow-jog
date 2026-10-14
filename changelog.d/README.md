# Changelog entries

A feature PR never edits `CHANGELOG.md`. Two PRs that both add a line under `Unreleased` conflict on every merge. Each PR adds one file here instead. A release folds the files into `CHANGELOG.md`.

## The rule

1. Add `changelog.d/<branch-slug>.md`. The slug is your branch name in lowercase, with each slash turned into a hyphen (`engine-m8-cleanup.md`; the branch `spike/foo` is `spike-foo.md`).
2. Do not edit `CHANGELOG.md` in a feature PR.
3. Keep the file current while you work. One file for each branch, so two PRs never touch the same file.

## The format

Keep a Changelog 1.1.0 headings (`###`), each with at least one bullet. Use only the headings you need:

```markdown
### Added
- A new thing, in one bullet. Say what a player or a developer sees.

### Changed
- A changed thing.
  - Indented lines belong to the bullet above.

### Fixed
- A fixed thing.
```

| Heading | Use for |
|---|---|
| `### Added` | New features |
| `### Changed` | Changes to existing behavior |
| `### Deprecated` | Features that will go |
| `### Removed` | Features that went |
| `### Fixed` | Bug fixes |
| `### Security` | Security fixes |

Not allowed (the check fails):

- An empty file, or a heading with no bullet.
- A heading that is not in the table, or any heading at another level than `###`.
- An `Unreleased` heading. `CHANGELOG.md` keeps that one.
- Text that is not a heading, a bullet or an indented line under a bullet.
- A file name that is not lowercase kebab-case ending in `.md`. Any file here other than `README.md` must follow this rule, so `Foo.MD`, `notes.txt` and `x.markdown` fail the check.
- A heading with no space after the `###`.

## Commands

- `npm run changelog:check` validates every file here (`README.md` is skipped). `npm run check` runs the same check as a unit test (`tests/changelog-fold.test.ts`).
- `npm run changelog:fold -- <version> [--date YYYY-MM-DD] [--dry-run]` is for a release. It merges the bullets of all files by heading, inserts `## [<version>] - <date>` directly under `## [Unreleased]`, leaves `Unreleased` empty, and deletes the files. It fails and changes nothing if any file is bad or the folder is empty. `CHANGELOG.md` still holds some bullets under `Unreleased` from before this folder existed. Do not add to them: the fold moves them into the new section, ahead of the entry bullets. The date defaults to today in your local time zone, and it must be a real day (`2026-02-30` fails). If a delete fails part way, the script restores the files and leaves `CHANGELOG.md` as it was.

Release steps: `docs/DEVELOPING.md` section 9.
