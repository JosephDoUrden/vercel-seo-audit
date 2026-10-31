import { randomBytes } from 'node:crypto';
import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage } from '../utils/http.js';
import { getNoindexDirective, getTitle, parseHtml } from '../utils/html-parser.js';

// Google, "How HTTP status codes, and network and DNS errors affect Google Search"
// (updated 04 Feb 2026), on a 2xx: "If the content suggests an error for Google Search, an
// empty page or an error message, ... Search Console will show a soft 404 error."
// https://developers.google.com/search/docs/crawling-indexing/http-network-errors
//
// Google, "Understand the JavaScript SEO basics" (updated 04 Mar 2026): "If the HTTP status
// code is non-200 (for example, on error pages with 404 status code), rendering might be
// skipped." A 404 is the cheap answer; a 200 gets queued for rendering.
// https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
//
// Next.js discussion #100192 (14 Oct 2026): "If the response has already been sent with a
// 200 status, a later call to notFound() cannot change it to 404", and "Next.js still renders
// the not-found UI and adds noindex." https://github.com/vercel/next.js/discussions/100192
//
// Next.js issue #99287 (opened 26 Sep 2026), "notFound() serves an empty `__next_error__`
// document instead of not-found.tsx", "Still reproduces on next@16.3.8" (04 Oct 2026).
// https://github.com/vercel/next.js/issues/99287
//
// Google Search Console Help, "404 (Page Not Found) errors" (no date on the page, read
// 31 Oct 2026): "Don't create fake content, redirect to your homepage, or use robots.txt to
// block 404s", and pages that redirect "to another page, such as the homepage, instead of
// returning a 404" are what it calls soft 404s. https://support.google.com/webmasters/answer/2445990

/** Which unknown path a probe asked for: the site root, a dynamic route, or a file name. */
export type ProbeKind = 'root' | 'dynamic' | 'file';

interface ProbeResult {
  probe: ProbeKind;
  url: string;
  status: number;
  body: string;
  headers: Headers;
  finalUrl: string;
}

const NOINDEX_RE = /\b(?:noindex|none)\b/i;
const ERROR_TEXT_RE = /not found|\b404\b|page (?:doesn['’]t|does not) exist/i;

function randomHex(): string {
  return randomBytes(16).toString('hex');
}

// The URL without a trailing slash on its path, so a slash hop is not counted as a redirect.
function withoutSlash(url: string): string {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.href;
}

/**
 * The parent path shared by the most sitemap URLs on `origin` that differ only in their last
 * segment, such as `/blog` for `/blog/a` and `/blog/b`. Ties go to the parent seen first.
 */
export function dynamicPrefix(urls: readonly string[] | undefined, origin: string): string | undefined {
  const host = new URL(origin).host;
  const children = new Map<string, Set<string>>();
  for (const raw of urls ?? []) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.host !== host) continue;
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length < 2) continue;
    const parent = `/${segments.slice(0, -1).join('/')}`;
    const set = children.get(parent) ?? new Set<string>();
    set.add(segments.at(-1)!);
    children.set(parent, set);
  }

  let best: string | undefined;
  let size = 1;
  for (const [parent, set] of children) {
    if (set.size > size) {
      best = parent;
      size = set.size;
    }
  }
  return best;
}

