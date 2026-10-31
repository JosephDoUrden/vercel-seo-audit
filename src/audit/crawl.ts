import type { AuditContext, AuditFinding } from '../types.js';
import { DEFAULT_CRAWL_LIMIT, CRAWL_CONCURRENCY } from '../constants.js';
import { fetchPage } from '../utils/http.js';
import { responseTooLarge } from '../utils/tooLarge.js';
import { reachesPrivateAddress } from '../utils/url.js';
import {
  getNoindexDirective,
  getTitle,
  getMetaTag,
  getCanonicalUrl,
  getCanonicalLinks,
  getHreflangLinks,
  getImages,
  locateMetadata,
  parseHtml,
} from '../utils/html-parser.js';
import { canonicalHrefKind, distinctCanonicalCount } from './metadata.js';
import { imagesMissingAlt } from './images.js';
import { hasHreflangSelfReference } from './i18n.js';

// Crawl-wide findings name at most this many duplicate groups, and each group at most this many URLs.
const MAX_DUPLICATE_GROUPS = 10;
const MAX_LISTED_URLS = 10;

// The metadata tags whose place in the document this module reads; Open Graph has its own check.
const STREAMED_TAGS = ['title', 'description', 'canonical'] as const;

/** What the crawl-wide checks need from one page that answered 2xx. */
interface PageFacts {
  url: string;
  title: string | null;
  description: string | null;
  /** The canonical resolved against the page URL. */
  canonical?: string;
}

interface PageResult {
  findings: AuditFinding[];
  facts?: PageFacts;
}

function stripSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function auditCrawl(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const pages: PageFacts[] = [];

  if (!ctx.sitemapUrls || ctx.sitemapUrls.length === 0) {
    return findings;
  }

  const limit = ctx.crawlLimit ?? DEFAULT_CRAWL_LIMIT;
  // The sitemap module already dropped URLs on other hosts; this keeps a
  // private address out even when ctx.sitemapUrls was filled some other way.
  const urls = ctx.sitemapUrls.filter((u) => ctx.fetchOptions.allowPrivate || !reachesPrivateAddress(u, ctx.normalizedUrl)).slice(0, limit);
  const total = urls.length;

  // Process in batches of CRAWL_CONCURRENCY
  for (let i = 0; i < urls.length; i += CRAWL_CONCURRENCY) {
    // An aborted audit is rejected by runAudit; the rest of the sitemap is not worth a line each.
    if (ctx.fetchOptions.signal?.aborted) break;
    const batch = urls.slice(i, i + CRAWL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (pageUrl, batchIdx) => {
        const idx = i + batchIdx + 1;
        process.stderr.write(`Crawling [${idx}/${total}] ${pageUrl}\n`);
        return auditPage(pageUrl, ctx);
      }),
    );

    // allSettled keeps sitemap order, so per-page findings come out in that order.
    for (const result of results) {
      if (result.status === 'fulfilled') {
        findings.push(...result.value.findings);
        if (result.value.facts) pages.push(result.value.facts);
      }
    }
  }

  findings.push(...duplicates(pages, 'title'), ...duplicates(pages, 'description'), ...canonicalChains(pages));
  return findings;
}

const DUPLICATE_COPY = {
  title: {
    code: 'CRAWL_DUPLICATE_TITLES',
    category: 'crawl',
    label: 'title',
    explanation:
      'Pages that share a <title> look like duplicates to search engines, which may show one and fold the others into it, and the results read the same to a searcher.',
    suggestion: 'Give each page a <title> that says what sets it apart from the others.',
  },
  description: {
    code: 'CRAWL_DUPLICATE_DESCRIPTIONS',
    category: 'crawl',
    label: 'meta description',
    explanation:
      'A meta description repeated across pages does not help a searcher choose between them, and search engines tend to replace it with text from the page.',
    suggestion: 'Write a meta description for each page that summarises that page, or leave it out where you cannot.',
  },
} as const;

// One finding per value that two or more crawled pages share, ordered by the value.
function duplicates(pages: readonly PageFacts[], field: 'title' | 'description'): AuditFinding[] {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const value = page[field];
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), page.url]);
  }
  const copy = DUPLICATE_COPY[field];
  return [...groups]
    .filter(([, urls]) => urls.length > 1)
    .sort(([a], [b]) => byString(a, b))
    .slice(0, MAX_DUPLICATE_GROUPS)
    .map(([value, urls]): AuditFinding => {
      const sorted = [...urls].sort(byString);
      return {
        code: copy.code,
        severity: 'warning',
        category: copy.category,
        message: `${urls.length} crawled pages share the ${copy.label} "${value}"`,
        explanation: copy.explanation,
        suggestion: copy.suggestion,
        details: { [field]: value, count: urls.length, urls: sorted.slice(0, MAX_LISTED_URLS) },
        url: sorted[0],
      };
    });
}

