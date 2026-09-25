# Shared CI

Reusable GitHub Actions CI orchestration for Node.js and TypeScript projects, designed to standardize the pipeline while leaving application commands and configuration with each project.

## Status

Shared CI is under development. The first candidate is published and an independent npm workflow has passed its install and capability baseline. The hosted matrix is still in progress, so do not adopt the placeholder examples until a release is available.

## Why Shared CI?

Repositories duplicate CI workflow maintenance, use inconsistent conventions, and can end up with green runs where optional stages silently did nothing. Shared CI aims to provide reusable orchestration and clear capability reporting while each consumer retains ownership of its application behavior and commands.

## Design principles

> Convention first, explicit override second, project ownership always.

- An absent capability is reported as absent/skipped, never passed.
- Runtime, package-manager and command resolution follow documented deterministic rules.
- The public workflow API stays small and explicit.
- Consumer repositories own application behavior, tool configuration, dependencies, secrets and E2E infrastructure.

## V1 scope under development

Node.js/TypeScript projects, npm, pnpm and Yarn 4, a reusable workflow, six optional-by-default CI capabilities with explicit overrides and requirements, deterministic runtime/package-manager setup, immutable installation, a single sequential job, and a GitHub Actions summary. See the [support policy](docs/support-policy.md) for the planned tested matrix.

The public input contract is implemented by the current reusable workflow and documented in [consumer-contract.md](docs/consumer-contract.md). The shipped inputs are `node-version`, `package-manager`, `working-directory`; six modes (`lint`, `typecheck`, `unit`, `integration`, `build`, `e2e`); and six corresponding `*-command` overrides. There is no public timeout input. A GitHub job summary reports project/runtime, setup and install outcomes, all six capabilities and typed diagnostics. Discovery (`DETECTED`, `OVERRIDDEN`, `ABSENT`, `DISABLED`) is separate from execution (`PASSED`, `FAILED`, `TIMED_OUT`, `SKIPPED`); absent or disabled work never appears passed. Lifecycle states (`NOT_RESOLVED`, `NOT_REACHED`, `NOT_EXECUTED`, `INCOMPLETE`) describe stages not reached. See [troubleshooting](docs/troubleshooting.md) for diagnostics and state meanings.

E2E is opt-in and defaults to `false`; `test:e2e` does not run unless enabled with `e2e: 'true'`. Consumers provide browsers, servers, services, databases, credentials and other E2E needs. Start with the [minimal example](examples/consumer-ci.yml), or see [frontend](examples/consumer-ci-frontend.yml), [backend](examples/consumer-ci-backend.yml), [legacy command](examples/consumer-ci-legacy.yml) and [E2E](examples/consumer-ci-e2e.yml) examples. Replace the documented `OWNER` placeholder with the actual repository owner. Stable consumers should use `@v1`, a fixed `@v1.x.y`, or a full commit SHA; do not use `@main` or `@master`.

V1 targets Node 22, 24 and 26 on Ubuntu latest, subject to the exact selector and Corepack minimums in the [support policy](docs/support-policy.md). npm, pnpm and Yarn 4 are the intended package managers. Shared CI is designed to cache each manager's package/download store using the selected lockfile; it never caches `node_modules`, and immutable installation is intended to run on every cache hit. Cache behavior is locally validated; full GitHub-hosted workflow and cache validation remain pending. See [integration validation](docs/github-integration-validation.md).

## Non-goals

V1 is not a deployment platform or CI/CD replacement. It excludes AWS/Kubernetes/cloud deployment, Docker publishing, organization rulesets and repository synchronization, security scanning platforms, coverage services, framework adapters, database/service provisioning, browser installation, workspace orchestration, other language ecosystems, and self-hosted runners.

## Architecture

- [Project definition](docs/project-definition.md)
- [Architecture](docs/architecture.md)
- [Consumer contract](docs/consumer-contract.md)
- [Architecture review](docs/architecture-review.md)
- [Architecture decision records](docs/adr/)

## Development

Development uses Node.js 24 and npm. The `.nvmrc` selects Node 24.

```sh
npm ci
npm run validate
```

Individual checks:

```sh
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:watch
```

`npm run validate` runs formatting check, lint, typecheck, checks that the committed JavaScript action matches its TypeScript sources, and runs tests. After changing action source, run `npm run build:action` and include the generated output; GitHub Actions requires the committed bundle.

## Roadmap

See the [implementation roadmap](docs/implementation-roadmap.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and contribution guidance.

## Security

The called job requests only `contents: read`; no secrets are inherited or required, and Shared CI grants no write or OIDC permissions. Callers should use trusted workflow triggers and never `pull_request_target` for untrusted code. See [SECURITY.md](SECURITY.md) and the [consumer contract](docs/consumer-contract.md).

## Security

See [SECURITY.md](SECURITY.md) for the current reporting status and security principles.

## License

MIT. See [LICENSE](LICENSE).
