# Security policy

Shared CI V1.0.0 is released. Security properties and supported configurations are described in the [consumer contract](docs/consumer-contract.md) and [support policy](docs/support-policy.md).

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting option on this repository if it is enabled; otherwise contact the repository maintainer privately before disclosing details. Do not include secrets or sensitive consumer data in public issues.

## Security principles

The reusable workflow and its caller examples use least-privilege `contents: read`. No secrets are inherited or required, and Shared CI grants no write, OIDC or deployment permissions. External actions in the reusable workflow are pinned to full commit SHAs and documented with their release versions. Consumer commands are configuration controlled by the consumer; workflow event text is not used to construct shell commands. Callers should use appropriate triggers and must not invoke this workflow with `pull_request_target` for untrusted code. See [the consumer contract](docs/consumer-contract.md) for the trust boundary, [integration validation](docs/github-integration-validation.md) for hosted evidence, and [troubleshooting](docs/troubleshooting.md) for typed failure diagnostics.
