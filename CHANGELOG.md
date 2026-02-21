# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [2.2.0](https://github.com/JosephDoUrden/vercel-seo-audit/compare/vercel-seo-audit-v2.1.0...vercel-seo-audit-v2.2.0) (2026-02-21)


### Features

* add performance hints audit module ([#38](https://github.com/JosephDoUrden/vercel-seo-audit/issues/38)) ([#53](https://github.com/JosephDoUrden/vercel-seo-audit/issues/53)) ([2339c03](https://github.com/JosephDoUrden/vercel-seo-audit/commit/2339c030b5ab652b3e7a6254b9a87e8ba753e632))


### Bug Fixes

* **ci:** add workflow_run fallback trigger for release-please ([6988f80](https://github.com/JosephDoUrden/vercel-seo-audit/commit/6988f806ef28fe4ffb1201e4782f4ace79b331c0))

## [2.1.0](https://github.com/JosephDoUrden/vercel-seo-audit/compare/vercel-seo-audit-v2.0.0...vercel-seo-audit-v2.1.0) (2026-02-18)


### Features

* add security headers audit module ([#51](https://github.com/JosephDoUrden/vercel-seo-audit/issues/51)) ([bd24694](https://github.com/JosephDoUrden/vercel-seo-audit/commit/bd24694136dfc88c6b0ca8d8a35e39a59cc7ee86))

## [2.0.0](https://github.com/JosephDoUrden/vercel-seo-audit/compare/vercel-seo-audit-v1.0.0...vercel-seo-audit-v2.0.0) (2026-02-18)


### ⚠ BREAKING CHANGES

* bump to first stable release. All audit modules, CLI flags, config file support, and output formats are now considered stable API.

### Features

* add --diff flag to compare audit runs ([#14](https://github.com/JosephDoUrden/vercel-seo-audit/issues/14)) ([#20](https://github.com/JosephDoUrden/vercel-seo-audit/issues/20)) ([5c190a1](https://github.com/JosephDoUrden/vercel-seo-audit/commit/5c190a1ffcbd47593246e1a8893ab2564d6cdf9f))
* add --report flag to write report.json / report.md ([#12](https://github.com/JosephDoUrden/vercel-seo-audit/issues/12)) ([36bf9b7](https://github.com/JosephDoUrden/vercel-seo-audit/commit/36bf9b7b9ff64d879534367a969b1d1bbef8877d)), closes [#10](https://github.com/JosephDoUrden/vercel-seo-audit/issues/10)
* add --strict flag to fail CI on warnings ([#5](https://github.com/JosephDoUrden/vercel-seo-audit/issues/5)) ([8fab7c3](https://github.com/JosephDoUrden/vercel-seo-audit/commit/8fab7c361ed144e9e2aa2a7564488e22f7341f73))
* add .seoauditrc.json config file support ([#30](https://github.com/JosephDoUrden/vercel-seo-audit/issues/30)) ([5c145ed](https://github.com/JosephDoUrden/vercel-seo-audit/commit/5c145ed3f0ebefeac69f24a971aadb922ed13145))
* add GitHub Action marketplace wrapper ([#13](https://github.com/JosephDoUrden/vercel-seo-audit/issues/13)) ([75cc229](https://github.com/JosephDoUrden/vercel-seo-audit/commit/75cc2299fb6575ed63fce0c131b1a5b67f4573c1)), closes [#11](https://github.com/JosephDoUrden/vercel-seo-audit/issues/11)
* add image SEO audit module ([#18](https://github.com/JosephDoUrden/vercel-seo-audit/issues/18)) ([#27](https://github.com/JosephDoUrden/vercel-seo-audit/issues/27)) ([4249f8a](https://github.com/JosephDoUrden/vercel-seo-audit/commit/4249f8aabf3eb4c27be744531a7f8fb36ff45d97))
* add Open Graph & Twitter Card image validation ([#36](https://github.com/JosephDoUrden/vercel-seo-audit/issues/36)) ([#48](https://github.com/JosephDoUrden/vercel-seo-audit/issues/48)) ([42d785e](https://github.com/JosephDoUrden/vercel-seo-audit/commit/42d785ecbc75245f9a34da9ffce61b9b2401da5c))
* comprehensive test coverage & CI/CD improvements ([#26](https://github.com/JosephDoUrden/vercel-seo-audit/issues/26)) ([4c2551c](https://github.com/JosephDoUrden/vercel-seo-audit/commit/4c2551c2ccf2b9b76e9ea36659e637173f4c9742))
* structured data, crawl mode & i18n hreflang validation ([#25](https://github.com/JosephDoUrden/vercel-seo-audit/issues/25)) ([e0e003b](https://github.com/JosephDoUrden/vercel-seo-audit/commit/e0e003bd148efd21b6d410ab869a763460838c63))


### Bug Fixes

* correct code block formatting in README.md ([75b41dd](https://github.com/JosephDoUrden/vercel-seo-audit/commit/75b41dd299ed528a05c0fa231203a985227f9e27))
* use PAT token for release-please to trigger CI checks ([c5c7a11](https://github.com/JosephDoUrden/vercel-seo-audit/commit/c5c7a11cc4ba877f1fe786e361da133624199e2f))


### Miscellaneous Chores

* release v1.0.0 ([fd2edb2](https://github.com/JosephDoUrden/vercel-seo-audit/commit/fd2edb209df7a8236e11949bb8995fb897cd603e))

## [0.5.3](https://github.com/JosephDoUrden/vercel-seo-audit/compare/vercel-seo-audit-v0.5.2...vercel-seo-audit-v0.5.3) (2026-02-18)


### Features

* add Open Graph & Twitter Card image validation ([#36](https://github.com/JosephDoUrden/vercel-seo-audit/issues/36)) ([#48](https://github.com/JosephDoUrden/vercel-seo-audit/issues/48)) ([42d785e](https://github.com/JosephDoUrden/vercel-seo-audit/commit/42d785ecbc75245f9a34da9ffce61b9b2401da5c))

## [0.5.2](https://github.com/JosephDoUrden/vercel-seo-audit/compare/vercel-seo-audit-v0.5.1...vercel-seo-audit-v0.5.2) (2026-02-18)


### Features

* add .seoauditrc.json config file support ([#30](https://github.com/JosephDoUrden/vercel-seo-audit/issues/30)) ([5c145ed](https://github.com/JosephDoUrden/vercel-seo-audit/commit/5c145ed3f0ebefeac69f24a971aadb922ed13145))

## [0.5.1](https://github.com/JosephDoUrden/vercel-seo-audit/compare/vercel-seo-audit-v0.5.0...vercel-seo-audit-v0.5.1) (2026-02-17)


### Features

* add --diff flag to compare audit runs ([#14](https://github.com/JosephDoUrden/vercel-seo-audit/issues/14)) ([#20](https://github.com/JosephDoUrden/vercel-seo-audit/issues/20)) ([5c190a1](https://github.com/JosephDoUrden/vercel-seo-audit/commit/5c190a1ffcbd47593246e1a8893ab2564d6cdf9f))
* add --report flag to write report.json / report.md ([#12](https://github.com/JosephDoUrden/vercel-seo-audit/issues/12)) ([36bf9b7](https://github.com/JosephDoUrden/vercel-seo-audit/commit/36bf9b7b9ff64d879534367a969b1d1bbef8877d)), closes [#10](https://github.com/JosephDoUrden/vercel-seo-audit/issues/10)
* add --strict flag to fail CI on warnings ([#5](https://github.com/JosephDoUrden/vercel-seo-audit/issues/5)) ([8fab7c3](https://github.com/JosephDoUrden/vercel-seo-audit/commit/8fab7c361ed144e9e2aa2a7564488e22f7341f73))
* add GitHub Action marketplace wrapper ([#13](https://github.com/JosephDoUrden/vercel-seo-audit/issues/13)) ([75cc229](https://github.com/JosephDoUrden/vercel-seo-audit/commit/75cc2299fb6575ed63fce0c131b1a5b67f4573c1)), closes [#11](https://github.com/JosephDoUrden/vercel-seo-audit/issues/11)
* add image SEO audit module ([#18](https://github.com/JosephDoUrden/vercel-seo-audit/issues/18)) ([#27](https://github.com/JosephDoUrden/vercel-seo-audit/issues/27)) ([4249f8a](https://github.com/JosephDoUrden/vercel-seo-audit/commit/4249f8aabf3eb4c27be744531a7f8fb36ff45d97))
* comprehensive test coverage & CI/CD improvements ([#26](https://github.com/JosephDoUrden/vercel-seo-audit/issues/26)) ([4c2551c](https://github.com/JosephDoUrden/vercel-seo-audit/commit/4c2551c2ccf2b9b76e9ea36659e637173f4c9742))
* structured data, crawl mode & i18n hreflang validation ([#25](https://github.com/JosephDoUrden/vercel-seo-audit/issues/25)) ([e0e003b](https://github.com/JosephDoUrden/vercel-seo-audit/commit/e0e003bd148efd21b6d410ab869a763460838c63))


### Bug Fixes

* correct code block formatting in README.md ([75b41dd](https://github.com/JosephDoUrden/vercel-seo-audit/commit/75b41dd299ed528a05c0fa231203a985227f9e27))
* use PAT token for release-please to trigger CI checks ([c5c7a11](https://github.com/JosephDoUrden/vercel-seo-audit/commit/c5c7a11cc4ba877f1fe786e361da133624199e2f))

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