// A canonical to a crawled page whose own canonical names another URL again. Only pages this
// crawl fetched are read, so a chain through a page outside it is not seen.
function canonicalChains(pages: readonly PageFacts[]): AuditFinding[] {
  const byUrl = new Map(pages.map((p) => [stripSlash(p.url), p]));
  const findings: AuditFinding[] = [];
  for (const page of [...pages].sort((a, b) => byString(a.url, b.url))) {
    if (!page.canonical || stripSlash(page.canonical) === stripSlash(page.url)) continue;
    const target = byUrl.get(stripSlash(page.canonical));
    if (!target?.canonical || stripSlash(target.canonical) === stripSlash(target.url)) continue;
    findings.push({
      code: 'CRAWL_CANONICAL_CHAIN',
      severity: 'warning',
      category: 'crawl',
      message: `Canonical points at a page with a canonical of its own: ${page.url}`,
      explanation:
        'This page names another crawled page as canonical, and that page names a different URL again. Google treats a canonical as a hint, and a chain of them makes it likelier to pick one you did not mean.',
      suggestion: `Point the canonical straight at the final URL (${target.canonical}), or make ${target.url} canonical to itself.`,
      details: { canonical: page.canonical, next: target.canonical },
      url: page.url,
    });
  }
  return findings;
}

