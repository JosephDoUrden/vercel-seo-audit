# AGENTS.md

vercel-seo-audit fetches a deployed site the way a crawler does and reports why search engines may
not index it. It is aimed at Next.js on Vercel but most checks work on any site.

## Run it

```bash
npx vercel-seo-audit https://your-site.com --format agent
npx vercel-seo-audit explain NOINDEX_DETECTED
```

`--format agent` prints one line of JSON to stdout and nothing else. It is the stable contract: the
fields below keep their meaning across minor versions. `--json` is the full report dump, with pass
findings, explanations and timings, and its shape can change. Read `--format agent`.

```json
{ "tool": "vercel-seo-audit", "version": "...", "url": "...", "finalUrl": "...", "exitCode": 1,
  "summary": { "errors": 1, "warnings": 2, "info": 3 },
  "findings": [{ "code": "TITLE_MISSING", "severity": "error", "category": "metadata",
    "module": "metadata", "message": "...", "url": "...", "fix": "...", "details": {} }],
  "skipped": ["crawl"], "truncated": false }
```

Findings come sorted error, warning, info, then in module run order. Pass and ignored findings are
left out, except an ignored `TARGET_UNREACHABLE`, which stays because the run still exits 2. `fix`
is the suggested change, or `null`. `details` is capped (10 array items, 200 characters a string)
and `truncated` is `true` when anything was cut. `skipped` lists the modules that did not run, from
`--only`, a non-HTML page or an unreachable one, or `crawl` unless `--crawl` is set. With `--diff
old.json` the comparison goes under a `diff` key, so stdout is still one JSON document. `--fix` is
refused with `--format agent`; the fix text is already in each finding.

`explain <CODE>` prints the module that reports a code, its category and one sentence on what it
means. An unknown code exits 2 and names the three closest codes.

## Exit codes

`0` means no errors. `1` means at least one error, or at least one warning under `--strict`. `2`
means the page could not be fetched at all (`TARGET_UNREACHABLE`), or the input was bad; on a
`TARGET_UNREACHABLE` run stdout is still valid JSON with `"exitCode": 2`. On bad input stdout is
empty and the reason is on stderr.

## What it can see

It does not run JavaScript and never reads the project source. It sees the HTML, headers,
robots.txt and sitemap the deployment serves. So a fix only counts once it is deployed: edit,
deploy (a preview URL is fine), then run the audit again against that URL. Do not claim a finding
is fixed without the re-run.

## Where to make the change in a Next.js app

| Codes | Edit |
|---|---|
| `ROBOTS_*` | `app/robots.ts` (or `public/robots.txt`) |
| `SITEMAP_*` | `app/sitemap.ts` (or `public/sitemap.xml`) |
| `TITLE_MISSING`, `DESCRIPTION_MISSING`, `CANONICAL_*`, `OG_*`, `TWITTER_*`, `NOINDEX_DETECTED`, `HREFLANG_*`, `CRAWL_PAGE_*` | `metadata` or `generateMetadata` in the page or layout (`alternates`, `openGraph`, `twitter`, `robots`) |
| `URL_HOST_LOCALHOST`, `URL_HOST_VERCEL_APP` | `metadata.metadataBase` in `app/layout.tsx`, set from the production origin (e.g. `NEXT_PUBLIC_SITE_URL`), not the request host |
| `METADATA_STREAMED_TO_BODY`, `METADATA_NOT_IN_HEAD` | `generateMetadata` (make it fast or static), or `htmlLimitedBots` in `next.config.js` |
| `FAVICON_MISSING`, `FAVICON_CONFLICT` | `app/icon.png` or `app/favicon.ico` |
| `JSONLD_*` | a `<script type="application/ld+json">` in the page component |
| `NEXTJS_TRAILING_SLASH_308`, `REDIRECT_*`, `COMMON_PAGE_REDIRECT` | `trailingSlash` and `redirects()` in `next.config.js`, or `middleware.ts` |
| `X_ROBOTS_NOINDEX`, `HSTS_MISSING`, `*_POLICY_MISSING`, `*_OPTIONS_MISSING`, `FRAME_PROTECTION_MISSING`, `VERCEL_CACHE_CONTROL_MISSING`, `VERCEL_SWR_MISSING`, `VERCEL_PREVIEW_INDEXABLE` | `headers` in `vercel.json` or `headers()` in `next.config.js` |
| `IMG_*` | swap `<img>` for `next/image` with `alt`, `width` and `height` |

`EDGE_CHALLENGE` and `TARGET_*` are not code changes: they are the firewall or the deployment.

## Rules

Fix errors first, then warnings. Do not "fix" an info finding: info is context (`VERCEL_DETECTED`,
`NOT_ON_VERCEL`, cache state) and changing code to make it go away is churn. If a warning is
deliberate, leave it and tell the user it can go in `.seoauditignore`; do not add it there yourself.
