# Security policy

Shared CI is under development and has no stable release yet. There are no supported release versions at this time.

## Reporting a vulnerability

Please do not publish details of a suspected vulnerability before coordinating a private disclosure. A private reporting channel has not been established because the public repository and maintainer contact are not yet finalized. The reporting channel will be documented when the public repository is created/released. Do not include secrets or sensitive consumer data in public issues.

## Security principles

The reusable workflow and its caller examples use least-privilege `contents: read`. No secrets are inherited or required, and Shared CI grants no write, OIDC or deployment permissions. External actions in the reusable workflow are pinned to full commit SHAs and documented with their release versions. Consumer commands are configuration controlled by the consumer; workflow event text is not used to construct shell commands. Callers should use appropriate triggers and must not invoke this workflow with `pull_request_target` for untrusted code. See [the consumer contract](docs/consumer-contract.md) for the trust boundary and [troubleshooting](docs/troubleshooting.md) for typed failure diagnostics. Hosted integration validation has not yet occurred.
