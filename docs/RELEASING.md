# Release process

This project uses [release-please](https://github.com/googleapis/release-please)
to automate versioning, changelog generation, and GitHub releases.

## How it works

1. **Merge conventional commits to `main`.**
   Release-please reads commit messages to determine what changed.

2. **Release-please opens (or updates) a release PR.**
   The PR bumps `package.json`, updates `CHANGELOG.md`, and updates the
   manifest. It stays open and accumulates changes until you're ready.

3. **Merge the release PR.**
   This creates a GitHub Release with a git tag (`vercel-seo-audit-v2.5.0`, etc.).
   Release-please bumps the `npx vercel-seo-audit@x.y.z` pin in `action.yml`
   and the `uses: JosephDoUrden/vercel-seo-audit@vercel-seo-audit-vx.y.z` line
   in `README.md` (both carry an `x-release-please-version` marker). `site/` is
   excluded from release-please, so the same `uses:` line inside the
   "GitHub Action" quick-start `<code>` block in `site/index.html` (find it with
   `grep -n 'uses: JosephDoUrden/vercel-seo-audit@' site/index.html`) is bumped
   by hand to the new tag.

4. **npm publish runs automatically.**
   The `publish` job in `release-please.yml` runs once the release exists and
   publishes with npm trusted publishing: the job authenticates through GitHub's
   OIDC token, no npm token is stored anywhere, and provenance is attached. If the
   release was created but the publish failed, run the workflow by hand
   (Actions → Release Please → Run workflow); the job skips versions that are
   already on npm.

## Commit message format

We follow [Conventional Commits](https://www.conventionalcommits.org/). The
commit type determines how the version is bumped:

| Prefix | Version bump | Example |
| ------ | ------------ | ------- |
| `feat:` | minor (0.x.0) | `feat: add image SEO audit module` |
| `fix:` | patch (0.x.y) | `fix: handle empty sitemap gracefully` |
| `feat!:` or `BREAKING CHANGE:` | major (x.0.0) | `feat!: redesign report output` |
| `chore:`, `docs:`, `test:`, `refactor:` | no release | `docs: update README` |

> **Pre-1.0 note:** While the version is below 1.0.0, release-please is
> configured with `bump-minor-pre-major` and `bump-patch-for-minor-pre-major`.
> This means breaking changes bump minor (0.x.0) and features bump patch
> (0.0.x), keeping early releases predictable.

## Required secrets

None for npm. Publishing uses a trusted publisher configured once on npmjs.com
(package → Settings → Trusted publisher → GitHub Actions, owner `JosephDoUrden`,
repository `vercel-seo-audit`, workflow `release-please.yml`, no environment).
Requires npm 11.5.1 or newer on the runner, which the job installs.

`RELEASE_PLEASE_TOKEN` (a fine-grained GitHub token) is still needed so the
release PR can trigger CI.

## Required repository permissions

The `release-please.yml` workflow needs permission to create PRs and push
commits. Ensure **Settings → Actions → General → Workflow permissions** is set
to **Read and write permissions** and **Allow GitHub Actions to create and
approve pull requests** is ticked.

## Manual release (emergency)

If you need to release without release-please:

```bash
# 1. Bump version
npm version patch  # or minor / major

# 2. Push with tag
git push origin main --tags

# 3. Create a GitHub Release from the tag
#    → then run the Release Please workflow by hand to publish
```
