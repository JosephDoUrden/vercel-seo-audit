import type { AuditContext, AuditFinding } from '../types.js';
import { DEFAULT_PATHS, SITEMAP_SAMPLE_SIZE } from '../constants.js';
import { fetchPage, fetchHead, followRedirectChain } from '../utils/http.js';
import { parseSitemapXml } from '../utils/xml-parser.js';
import { detectChallenge, edgeChallengeFinding } from '../utils/challenge.js';
import { getOrigin, isSameHost } from '../utils/url.js';
import { responseTooLarge } from '../utils/tooLarge.js';

const CROSS_HOST_EXAMPLES = 5;

function crossHostFinding(offHost: string[], sitemapUrl: string): AuditFinding[] {
  if (offHost.length === 0) return [];
  return [
    {
      code: 'SITEMAP_CROSS_HOST_URLS',
      severity: 'warning',
      category: 'sitemap',
      message: `${offHost.length} sitemap URL(s) are on another host and were not checked`,
      explanation:
        'Google only accepts sitemap URLs on the host the sitemap is served from, unless the robots.txt of the other host points to this sitemap. URLs on other hosts are likely ignored.',
      suggestion:
        'List only URLs on this host, or add a Sitemap: line for this sitemap to the robots.txt of the other host.',
      details: { count: offHost.length, examples: offHost.slice(0, CROSS_HOST_EXAMPLES) },
      url: sitemapUrl,
    },
  ];
}

