# Contributing

Bug reports and focused pull requests are welcome. For a bug, include the Shared CI reference, Node and package-manager versions, working directory, affected capability, expected and actual behavior, and a minimal reproduction repository. Do not post credentials or private consumer data in public issues. For security reports, follow [SECURITY.md](SECURITY.md).

## Local development

Use Node.js 24 and npm. Run:

```sh
npm ci
npm run validate
```

`npm run validate` checks formatting, lint, types, the generated action bundle, and tests. `npm run format` applies formatting; `npm run format:check` checks it. Add focused Vitest coverage for behavior changes. After editing action TypeScript, run `npm run build:action` and commit the generated `.github/actions/node-ci/dist/` bundle.

## Pull requests

Explain the problem, proposed change, user-visible impact, and validation performed. Keep changes focused and include relevant tests and documentation. Do not include dependency directories, credentials, or local planning files.

Changes to workflow inputs, resolution rules, security boundaries, supported configuration, or workflow behavior need explicit contract documentation and hosted validation. Breaking changes to the public workflow contract require a V2 release; compatible fixes and additions may qualify for a V1 release.

## Release qualification

Contributors do not create or move release tags. Before a maintainer publishes a candidate, validate the candidate by full commit SHA from the independent `shared-ci-validation` consumer repository across its expected success and failure cases. Record the Actions run and confirm that each observed result matches its expected result. A deliberate fixture failure is valid only when its expected failure and diagnostic are observed. Local unit tests are not a substitute for hosted reusable-workflow validation.

After qualification, the maintainer creates an immutable `v1.x.y` release tag and GitHub Release, then moves the maintained `v1` major reference to the same validated commit. The repository's dogfood workflow then exercises `@v1`; it does not replace independent candidate validation. Never move or recreate a concrete semantic release tag.

Consumers can roll back by changing `@v1` to `@v1.0.0` or a known-good full commit SHA. A maintainer may deliberately move `v1` back to a previously validated V1 release. Concrete `v1.x.y` tags remain immutable. Do not use `@main` as a production reference.
