# vercel-seo-audit

[![npm version](https://img.shields.io/npm/v/vercel-seo-audit.svg)](https://www.npmjs.com/package/vercel-seo-audit)
[![npm downloads](https://img.shields.io/npm/dm/vercel-seo-audit.svg)](https://www.npmjs.com/package/vercel-seo-audit)
[![CI](https://github.com/JosephDoUrden/vercel-seo-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/JosephDoUrden/vercel-seo-audit/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/vercel-seo-audit.svg)](./LICENSE)

See your site the way Googlebot does: no JavaScript, no source, just what the server sent. The deepest Next.js and Vercel indexing checks of any audit tool.

> **If you're using Vercel and Google hates your site, this is for you.**

A CLI that explains **why Google isn't indexing your Next.js site**, from what the deployed site sends back. Two of its checks are not in other SEO audit tools:

* **Preview deployments left indexable.** A `*.vercel.app` URL served without `x-robots-tag: noindex` or a robots meta `noindex` (`VERCEL_PREVIEW_INDEXABLE`): an error on branch URLs, which are always previews, and a warning on other generated URLs, which may be production.
* **Metadata streamed into `<body>`.** Next.js 15.2 and later stream dynamic `generateMetadata` output into `<body>` for every user agent not on their HTML-limited bot list, so a crawler that reads only `<head>` and does not run JavaScript sees no title, description or canonical. The page is fetched once more as a bot on that list to confirm (`METADATA_STREAMED_TO_BODY`, `METADATA_NOT_IN_HEAD`, `METADATA_IN_HEAD`).

Beyond those, the audit covers redirect chains and loops, the trailing-slash 308, robots.txt (including rules that keep Googlebot from the page's scripts and stylesheets, `ROBOTS_BLOCKS_RENDER_ASSETS`), the sitemap, `noindex` headers, canonical mismatches, Open Graph, favicons, JSON-LD, hreflang, images, security headers, performance hints, Vercel CDN cache headers and Vercel or Cloudflare challenge pages on the page, robots.txt or the sitemap (`EDGE_CHALLENGE`), canonical, social card, hreflang and JSON-LD URLs that point at localhost or a `vercel.app` host (`URL_HOST_LOCALHOST`, `URL_HOST_VERCEL_APP`, `URL_HOST_MISMATCH`), pages that answer Googlebot, an HTML-limited bot or another crawler differently from the default user agent (`UA_STATUS_DIFFERS`, `UA_METADATA_DIFFERS`, `UA_CACHE_DIFFERS`, `UA_SIZE_DIFFERS`), unknown paths that answer 200 or redirect instead of 404 (`SOFT_404`, `NEXTJS_ERROR_SHELL`), with `--crawl` to run the page checks over every sitemap URL. The 17 modules are listed under [Running some modules only](#running-some-modules-only).

---

## Quick start

```bash
npx vercel-seo-audit https://your-site.com
```

![vercel-seo-audit running against a live site, with the redirect, sitemap, structured data and streamed-metadata modules](./docs/demo.gif)

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

- **Trailing-slash 308s** — Next.js answers the other form of every URL (with or without the slash, as set by `trailingSlash` in `next.config.js`) with one 308. That is one redirect per URL, not a loop, and it is reported as info; it costs a hop on every page when your sitemap, canonicals or inbound links use the form that redirects.
- **www / non-www domain redirects** — serving the same content on both domains without a redirect splits link equity and causes duplicate-content issues.
- **Middleware rewrites & redirects affecting crawlers** — Next.js middleware can rewrite or redirect in ways that only affect bots, breaking indexing without any visible symptoms in a browser.
- **Canonical mismatch** — the `<link rel="canonical">` points to a different URL than the page actually lives at, telling Google to ignore the page.
- **Sitemap / robots issues** — missing `sitemap.xml`, empty sitemaps, robots.txt blocking Googlebot, or `Sitemap:` directive pointing to the wrong URL.

---

## For coding agents

[AGENTS.md](./AGENTS.md) is written for Claude Code, Cursor, Codex and the like. The short version:

```bash
# One line of JSON: findings sorted by severity, each with its fix text
npx vercel-seo-audit https://your-site.com --format agent

# What a code means, which module reports it and under which category
npx vercel-seo-audit explain NOINDEX_DETECTED
```

`--format agent` is the stable contract for agents. `--json` is the full report dump and can change shape between releases.

### Install as an agent skill

The repo ships an [Agent Skill](./skills/vercel-seo-audit/SKILL.md) that tells the agent when to run the audit, where in a Next.js app each finding is fixed, and to re-run after you deploy. It works with Claude Code, Codex, Cursor, Gemini CLI, Copilot and the other agents the `skills` CLI supports:

```bash
npx skills add JosephDoUrden/vercel-seo-audit
```

In Claude Code you can install it as a plugin instead:

```
/plugin install vercel-seo-audit --marketplace JosephDoUrden/vercel-seo-audit
```

### Use as a library

The package also exports the audit itself, for tools such as an MCP server that would rather not spawn the CLI:

```ts
import { runAudit, formatAgent, getExitCode, VERSION } from 'vercel-seo-audit';

const report = await runAudit('https://your-site.com', { only: ['robots', 'sitemap', 'metadata'] });
const exitCode = getExitCode(report.summary, false);
console.log(formatAgent(report, { version: VERSION, exitCode }));
```

`runAudit` takes the CLI's options (`timeout`, `pages`, `userAgent`, `crawl`, `ignore`, `only`, `skipPacks`) and `signal`, and returns the full report that `--json` prints. It applies the same private-address guard as the CLI: when the audited URL is public, no redirect, sitemap entry or crawled link can send a request to localhost, a private range or a cloud metadata address, whether written as an address or as a name that resolves to one. Pass `maxHtmlBytes` to read less of each page than the default 10 MiB (sitemaps keep their 50 MB cap); memory grows with the page, so a service auditing pages it does not control may want it lower. Pass `signal` to cancel an audit: every request in flight is aborted, no new one starts, and `runAudit` rejects with an error named `AbortError` rather than returning a partial report.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);
await runAudit('https://your-site.com', { signal: controller.signal });
```

`diffReports`, `describeCode`, `ISSUE_CODES`, `MODULE_IDS` and the report types are exported too. The package is ESM only.

---

## Usage

```bash
# Basic audit
vercel-seo-audit https://your-site.com

# JSON output (pipe to jq, save to file, feed to CI)
vercel-seo-audit https://your-site.com --json

# Compact JSON for coding agents: no pass findings, no prose, --diff nested under "diff"
vercel-seo-audit https://your-site.com --format agent

# Explain an issue code (unknown codes exit 2 with the three closest)
vercel-seo-audit explain VERCEL_PREVIEW_INDEXABLE

# Verbose mode — raw HTTP details for each finding
vercel-seo-audit https://your-site.com --verbose

# Custom timeout per request (default: 10s), covering every redirect hop and the body
vercel-seo-audit https://your-site.com --timeout 15000

# Check specific pages for redirect issues
vercel-seo-audit https://your-site.com --pages /docs,/team,/careers

# Audit as Googlebot
vercel-seo-audit https://your-site.com --user-agent googlebot

# Audit as Bingbot
vercel-seo-audit https://your-site.com --user-agent bingbot

# Custom crawler user-agent
vercel-seo-audit https://your-site.com --user-agent "Googlebot-Image/1.0"

# Write report to file (json, md, or html)
vercel-seo-audit https://your-site.com --report json
vercel-seo-audit https://your-site.com --report md
vercel-seo-audit https://your-site.com --report html

# Compare against a previous report to detect regressions
vercel-seo-audit https://your-site.com --diff previous-report.json

# Diff with JSON output
vercel-seo-audit https://your-site.com --diff previous-report.json --json

# Crawl all sitemap URLs and audit each page (default: 50 pages)
vercel-seo-audit https://your-site.com --crawl

# Crawl with a custom limit
vercel-seo-audit https://your-site.com --crawl 100

# Ignore issue codes you have accepted (comma-separated, repeatable)
vercel-seo-audit https://your-site.com --ignore ROBOTS_MISSING,FAVICON_MISSING

# Run only some audit modules (comma-separated, repeatable)
vercel-seo-audit https://your-site.com --only vercel,streamedMetadata

# Leave out a module pack on a site that is not on Vercel or not Next.js (vercel, nextjs)
vercel-seo-audit https://your-site.com --skip-pack vercel

# List the modules with their pack and how many codes each reports
vercel-seo-audit explain --modules

# Print starter files for findings that have one, and write them with --apply
vercel-seo-audit https://your-site.com --fix
vercel-seo-audit https://your-site.com --fix --apply
```

`--fix` has a file for three findings: `public/robots.txt` for `ROBOTS_MISSING`, `public/sitemap.xml` for `SITEMAP_MISSING` and a `next.config.js` with `trailingSlash: true` for `NEXTJS_TRAILING_SLASH_308`. `--apply` asks before writing and never overwrites a file that exists.

Every JSON report carries a `page` object describing the up-front fetch of the audited URL:
`{ "status": 200, "finalUrl": "https://your-site.com/", "nextjs": true }`. `status` and
`finalUrl` are those of the last response after redirects, and both are `null` when the request
failed; `nextjs` is `true` when that response has the `x-powered-by: Next.js` header or Next.js
build markers in its HTML. A non-2xx response keeps its status, so an unreachable or blocked page
reads differently from one that is simply not Next.js.

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
  "timeout": 15000,
  "ignore": ["ROBOTS_MISSING", "FAVICON_MISSING"],
  "only": ["metadata", "vercel"],
  "format": "text"
}
```

Then just run `vercel-seo-audit` with no arguments. CLI flags always override config values; `format` is `text` or `agent`, and `--json` on the command line beats a `format` set here.

### Ignoring findings

Codes you have chosen to live with can come from three places, and the tool uses all of them together:

* `--ignore ROBOTS_MISSING,FAVICON_MISSING` on the command line
* a `.seoauditignore` file in the current directory, one code per line, `#` starts a comment
* the `ignore` array in `.seoauditrc.json`

```
# .seoauditignore
ROBOTS_MISSING
HSTS_MISSING  # set at the CDN, not by the app
```

Codes match exactly, case included. An unknown code stops the run with exit code `2` and names the file or flag it came from.

Ignored findings do not count towards the summary or the exit code. The text report hides them unless you pass `--verbose`, where they carry an `(ignored)` tag; JSON, Markdown and HTML reports keep them with `"ignored": true` or the same tag. `--fix` skips them. `--diff` still lists them, tagged, so a code you have just started ignoring does not show up as resolved.

### Running some modules only

`--only` (or the `only` array in `.seoauditrc.json`) runs just the modules you name. The page itself is still fetched once and shared, so `--only streamedMetadata` costs at most two requests: the page, and the same page again as an HTML-limited bot when its metadata is streamed. `--only` on the command line replaces `only` in the config rather than adding to it.

| Module | Pack | What it checks |
|--------|------|----------------|
| `robots` | generic | robots.txt |
| `redirects` | generic | Redirect chains, trailing slash, www and the `--pages` paths |
| `sitemap` | generic | sitemap.xml and a sample of its URLs; adds `robots` |
| `metadata` | generic | Title, description, canonical, `noindex`, Open Graph and Twitter Card |
| `favicon` | generic | Favicon file and `<link>` tags |
| `nextjs` | nextjs | Next.js and Vercel detection, trailing slash and middleware headers |
| `structuredData` | generic | JSON-LD |
| `i18n` | generic | hreflang |
| `images` | generic | Image `alt` text, `next/image`, lazy loading and sizes |
| `security` | generic | Security headers |
| `performance` | generic | Performance hints |
| `vercel` | vercel | Vercel CDN cache headers and indexable preview URLs |
| `streamedMetadata` | nextjs | Metadata streamed into `<body>` by Next.js 15.2+ |
| `hostLeak` | generic | Canonical, social card, hreflang and JSON-LD URLs on localhost or a vercel.app host |
| `uaParity` | generic | What the page serves to Googlebot, an HTML-limited bot and another crawler, against the default user agent |
| `soft404` | generic | What a path that does not exist answers: 404, a 200, a redirect or the Next.js error shell; adds `robots` and `sitemap` |
| `crawl` | generic | Sitemap URLs up to the `--crawl` limit (default 50); adds `robots` and `sitemap` |

A module that reads another one's results brings it along: `--only sitemap` also runs `robots`, so the robots.txt cross-check still happens, and `--only crawl` runs `robots` and `sitemap` first. `--only` without `crawl` turns crawling off even if `--crawl` is set (a warning says so); naming `crawl` turns it on, with the `--crawl` limit or the default of 50. Ids match exactly, case included, and an unknown one stops the run with exit code `2`.

A limited run says so: the text, Markdown and HTML reports print a `Modules:` line, and the JSON report gains an `only` array listing the modules that ran. With `--diff`, the previous report is compared on the same modules, so findings from modules you did not run are not shown as resolved.

#### Module packs

Every module is tagged with a pack. Generic modules read any site. The `vercel` pack (`vercel`) checks Vercel's CDN headers and preview URLs, and the `nextjs` pack (`nextjs`, `streamedMetadata`) checks Next.js behaviour. `--skip-pack vercel,nextjs` (repeatable, or the `skipPacks` array in `.seoauditrc.json`, which the flag replaces) leaves those modules out, and `--format agent` lists them under `skipped`. A module you name in `--only` still runs, with a note on stderr. The JSON report gains a `skippedByPack` array, and `--diff` leaves those modules out of the comparison. `vercel-seo-audit explain --modules` prints each module with its pack and how many codes it reports.

---

## What it checks

### The audited page

The page is fetched once before any module runs.

* Not reachable at all (DNS, TLS, refused connection, timeout): one `TARGET_UNREACHABLE` error
  with the underlying message in `details.error`. No module runs, and the CLI exits with `2`.
  A redirect loop, or more than 20 redirects, is not that: the modules run and `redirects`
  reports it
* A 4xx or 5xx status: `TARGET_HTTP_ERROR` (error, `details.status`). The modules still run.
  An edge challenge page is reported as `EDGE_CHALLENGE` instead
* A 2xx response that is not HTML (`content-type` other than `text/html` or
  `application/xhtml+xml`) or has an empty body: `TARGET_NOT_HTML` (warning). The modules that
  read HTML are skipped; `robots`, `redirects`, `sitemap`, `nextjs`, `security`, `vercel` and
  `crawl` still run. A response without a `content-type` is read as HTML
* Bodies are cut at 10 MiB, sitemaps at 50 MB (Google's sitemap limit). Googlebot itself reads
  only the first 2 MB of an HTML file. The audited page, a sitemap or a crawled page cut that
  way gets `RESPONSE_TOO_LARGE` (warning, `details.bytes` from `content-length`), and the
  checks read the part that came in

### Redirects

* Redirect chains & loops (audited page + common pages)
* The audited URL itself redirecting to another host or path (`TARGET_REDIRECTED`; info for a www/apex hop only), since every other check then describes the destination
* HTTP → HTTPS redirect
* Trailing slash: whether the other form of the URL redirects, and with which status (Next.js uses a 308)
* Meta refresh redirects (`<meta http-equiv="refresh">`)
* Samples common routes: `/about`, `/contact`, `/blog`, `/pricing` (customisable with `--pages`)

### robots.txt

* Missing robots.txt
* `Disallow: /` (blocks everything)
* Googlebot-specific blocks
* Missing `Sitemap:` directive
* Which AI crawlers may fetch the site root (`AI_CRAWLER_ACCESS`, info), in three columns:
  training (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`), search
  (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`) and user fetch (`ChatGPT-User`,
  `Claude-User`, `Perplexity-User`). Each crawler follows its own group, or `*` when it has none.
  `Content-Signal:` lines are copied into the details. Blocking training crawlers is your call
  and is not flagged.
* An AI search crawler blocked while Googlebot is allowed (`AI_SEARCH_BOT_BLOCKED`, warning): the
  site drops out of AI search answers, usually as a side effect of blocking AI bots wholesale.
  Both read robots.txt only; an edge rule such as the Vercel AI Bots managed ruleset or a
  Cloudflare bot setting can block crawlers whatever robots.txt says, and the audit cannot see it.

### Sitemap

* Missing or malformed `sitemap.xml`
* Sitemap redirects (some crawlers won't follow)
* Empty sitemap / broken URLs (samples up to 10)
* Sitemap index support
* Cross-check with robots.txt `Sitemap:` directive
* URLs and child sitemaps on another host (`SITEMAP_CROSS_HOST_URLS`, warning, with the count
  and up to five examples). They are never fetched, sampled or crawled. `http` and `https` on
  the same host count as the same host, and so does the host the page or the sitemap
  redirected to
* Strict validation the way Google reads the file: unescaped `&` or `<`, unclosed tags and
  undeclared entities (`SITEMAP_MALFORMED_XML`), more than 50,000 URLs in one file
  (`SITEMAP_TOO_MANY_URLS`), relative `<loc>` values (`SITEMAP_RELATIVE_URLS`), `lastmod`
  values that are not W3C Datetime (`SITEMAP_LASTMOD_INVALID`), every `lastmod` on the same
  second, which is what `new Date()` in `app/sitemap.ts` produces (`SITEMAP_LASTMOD_IDENTICAL`),
  `priority` or `changefreq`, which Google ignores (`SITEMAP_IGNORED_FIELDS`), and an index
  that lists another index (`SITEMAP_INDEX_NESTED`)
* A sitemap that parses with every sampled URL answering, or an index that parses:
  `SITEMAP_FOUND` (pass). `SITEMAP_MISSING` is only ever the failure

Wherever the audit follows a URL it did not get from you (redirect hops, child sitemaps,
crawled pages, `og:image` / `twitter:image` / `<img>` probes, hreflang alternates), it refuses
loopback, private, link-local, reserved and cloud-metadata addresses such as `169.254.169.254`,
IPv6 forms that carry one included, unless the audited URL is itself on one (auditing
`http://localhost:3000` still works). A literal address is refused before any request. A name
is checked when the connection is made: if any address it resolves to is private the request
fails, and a lookup that fails is an error too, so a name that resolves differently from one
request to the next is caught as well. Because only a literal private host or `localhost`
counts as a local audit, a site on a private DNS name (`http://intranet.example/`) is refused;
audit it by `localhost` or its address.

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
* JSON-LD present: `JSONLD_FOUND` (pass), with the declared types in `details.types`.
  `JSONLD_MISSING` is only ever the failure

### Image SEO

* Missing `alt` attributes (accessibility + SEO)
* Empty `alt` on potentially non-decorative images
* Not using `next/image` component on Next.js sites
* Missing `loading="lazy"` on below-fold images
* Oversized images (> 200 KB via HEAD request)
* Missing `width`/`height` attributes (causes layout shift)

### Unknown paths (soft 404)

Up to three GETs for paths that cannot exist, under the origin the audited page settled on:
a random 32-character hex path, a random slug under the parent path the sitemap uses most
(`/blog/<slug>` when it lists `/blog/a` and `/blog/b`), and, only when both of those answer
200, a random `.html` name to tell a catch-all rewrite apart. Skipped when the audited page
did not answer 2xx HTML.

* 404 or any other 4xx: `SOFT_404_NONE` (pass), with every probe in `details.probes`
* 200 with a robots `noindex` meta or `X-Robots-Tag`: `SOFT_404_NOINDEX` (info). This is the
  App Router calling `notFound()` after streaming has started: the 200 has already been sent,
  so Next.js renders the not-found UI with `noindex` instead
  ([discussion #100192](https://github.com/vercel/next.js/discussions/100192)). Google will
  not index it, but still fetches it
* 200 without `noindex`: `SOFT_404` (error), with `details.title` and `details.looksLikeErrorPage`
* 200 with the empty Next.js error document (`<html id="__next_error__">`, or a bare `__next`
  root and no `<title>`): `NEXTJS_ERROR_SHELL` (error); see
  [issue #99287](https://github.com/vercel/next.js/issues/99287)
* A redirect to another page: `SOFT_404_REDIRECT` (warning). Google asks sites not to
  redirect to the home page in place of a 404. A hop that only adds a trailing slash or
  ends in a 404 does not count
* 5xx: `SOFT_404_SERVER_ERROR` (warning)

### Crawl Mode (`--crawl`)

When `--crawl` is enabled, every URL from the sitemap is fetched and audited for:

* Non-2xx status codes (broken pages)
* `noindex` directives (meta tag or `X-Robots-Tag` header)
* Missing `<title>` tag
* Missing meta description
* Missing or mismatched canonical URL
* Missing JSON-LD structured data
* Canonical tags in `<head>` that name different URLs (`CRAWL_PAGE_CANONICAL_MULTIPLE`), and a
  relative canonical or one with a fragment (`CRAWL_PAGE_CANONICAL_RELATIVE`). The canonical
  target is not fetched per page
* hreflang tags that do not include the page itself (`CRAWL_PAGE_HREFLANG_MISSING_SELF`). The
  x-default and reciprocal checks stay on the entry page
* Images with no `alt` attribute, with the count (`CRAWL_PAGE_IMAGES_MISSING_ALT`)
* A missing `og:title` or `og:image`, one finding per page (`CRAWL_PAGE_OG_MISSING`)
* A title, description or canonical only in `<body>` for the audit's user agent
  (`CRAWL_PAGE_METADATA_IN_BODY`). There is no second request as an HTML-limited bot per page, so
  streamed Next.js metadata and tags that never reach `<head>` read the same here

Across the crawled pages that answered 2xx:

* Pages sharing a `<title>` (`CRAWL_DUPLICATE_TITLES`) or a meta description
  (`CRAWL_DUPLICATE_DESCRIPTIONS`): one finding per shared value, up to 10, each listing up to 10 URLs
* A canonical that points at another crawled page whose own canonical names a third URL
  (`CRAWL_CANONICAL_CHAIN`)

Each page is still fetched once. Progress is printed to stderr as each page is crawled.

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

### Performance Hints

* HTML document size (warning > 1 MB, info > 500 KB)
* Render-blocking `<script>` tags in `<head>` without `async`/`defer`
* Large inline `<style>` blocks (> 50 KB)
* Missing `<link rel="preconnect">` for third-party origins
* Indexed elements past Googlebot's 2 MB (`HTML_PAST_GOOGLEBOT_LIMIT`, error). Googlebot reads
  the first 2 MB of an HTML file, uncompressed, and indexes only that part. When the `<title>`,
  meta description, canonical `<link>`, robots meta, first JSON-LD block or `<h1>` starts at
  byte 2,097,152 or later, each one is listed with its UTF-8 byte offset in `details.elements`
* Heavy Next.js flight data (`HTML_RSC_PAYLOAD_HEAVY`, info): the `self.__next_f.push(` scripts
  the App Router streams for hydration are more than half of an HTML document over 500 KiB
  (`details.totalBytes`, `details.rscBytes`, `details.share`)

### Next.js / Vercel

* Detect Vercel deployment
* Detect Next.js trailing slash redirect behaviour
* Middleware rewrite/redirect headers (best-effort)
* Metadata streamed into `<body>` (`METADATA_STREAMED_TO_BODY`, info). Next.js 15.2+ streams
  `generateMetadata` output into `<body>` for every user agent not on its HTML-limited bot list
  when `generateMetadata` is dynamic (static metadata and prerendered pages stay in `<head>`),
  so crawlers that read only `<head>` and do not run JavaScript miss the title, description,
  canonical and Open Graph tags. When any of those is in `<body>` alone on a Next.js page, the
  page is fetched once more as `facebookexternalhit`, without the shared cache, to compare.
  Together with the Vercel recheck below, that is at most two extra GETs of the page per audit,
  on top of the three the user-agent parity check makes.
  Skipped when `--user-agent` is already on Next's list (the `bingbot` preset is; `googlebot`
  is not, because Next.js streams to it too), and not run on `--crawl` pages
* Metadata missing from `<head>` even for that bot (`METADATA_NOT_IN_HEAD`, warning): a narrower
  `htmlLimitedBots`, a proxy rewriting the user agent, or tags rendered by client code. A bot
  copy served from the CDN cache (`HIT` / `STALE`) still warns, since that is what the crawler
  gets until the entry expires, with a note to re-run after it does
* Metadata already in `<head>` (`METADATA_IN_HEAD`, pass) on a Next.js page where at least one of those tags is in `<head>` and none
  is in `<body>` alone, with the tags found in `details.headTags`; no second request is made.
  Like other pass findings it counts under "passed" and never changes the exit code

### Vercel platform

Header-based checks that only make sense on Vercel's CDN. They read the page response
already fetched for the other modules. The one request of their own comes when that response
is an `x-vercel-cache: MISS` on a page the CDN could store: the page is fetched once more,
without the shared cache, so a cold miss after a deploy is not reported as an uncached page.
That can add up to twice `--timeout` to the audit, more if the second request is redirected.
Off Vercel (no `server: Vercel` and no `x-vercel-id`) the module reports that once and stops.

* `x-vercel-cache: MISS` on both requests, `STALE`, or `BYPASS` on a page the CDN could store
  (no `set-cookie`, no `private` / `no-store` / `no-cache`, no `Vary: *`). All three are info:
  a dynamic route misses every time, and Vercel bypasses the cache on purpose for Draft Mode
  and for some crawler requests (`VERCEL_CACHE_BYPASS`). A MISS followed by a `HIT`,
  `PRERENDER` or `REVALIDATED` is a cold miss and reports nothing; the checks below then read
  the second response. If the second request fails (an error, a non-2xx status, a redirect
  elsewhere, or no readable `x-vercel-cache`), the first response is reported with advice to
  run the audit again
* A page that missed the cache with no CDN lifetime readable from its headers: no `s-maxage`
  in `cache-control` (Vercel's default `public, max-age=0, must-revalidate` is the usual case),
  or no `s-maxage` / `max-age` in `cdn-cache-control` when that header is present. Info, both
  after two misses and when the second request failed. `s-maxage=0` counts as a lifetime, so
  a deliberate opt-out is not reported
* CDN lifetime below 60 seconds, and a lifetime without `stale-while-revalidate`. These read
  `s-maxage` from `cache-control`, or `s-maxage` / `max-age` from `cdn-cache-control` when that
  header is present (it overrides `cache-control` entirely). Vercel normally consumes `s-maxage`
  before the client sees it, so a lifetime is only readable when it comes through. `s-maxage=0`
  is treated as deliberately uncached
* A `*.vercel.app` URL without `x-robots-tag: noindex` or a robots meta `noindex`. Branch
  URLs (`<project>-git-<branch>-<scope>.vercel.app`) are always previews and get an
  error; other generated URLs can be the production deployment itself and get a warning

### User-agent parity

The page is fetched three more times, without the shared cache, as Googlebot (the `googlebot`
preset), as `facebookexternalhit` (the HTML-limited bot the streamed-metadata check uses) and
as `vercel-seo-audit/<version> (+https://github.com/JosephDoUrden/vercel-seo-audit)`, or as
Chrome when the default user agent is already the audit's own. Each answer is compared with
the page already fetched. Skipped when that page was not a 2xx HTML response (unreachable,
an error status or an edge challenge), and not run on `--crawl` pages.

Next.js can answer the same URL differently by user agent: a user agent on a custom
`htmlLimitedBots` list but not the built-in one gets no metadata under PPR and, on Vercel, a 500
([vercel/next.js#95406](https://github.com/vercel/next.js/issues/95406)), and from 16.3 matched
user agents get `private, no-store` ([#96594](https://github.com/vercel/next.js/issues/96594)).
Google counts serving different content to users and to search engines as
[cloaking](https://developers.google.com/search/docs/essentials/spam-policies#cloaking).

These requests are not from verified crawlers. Vercel and Cloudflare check Googlebot by IP
address, so a block seen here may not apply to Google, and the other way round.

* A 4xx or 5xx for one of them (`UA_STATUS_DIFFERS`, error), naming a Vercel or Cloudflare
  challenge when that is what came back
* A title, canonical, robots meta or `X-Robots-Tag` that differs in presence or value
  (`UA_METADATA_DIFFERS`, warning). Case, whitespace and a trailing slash on the canonical
  are ignored
* `private` or `no-store` in `cache-control` for some user agents only (`UA_CACHE_DIFFERS`,
  info): expected on Next.js 16.3 for `htmlLimitedBots`
* Two 2xx responses more than 30% apart in size (`UA_SIZE_DIFFERS`, info), with each size
  against the default's to the nearest 10% and whether the page has an `<h1>`

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

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | No errors found (warnings/info don't fail)                           |
| `1`  | One or more errors found                                             |
| `2`  | Crash, invalid input, or the audited page could not be fetched at all |

On a `TARGET_UNREACHABLE` run the report is still printed (and `--json` is still valid JSON),
with that one finding; the exit code is `2` even when the code is ignored, since nothing was audited.

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
      - uses: JosephDoUrden/vercel-seo-audit@vercel-seo-audit-v2.18.0 # x-release-please-version
        with:
          url: https://your-site.com
          strict: true
          report: json
```

The pinned tag above is updated on each release. `@v2` also works and follows the latest 2.x release; a
workflow moves it after every publish. For a build that never changes underneath you, pin the commit SHA.

All inputs:

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | yes | — | URL to audit |
| `strict` | no | `false` | Fail on warnings too |
| `user-agent` | no | — | `googlebot`, `bingbot`, or custom string |
| `pages` | no | — | Comma-separated page paths |
| `report` | no | — | Write report file: `json` or `md` |
| `timeout` | no | `10000` | Request timeout in ms |
| `verbose` | no | `false` | Show detailed output |
| `ignore` | no | — | Comma-separated issue codes to ignore |
| `summary` | no | `true` | Add the report to the job summary |
| `pr-comment` | no | `false` | Post the report as a pull request comment, updated in place on reruns |
| `comment-key` | no | `default` | One comment per key; give each workflow or matrix job its own |
| `github-token` | no | `github.token` | Token used for the pull request comment |

Outputs: `exit-code`, `report-path`

The action reads `.seoauditignore` and `.seoauditrc.json` from the working directory, so run `actions/checkout` first if you keep ignore lists in the repository. The `ignore` input works without it.

### Job summary and pull request comment

The summary and the comment are built from `report.md`. When `report` is unset and `summary` or `pr-comment` is on, the action passes `--report md`, so `report.md` appears in the working directory and `report-path` points to it. Any `report.*` file already there is deleted before the audit runs. An explicit `report` is never overridden: with `report: json` there is no Markdown report, and the summary and comment are skipped with a log line. Set `summary: false` to keep the old behaviour.

The comment is one collapsible block whose first line is a hidden `<!-- vercel-seo-audit:default -->` marker. A rerun edits its own earlier comment instead of adding another: one that starts with the marker and was written by the same account (`github-actions[bot]` for the default token, or the owner of a personal access token). Comments by anyone else are never touched. If several workflows or matrix jobs comment on the same pull request, give each its own `comment-key` so they do not overwrite each other.

The job summary has the full report (up to GitHub's 1 MiB limit). The comment is cut at 60,000 characters, with a note saying the full report is in the job summary. The comment step runs after a failing audit too, and a failure there never changes the audit's exit code. If the audit crashes or cannot reach the site (exit code `2`), an earlier comment is replaced with a note that the audit failed to run, so it does not keep showing the last run's numbers.

```yaml
name: SEO Audit
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: JosephDoUrden/vercel-seo-audit@v2
        with:
          url: https://your-site.com
          pr-comment: true
```

On `pull_request`, a pull request from a fork gets a read-only token, so the comment is skipped and the job summary still has the report.

To audit each Vercel preview deployment, run on `deployment_status`. The action looks for the one open pull request whose head is the deployed commit and comments there. With none, or more than one, it writes the summary only. `deployment_status` runs in the base repository with a write token, so previews of fork pull requests get a comment too.

```yaml
name: SEO Audit (preview)
on: deployment_status

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Preview'
    runs-on: ubuntu-latest
    steps:
      - uses: JosephDoUrden/vercel-seo-audit@v2
        with:
          url: ${{ github.event.deployment_status.environment_url }}
          pr-comment: true
```

This workflow needs no `actions/checkout`: the action runs the audit with `npx`. On `deployment_status`, the event's commit is the pull request's head, which for a fork is the fork's code. Checking it out before the action lets that code run, since `npx` honours a committed `.npmrc` (`registry=`). If you need `.seoauditignore` or `.seoauditrc.json`, check out the base branch (`ref: ${{ github.event.repository.default_branch }}`), never the deployment commit.

Vercel's Deployment Protection is on by default for preview deployments, so the audit gets the Vercel login page instead of your site unless previews are reachable without it (a [Deployment Protection Exception](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions), or protection turned off for previews). The action cannot send the Protection Bypass for Automation header yet. Do not put the bypass secret in `url` as a query parameter: the url is printed in the report, the job summary and the comment.

The `deployment_status` path is covered by unit tests with fixture payloads; this repository has no Vercel deployment to run it against.

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
      - uses: actions/setup-node@v7
        with:
          node-version: 22
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

The full roadmap, with sources and sizes, is in [docs/ROADMAP.md](./docs/ROADMAP.md). In short:

* **Now:** accuracy fixes found by running v2.10.0 against live sites, and fetch hardening
  (body cap, global deadline, same-origin crawl, unreachable target exits 2).
* **Next:** edge challenge detection, robots.txt status semantics, soft-404 probing, canonical
  integrity, host leaks, strict sitemap validation, user-agent parity.
* **Then:** `--format agent`, an Agent Skill, and a read-only MCP server.

Everything shipped so far is in the [changelog](./CHANGELOG.md).

---

## What this does not do

* **No JavaScript execution.** Pages are fetched and parsed as HTML. Anything rendered on the
  client, including metadata injected by scripts, is invisible to the audit.
* **No source reading.** It never opens `app/**`, `pages/**`, `next.config.js` or `vercel.json`;
  it only sees what the deployed site sends back.
* **No field Core Web Vitals.** The performance hints are static heuristics on the HTML. Real
  user metrics need PageSpeed Insights or a RUM tool.
* **No schema.org validation.** JSON-LD is checked for well-formedness and a few required
  fields, not against the schema.org vocabulary.
* **Vercel checks are header-based only.** They cannot see `s-maxage` the CDN has already
  consumed, cannot tell a cold miss from an uncached page on one request, and cannot reach a
  deployment behind Deployment Protection.

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
