# vercel-seo-audit

[![npm version](https://img.shields.io/npm/v/vercel-seo-audit.svg)](https://www.npmjs.com/package/vercel-seo-audit)
[![npm downloads](https://img.shields.io/npm/dm/vercel-seo-audit.svg)](https://www.npmjs.com/package/vercel-seo-audit)
[![CI](https://github.com/JosephDoUrden/vercel-seo-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/JosephDoUrden/vercel-seo-audit/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/vercel-seo-audit.svg)](./LICENSE)

> **If you're using Vercel and Google hates your site, this is for you.**

A fast, developer-friendly CLI that explains **why Google isn't indexing your Next.js site** — beyond the vague stuff in Search Console.
It detects the misconfigs that silently kill crawling and indexing: **redirect traps (308), missing robots/sitemap, noindex headers, canonical mismatches, and Vercel/Next.js quirks**.

---

## Quick start

```bash
npx vercel-seo-audit https://your-site.com
```

Install globally (optional):

```bash
npm i -g vercel-seo-audit
vercel-seo-audit https://your-site.com
```

---

## Example output

```txt
SEO Audit Report for https://example.com/
  Completed in 1118ms at 2026-01-31T12:30:54.448Z

  Summary:
    ✖ 1 error
    ⚠ 3 warnings
    ℹ 2 info
    ✔ 4 passed

  REDIRECTS
  ────────────────────────────────────────
  ✖ [ERROR] Redirect chain detected (3 hops)
    → Reduce to a single redirect: http://example.com → https://example.com/

  ROBOTS
  ────────────────────────────────────────
  ⚠ [WARNING] robots.txt not found
    → Create a robots.txt at /robots.txt

  SITEMAP
  ────────────────────────────────────────
  ⚠ [WARNING] sitemap.xml not found
    → Add app/sitemap.ts in Next.js App Router

  METADATA
  ────────────────────────────────────────
  ⚠ [WARNING] Canonical URL mismatch
    → Canonical points to https://www.example.com/ but page is https://example.com/
  ✔ [PASS] Title tag present
  ✔ [PASS] Meta description present
```

---

## Common pitfalls we catch

These are the issues that silently tank your rankings on Next.js/Vercel:

- **Next.js 308 trailing-slash traps** — `trailingSlash: true` creates 308 redirect loops that waste crawl budget and confuse Google.
- **www / non-www domain redirects** — serving the same content on both domains without a redirect splits link equity and causes duplicate-content issues.
- **Middleware rewrites & redirects affecting crawlers** — Next.js middleware can rewrite or redirect in ways that only affect bots, breaking indexing without any visible symptoms in a browser.
- **Canonical mismatch** — the `<link rel="canonical">` points to a different URL than the page actually lives at, telling Google to ignore the page.
- **Sitemap / robots issues** — missing `sitemap.xml`, empty sitemaps, robots.txt blocking Googlebot, or `Sitemap:` directive pointing to the wrong URL.

---

## Usage

```bash
# Basic audit
vercel-seo-audit https://your-site.com

# JSON output (pipe to jq, save to file, feed to CI)
vercel-seo-audit https://your-site.com --json

# Verbose mode — raw HTTP details for each finding
vercel-seo-audit https://your-site.com --verbose

# Custom timeout (default: 10s)
vercel-seo-audit https://your-site.com --timeout 15000

# Check specific pages for redirect issues
vercel-seo-audit https://your-site.com --pages /docs,/team,/careers

# Audit as Googlebot
vercel-seo-audit https://your-site.com --user-agent googlebot

# Audit as Bingbot
vercel-seo-audit https://your-site.com --user-agent bingbot

# Custom crawler user-agent
vercel-seo-audit https://your-site.com --user-agent "Googlebot-Image/1.0"

# Write report to file (json or md)
vercel-seo-audit https://your-site.com --report json
vercel-seo-audit https://your-site.com --report md

# Compare against a previous report to detect regressions
vercel-seo-audit https://your-site.com --diff previous-report.json

# Diff with JSON output
vercel-seo-audit https://your-site.com --diff previous-report.json --json

# Crawl all sitemap URLs and audit each page (default: 50 pages)
vercel-seo-audit https://your-site.com --crawl

# Crawl with a custom limit
vercel-seo-audit https://your-site.com --crawl 100
```

### Config file

Create a `.seoauditrc.json` in your project root to set defaults:

```json
{
  "url": "https://your-site.com",
  "strict": true,
  "verbose": false,
  "userAgent": "googlebot",
  "pages": ["/docs", "/team", "/careers"],
  "report": "json",
  "timeout": 15000
}
```

Then just run `vercel-seo-audit` with no arguments. CLI flags always override config values.

---

## What it checks

### Redirects

* Redirect chains & loops (homepage + common pages)
* HTTP → HTTPS redirect
* Trailing slash consistency (catches Next.js **308 traps**)
* Meta refresh redirects (`<meta http-equiv="refresh">`)
* Samples common routes: `/about`, `/contact`, `/blog`, `/pricing` (customisable with `--pages`)

### robots.txt

* Missing robots.txt
* `Disallow: /` (blocks everything)
* Googlebot-specific blocks
* Missing `Sitemap:` directive

### Sitemap

* Missing or malformed `sitemap.xml`
* Sitemap redirects (some crawlers won't follow)
* Empty sitemap / broken URLs (samples up to 10)
* Sitemap index support
* Cross-check with robots.txt `Sitemap:` directive

### Metadata

* Canonical URL presence & mismatch
* `noindex` via meta tags **and** `X-Robots-Tag` header
* Missing `title`, `description`, `charset`, `viewport`
* Open Graph basics: `og:title`, `og:description`, `og:image`
* Broken or relative `og:image` URL validation
* Twitter Card: `twitter:card`, `twitter:image` presence and validation

### Favicon

* Missing favicon entirely
* `/favicon.ico` exists but no `<link>` tag
* Conflicting favicon declarations (multiple icons)

### Structured Data

* Missing JSON-LD blocks entirely
* Invalid JSON syntax in `<script type="application/ld+json">`
* Missing `@context` or `@type` properties
* Missing required fields for known types (Article, FAQPage, Product, Organisation, etc.)

### Image SEO

* Missing `alt` attributes (accessibility + SEO)
* Empty `alt` on potentially non-decorative images
* Not using `next/image` component on Next.js sites
* Missing `loading="lazy"` on below-fold images
* Oversized images (> 200 KB via HEAD request)
* Missing `width`/`height` attributes (causes layout shift)

### Crawl Mode (`--crawl`)

When `--crawl` is enabled, every URL from the sitemap is fetched and audited for:

* Non-2xx status codes (broken pages)
* `noindex` directives (meta tag or `X-Robots-Tag` header)
* Missing `<title>` tag
* Missing meta description
* Missing or mismatched canonical URL
* Missing JSON-LD structured data

Progress is printed to stderr as each page is crawled.

### Internationalisation (hreflang)

* Missing hreflang tags entirely (informational for single-language sites)
* Invalid language/region codes
* Missing self-referencing hreflang entry
* Missing `x-default` fallback
* Duplicate hreflang values
* Missing reciprocal links (page A→B but B doesn't→A)

### Security Headers

* Missing `Strict-Transport-Security` (HSTS)
* Missing `X-Content-Type-Options: nosniff`
* Missing frame protection (`X-Frame-Options` or CSP `frame-ancestors`)
* Missing `Referrer-Policy`

### Next.js / Vercel

* Detect Vercel deployment
* Detect Next.js trailing slash redirect behaviour
* Middleware rewrite/redirect headers (best-effort)

---

## Severity & exit codes

Findings are categorised by severity:

| Icon | Severity    | Meaning                            |
| ---- | ----------- | ---------------------------------- |
| `✖`  | **error**   | Actively hurting SEO — fix now     |
| `⚠`  | **warning** | Likely causing problems — fix soon |
| `ℹ`  | **info**    | Useful context                     |
| `✔`  | **pass**    | Looks good                         |

Exit codes:

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| `0`  | No errors found (warnings/info don't fail) |
| `1`  | One or more errors found                   |
| `2`  | Crash / invalid input                      |

---

## CI / GitHub Actions

### Using the GitHub Action

```yaml
name: SEO Audit
on:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: JosephDoUrden/vercel-seo-audit@v1
        with:
          url: https://your-site.com
          strict: true
          report: json
```

All inputs:

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | yes | — | URL to audit |
| `strict` | no | `false` | Fail on warnings too |
| `user-agent` | no | — | `googlebot`, `bingbot`, or custom string |
| `pages` | no | — | Comma-separated page paths |
| `report` | no | — | Write report file: `json` or `md` |
| `crawl` | no | — | Crawl sitemap URLs (number = page limit, default 50) |
| `timeout` | no | `10000` | Request timeout in ms |
| `verbose` | no | `false` | Show detailed output |

Outputs: `exit-code`, `report-path`

### Using npx directly

```yaml
name: SEO Audit
on:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx vercel-seo-audit https://your-site.com --strict --report json
```

### Strict mode & reports in CI

Use `--strict` (`-S`) to fail CI on warnings as well as errors — useful for enforcing SEO standards on every deploy:

```bash
# Fail on any warning or error
npx vercel-seo-audit https://your-site.com --strict

# Generate a JSON report and fail strictly
npx vercel-seo-audit https://your-site.com --strict --report json

# Generate a Markdown report for PR comments
npx vercel-seo-audit https://your-site.com --report md
```

> [!TIP]
> If you want warnings to fail CI too, add a `--strict` or `-S` flag.

---

## Roadmap

### Completed

* [x] ~~`--strict` (warnings fail with exit code 1)~~
* [x] ~~`--pages` to customise sampled paths~~
* [x] ~~`--user-agent` presets (`googlebot`, `bingbot`)~~
* [x] ~~`--report` to write `report.json` / `report.md`~~
* [x] ~~GitHub Action marketplace wrapper~~
* [x] ~~`--diff` to compare two audit runs and detect regressions~~
* [x] ~~Structured data / JSON-LD validation~~
* [x] ~~`--crawl` mode to audit all pages from sitemap~~
* [x] ~~i18n / `hreflang` validation~~
* [x] ~~Image SEO checks (missing `alt`, `next/image`, lazy loading)~~
* [x] ~~Config file (`.seoauditrc.json`) for project-level defaults~~
* [x] ~~Open Graph & Twitter Card image validation ([#36](https://github.com/JosephDoUrden/vercel-seo-audit/issues/36))~~
* [x] ~~Security headers audit ([#37](https://github.com/JosephDoUrden/vercel-seo-audit/issues/37))~~

### Up next

* [ ] `--ignore` flag and `.seoauditignore` support ([#41](https://github.com/JosephDoUrden/vercel-seo-audit/issues/41)) `good first issue`
* [ ] GitHub Actions PR comment integration ([#44](https://github.com/JosephDoUrden/vercel-seo-audit/issues/44)) `good first issue`
* [ ] Performance hints (resource size, render-blocking) ([#38](https://github.com/JosephDoUrden/vercel-seo-audit/issues/38))
* [ ] HTML report format with interactive dashboard ([#39](https://github.com/JosephDoUrden/vercel-seo-audit/issues/39))
* [ ] `--fix` flag with auto-fix suggestions ([#40](https://github.com/JosephDoUrden/vercel-seo-audit/issues/40))
* [ ] Internal broken link checker ([#42](https://github.com/JosephDoUrden/vercel-seo-audit/issues/42))

### Future

* [ ] Page speed score via PageSpeed Insights API ([#43](https://github.com/JosephDoUrden/vercel-seo-audit/issues/43))
* [ ] Accessibility basics audit ([#45](https://github.com/JosephDoUrden/vercel-seo-audit/issues/45))
* [ ] Multi-URL batch auditing ([#46](https://github.com/JosephDoUrden/vercel-seo-audit/issues/46))
* [ ] Plugin system for custom audit checks ([#47](https://github.com/JosephDoUrden/vercel-seo-audit/issues/47))

---

## FAQ

**Does this replace Google Search Console?**
No — it explains & verifies the things Search Console often reports vaguely.

**Will it scan my entire site?**
No. It checks critical endpoints + samples common pages to stay fast. Use `--crawl` for a full sitemap audit.

**Does it work on non-Next.js sites?**
Yes for most checks (redirects/robots/sitemap/metadata). Some checks are Next.js/Vercel-specific.

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](./CONTRIBUTING.md) before opening a PR.

If you're looking for a place to start, check out issues labelled [`good first issue`](https://github.com/JosephDoUrden/vercel-seo-audit/labels/good%20first%20issue).

If you're reporting a false positive, include:

* the URL (or a reproducible HTML sample)
* expected behaviour
* actual output

---

## Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please).
Merge conventional commits to `main` and release-please opens a release PR that
bumps the version and updates `CHANGELOG.md`. Merging that PR creates a GitHub
Release, which triggers npm publish automatically.

See [docs/RELEASING.md](./docs/RELEASING.md) for the full process, commit
message format, and required secrets.

---

## Licence

[MIT](./LICENSE)
