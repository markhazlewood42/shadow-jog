### Added
- Command Center, hosted Agents page: one box for each agent, with the label, running or done, the model family (`opus`, `sonnet`, `haiku` or `fable`) and the run time. The reporter publishes `agents.items` for this. An older reporter still shows the agent names.

### Fixed
- Command Center: the reporter now keeps live sessions whose process file status is `shell` or `waiting` (Claude Code 2.1.299). Before, a builder session in one of these states was missing from Running.
