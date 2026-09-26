# Shared CI

Reusable GitHub Actions CI for Node.js and TypeScript projects. Shared CI handles runtime and package-manager setup, immutable dependency installation, and sequential capability execution. Your repository owns its commands, application configuration, and test infrastructure.

## Use Shared CI

Create `.github/workflows/ci.yml` in your repository:

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

V1 inputs are `node-version`, `package-manager`, `working-directory`; capability modes `lint`, `typecheck`, `unit`, `integration`, `build`, `e2e`; and corresponding `lint-command`, `typecheck-command`, `unit-command`, `integration-command`, `build-command`, `e2e-command` overrides. Modes accept `auto`, `true`, or `false`. Defaults are `node-version: auto`, `package-manager: auto`, `working-directory: .`, all capability modes `auto` except `e2e: false`, and empty command overrides. Inputs omitted above use these defaults. The complete input names and defaults are defined by [`workflow_call`](.github/workflows/node-ci.yml).

With no inputs, Shared CI selects Node 24 unless a numeric version is declared in `.nvmrc`, `.node-version`, or `package.json` `engines.node`. It selects the package manager from `package.json` `packageManager` or a single supported lockfile (`package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`); pin pnpm and Yarn exactly in `packageManager`. Each detected capability defaults to `auto`; set a mode to `true` to require it or `false` to disable it. Command overrides let a consumer use a nonstandard script. `working-directory` selects a project subdirectory. Capabilities run sequentially; independent checks continue after a failure, while build runs only when its prerequisites pass.

Discovery (`DETECTED`, `OVERRIDDEN`, `ABSENT`, `DISABLED`) is distinct from execution (`PASSED`, `FAILED`, `TIMED_OUT`, `SKIPPED`). An absent or disabled capability is not a successful execution. The job summary reports capability and setup outcomes, including work not reached after an earlier failure.

## Supported projects

- Node.js 22, 24, and 26 on GitHub-hosted Ubuntu runners, using supported exact selectors.
- npm, pnpm 9.15.4, and Yarn 4.5.3. Corepack 0.36.0 is used for pnpm and Yarn.
- npm, pnpm, and Yarn package-manager stores/download caches are keyed from the selected lockfile. Shared CI does not cache `node_modules`, build output, or application artifacts. Immutable dependency installation runs on cache hits too.

E2E is opt-in. The consumer supplies its E2E command and provisions browsers, services, credentials, and other required environment. Shared CI only orchestrates that command. Build meaning is also consumer-owned: Shared CI runs the selected build command but does not prescribe framework-specific production behavior.

## Versioning and security

Use `@v1` for the maintained compatible V1 channel, `@v1.0.0` for this immutable release, or a full commit SHA for the strongest immutable reference. Do not use `@main` for production. Compatible changes may be released on V1; breaking workflow contract changes require V2. Consumers can roll back from `@v1` to `@v1.0.0` or a known-good full SHA.

The reusable job requests only `contents: read`. It does not inherit secrets or request write or OIDC permissions. External actions are pinned to full commit SHAs. Callers should use trusted workflow triggers and must not use `pull_request_target` to run untrusted code. See [SECURITY.md](SECURITY.md).

## Troubleshooting

Check the job summary for preflight, runtime, package-manager, install, and per-capability outcomes. Verify that the selected project directory contains its manifest and matching lockfile, that the chosen Node selector is supported, and that required conventional scripts exist (or supply a `*-command` override). A disabled or absent capability is skipped, not passed. E2E failures often require consumer-provided browser or service setup.

## Development and contributing

Development uses Node.js 24 and npm. Run `npm ci` and `npm run validate`; individual checks are `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. After editing action TypeScript, run `npm run build:action` and include the generated `dist/` bundle. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and release qualification guidance.

## Scope

V1 does not provision browsers, databases, services, deployments, or framework-specific tooling; it does not provide monorepo fanout, workspace orchestration, other language ecosystems, or self-hosted runner support. Consumers retain ownership of application behavior and environment.

## License

MIT. See [LICENSE](LICENSE).