async function auditPage(
  pageUrl: string,
  ctx: AuditContext,
): Promise<PageResult> {
  const findings: AuditFinding[] = [];

  let body: string;
  let status: number;
  let headers: Headers;
  let finalUrl: string;
  // Each crawled page is fetched once, so the audit cache would only pin every
  // body in memory until the audit ends.
  const { timeout, userAgent, signal, maxBytes, allowPrivate } = ctx.fetchOptions;
  try {
    const res = await fetchPage(pageUrl, { timeout, userAgent, auditedUrl: ctx.normalizedUrl, signal, maxBytes, allowPrivate });
    body = res.body;
    status = res.status;
    headers = res.headers;
    finalUrl = res.finalUrl;
    if (res.truncated) findings.push(responseTooLarge(pageUrl, 'crawl', headers, 'html', maxBytes));
  } catch {
    findings.push({
      code: 'CRAWL_PAGE_ERROR',
      severity: 'error',
      category: 'crawl',
      message: `Failed to fetch page: ${pageUrl}`,
      explanation: 'The page could not be reached, which means search engines cannot crawl it either.',
      suggestion: 'Ensure the page is accessible and not timing out.',
      url: pageUrl,
    });
    return { findings };
  }

  // Non-2xx status
  if (status < 200 || status >= 300) {
    findings.push({
      code: 'CRAWL_PAGE_ERROR',
      severity: 'error',
      category: 'crawl',
      message: `Page returned HTTP ${status}: ${pageUrl}`,
      explanation: 'Pages in the sitemap should return a 200 status. Non-2xx pages waste crawl budget.',
      suggestion: 'Fix the page or remove it from the sitemap.',
      details: { status },
      url: pageUrl,
    });
    return { findings };
  }

  // noindex via meta tag
  if (getNoindexDirective(body)) {
    findings.push({
      code: 'CRAWL_PAGE_NOINDEX',
      severity: 'warning',
      category: 'crawl',
      message: `Page has noindex directive: ${pageUrl}`,
      explanation: 'A page in the sitemap should not have a noindex directive — it sends conflicting signals to search engines.',
      suggestion: 'Remove the noindex tag or remove the page from the sitemap.',
      url: pageUrl,
    });
  }

  // noindex via X-Robots-Tag header
  const xRobotsTag = headers.get('x-robots-tag') ?? '';
  if (xRobotsTag.toLowerCase().includes('noindex')) {
    findings.push({
      code: 'CRAWL_PAGE_NOINDEX',
      severity: 'warning',
      category: 'crawl',
      message: `Page has X-Robots-Tag noindex header: ${pageUrl}`,
      explanation: 'The X-Robots-Tag header tells search engines not to index this page, conflicting with its presence in the sitemap.',
      suggestion: 'Remove the X-Robots-Tag noindex header or remove the page from the sitemap.',
      url: pageUrl,
    });
  }

  // Missing title
  const title = getTitle(body);
  if (!title) {
    findings.push({
      code: 'CRAWL_PAGE_TITLE_MISSING',
      severity: 'warning',
      category: 'crawl',
      message: `Page is missing <title>: ${pageUrl}`,
      explanation: 'The title tag is a critical ranking signal and is displayed in search results.',
      suggestion: 'Add a unique, descriptive <title> tag to this page.',
      url: pageUrl,
    });
  }

  // Missing meta description
  const description = getMetaTag(body, 'description');
  if (!description) {
    findings.push({
      code: 'CRAWL_PAGE_DESCRIPTION_MISSING',
      severity: 'info',
      category: 'crawl',
      message: `Page is missing meta description: ${pageUrl}`,
      explanation: 'Meta descriptions are shown in search result snippets and can improve click-through rates.',
      suggestion: 'Add a <meta name="description"> tag with a concise summary of the page.',
      url: pageUrl,
    });
  }

  // Missing canonical
  const canonical = getCanonicalUrl(body);
  let resolvedCanonical: string | undefined;
  if (!canonical) {
    findings.push({
      code: 'CRAWL_PAGE_CANONICAL_MISSING',
      severity: 'warning',
      category: 'crawl',
      message: `Page is missing canonical tag: ${pageUrl}`,
      explanation: 'Without a canonical tag, search engines may treat URL variations as duplicate content.',
      suggestion: 'Add a <link rel="canonical"> tag pointing to the preferred URL.',
      url: pageUrl,
    });
  } else {
    // Canonical mismatch
    resolvedCanonical = new URL(canonical, pageUrl).href;
    const normalizedPage = pageUrl.replace(/\/$/, '');
    const normalizedCanonical = resolvedCanonical.replace(/\/$/, '');
    if (normalizedCanonical !== normalizedPage) {
      findings.push({
        code: 'CRAWL_PAGE_CANONICAL_MISMATCH',
        severity: 'warning',
        category: 'crawl',
        message: `Canonical URL does not match page URL: ${pageUrl}`,
        explanation: 'The canonical tag points to a different URL, which tells search engines this page is a duplicate.',
        suggestion: 'Update the canonical tag to match the page URL, or remove this page from the sitemap.',
        details: { canonical: resolvedCanonical, pageUrl },
        url: pageUrl,
      });
    }
  }

  // Missing JSON-LD
  const $ = parseHtml(body);
  const jsonldScripts = $('script[type="application/ld+json"]');
  if (jsonldScripts.length === 0) {
    findings.push({
      code: 'CRAWL_PAGE_JSONLD_MISSING',
      severity: 'info',
      category: 'crawl',
      message: `Page has no structured data: ${pageUrl}`,
      explanation: 'Structured data helps search engines understand page content and can enable rich results.',
      suggestion: 'Add JSON-LD structured data relevant to the page content.',
      url: pageUrl,
    });
  }

  findings.push(...canonicalIntegrity(body, pageUrl), ...pageChecks(body, pageUrl, finalUrl));

  return { findings, facts: { url: pageUrl, title, description, canonical: resolvedCanonical } };
}

// The canonical checks from the metadata module that read only this page's HTML. The target
// fetch (CANONICAL_TARGET_NOT_OK) would be another request per page, so it is not run here.
function canonicalIntegrity(body: string, pageUrl: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const tags = getCanonicalLinks(body);
  const headTags = tags.filter((t) => t.inHead);

  if (distinctCanonicalCount(headTags, pageUrl) > 1) {
    findings.push({
      code: 'CRAWL_PAGE_CANONICAL_MULTIPLE',
      severity: 'warning',
      category: 'crawl',
      message: `${headTags.length} canonical tags name different URLs: ${pageUrl}`,
      explanation:
        'Google says conflicting or multiple rel="canonical" link tags "may lead to unexpected results": it can pick one you did not mean, or ignore them and choose the canonical itself.',
      suggestion: 'Keep one <link rel="canonical"> in <head>. A layout and a page that both set it are the usual cause.',
      details: { hrefs: headTags.map((t) => t.href) },
      url: pageUrl,
    });
  }

  // As on the entry page, the first canonical in <head>, or in <body> when <head> has none.
  const href = (headTags[0] ?? tags[0])?.href;
  const kind = href === undefined ? undefined : canonicalHrefKind(href);
  if (kind) {
    findings.push({
      code: 'CRAWL_PAGE_CANONICAL_RELATIVE',
      severity: 'warning',
      category: 'crawl',
      message:
        kind === 'fragment' ? `The canonical URL carries a fragment: ${pageUrl}` : `The canonical URL is relative: ${pageUrl}`,
      explanation:
        kind === 'fragment'
          ? 'Google says not to specify a URL fragment as canonical, "as Google generally doesn\'t support URL fragments".'
          : 'Google supports relative canonicals but recommends absolute URLs: a relative one points at whichever host serves the page, so a crawled preview or testing deployment names itself as canonical.',
      suggestion: 'Use the full absolute URL, with scheme and host and no fragment.',
      details: { href, kind },
      url: pageUrl,
    });
  }

  return findings;
}

