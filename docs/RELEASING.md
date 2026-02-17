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
   This creates a GitHub Release with a git tag (`v0.6.0`, etc.).

4. **npm publish runs automatically.**
   The `publish.yml` workflow triggers on the GitHub Release and publishes to
   npm using the `NPM_TOKEN` secret.

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

| Secret | Where | Purpose |
| ------ | ----- | ------- |
| `NPM_TOKEN` | Repository → Settings → Secrets → Actions | npm publish authentication |

The publish workflow is fork-safe — if `NPM_TOKEN` is not set, it prints a
warning and skips the publish step.

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
#    → this triggers npm publish via publish.yml
```
