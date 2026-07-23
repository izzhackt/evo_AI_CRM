# Security Policy

EVO Admissions Platform handles customer conversations, admissions records,
integration credentials, and production infrastructure. Report suspected
security problems privately so the team can contain them before details spread.

## Supported Code

Security fixes are maintained for:

- the current `main` branch;
- the exact commits currently deployed to EVO production; and
- an active release branch only when its pull request is still under review.

Historical branches, archived plans, old local worktrees, and unreviewed forks
are not supported release lines. If a finding affects one of them and also
affects `main` or production, report the supported impact.

## Report A Vulnerability Privately

Do not open a normal GitHub Issue, discussion, or pull request for a suspected
vulnerability. Do not paste exploit details, customer data, access tokens, or
session material into screenshots or ordinary chat.

Use this order:

1. If the repository Security tab offers a private vulnerability report or a
   draft security advisory, create the report there.
2. If that option is unavailable, contact the repository owner through an
   approved private EVO management channel and ask for a restricted security
   incident thread. Share only the request for restricted follow-up until that
   thread exists.

The report should include:

- the affected component, route, integration, or deployment;
- the commit, environment, and URL involved;
- the security impact and who could be affected;
- minimal reproduction steps or a small proof of concept;
- whether any real secret, customer record, or production session may be
  exposed; and
- containment already performed, without including the secret value itself.

The repository owner will confirm receipt, restrict access to the report, assess
severity, coordinate remediation, and decide when disclosure is safe. Response
and release timing depends on verified impact; this policy does not promise a
fixed public-disclosure date.

## Exposed Credentials Or Customer Data

Treat a suspected credential leak or unauthorized customer-data exposure as an
incident, not a routine bug. Notify an authorized owner immediately. If you own
the affected credential and are authorized to do so, revoke or rotate it at the
provider first, then record that action in the restricted incident thread.

Never commit a replacement secret. Runtime secrets belong only in ignored local
environment files, VPS secret files, encrypted application settings, or the
provider dashboard.

## Safe Research

- Do not test against production or real customer accounts without explicit
  written authorization.
- Do not access, change, download, or retain more data than needed to verify the
  issue.
- Stop when verification could disrupt service, send a real message, alter a
  lead, or expose another person's data.
- Give the team reasonable time to investigate and remediate before any public
  disclosure.

Dependency vulnerabilities should also be reported to the upstream maintainer
through that project's private process. Notify EVO privately when the
dependency is used here or creates an EVO production risk.
