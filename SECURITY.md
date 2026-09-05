# Security Policy

## Secrets

Never commit:

- Google Chat webhook URLs or tokens
- API keys
- firewall credentials
- internal email distribution lists
- production firewall names/IPs
- customer identifiers
- real incident data that is not approved for publication

Store runtime secrets in Apps Script **Script Properties** or another approved secret-management mechanism.

## If a webhook was exposed

Treat it as compromised. Remove it from the destination space or rotate/recreate it before publishing the repository. Removing the string from the latest commit does not remove it from Git history.

## Generated CLI

This project generates configuration text from user-provided input. The public reference implementation sanitizes CLI string fields and validates IPv4/CIDR values, but generated commands must still be reviewed under your normal change-control process.

## Reporting a vulnerability

For a public fork, configure GitHub Private Vulnerability Reporting or provide a dedicated security contact before accepting external reports.
