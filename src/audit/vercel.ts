import type { AuditContext, AuditFinding } from '../types.js';
import { getNoindexDirective } from '../utils/html-parser.js';
import { detectChallenge, edgeChallengeFinding } from '../utils/challenge.js';
import { fetchPage } from '../utils/http.js';

// Vercel's own examples pair a one-second s-maxage with stale-while-revalidate. Below a
// minute without it, every expiry makes a visitor wait on the origin.
const S_MAXAGE_FLOOR = 60;

const VERCEL_APP_SUFFIX = '.vercel.app';

// <project>-git-<branch>-<scope>.vercel.app. A project whose own name contains "git" fits
// this too, so the shape is a strong hint, not proof. Commit URLs carry a nine-character
// hash label instead of a branch; a host with one of those is not read as a branch URL.
const BRANCH_URL = /^[a-z0-9]+(?:-[a-z0-9]+)*-git-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]+\.vercel\.app$/;
const COMMIT_HASH_LABEL = /-(?=[a-z0-9]{9}-)(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{9}-/;

function isBranchUrl(host: string): boolean {
  return BRANCH_URL.test(host) && !COMMIT_HASH_LABEL.test(host.slice(host.indexOf('-git-') + 4));
}

// noindex, or none (which means noindex, nofollow).
const NOINDEX = /\b(?:noindex|none)\b/i;

type Directives = Map<string, string | true>;

function parseDirectives(value: string | undefined): Directives | undefined {
  if (value === undefined) return undefined;
  const out: Directives = new Map();
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    const name = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase();
    if (!name) continue;
    const raw = eq === -1 ? true : part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    out.set(name, raw);
  }
  return out;
}

