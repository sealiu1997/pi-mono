# Changelog

## [Unreleased]

### Added

- Added the standalone `@mariozechner/pi-agent-state-self-regulation` pi package for runtime state assessment and explicit compaction profiles.
- Added generic assessment extenders so custom logic can rewrite the computed assessment and inject structured prompt fields.
- Added standalone package tests for hook registration, tool actions, script probes, and custom compaction routing.

### Changed

- Changed the package to become the canonical implementation source instead of a thin wrapper around `coding-agent`.
