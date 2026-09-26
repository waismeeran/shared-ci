# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository if available. Otherwise contact the maintainer privately before disclosing details. Do not include secrets or sensitive consumer data in public issues.

## Workflow security model

The reusable job and caller examples request only `contents: read`. Shared CI does not inherit secrets or request repository write, package write, Actions write, OIDC, or deployment permissions. Consumer commands are selected from repository configuration; workflow event text is not used to construct shell commands. External actions in the reusable workflow are pinned to these full commit SHAs:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1)
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (v7.0.0)
- `actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (v6.1.0)
- `actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (v6.1.0)

Callers control workflow triggers and should not use `pull_request_target` to execute untrusted pull-request code. Consumers remain responsible for their own secrets, dependencies, and test infrastructure.
