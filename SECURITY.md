# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |
| < 2.0   | No        |

Fixes ship in the next patch release on npm; the Marketplace action's `v1` and `v2` tags follow the
latest release.

## Reporting a vulnerability

If you discover a security vulnerability in this project, please report it
responsibly. **Do not open a public issue.**

Use [GitHub's private vulnerability reporting](https://github.com/JosephDoUrden/vercel-seo-audit/security/advisories/new)
on this repository (Security tab, "Report a vulnerability"). If that is not an option, email the
maintainer (see the `author` field in `package.json`).

Please include:

- A description of the vulnerability
- Steps to reproduce
- The potential impact

You should receive an acknowledgement within 48 hours and an initial assessment within 7 days.
Fixes are released as soon as practical and credited in the release notes unless you prefer
otherwise. Please give us the chance to ship a fix before any public disclosure.

## Scope notes

- The CLI fetches the URL you give it and the pages it links to. It never executes page JavaScript.
- The GitHub Action passes its inputs to the CLI as arguments, never through a shell string
  (fixed in 2.5.1).
