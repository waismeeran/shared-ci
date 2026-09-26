# Shared CI

Reusable GitHub Actions CI for Node.js and TypeScript repositories. Shared CI centralizes runtime and package-manager setup, immutable installation, capability orchestration, and reporting while each project keeps control of its tools and commands.

[![CI](https://github.com/waismeeran/shared-ci/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/waismeeran/shared-ci/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/waismeeran/shared-ci)](https://github.com/waismeeran/shared-ci/releases/latest)
[![MIT license](https://img.shields.io/github/license/waismeeran/shared-ci)](LICENSE)

**Stable:** `v1.0.0` · **Recommended reference:** `@v1`

## Why Shared CI?

Node.js repositories often repeat Node setup, package-manager setup, immutable installs, caching, lint, typecheck, tests, builds, and reporting in copied workflow files. Those copies drift and make shared fixes hard to roll out. Shared CI puts that orchestration in one reusable workflow and makes detected, skipped, and failed work visible.

## Quick start

Add `.github/workflows/ci.yml` to a consumer repository:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ci:
    uses: waismeeran/shared-ci/.github/workflows/node-ci.yml@v1
```

With no inputs, Shared CI discovers the project conventions and runs the available capabilities. The complete input contract is in [`workflow_call`](.github/workflows/node-ci.yml).

## What it owns

Shared CI owns runtime resolution and setup, package-manager preparation, immutable dependency installation, package-store cache orchestration, capability sequencing, diagnostics, and the GitHub job summary.

The consumer owns `package.json`, ESLint and TypeScript configuration, test frameworks, application behavior, commands, E2E services and browsers, secrets, and deployment. **Convention first. Explicit override second. Project ownership always.**

## Discovery and configuration

By default, Shared CI reads Node selectors from `.nvmrc`, `.node-version`, or `package.json` `engines.node`; otherwise it selects Node 24. It reads the manager from `package.json` `packageManager` or one supported lockfile: `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`. Pin pnpm and Yarn exactly in `packageManager`.

The capability modes are `lint`, `typecheck`, `unit`, `integration`, `build`, and `e2e`. Each accepts `auto`, `true`, or `false`: discover a conventional script, require it, or disable it. A corresponding `*-command` input overrides a project command. `working-directory` selects a project subdirectory.

The workflow inputs are `node-version`, `package-manager`, `working-directory`, the six capability modes, and `lint-command`, `typecheck-command`, `unit-command`, `integration-command`, `build-command`, and `e2e-command`.

Here is a caller that requires lint, uses a nonstandard test command, selects a nested app, and opts into E2E:

```yaml
jobs:
  ci:
    uses: waismeeran/shared-ci/.github/workflows/node-ci.yml@v1
    with:
      working-directory: apps/web
      lint: 'true'
      unit-command: npm run test:unit -- --runInBand
      e2e: 'true'
```

Capabilities run sequentially. Independent checks continue after a failure; build and E2E respect their prerequisites. Discovery (`DETECTED`, `OVERRIDDEN`, `ABSENT`, `DISABLED`) is separate from execution (`PASSED`, `FAILED`, `TIMED_OUT`, `SKIPPED`). An absent or disabled capability is not a successful execution.

## Supported environments and caching

| Area             | Supported configuration                       |
| ---------------- | --------------------------------------------- |
| Runner           | GitHub-hosted Ubuntu                          |
| Node.js          | 22, 24, and 26 with supported exact selectors |
| Package managers | npm, pnpm 9.15.4, Yarn 4.5.3                  |
| Corepack         | 0.36.0 for pnpm and Yarn                      |

Shared CI caches package-manager data (npm cache, pnpm store, or Yarn cache) using a key derived from the selected lockfile. It does not cache `node_modules`, builds, or consumer artifacts. Immutable installation runs on cache hits too.

## E2E boundary

E2E is opt-in and defaults to `false`. Shared CI runs the consumer's E2E command; the consumer provisions browsers, services, credentials, and other required environment. Shared CI does not install Playwright, Cypress, or application-specific infrastructure.

## Architecture and failure behavior

```text
Consumer workflow → reusable workflow → project discovery
  → runtime and package-manager setup → immutable install + cache
  → sequential capabilities → diagnostics and job summary
```

The summary reports setup and capability outcomes, including work not reached after an earlier failure. Check it first when a job fails; confirm the working directory contains the expected manifest and lockfile, the Node selector is supported, and required scripts exist or have command overrides.

## Validation evidence

The independent [Shared CI validation repository](https://github.com/waismeeran/shared-ci-validation) exercises the reusable workflow from a separate consumer. Its hosted cases cover Node 22/24/26, npm/pnpm/Yarn, cache miss and hit behavior, lockfile invalidation, nested working directories, custom commands, expected failures, E2E, and release references. Local unit tests and hosted consumer runs are tracked separately.

## Versioning and security

- Use `@v1` for the maintained compatible V1 channel.
- Use `@v1.0.0` to pin this concrete release.
- Use a full commit SHA for the strongest immutable reference.
- Do not use `@main` for production. Breaking workflow-contract changes require V2.

The reusable job requests only `contents: read`; it does not inherit secrets or request write or OIDC permissions. External actions are pinned to full commit SHAs. Callers should use trusted workflow triggers and must not use `pull_request_target` to run untrusted code. See [SECURITY.md](SECURITY.md).

## Development and contributing

Development uses Node.js 24 and npm. Run `npm ci` and `npm run validate`; individual checks are `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. After editing action TypeScript, run `npm run build:action` and include the generated `dist/` bundle. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Scope

V1 does not provision browsers, databases, services, deployments, or framework-specific tooling. It does not provide monorepo fanout, workspace orchestration, other language ecosystems, or self-hosted runner support. Consumers retain ownership of application behavior and environment.

## License

MIT. See [LICENSE](LICENSE).
