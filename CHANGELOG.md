# Changelog

All notable changes to Shared CI will be documented here.

## [Unreleased]

### Added

- Initial repository foundation.
- Architecture, consumer contract, support policy, roadmap and ADR documentation.
- Added the pure TypeScript metadata resolver, typed CI plan and diagnostics, project fixtures, and discovery tests.
- Added the local command execution adapter, bounded timeout handling, and execution fixtures/tests.
- Added Node runtime verification, isolated package-manager preparation, and immutable dependency-install plans and results.
- Added sequential core capability orchestration for lint, typecheck, unit, integration and build, including independent-check continuation, prerequisite-gated build, aggregate failure results and grouped workflow logs.
- Added opt-in, framework-neutral E2E command execution after the core capability sequence, with prerequisite gating, aggregate failure handling, deterministic six-capability results, and controlled E2E coverage.
- Added an always-run GitHub job summary with six-capability discovery/execution reporting, setup and immutable-install stages, typed error/warning diagnostics, partial-state handling, and actionable failure details.
- Added deterministic, zero-configuration npm, pnpm and Yarn 4 package-store caching with exact OS/architecture/manager/lockfile keys, immutable installation on hits, non-fatal cache errors and summary status.
