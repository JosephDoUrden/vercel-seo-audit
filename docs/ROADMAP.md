# Roadmap

Last revised 31 Oct 2026 (evening), against v2.12.0. Items move up or down as evidence arrives; dates are
targets, not promises. Anything marked *not planned* in the issue tracker stays out unless a user
turns up with a concrete case.

The tool keeps its model: it looks only at what the deployed site sends back. No JavaScript
execution, no source reading, no API keys. Every item below fits inside that.

## Phase 1: accuracy and robustness

Found by running v2.10.0 against live sites and a hostile fixture server on 31 Oct 2026.
All shipped in v2.11.0 (31 Oct 2026) except the last row.

| Item | Why | Size |
|---|---|---|
| `RENDER_BLOCKING_SCRIPT` ignores `nomodule` scripts | Fires on every Next.js site because of the legacy polyfill chunk | S |
| `JSONLD_MISSING_TYPE` accepts `@graph` blocks whose nodes carry `@type` | False positive on any site using the `@graph` form | S |
| Unreachable or non-HTML target is an error, exit code 2 | A dead host, a DNS failure or a PDF currently exits 0 with findings that blame the site's config | S |
| Target status code is reported | A 404 is audited as a page and told it has `noindex` | S |
| Body size cap and global deadline | A 300 MB body kills the process; `--timeout` is per read, so an unreachable host can take 28 s | S |
| Same-origin filter on sitemap `<loc>`, child sitemaps and crawl | A sitemap listing another host makes the tool fetch it, which is an SSRF relay when run in CI | S |
| Module failures surface in the report | A module that throws today leaves no finding and no exit-code trace | S |
| Findings use the final URL | `http://` input and apex-to-www moves produce canonical and trailing-slash artefacts | S |
| Pass findings get their own codes | `SITEMAP_MISSING` with severity `pass` misleads anyone filtering JSON by code. Open | S |

## Phase 2: checks

Each sourced to a Google Search Central page or a Next.js issue, all read 31 Oct 2026.
Shipped: edge challenge, robots.txt status semantics and the AI-crawler matrix (v2.11.0 and
v2.12.0), canonical integrity, host leak, strict sitemap validation, render-asset blocking, the
2 MB cut-off, user-agent parity and the entry-URL redirect finding (v2.12.0), the soft-404 probe
(v2.13.0), crawl pages getting the homepage checks plus duplicate titles, descriptions and
canonical chains across the crawl (v2.14.0). Open: the smaller items below.

| Item | What it detects | Source | Size |
|---|---|---|---|
| Edge challenge on crawl paths | `/`, `/robots.txt` or the sitemap answering 403/429 with a challenge page (`x-vercel-mitigated`, `cf-mitigated`) | Vercel community thread, 16 Sep 2026 | S |
| robots.txt status semantics | 5xx or 429 means Google stops crawling for 12 h; over 500 KiB is truncated; more than 5 redirect hops counts as 404 | Google robots.txt spec, 23 Oct 2026 | S |
| Soft 404 and error shell | A random unknown path, or a random slug under a dynamic prefix, returning 200; the empty `__next_error__` shell | Next.js discussion #100192, issue #99287 | M |
| Canonical integrity | More than one canonical, `Link` header disagreeing with the tag, canonical outside `<head>`, relative or fragment canonical, target that redirects or is `noindex` | Google, consolidate duplicate URLs, 10 Jul 2026 | M |
| Host leak | canonical, `og:image`, hreflang, sitemap `<loc>` or JSON-LD `url` on `localhost`, `*.vercel.app` or a host that answers 401 | Vercel KB on `.vercel.app` duplicates, 18 Sep 2026 | S |
| Strict sitemap validation | Unescaped `&`, more than 50k URLs or 50 MB, cross-host `<loc>`, invalid or identical `lastmod` | Google, build a sitemap, 08 Jul 2026 | M |
| robots.txt blocks render assets | `Disallow` rules matching `/_next/static/` or `/_next/image` URLs the page references | Next.js discussion #89939 | S |
| User-agent parity | Status, title, canonical, robots or `cache-control` differing between a browser, Googlebot, an HTML-limited bot and an unlisted crawler | Next.js issues #95406, #96594 | M |
| Googlebot 2 MB cut-off | canonical, robots, JSON-LD or title past byte 2,097,152, and the share of HTML taken by the RSC payload | Google crawler blog, Mar 2026 | S |
| AI crawler access matrix | Allow or deny per token, grouped as training, search and user fetch; flags a blocked search bot | Anthropic and OpenAI bot pages, Cloudflare Content Signals | S |
| Crawl pages get the homepage checks | hreflang, images, Open Graph and streamed metadata run only on the entry page today | Code | M |

Smaller: `unavailable_after` in the past, `max-snippet:0`, a `googlebot` meta that conflicts with
`robots`, the same JSON-LD block appearing twice, `SITEMAP_LASTMOD_IDENTICAL` for a sitemap where
only the dynamic routes share one build timestamp, a fetch cache keyed by user agent so the parity
module can share requests, and a redirect-chain finding that says when the 20-hop walk was cut.

## Phase 3: agents

Coding agents already run CLIs. The cheap step is to make the output something an agent can act on
without guessing, then teach it the procedure.

1. `--format agent`: compact JSON, no pass findings, stable codes, a fix hint per finding, and an
   `explain <CODE>` subcommand. Ships with `AGENTS.md`. Shipped in v2.12.0.
2. An Agent Skill (`SKILL.md`) that runs the CLI, reads the codes, edits `app/sitemap.ts`,
   `app/robots.ts` or `next.config.js`, and re-runs. Published where Claude Code, Codex and Cursor
   look for skills.
3. A read-only MCP server, as a stdio subcommand, once the Phase 1 fetch hardening has shipped. It
   exposes `audit_site`, `audit_page`, `explain_finding` and `diff_reports`, takes no credentials,
   returns findings and labelled snippets rather than raw HTML, and is listed in the MCP Registry
   under its own `server.json`. The design bar is in [SECURITY.md](../SECURITY.md) when it lands.

Order is by cost and evidence. Step 3 waits for a request from someone who cannot run a shell, or
for the fetch layer to be hardened, whichever comes first.

## Not planned

Lighthouse or PageSpeed scores, accessibility, broken-link checking, multi-site runs, a plugin
system, `llms.txt` validation, FAQ rich-result checks, `priority` and `changefreq` advice,
rendered-versus-raw diffs, IndexNow submission, any "AI visibility" score. The issue tracker
records the reason for each.
