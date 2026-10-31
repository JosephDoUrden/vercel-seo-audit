---
name: vercel-seo-audit
description: Audits a deployed site the way a crawler sees it and fixes what stops Google indexing it. Use when the user says Google is not indexing their site or pages, mentions Search Console errors (crawled but not indexed, duplicate without canonical, blocked by robots.txt, redirect errors), asks for an SEO audit, has robots.txt, sitemap or canonical problems on a Next.js or Vercel site, or has just deployed and wants to check it.
license: MIT
compatibility: Needs Node.js 20 or later and network access to the site being audited. The fixes are written for Next.js apps.
---

# vercel-seo-audit

This skill runs the `vercel-seo-audit` CLI against a deployed URL, reads its findings and edits
the Next.js app to fix them. The CLI fetches the site the way a crawler does. It does not run
JavaScript and it never reads the project source, so what it reports is what search engines see.

## Before you start

You need a URL that is deployed and reachable. Ask the user for it if you do not have it. A
preview deployment URL is fine. `http://localhost:3000` works against a local `next start`, but
the Vercel checks (preview indexing, cache headers, the Vercel host) will not fire there, so say
so when you report.

## Procedure

1. Run the audit and read stdout as JSON:

   ```bash
   npx vercel-seo-audit https://your-site.com --format agent
   ```

   stdout is one line of JSON. Read `exitCode`, `summary` and `findings`. Findings come sorted
   error, then warning, then info. Each one has `code`, `severity`, `message`, `url`, `fix` and
   `details`.

2. Check the exit code before anything else:

   - `0`: no errors. Report any warnings and stop unless the user wants them fixed.
   - `1`: at least one error, or a warning under `--strict`. Carry on.
   - `2`: the page could not be fetched (`TARGET_UNREACHABLE`) or the input was bad. Do not edit
     code. Tell the user what failed (wrong URL, deployment down, firewall) and stop.

3. Work through the errors first, then the warnings. For each finding read `fix`. If you are
   unsure what a code means, ask the CLI:

   ```bash
   npx vercel-seo-audit explain NOINDEX_DETECTED
   ```

4. Find the file to edit. The full table is in
   [AGENTS.md](https://github.com/JosephDoUrden/vercel-seo-audit/blob/main/AGENTS.md#where-to-make-the-change-in-a-nextjs-app).
   The short version:

   | Codes | Where |
   |---|---|
   | `ROBOTS_*` | `app/robots.ts` or `public/robots.txt` |
   | `SITEMAP_*` | `app/sitemap.ts` or `public/sitemap.xml` |
   | `TITLE_MISSING`, `DESCRIPTION_MISSING`, `CANONICAL_*`, `OG_*`, `TWITTER_*`, `NOINDEX_DETECTED`, `HREFLANG_*`, `CRAWL_PAGE_*` | `metadata` or `generateMetadata` in the page or layout |
   | `URL_HOST_LOCALHOST`, `URL_HOST_VERCEL_APP` | `metadata.metadataBase` in `app/layout.tsx` |
   | `METADATA_STREAMED_TO_BODY`, `METADATA_NOT_IN_HEAD` | `generateMetadata`, or `htmlLimitedBots` in `next.config.js` |
   | `FAVICON_MISSING`, `FAVICON_CONFLICT` | `app/icon.png` or `app/favicon.ico` |
   | `JSONLD_*` | the JSON-LD script in the page component |
   | `REDIRECT_*`, `NEXTJS_TRAILING_SLASH_308`, `COMMON_PAGE_REDIRECT` | `redirects()` and `trailingSlash` in `next.config.js`, or `middleware.ts` |
   | `X_ROBOTS_NOINDEX`, `VERCEL_PREVIEW_INDEXABLE`, the security and cache header codes | `headers` in `vercel.json` or `headers()` in `next.config.js` |
   | `IMG_*` | `next/image` with `alt`, `width` and `height` |

   `EDGE_CHALLENGE` and `TARGET_*` are not code changes. They are the firewall or the deployment.

5. Make the edit. Keep it to what the finding asks for.

6. Tell the user to deploy. The audit only sees what is deployed, so nothing is fixed until it
   is live. A preview deployment is enough.

7. When they give you the deployed URL, run the same audit again. Report what went away and
   what is left. Do not claim a finding is fixed without the re-run.

8. Stop. Do not loop on deploys yourself, and do not chase warnings the user did not ask about.

## Rules

- Never "fix" an info finding. Info is context (`VERCEL_DETECTED`, `NOT_ON_VERCEL`, cache
  state), and changing code to make it go away is churn.
- Never edit robots.txt to hide 404s or redirect errors from crawlers. Fix the route, the
  redirect or the sitemap entry instead.
- Never add `noindex` to fix a duplicate or canonical finding without asking the user first.
  Point the canonical at the right URL; `noindex` drops the page from search.
- If a warning looks deliberate, leave it and tell the user it can go in `.seoauditignore`. Do
  not add it there yourself.
- Do not pass `--fix` with `--format agent`. It is refused, and the fix text is already in each
  finding.
- Read `--format agent`, not `--json`. `--json` is the full report dump and its shape can change.

## Useful flags

```bash
# Audit the sitemap URLs too (default limit 50)
npx vercel-seo-audit https://your-site.com --format agent --crawl

# Check named pages for redirect problems
npx vercel-seo-audit https://your-site.com --format agent --pages /about,/pricing

# Fetch as Googlebot
npx vercel-seo-audit https://your-site.com --format agent --user-agent googlebot

# Treat warnings as failures
npx vercel-seo-audit https://your-site.com --format agent --strict
```
