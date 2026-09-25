# Examples

These examples use `OWNER` as a placeholder until the public repository identity and release exist. Replace it with the actual owner when adopting a published release.

- `consumer-ci.yml`: minimal call.
- `consumer-ci-frontend.yml`: generic frontend scripts (no framework detection).
- `consumer-ci-backend.yml`: integration command; required services remain consumer-owned.
- `consumer-ci-legacy.yml`: command overrides for existing script names.
- `consumer-ci-e2e.yml`: explicit opt-in; browsers, servers, services and artifacts remain consumer-owned.

Only inputs declared by `.github/workflows/node-ci.yml` are valid. The local contract test checks each `with:` key against that workflow. These placeholders are not hosted integration evidence.

Shared CI automatically caches supported package-manager stores using the selected lockfile. Consumers do not need cache inputs or configuration; immutable installation still runs on every invocation.
