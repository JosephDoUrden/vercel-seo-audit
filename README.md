# vercel-seo-audit

> If you're using Vercel and Google hates your site, this is for you.

CLI tool that diagnoses SEO and indexing issues for Next.js/Vercel websites. Catches the problems that tank your search rankings — broken redirects, missing sitemaps, noindex tags you forgot about, and Vercel-specific quirks that silently kill your crawl budget.

## Install

```bash
npx vercel-seo-audit https://yoursite.com
```

Or install globally:

```bash
npm i -g vercel-seo-audit
vercel-seo-audit https://yoursite.com
```

## Usage

```bash
# Basic audit
vercel-seo-audit https://yoursite.com

# JSON output (pipe to jq, save to file, feed to CI)
vercel-seo-audit https://yoursite.com --json

# Verbose mode — shows raw details for every finding
vercel-seo-audit https://yoursite.com --verbose

# Custom timeout (default: 10s)
vercel-seo-audit https://yoursite.com --timeout 15000
```

## What it checks

### Redirects
- Redirect chains and loops on your homepage
- HTTP → HTTPS redirect presence
- Trailing slash consistency (catches Next.js 308 traps)
- Meta refresh redirects in HTML
- Redirect chains on common pages (`/about`, `/contact`, `/blog`, `/pricing`)

### Robots.txt
- Missing robots.txt
- `Disallow: /` blocking all crawlers
- Googlebot-specific blocks
- Missing `Sitemap:` directive

### Sitemap
- Missing or malformed `sitemap.xml`
- Sitemap redirects (some crawlers won't follow)
- Empty sitemaps
- Broken URLs inside the sitemap (samples up to 10)
- Sitemap index support
- Cross-reference with robots.txt `Sitemap:` directive

### Metadata
- Missing or mismatched canonical URL
- `noindex` in meta tags and `X-Robots-Tag` header
- Missing charset, viewport, title, description
- Open Graph tags: `og:title`, `og:description`, `og:image`

### Favicon
- Missing favicon entirely
- `/favicon.ico` exists but no HTML `<link>` tag
- Multiple conflicting favicon declarations

### Next.js / Vercel
- Vercel deployment detection
- Next.js 308 trailing slash behavior
- Middleware rewrite/redirect headers
- App Router metadata presence

## Output

Findings are categorized by severity:

| Icon | Severity | Meaning |
|------|----------|---------|
| `✖` | **error** | Actively hurting your SEO — fix immediately |
| `⚠` | **warning** | Likely causing problems — should fix |
| `ℹ` | **info** | Worth knowing, may or may not need action |
| `✔` | **pass** | Looks good |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | No errors found (warnings/info don't count) |
| `1` | One or more errors found |
| `2` | CLI crash or invalid input |

Useful for CI pipelines:

```bash
vercel-seo-audit https://yoursite.com --json || echo "SEO issues found"
```

## Requirements

Node.js >= 18 (uses native `fetch`).

## License

MIT
