# Issue triage guide

This document is for maintainers. It describes the labels used for triage and
the process for handling incoming issues.

## Labels

| Label | Colour | Description |
| ----- | ------ | ----------- |
| `bug` | red | Confirmed bug or crash |
| `enhancement` | blue | New feature or improvement request |
| `documentation` | green | Docs-only change |
| `good first issue` | purple | Simple, well-scoped — ideal for new contributors |
| `help wanted` | yellow | Maintainer would appreciate outside help |
| `false-positive` | orange | Tool reports an issue that isn't real |
| `needs-repro` | grey | Bug report needs a reproducible case before we can act |

## Triage process

1. **New issue arrives** — read it, apply the appropriate label(s).
2. **Bug?** Add `bug`. If there's no reproduction steps, add `needs-repro` and ask the reporter to include the URL + CLI output.
3. **False positive?** Add `false-positive` + `bug`. Try to reproduce locally with `--verbose`.
4. **Feature request?** Add `enhancement`. If it's small and self-contained, also add `good first issue`.
5. **Stale?** If no response after 14 days on a `needs-repro` issue, close with a comment.

## Picking up work

- Issues labelled `good first issue` are intentionally kept small. If you're a first-time contributor, start there.
- Issues labelled `help wanted` may be larger but have clear scope.