function seconds(directives: Directives | undefined, name: string): number | undefined {
  const raw = directives?.get(name);
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

interface Lifetime {
  lifetime: number;
  directive: 's-maxage' | 'max-age';
  source: 'cdn-cache-control' | 'cache-control';
}

// Cache-Control only caches the CDN through s-maxage; CDN-Cache-Control also honours max-age.
function lifetimeFrom(directives: Directives | undefined, source: Lifetime['source']): Lifetime | undefined {
  if (!directives) return undefined;
  const sMaxage = seconds(directives, 's-maxage');
  if (sMaxage !== undefined) return { lifetime: sMaxage, directive: 's-maxage', source };
  if (source === 'cdn-cache-control') {
    const maxAge = seconds(directives, 'max-age');
    if (maxAge !== undefined) return { lifetime: maxAge, directive: 'max-age', source };
  }
  return undefined;
}

// The CDN refuses to store these no matter what else is set.
function optsOut(directives: Directives | undefined): boolean {
  return !!directives && ['private', 'no-store', 'no-cache'].some((d) => directives.has(d));
}

// CDN-Cache-Control overrides Cache-Control for the CDN, so a browser-only no-store beside
// a CDN lifetime is still storable.
function isPersonalised(headers: Record<string, string>): boolean {
  const directives = parseDirectives(headers['cdn-cache-control']) ?? parseDirectives(headers['cache-control']);
  return 'set-cookie' in headers || optsOut(directives) || (headers['vary'] ?? '').trim() === '*';
}

// The statuses a re-request can settle on. Anything else, including no header at all,
// tells us nothing and counts as a failed second request.
const CACHE_STATUSES = new Set(['MISS', 'HIT', 'STALE', 'PRERENDER', 'REVALIDATED', 'BYPASS']);

interface Recheck {
  status: string;
  headers: Record<string, string>;
}

// One more GET for the same URL. The options leave out the shared cache on purpose: with it,
// fetchPage would hand back the phase 0 response instead of asking the CDN again.
async function recheck(url: string, ctx: AuditContext): Promise<Recheck | undefined> {
  try {
    const { timeout, userAgent, auditedUrl, signal } = ctx.fetchOptions;
    const page = await fetchPage(url, { timeout, userAgent, auditedUrl, signal });
    if (page.status < 200 || page.status >= 300 || page.finalUrl !== url) return undefined;
    const headers = Object.fromEntries(page.headers.entries());
    const status = (headers['x-vercel-cache'] ?? '').toUpperCase();
    return CACHE_STATUSES.has(status) ? { status, headers } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Header-driven checks that only make sense on Vercel's CDN. Everything starts from the
 * phase 0 response. The one request of its own is a second GET when that response was a
 * MISS on a page the CDN could store, to tell a cold miss from a page that is never cached.
 */
export async function auditVercel(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, headers } = ctx;

  // Phase 0 shares only a 2xx page, and a challenge is never one. Asking again here goes
  // through the shared cache, so it is the same request the other modules retry with.
  if (!headers) {
    try {
      const page = await fetchPage(normalizedUrl, ctx.fetchOptions);
      const challenge = detectChallenge(page.headers, page.status);
      if (challenge) findings.push(edgeChallengeFinding(challenge, 'vercel', 'the page', page.finalUrl));
    } catch {
      // Nothing to read
    }
    return findings;
  }

  const url = ctx.finalUrl ?? normalizedUrl;

  const server = headers['server'] ?? '';
  const xVercelId = headers['x-vercel-id'];
  if (!server.toLowerCase().includes('vercel') && !xVercelId) {
    findings.push({
      code: 'NOT_ON_VERCEL',
      severity: 'info',
      category: 'vercel',
      message: 'No Vercel signal in the response headers, Vercel checks skipped',
      explanation:
        'Vercel deployments answer with server: Vercel and an x-vercel-id header. Neither was present, so the cache and preview checks do not apply.',
      suggestion: 'No action needed unless this site is on Vercel behind another proxy that rewrites the server header.',
      details: { server: server || undefined },
      url,
    });
    return findings;
  }

  // 1. Preview deployments must not be indexable. Branch URLs are always previews; the
  // other generated shapes can also be the production deployment's own URL.
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith(VERCEL_APP_SUFFIX)) {
    const xRobots = (headers['x-robots-tag'] ?? '').toLowerCase();
    const headerNoindex = NOINDEX.test(xRobots);
    const metaNoindex = ctx.html ? getNoindexDirective(ctx.html) : false;
    if (!headerNoindex && !metaNoindex) {
      const branchUrl = isBranchUrl(host);
      findings.push({
        code: 'VERCEL_PREVIEW_INDEXABLE',
        severity: branchUrl ? 'error' : 'warning',
        category: 'vercel',
        message: branchUrl
          ? 'Branch preview deployment is indexable'
          : 'Generated vercel.app URL is indexable',
        explanation: branchUrl
          ? 'This host has the shape of a branch preview URL. Vercel sends x-robots-tag: noindex on every preview deployment so it cannot compete with production for the same content, and this one sends neither the header nor a robots meta noindex, which happens when the header has been disabled in vercel.json or overwritten by middleware.'
          : 'This vercel.app URL sends no noindex. If it is the production deployment on its generated domain that is expected, but if it is a preview or an old deployment it duplicates your production content in the index.',
        suggestion: branchUrl
          ? 'Remove any vercel.json or middleware rule that drops x-robots-tag on previews, or add the header for non-production builds using the VERCEL_ENV variable. If the project name itself contains "git" and this is production, serve it from a custom domain instead.'
          : 'Serve production from a custom domain, or add x-robots-tag: noindex to non-production builds using the VERCEL_ENV variable.',
        details: { host, xRobotsTag: xRobots || undefined, metaNoindex },
        url,
      });
    }
  }

  // 2. CDN cache state. Only worth reading when the response is one the CDN may store.
  if (isPersonalised(headers)) return findings;

  // A MISS straight after a deploy says nothing about the page, so ask once more. When the
  // CDN has it the second time, the rest of the checks read that response instead.
  let status = (headers['x-vercel-cache'] ?? '').toUpperCase();
  let current = headers;
  let requests: { firstRequest: string; secondRequest: string } | undefined;
  if (status === 'MISS') {
    const second = await recheck(url, ctx);
    if (second && isPersonalised(second.headers)) return findings;
    requests = { firstRequest: 'MISS', secondRequest: second?.status ?? 'failed' };
    if (second && second.status !== 'MISS') {
      status = second.status;
      current = second.headers;
    }
  }
  const confirmedMiss = requests?.secondRequest === 'MISS';

  const cacheControl = current['cache-control'];
  const cdnCacheControl = current['cdn-cache-control'];
  const cc = parseDirectives(cacheControl);
  const cdn = parseDirectives(cdnCacheControl);
  const cacheDetails = {
    xVercelCache: status || undefined,
    cacheControl,
    cdnCacheControl,
    ...requests,
  };

  if (status === 'MISS') {
    findings.push({
      code: 'VERCEL_CACHE_MISS',
      severity: 'info',
      category: 'vercel',
      message: confirmedMiss
        ? 'Page was not served from the Vercel CDN cache on two requests (x-vercel-cache: MISS)'
        : 'Page was not served from the Vercel CDN cache (x-vercel-cache: MISS)',
      explanation: confirmedMiss
        ? 'The audit asked for the page twice and the CDN generated it from your function both times, so this is not a cold miss after a deploy. That is expected on a dynamic route, which Vercel renders on every request, but a page that is the same for every visitor is not being cached.'
        : 'The CDN had nothing to serve and generated the response from your function. Vercel strips s-maxage before the client sees it, so a cold miss after a deploy and a page with no CDN lifetime look the same from outside.',
      suggestion: confirmedMiss
        ? 'If the page is the same for every visitor, set s-maxage (Vercel suggests max-age=0, s-maxage=86400) or use ISR. On a dynamic route, no action needed.'
        : 'Run the audit again. A second MISS on a page that is the same for every visitor means it is not being cached; set s-maxage (Vercel suggests max-age=0, s-maxage=86400) or use ISR.',
      details: cacheDetails,
      url,
    });
  } else if (status === 'BYPASS') {
    findings.push({
      code: 'VERCEL_CACHE_BYPASS',
      severity: 'info',
      category: 'vercel',
      message: 'Vercel skipped the CDN cache for this request (x-vercel-cache: BYPASS)',
      explanation:
        'Vercel skipped the cache on purpose and served fresh content from your function. It does that for Draft Mode, for requests matching a prerender bypass rule (Next.js uses one to serve some crawlers fully rendered pages), and for known crawlers on a page that would otherwise get its prerender fallback. Other visitors may still get the cached copy.',
      suggestion:
        'No action needed if you audited with a crawler user agent. Otherwise the runtime logs show the bypass reason for this path.',
      details: cacheDetails,
      url,
    });
  } else if (status === 'STALE') {
    findings.push({
      code: 'VERCEL_CACHE_STALE',
      severity: 'info',
      category: 'vercel',
      message: 'Page was served stale while the CDN refreshed it (x-vercel-cache: STALE)',
      explanation:
        'The cached copy had passed its lifetime, so the CDN served it and regenerated in the background. That is the normal stale-while-revalidate path, but it is also what you see when every revalidation fails and the last good copy keeps being served.',
      suggestion:
        'Check the runtime logs for a revalidation error on this path. If regeneration is healthy, no action needed.',
      details: cacheDetails,
      url,
    });
  }

  // 3. Lifetime directives. CDN-Cache-Control wins over Cache-Control outright, so once it is
  // present nothing in Cache-Control counts. Vercel usually consumes s-maxage before the
  // client sees it, so a lifetime is only readable when it comes through.
  const lifetime = cdn ? lifetimeFrom(cdn, 'cdn-cache-control') : lifetimeFrom(cc, 'cache-control');
  const ttl = lifetime?.lifetime;
  const swr = cdn ? cdn.has('stale-while-revalidate') : !!cc?.has('stale-while-revalidate');

  if (status === 'MISS' && ttl === undefined) {
    const present = [cdn && 'cdn-cache-control', cc && 'cache-control'].filter(Boolean).join(' or ');
    const missed = confirmedMiss ? 'missed the CDN cache twice' : 'missed the CDN cache';
    findings.push({
      code: 'VERCEL_CACHE_CONTROL_MISSING',
      // Two misses in a row are also what a dynamic route looks like, and a failed second
      // request proves even less, so neither is worth a warning.
      severity: 'info',
      category: 'vercel',
      message: present
        ? `No CDN lifetime in ${present} on a page that ${missed}`
        : `No cache-control header on a page that ${missed}`,
      explanation: confirmedMiss
        ? 'Without s-maxage (or max-age in cdn-cache-control) the CDN generates this page on every request. Vercel treats the default public, max-age=0, must-revalidate as no caching. Both requests the audit made missed the cache, so this is not a cold miss after a deploy, though a dynamic route misses every time too.'
        : 'Without s-maxage (or max-age in cdn-cache-control) the CDN generates this page on every request. Vercel treats the default public, max-age=0, must-revalidate as no caching. Vercel also strips s-maxage before the client sees it, so a cold miss straight after a deploy looks the same; a second run settles it.',
      suggestion:
        'For pages that are the same for every visitor, send Cache-Control: max-age=0, s-maxage=86400 with a stale-while-revalidate window, or use ISR.',
      details: cacheDetails,
      url,
    });
  }

  // s-maxage=0 is a deliberate do-not-cache, not a short lifetime.
  if (lifetime && ttl !== undefined && ttl > 0) {
    if (ttl < S_MAXAGE_FLOOR) {
      findings.push({
        code: 'VERCEL_S_MAXAGE_SHORT',
        severity: 'info',
        category: 'vercel',
        message: `CDN lifetime is ${ttl}s (below ${S_MAXAGE_FLOOR}s)`,
        explanation:
          'A very short s-maxage sends most visitors to the origin. Vercel pairs short lifetimes with stale-while-revalidate so the CDN can keep serving while it refreshes in the background.',
        suggestion:
          'Raise s-maxage for content that tolerates staleness, or keep it short and add stale-while-revalidate (for example s-maxage=1, stale-while-revalidate=59).',
        details: { ...cacheDetails, ...lifetime, floor: S_MAXAGE_FLOOR },
        url,
      });
    }
    if (!swr) {
      findings.push({
        code: 'VERCEL_SWR_MISSING',
        severity: 'info',
        category: 'vercel',
        message: 'CDN lifetime is set without stale-while-revalidate',
        explanation:
          'When s-maxage runs out the next visitor waits for the origin. With stale-while-revalidate the CDN serves the stale copy and refreshes it in the background.',
        suggestion: 'Add stale-while-revalidate=N alongside s-maxage.',
        details: { ...cacheDetails, ...lifetime },
        url,
      });
    }
  }

  return findings;
}
