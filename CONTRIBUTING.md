# Contributing

Thanks for considering a contribution. Shared CI is under active development; its accepted architecture and consumer contract are the source of truth for implementation work.

## Prerequisites

- Node.js 24 (see `.nvmrc`)
- npm (ships with Node.js)
- Git

## Setup and validation

```sh
npm ci
npm run validate
```

Individual commands are documented in the [README](README.md). `npm run format` applies formatting; `npm run format:check` checks it without changing files.

## Code style and tests

Use strict TypeScript for implementation code, ESLint for linting and Prettier for formatting. Add focused Vitest tests for behavior introduced by a change. Keep unit fixtures under `fixtures/`; standalone consumer projects and the hosted validation case manifest live there too. Public caller examples live under `examples/` and are checked against the actual `workflow_call.inputs` contract. `npm run validate` runs deterministic local checks, including example/input drift, local documentation links and the hosted case manifest. These checks do not count as GitHub-hosted reusable-workflow validation.

When changing action source, run `npm run build:action`, include the generated bundle, and confirm `npm run check:action-build` passes. To qualify a change for release, make a candidate revision available in Shared CI and call `.github/workflows/node-ci.yml` from the independent `shared-ci-validation` repository using a full SHA and the cases in `fixtures/hosted-validation/cases.json`. Record each case's revision, expected and actual conclusion, summary result and run reference in `docs/github-integration-validation.md`. A deliberately failing fixture is a validation pass when its failure and diagnostic match expectation. Do not record local unit tests as hosted evidence. The release process documents candidate qualification, version tags, validation, rollback and post-release dogfooding. Contributors do not create release tags; `@main` is not a production consumer reference.

## Architecture and scope

Follow the accepted documents in `docs/`. If a change alters a public input, resolution rule, security boundary, workflow behavior or supported configuration, update the relevant consumer contract and ADR in the same change. Do not silently work around an accepted ADR; raise a focused proposal if new evidence reveals a concrete problem.

Keep changes within the current milestone. The project is intentionally not a deployment platform, framework adapter, multi-language CI system or monorepo orchestrator.

## Pull requests

- Explain the user-visible or maintenance problem and the approach.
- Include relevant tests and documentation updates.
- Run `npm run validate` and report its result.
- Keep changes focused; do not include dependency directories or secrets. The GitHub action's generated `dist/` directory is an intentional committed artifact.

There is no formal issue template or approval process yet; clear, reviewable contributions are welcome.
