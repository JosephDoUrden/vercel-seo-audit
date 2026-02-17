import type { AuditContext, AuditFinding } from '../types.js';
import { DEFAULT_CRAWL_LIMIT, CRAWL_CONCURRENCY } from '../constants.js';
import { fetchPage } from '../utils/http.js';
import {
  getNoindexDirective,
  getTitle,
  getMetaTag,
  getCanonicalUrl,
} from '../utils/html-parser.js';
import * as cheerio from 'cheerio';

export async function auditCrawl(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  if (!ctx.sitemapUrls || ctx.sitemapUrls.length === 0) {
    return findings;
  }

  const limit = ctx.crawlLimit ?? DEFAULT_CRAWL_LIMIT;
  const urls = ctx.sitemapUrls.slice(0, limit);
  const total = urls.length;

  // Process in batches of CRAWL_CONCURRENCY
  for (let i = 0; i < urls.length; i += CRAWL_CONCURRENCY) {
    const batch = urls.slice(i, i + CRAWL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (pageUrl, batchIdx) => {
        const idx = i + batchIdx + 1;
        process.stderr.write(`Crawling [${idx}/${total}] ${pageUrl}\n`);
        return auditPage(pageUrl, ctx);
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        findings.push(...result.value);
      }
    }
  }

  return findings;
}

async function auditPage(
  pageUrl: string,
  ctx: AuditContext,
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  let body: string;
  let status: number;
  let headers: Headers;
  try {
    const res = await fetchPage(pageUrl, ctx.fetchOptions);
    body = res.body;
    status = res.status;
    headers = res.headers;
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
    return findings;
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
    return findings;
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
  if (!getTitle(body)) {
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
  if (!getMetaTag(body, 'description')) {
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
    const resolvedCanonical = new URL(canonical, pageUrl).href;
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
  const $ = cheerio.load(body);
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

  return findings;
}