export async function auditSitemap(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const origin = getOrigin(ctx.normalizedUrl);
  const sitemapUrl = `${origin}${DEFAULT_PATHS.sitemapXml}`;

  // 1. Check if sitemap is redirected
  const chain = await followRedirectChain(sitemapUrl, ctx.fetchOptions);
  if (chain.hops.length > 0) {
    findings.push({
      code: 'SITEMAP_REDIRECTED',
      severity: 'warning',
      category: 'sitemap',
      message: 'Sitemap URL is redirected',
      explanation:
        'Some search engines may not follow redirects to sitemaps, which could cause discovery issues.',
      suggestion:
        'Serve the sitemap directly at /sitemap.xml without redirects.',
      details: { hops: chain.hops, finalUrl: chain.finalUrl },
      url: sitemapUrl,
    });
  }

  // URLs on another host are counted, reported once and never requested. That
  // also keeps a public sitemap from pointing the audit at a private address.
  // The hosts the page and the sitemap redirected to count as this site's own.
  const ownHosts = [sitemapUrl, chain.finalUrl, ctx.finalUrl ?? sitemapUrl];
  const offHost: string[] = [];
  const onHost = (url: string): boolean => {
    // An unparsable URL is left to fail on its own, as before.
    if (!URL.canParse(url) || ownHosts.some((own) => isSameHost(url, own))) return true;
    offHost.push(url);
    return false;
  };

  // 2. Fetch and parse the sitemap
  let sitemapBody: string;
  try {
    const res = await fetchPage(sitemapUrl, ctx.fetchOptions);
    if (res.status !== 200) {
      const challenge = detectChallenge(res.headers, res.status);
      if (challenge) {
        findings.push(edgeChallengeFinding(challenge, 'sitemap', 'the sitemap', sitemapUrl));
        return findings;
      }
      findings.push({
        code: 'SITEMAP_MISSING',
        severity: 'warning',
        category: 'sitemap',
        message: 'sitemap.xml not found',
        explanation:
          'Without a sitemap, search engines rely solely on crawling to discover your pages, which may miss content.',
        suggestion:
          'Generate a sitemap.xml. In Next.js App Router, export a sitemap function from app/sitemap.ts.',
        url: sitemapUrl,
      });
      return findings;
    }
    if (res.truncated) findings.push(responseTooLarge(sitemapUrl, 'sitemap', res.headers));
    sitemapBody = res.body;
  } catch {
    findings.push({
      code: 'SITEMAP_MISSING',
      severity: 'warning',
      category: 'sitemap',
      message: 'sitemap.xml could not be fetched',
      explanation:
        'Without a sitemap, search engines rely solely on crawling to discover your pages.',
      suggestion: 'Ensure sitemap.xml is accessible at the root of your domain.',
      url: sitemapUrl,
    });
    return findings;
  }

  let parsed;
  try {
    parsed = parseSitemapXml(sitemapBody);
  } catch {
    findings.push({
      code: 'SITEMAP_MISSING',
      severity: 'error',
      category: 'sitemap',
      message: 'sitemap.xml contains invalid XML',
      explanation: 'Search engines cannot read malformed sitemap files.',
      suggestion: 'Validate and fix your sitemap XML structure.',
      url: sitemapUrl,
    });
    return findings;
  }

  // 3. Handle sitemap index
  if (parsed.type === 'sitemapindex') {
    // Resolve child sitemaps and collect all URLs for crawl mode
    const allUrls: string[] = [];
    for (const childUrl of parsed.sitemaps.filter(onHost)) {
      try {
        const childRes = await fetchPage(childUrl, ctx.fetchOptions);
        if (childRes.status === 200) {
          if (childRes.truncated) findings.push(responseTooLarge(childUrl, 'sitemap', childRes.headers));
          const childParsed = parseSitemapXml(childRes.body);
          if (childParsed.type === 'urlset') {
            allUrls.push(...childParsed.urls.map((u) => u.loc).filter(onHost));
          }
        }
      } catch {
        // Skip unreachable child sitemaps
      }
    }
    ctx.sitemapUrls = allUrls;
    findings.push(...crossHostFinding(offHost, sitemapUrl));

    findings.push({
      code: 'SITEMAP_MISSING',
      severity: 'pass',
      category: 'sitemap',
      message: `Sitemap index found with ${parsed.sitemaps.length} sitemap(s)`,
      explanation: 'A sitemap index is a valid approach for organizing large sitemaps.',
      suggestion: 'No action needed.',
      details: { sitemaps: parsed.sitemaps },
      url: sitemapUrl,
    });
    return findings;
  }

  // 4. Check for empty sitemap
  if (parsed.urls.length === 0) {
    findings.push({
      code: 'SITEMAP_EMPTY',
      severity: 'warning',
      category: 'sitemap',
      message: 'Sitemap contains no URLs',
      explanation: 'An empty sitemap provides no value for search engine crawling.',
      suggestion: 'Add your site pages to the sitemap.',
      url: sitemapUrl,
    });
    return findings;
  }

  // Store URLs for crawl mode
  const ownUrls = parsed.urls.map((u) => u.loc).filter(onHost);
  ctx.sitemapUrls = ownUrls;
  findings.push(...crossHostFinding(offHost, sitemapUrl));

  // 5. Sample URLs for status checks
  const sample = ownUrls.slice(0, SITEMAP_SAMPLE_SIZE);
  let errorCount = 0;

  for (const loc of sample) {
    try {
      const { status } = await fetchHead(loc, ctx.fetchOptions);
      if (status >= 400) {
        errorCount++;
        findings.push({
          code: 'SITEMAP_URL_ERROR',
          severity: 'warning',
          category: 'sitemap',
          message: `Sitemap URL returns ${status}: ${loc}`,
          explanation:
            'Sitemap URLs returning error status codes waste crawl budget and signal poor site quality.',
          suggestion: 'Remove broken URLs from the sitemap or fix the underlying pages.',
          details: { status },
          url: loc,
        });
      }
    } catch {
      // Network error for one URL shouldn't stop the audit
    }
  }

  if (errorCount === 0 && sample.length > 0) {
    findings.push({
      code: 'SITEMAP_MISSING',
      severity: 'pass',
      category: 'sitemap',
      message: `Sitemap found with ${parsed.urls.length} URLs (${sample.length} sampled, all OK)`,
      explanation: 'Your sitemap is valid and URLs are accessible.',
      suggestion: 'No action needed.',
      url: sitemapUrl,
    });
  }

  // 6. Cross-reference with robots.txt Sitemap directive
  if (ctx.robotsTxt) {
    const robotsSitemaps = ctx.robotsTxt
      .split('\n')
      .filter((l) => l.toLowerCase().trim().startsWith('sitemap:'))
      .map((l) => l.split(':').slice(1).join(':').trim());

    if (robotsSitemaps.length > 0 && !robotsSitemaps.includes(sitemapUrl) && !robotsSitemaps.includes(chain.finalUrl)) {
      findings.push({
        code: 'SITEMAP_ROBOTS_MISMATCH',
        severity: 'info',
        category: 'sitemap',
        message: 'Sitemap URL in robots.txt does not match /sitemap.xml',
        explanation:
          'Mismatched sitemap URLs between robots.txt and the default location may confuse crawlers.',
        suggestion: 'Ensure robots.txt Sitemap directive matches your actual sitemap URL.',
        details: { robotsSitemaps },
        url: sitemapUrl,
      });
    }
  }

  return findings;
}
