import type { AuditContext, AuditFinding } from '../types.js';
import { getNoindexDirective } from '../utils/html-parser.js';

// Vercel's own examples pair a one-second s-maxage with stale-while-revalidate. Below a
// minute without it, every expiry makes a visitor wait on the origin.
const S_MAXAGE_FLOOR = 60;

const VERCEL_APP_SUFFIX = '.vercel.app';

type Directives = Map<string, string | true>;

function parseDirectives(value: string | undefined): Directives | undefined {
  if (value === undefined) return undefined;
  const out: Directives = new Map();
  for (const part of value.split(',')) {
    const [name, raw] = part.trim().split('=', 2);
    if (!name) continue;
    out.set(name.toLowerCase(), raw === undefined ? true : raw.trim().replace(/^"|"$/g, ''));
  }
  return out;
}

function seconds(directives: Directives | undefined, name: string): number | undefined {
  const raw = directives?.get(name);
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

// The CDN refuses to store these no matter what else is set.
function optsOut(directives: Directives | undefined): boolean {
  return !!directives && ['private', 'no-store', 'no-cache'].some((d) => directives.has(d));
}

/**
 * Header-driven checks that only make sense on Vercel's CDN. Everything comes from the
 * phase 0 response; nothing here makes a request of its own.
 */
export async function auditVercel(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, headers } = ctx;
  if (!headers) return findings;

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
    const headerNoindex = xRobots.includes('noindex');
    const metaNoindex = ctx.html ? getNoindexDirective(ctx.html) : false;
    if (!headerNoindex && !metaNoindex) {
      const isBranchUrl = host.includes('-git-');
      findings.push({
        code: 'VERCEL_PREVIEW_INDEXABLE',
        severity: isBranchUrl ? 'error' : 'warning',
        category: 'vercel',
        message: isBranchUrl
          ? 'Branch preview deployment is indexable'
          : 'Generated vercel.app URL is indexable',
        explanation: isBranchUrl
          ? 'Vercel sends x-robots-tag: noindex on every preview deployment so it cannot compete with production for the same content. This branch URL sends neither the header nor a robots meta noindex, which happens when the header has been disabled in vercel.json or overwritten by middleware.'
          : 'This vercel.app URL sends no noindex. If it is the production deployment on its generated domain that is expected, but if it is a preview or an old deployment it duplicates your production content in the index.',
        suggestion: isBranchUrl
          ? 'Remove any vercel.json or middleware rule that drops x-robots-tag on previews, or add the header for non-production builds using the VERCEL_ENV variable.'
          : 'Serve production from a custom domain, or add x-robots-tag: noindex to non-production builds using the VERCEL_ENV variable.',
        details: { host, xRobotsTag: xRobots || undefined, metaNoindex },
        url,
      });
    }
  }

  // 2. CDN cache state. Only worth reading when the response is one the CDN may store.
  const cacheControl = headers['cache-control'];
  const cdnCacheControl = headers['cdn-cache-control'];
  const cc = parseDirectives(cacheControl);
  const cdn = parseDirectives(cdnCacheControl);
  const personalised =
    'set-cookie' in headers || optsOut(cc) || optsOut(cdn) || (headers['vary'] ?? '').trim() === '*';
  if (personalised) return findings;

  const status = (headers['x-vercel-cache'] ?? '').toUpperCase();
  const cacheDetails = {
    xVercelCache: status || undefined,
    cacheControl,
    cdnCacheControl,
  };

  if (status === 'MISS') {
    findings.push({
      code: 'VERCEL_CACHE_MISS',
      severity: 'info',
      category: 'vercel',
      message: 'Page was not served from the Vercel CDN cache (x-vercel-cache: MISS)',
      explanation:
        'The CDN had nothing to serve and generated the response from your function. Vercel strips s-maxage before the client sees it, so a cold miss after a deploy and a page with no CDN lifetime look the same from outside.',
      suggestion:
        'Run the audit again. A second MISS on a page that is the same for every visitor means it is not being cached; set s-maxage (Vercel suggests max-age=0, s-maxage=86400) or use ISR.',
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

  // 3. Lifetime directives. CDN-Cache-Control wins over Cache-Control, and Cache-Control is
  // only forwarded verbatim when CDN-Cache-Control is present, so read what is actually visible.
  const ttl = cdn ? seconds(cdn, 's-maxage') ?? seconds(cdn, 'max-age') : seconds(cc, 's-maxage');
  const swr =
    seconds(cdn, 'stale-while-revalidate') ?? seconds(cc, 'stale-while-revalidate');

  if (status === 'MISS' && (cc === undefined || (cdn !== undefined && ttl === undefined))) {
    findings.push({
      code: 'VERCEL_CACHE_CONTROL_MISSING',
      severity: 'warning',
      category: 'vercel',
      message:
        cc === undefined
          ? 'No cache-control header on a page that missed the CDN cache'
          : 'cdn-cache-control sets no lifetime on a page that missed the CDN cache',
      explanation:
        'Without s-maxage (or max-age in cdn-cache-control) the CDN generates this page on every request. Vercel treats the default as public, max-age=0, must-revalidate, which caches nothing.',
      suggestion:
        'For pages that are the same for every visitor, send Cache-Control: max-age=0, s-maxage=86400 with a stale-while-revalidate window, or use ISR.',
      details: cacheDetails,
      url,
    });
  }

  if (ttl !== undefined) {
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
        details: { ...cacheDetails, sMaxage: ttl, floor: S_MAXAGE_FLOOR },
        url,
      });
    }
    if (swr === undefined) {
      findings.push({
        code: 'VERCEL_SWR_MISSING',
        severity: 'info',
        category: 'vercel',
        message: 'CDN lifetime is set without stale-while-revalidate',
        explanation:
          'When s-maxage runs out the next visitor waits for the origin. With stale-while-revalidate the CDN serves the stale copy and refreshes it in the background.',
        suggestion: 'Add stale-while-revalidate=N alongside s-maxage.',
        details: { ...cacheDetails, sMaxage: ttl },
        url,
      });
    }
  }

  return findings;
}
