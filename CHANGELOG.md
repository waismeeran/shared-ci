# Changelog

All notable changes to Shared CI will be documented here.

## [1.0.0] - 2026-09-26

First stable release. The executable implementation is validated at `cafba3a58415f84390c92085b85b61908b00c6cf`; hosted evidence is recorded in [the integration validation log](docs/github-integration-validation.md).

### Added

- Reusable Node.js/TypeScript CI workflow with Node 22, 24 and 26 support on GitHub-hosted Ubuntu, subject to the documented selectors and Corepack minimums.
- npm, pnpm and Yarn 4 resolution, pinned Corepack setup, immutable dependency installation, and lockfile-keyed package-manager store caching.
- Optional lint, typecheck, unit, integration, build and explicit opt-in E2E capabilities, with command overrides and nested working-directory support.
- Always-run GitHub job summary with capability states, setup outcomes and typed diagnostics.
- Read-only security model: `contents: read`, no inherited secrets, OIDC or write permissions, and full-SHA-pinned external workflow actions.

### V1 boundaries

- No deployment/CD, browser provisioning, database/service orchestration, secret-management abstraction, `node_modules` caching, monorepo workspace fanout, framework-specific build semantics, or automatic E2E environment provisioning.

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