// hreflang self-reference, image alt text, Open Graph and metadata placement, each through the
// helper its entry-page module uses, without the extra requests those modules make.
function pageChecks(body: string, pageUrl: string, finalUrl: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Only the self-reference: x-default per page would repeat one finding across every locale,
  // and reciprocity needs a fetch per alternate.
  const hreflang = getHreflangLinks(body);
  if (
    hreflang.length > 0 &&
    !hasHreflangSelfReference(hreflang, pageUrl) &&
    !hasHreflangSelfReference(hreflang, finalUrl)
  ) {
    findings.push({
      code: 'CRAWL_PAGE_HREFLANG_MISSING_SELF',
      severity: 'warning',
      category: 'crawl',
      message: `Hreflang tags do not include this page: ${pageUrl}`,
      explanation:
        'Every page with hreflang tags should include a link pointing to itself. Without it, search engines may ignore all hreflang annotations on this page.',
      suggestion: 'Add a <link rel="alternate" hreflang="..."> tag whose href matches this page\'s URL.',
      details: { hreflang: hreflang.map((l) => l.hreflang) },
      url: pageUrl,
    });
  }

  const missingAlt = imagesMissingAlt(getImages(body));
  if (missingAlt.length > 0) {
    findings.push({
      code: 'CRAWL_PAGE_IMAGES_MISSING_ALT',
      severity: 'warning',
      category: 'crawl',
      message: `${missingAlt.length} image(s) missing alt attribute: ${pageUrl}`,
      explanation: 'Images without alt attributes are inaccessible to screen readers and may hurt SEO rankings.',
      suggestion: 'Add descriptive alt text to all images. Use alt="" only for purely decorative images.',
      details: { count: missingAlt.length, srcs: missingAlt.slice(0, MAX_LISTED_URLS).map((i) => i.src) },
      url: pageUrl,
    });
  }

  const ogMissing = (['og:title', 'og:image'] as const).filter((tag) => !getMetaTag(body, tag));
  if (ogMissing.length > 0) {
    findings.push({
      code: 'CRAWL_PAGE_OG_MISSING',
      severity: 'warning',
      category: 'crawl',
      message: `Page is missing ${ogMissing.join(' and ')}: ${pageUrl}`,
      explanation:
        'Social platforms and chat apps build a link preview from og:title and og:image; without them a shared link shows a bare URL or whatever the platform guesses.',
      suggestion: 'Add <meta property="og:title"> and <meta property="og:image"> (an absolute URL) to this page.',
      details: { missing: ogMissing },
      url: pageUrl,
    });
  }

  const { bodyOnly } = locateMetadata(body);
  const inBody = STREAMED_TAGS.filter((tag) => bodyOnly.has(tag));
  if (inBody.length > 0) {
    findings.push({
      code: 'CRAWL_PAGE_METADATA_IN_BODY',
      severity: 'warning',
      category: 'crawl',
      message: `Page metadata is only in <body>: ${pageUrl}`,
      explanation: `With the audit's user agent, ${inBody.join(', ')} appeared only in <body>. Next.js 15.2 and later stream dynamic generateMetadata output there for user agents not on its HTML-limited bot list, and crawlers that read only <head> without running JavaScript miss it. A crawled page is fetched once, so unlike the entry page there is no second request as an HTML-limited bot to tell streaming apart from tags that never reach <head>.`,
      suggestion:
        'Export static metadata where the values do not depend on the request, or audit this URL on its own to see what an HTML-limited bot gets.',
      details: { bodyOnly: inBody },
      url: pageUrl,
    });
  }

  return findings;
}
