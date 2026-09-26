# Changelog

All notable changes to Shared CI will be documented here.

## [1.0.0] - 2026-09-26

First stable release. The executable implementation was validated at `cafba3a58415f84390c92085b85b61908b00c6cf`.

### Added

- Reusable Node.js/TypeScript CI workflow with Node 22, 24 and 26 support on GitHub-hosted Ubuntu, subject to the documented selectors and Corepack minimums.
- npm, pnpm and Yarn 4 resolution, pinned Corepack setup, immutable dependency installation, and lockfile-keyed package-manager store caching.
- Optional lint, typecheck, unit, integration, build and explicit opt-in E2E capabilities, with command overrides and nested working-directory support.
- Always-run GitHub job summary with capability states, setup outcomes and typed diagnostics.
- Read-only security model: `contents: read`, no inherited secrets, OIDC or write permissions, and full-SHA-pinned external workflow actions.

### V1 boundaries

- No deployment/CD, browser provisioning, database/service orchestration, secret-management abstraction, `node_modules` caching, monorepo workspace fanout, framework-specific build semantics, or automatic E2E environment provisioning.
