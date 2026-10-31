import * as cheerio from 'cheerio';
import type { AuditContext, AuditFinding, IssueCode, IssueSeverity } from '../types.js';
import { getCanonicalUrl, getHreflangLinks } from '../utils/html-parser.js';

// Vercel, "Avoiding duplicate content with vercel.app URLs" (updated 18 Sep 2026):
// "Duplicate URLs don't automatically incur a search penalty", but they "can split signals
// and make search engines choose a different canonical URL". Its advice is to "Set an
// absolute rel="canonical" URL for the corresponding page on your custom domain."
// https://vercel.com/kb/guide/avoiding-duplicate-content-with-vercel-app-urls
//
// The generated URL may not even be public: with Standard Protection "the production
// generated deployment URL becomes restricted" (https://vercel.com/docs/deployment-protection),
// so a crawler or a social card fetcher following it gets an auth wall instead of the page.
const VERCEL_APP_SUFFIX = '.vercel.app';

const MAX_OCCURRENCES = 10;

// The JSON-LD keys whose string values are URLs worth checking.
const JSONLD_KEYS = new Set(['url', '@id', 'image', 'logo']);

// Tags where any foreign host is worth a note. Canonical is left to CANONICAL_EXTERNAL in
// metadata.ts, and images or logos on a CDN host are normal.
const MISMATCH_TAGS = new Set(['og:url']);

interface Candidate {
  tag: string;
  value: string;
}

interface Occurrence {
  tag: string;
  url: string;
  host: string;
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

// Lower-case, no trailing dot, no www, so www and apex compare equal.
function siteHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function collectJsonLd(value: unknown, out: Candidate[], key?: string): void {
  if (typeof value === 'string') {
    if (key && JSONLD_KEYS.has(key)) out.push({ tag: `jsonld:${key}`, value });
  } else if (Array.isArray(value)) {
    // An array keeps the key it sits under, so "image": ["a", "b"] is read as two images.
    for (const item of value) collectJsonLd(item, out, key);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectJsonLd(v, out, k);
  }
}

function candidates(html: string): Candidate[] {
  const $ = cheerio.load(html);
  const out: Candidate[] = [];

  const canonical = getCanonicalUrl(html);
  if (canonical) out.push({ tag: 'canonical', value: canonical });

  for (const tag of ['og:image', 'og:url', 'twitter:image']) {
    $(`meta[property="${tag}"], meta[name="${tag}"]`).each((_, el) => {
      const content = $(el).attr('content')?.trim();
      if (content) out.push({ tag, value: content });
    });
  }

  for (const link of getHreflangLinks(html)) out.push({ tag: 'hreflang', value: link.href });

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectJsonLd(JSON.parse($(el).text()), out);
    } catch {
      // Malformed JSON-LD is reported by the structuredData module
    }
  });

  return out;
}

export async function auditHostLeak(ctx: AuditContext): Promise<AuditFinding[]> {
  // Reads the page phase 0 fetched and nothing else: no request is made, not even to the URLs found.
  if (!ctx.html) return [];

  const pageUrl = ctx.finalUrl ?? ctx.normalizedUrl;
  // The audited host and the host it redirected to both count as the site.
  const own = new Set([ctx.normalizedUrl, pageUrl].map((u) => siteHost(new URL(u).hostname)));
  const siteOnVercelApp = [...own].some((h) => h.endsWith(VERCEL_APP_SUFFIX));

  const local: Occurrence[] = [];
  const vercelApp: Occurrence[] = [];
  const mismatch: Occurrence[] = [];

  for (const { tag, value } of candidates(ctx.html)) {
    let parsed: URL;
    try {
      parsed = new URL(value, pageUrl);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;

    const host = siteHost(parsed.hostname);
    const occurrence = { tag, url: parsed.href, host: parsed.hostname };
    if (isLocalHost(host)) local.push(occurrence);
    else if (own.has(host)) continue;
    else if (host.endsWith(VERCEL_APP_SUFFIX) && !siteOnVercelApp) vercelApp.push(occurrence);
    else if (MISMATCH_TAGS.has(tag)) mismatch.push(occurrence);
  }

  const findings: AuditFinding[] = [];
  const report = (
    list: Occurrence[],
    code: IssueCode,
    severity: IssueSeverity,
    text: Pick<AuditFinding, 'message' | 'explanation' | 'suggestion'>,
  ): void => {
    if (list.length === 0) return;
    findings.push({
      code,
      severity,
      category: 'metadata',
      ...text,
      details: { count: list.length, occurrences: list.slice(0, MAX_OCCURRENCES) },
      url: ctx.normalizedUrl,
    });
  };

  report(local, 'URL_HOST_LOCALHOST', 'error', {
    message: 'Page URLs point at localhost or a local network name',
    explanation:
      'A canonical, social card, hreflang or JSON-LD URL names a host that only resolves on a developer machine. Search engines and social card fetchers cannot reach it, so the tag is useless or, for a canonical, actively wrong.',
    suggestion:
      'Build these URLs from the production origin, for example a NEXT_PUBLIC_SITE_URL variable or metadataBase in Next.js, not from the request host or a local default.',
  });
  report(vercelApp, 'URL_HOST_VERCEL_APP', 'warning', {
    message: 'Page URLs point at a vercel.app host instead of this domain',
    explanation:
      'A canonical, social card, hreflang or JSON-LD URL names a generated vercel.app host. Vercel says duplicate vercel.app URLs can split signals and make search engines pick a different canonical, and with Standard Deployment Protection the generated URL is not public at all.',
    suggestion:
      'Build these URLs from your custom domain rather than VERCEL_URL, and point the canonical at the custom domain.',
  });
  report(mismatch, 'URL_HOST_MISMATCH', 'info', {
    message: 'og:url points at a different host',
    explanation:
      'The og:url names a host other than the audited site, so shares of this page are attributed to that host.',
    suggestion: 'Verify this is intentional. Otherwise set og:url to this page on its own domain.',
  });

  return findings;
}