// The App Router shell (<html id="__next_error__">), or a Pages Router body holding nothing
// but an empty __next root and no <title>: a 200 with no content a crawler can read.
function isErrorShell(html: string): boolean {
  if (/<html[^>]*\bid=["']?__next_error__/i.test(html)) return true;
  if (getTitle(html)) return false;
  const $ = parseHtml(html);
  const content = $('body').children().not('script, noscript, template, link, style');
  if (content.length !== 1 || content.attr('id') !== '__next') return false;
  return content.children().length === 0 && content.text().trim() === '';
}

function noindexOf(page: ProbeResult): 'meta' | 'header' | undefined {
  if (getNoindexDirective(page.body)) return 'meta';
  if (NOINDEX_RE.test(page.headers.get('x-robots-tag') ?? '')) return 'header';
  return undefined;
}

function looksLikeErrorPage(html: string): boolean {
  const $ = parseHtml(html);
  const text = `${getTitle(html) ?? ''}\n${$('h1').text()}`;
  return ERROR_TEXT_RE.test(text);
}

const WHAT: Record<ProbeKind, string> = {
  root: 'An unknown path',
  dynamic: 'An unknown slug under a dynamic route',
  file: 'An unknown .html file',
};

/** A finding for a probe that went wrong, or undefined when it answered 4xx as it should. */
function classify(page: ProbeResult, url: string): AuditFinding | undefined {
  const base = { probe: page.probe, url: page.url, status: page.status };
  const what = WHAT[page.probe];
  // A hop that ends in a 4xx (a locale prefix, a trailing slash) still tells crawlers "gone".
  if (page.status >= 400 && page.status < 500) return undefined;

  if (page.status >= 500) {
    return {
      code: 'SOFT_404_SERVER_ERROR',
      severity: 'warning',
      category: 'indexing',
      message: `${what} answers HTTP ${page.status} instead of 404`,
      explanation:
        'A request for a page that does not exist made the server fail. Google slows its crawl of a site that keeps answering 5xx, and keeps retrying the URL instead of dropping it.',
      suggestion:
        'Make the route answer 404 for an unknown path: call notFound() before anything that can throw, and check the server logs for this URL.',
      details: { ...base, finalUrl: page.finalUrl },
      url,
    };
  }

  if (withoutSlash(page.finalUrl) !== withoutSlash(page.url)) {
    return {
      code: 'SOFT_404_REDIRECT',
      severity: 'warning',
      category: 'indexing',
      message: `${what} redirects to ${page.finalUrl}`,
      explanation:
        'Unknown paths are redirected rather than answered with 404. Google\'s help on 404 errors says not to "redirect to your homepage" in place of a 404, and treats such pages as soft 404s, so broken links never drop out and the target page collects them.',
      suggestion:
        'Let unknown paths answer 404 (app/not-found.tsx in Next.js) and keep redirects for pages that moved. Check redirects() in next.config and middleware for a catch-all rule.',
      details: { ...base, finalUrl: page.finalUrl },
      url,
    };
  }

  if (isErrorShell(page.body)) {
    return {
      code: 'NEXTJS_ERROR_SHELL',
      severity: 'error',
      category: 'indexing',
      message: `${what} answers 200 with the empty Next.js error shell`,
      explanation:
        'The response is the Next.js error document (<html id="__next_error__"> or a bare __next root) with HTTP 200: no title, no text, nothing a crawler can read. Next.js issue #99287 reports notFound() serving this shell instead of not-found.tsx, still on 16.3.8.',
      suggestion:
        'Add app/not-found.tsx (or pages/404.tsx), call notFound() before the page starts streaming, and upgrade Next.js once #99287 is fixed.',
      details: base,
      url,
    };
  }

  const noindex = noindexOf(page);
  if (noindex) {
    return {
      code: 'SOFT_404_NOINDEX',
      severity: 'info',
      category: 'indexing',
      message: `${what} answers 200 with noindex instead of 404`,
      explanation:
        'This is what the App Router does when notFound() runs after the response has started streaming: the status line has already gone out as 200, so Next.js renders the not-found UI and adds noindex instead. Google will not index the page, but it fetches and may render every such URL before it sees the noindex, which costs crawl budget.',
      suggestion:
        'Call notFound() before anything streams: in generateMetadata or at the top of the page, outside any <Suspense> boundary and before loading.tsx takes over, so Next.js can still send a 404.',
      details: { ...base, noindex },
      url,
    };
  }

  const title = getTitle(page.body);
  return {
    code: 'SOFT_404',
    severity: 'error',
    category: 'indexing',
    message: `${what} answers 200 instead of 404`,
    explanation:
      'A URL that does not exist returns a normal page with HTTP 200 and no noindex. Google calls that a soft 404: it renders the page, works out from the content that it is an error, and reports it in Search Console, while a catch-all route can also fill the index with copies of one page.',
    suggestion:
      'Return a real 404 for unknown paths: call notFound() in dynamic routes when the record is missing, and do not let a catch-all route or rewrite answer every path.',
    details: { ...base, title, looksLikeErrorPage: looksLikeErrorPage(page.body) },
    url,
  };
}

/**
 * Asks for up to three paths that cannot exist (a random path, a random slug under the
 * sitemap's busiest dynamic route, and a random .html file when both of those answer 200)
 * and reports any that do not answer 404 or 410.
 */
export async function auditSoft404(ctx: AuditContext, random: () => string = randomHex): Promise<AuditFinding[]> {
  // No page in phase 0 means the target was unreachable or did not answer 2xx; probing an
  // unknown path then says nothing about soft 404s.
  if (!ctx.html) return [];

  // The origin the page settled on, so a www or https redirect is not taken for a soft 404.
  const origin = new URL(ctx.finalUrl ?? ctx.normalizedUrl).origin;
  const results: ProbeResult[] = [];

  const probe = async (kind: ProbeKind, path: string): Promise<ProbeResult | undefined> => {
    const url = new URL(path, origin).href;
    try {
      // ctx.fetchOptions carries the private-address guard and the body cap.
      const page = await fetchPage(url, ctx.fetchOptions);
      const result = { probe: kind, url, ...page };
      results.push(result);
      return result;
    } catch {
      // A probe that times out or is refused says nothing either way.
      return undefined;
    }
  };

  // 200 at the probe URL itself, not after a redirect.
  const answered200 = (r: ProbeResult | undefined): boolean =>
    !!r && r.status >= 200 && r.status < 300 && withoutSlash(r.finalUrl) === withoutSlash(r.url);

  const root = await probe('root', `/${random()}`);
  const prefix = dynamicPrefix(ctx.sitemapUrls, origin);
  const dynamic = prefix ? await probe('dynamic', `${prefix}/${random()}`) : undefined;
  // Both answered 200: a .html name tells a catch-all rewrite from a route that renders anything.
  if (answered200(root) && answered200(dynamic)) await probe('file', `/${random()}.html`);

  if (results.length === 0) return [];

  const findings = results
    .map((r) => classify(r, ctx.normalizedUrl))
    .filter((f): f is AuditFinding => f !== undefined);
  if (findings.length > 0) return findings;

  return [
    {
      code: 'SOFT_404_NONE',
      severity: 'pass',
      category: 'indexing',
      message: `Unknown paths answer ${[...new Set(results.map((r) => r.status))].join(' or ')}`,
      explanation: 'Paths that cannot exist get a real error status, so search engines drop them without rendering.',
      suggestion: 'Nothing to do.',
      details: { probes: results.map(({ probe: kind, url, status }) => ({ probe: kind, url, status })) },
      url: ctx.normalizedUrl,
    },
  ];
}
