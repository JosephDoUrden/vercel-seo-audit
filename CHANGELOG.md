# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Image SEO audit module: missing `alt`, empty `alt`, `next/image` detection, lazy loading, large file sizes, missing dimensions (#18)

## [0.5.0] - 2026-01-31

### Added
- Structured data (JSON-LD) validation: missing blocks, invalid JSON, missing `@context`/`@type`, empty required fields
- Crawl mode (`--crawl`) to audit every URL in the sitemap
- i18n / hreflang validation: missing tags, invalid codes, missing self-reference, missing `x-default`, duplicates, missing reciprocal links
- Comprehensive test coverage and CI/CD improvements

## [0.4.0] - 2026-01-15

### Added
- `--diff` flag to compare audit runs and detect regressions
- `--report` flag to write `report.json` or `report.md`
- `--strict` / `-S` flag: warnings also fail with exit code 1
- `--pages` to customise sampled page paths
- `--user-agent` presets (`googlebot`, `bingbot`) and custom strings
- GitHub Action marketplace wrapper (`action.yml`)

### Fixed
- Trailing slash redirect detection for Next.js 308 responses

[Unreleased]: https://github.com/JosephDoUrden/vercel-seo-audit/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/JosephDoUrden/vercel-seo-audit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/JosephDoUrden/vercel-seo-audit/releases/tag/v0.4.0
