# vercel-seo-audit

> **If you're using Vercel and Google hates your site, this is for you.**

A fast, developer-friendly CLI that explains **why Google isn’t indexing your Next.js site** — beyond the vague stuff in Search Console.
It detects the misconfigs that silently kill crawling and indexing: **redirect traps (308), missing robots/sitemap, noindex headers, canonical mismatches, and Vercel/Next.js quirks**.

---

## Why this exists

Google Search Console often reports symptoms like:
- *“Page with redirect”*
- *“Discovered – currently not indexed”*
- *“Alternate page with proper canonical”*

…but doesn’t tell you **what’s actually wrong** or **what to change**.

`vercel-seo-audit` turns those symptoms into **actionable fixes**.

For a deeper dive into why Next.js sites often struggle with indexing, see:
- [Why Google Refuses to Index Your Next.js Site](https://dev.to/yusufhansck/why-google-refuses-to-index-your-nextjs-site-173a) (dev.to)
- [Why Google Refuses to Index Your Next.js Site](https://yusufhansacak.medium.com/why-google-refuses-to-index-your-next-js-site-04a924948859) (Medium)

---

## Quick start

```bash
npx vercel-seo-audit https://yoursite.com
```

Install globally (optional):

```bash
npm i -g vercel-seo-audit
vercel-seo-audit https://yoursite.com
```

---

## Example output

```txt
SEO Audit Report for https://yusufhan.dev/
  Completed in 1118ms at 2026-01-31T12:30:54.448Z

  Summary:
    ⚠ 2 warnings
    ℹ 1 info
    ✔ 1 passed

  ROBOTS
  ────────────────────────────────────────
  ⚠ [WARNING] robots.txt not found
    → Create a robots.txt at /robots.txt

  SITEMAP
  ────────────────────────────────────────
  ⚠ [WARNING] sitemap.xml not found
    → Add app/sitemap.ts in Next.js App Router
```

---

## Usage

```bash
# Basic audit
vercel-seo-audit https://yoursite.com

# JSON output (pipe to jq, save to file, feed to CI)
vercel-seo-audit https://yoursite.com --json

# Verbose mode — raw HTTP details for each finding
vercel-seo-audit https://yoursite.com --verbose

# Custom timeout (default: 10s)
vercel-seo-audit https://yoursite.com --timeout 15000

# Check specific pages for redirect issues
vercel-seo-audit https://yoursite.com --pages /docs,/team,/careers

# Audit as Googlebot
vercel-seo-audit https://yoursite.com --user-agent googlebot

# Audit as Bingbot
vercel-seo-audit https://yoursite.com --user-agent bingbot

# Custom crawler user-agent
vercel-seo-audit https://yoursite.com --user-agent "Googlebot-Image/1.0"

# Write report to file (json or md)
vercel-seo-audit https://yoursite.com --report json
vercel-seo-audit https://yoursite.com --report md
```

---

## What it checks

### Redirects

* Redirect chains & loops (homepage + common pages)
* HTTP → HTTPS redirect
* Trailing slash consistency (catches Next.js **308 traps**)
* Meta refresh redirects (`<meta http-equiv="refresh">`)
* Samples common routes: `/about`, `/contact`, `/blog`, `/pricing` (customizable with `--pages`)

### robots.txt

* Missing robots.txt
* `Disallow: /` (blocks everything)
* Googlebot-specific blocks
* Missing `Sitemap:` directive

### Sitemap

* Missing or malformed `sitemap.xml`
* Sitemap redirects (some crawlers won’t follow)
* Empty sitemap / broken URLs (samples up to 10)
* Sitemap index support
* Cross-check with robots.txt `Sitemap:` directive

### Metadata

* Canonical URL presence & mismatch
* `noindex` via meta tags **and** `X-Robots-Tag` header
* Missing `title`, `description`, `charset`, `viewport`
* Open Graph basics: `og:title`, `og:description`, `og:image`

### Favicon

* Missing favicon entirely
* `/favicon.ico` exists but no `<link>` tag
* Conflicting favicon declarations (multiple icons)

### Next.js / Vercel

* Detect Vercel deployment
* Detect Next.js trailing slash redirect behavior
* Middleware rewrite/redirect headers (best-effort)

---

## Severity & exit codes

Findings are categorized by severity:

| Icon | Severity    | Meaning                            |
| ---- | ----------- | ---------------------------------- |
| `✖`  | **error**   | Actively hurting SEO — fix now     |
| `⚠`  | **warning** | Likely causing problems — fix soon |
| `ℹ`  | **info**    | Useful context                     |
| `✔`  | **pass**    | Looks good                         |

Exit codes:

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| `0`  | No errors found (warnings/info don’t fail) |
| `1`  | One or more errors found                   |
| `2`  | Crash / invalid input                      |

---

## CI / GitHub Actions

Fail the build only when **errors** exist:

```yaml
name: SEO Audit
on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx vercel-seo-audit https://yoursite.com --json
```
>[!TIP]
>If you want warnings to fail CI too, add a `--strict` or `-S` flag.

---

## Roadmap

* [x] ~~`--strict` (warnings fail with exit code 1)~~
* [x] ~~`--pages` to customize sampled paths (`/about,/pricing`)~~
* [x] ~~`--user-agent` presets (`googlebot`, `bingbot`)~~
* [x] ~~`--report` to write `report.json` / `report.md`~~
* [ ] GitHub Action marketplace wrapper

---

## FAQ

**Does this replace Google Search Console?**
No — it explains & verifies the things Search Console often reports vaguely.

**Will it scan my entire site?**
No. It checks critical endpoints + samples common pages to stay fast.

**Does it work on non-Next.js sites?**
Yes for most checks (redirects/robots/sitemap/metadata). Some checks are Next.js/Vercel-specific.

---

## Contributing

PRs welcome. If you’re fixing a false positive, include:

* the URL (or a reproducible HTML sample)
* expected behavior
* actual output

---

## License

MIT
