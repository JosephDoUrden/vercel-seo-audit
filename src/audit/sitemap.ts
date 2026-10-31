import { XMLValidator } from 'fast-xml-parser';
import type { AuditContext, AuditFinding } from '../types.js';
import { DEFAULT_PATHS, MAX_SITEMAP_BYTES, SITEMAP_MAX_URLS, SITEMAP_SAMPLE_SIZE } from '../constants.js';
import { fetchPage, fetchHead, followRedirectChain } from '../utils/http.js';
import { parseSitemapXml, type SitemapUrl } from '../utils/xml-parser.js';
import { detectChallenge, edgeChallengeFinding } from '../utils/challenge.js';
import { getOrigin, isSameHost, reachesPrivateAddress } from '../utils/url.js';
import { responseTooLarge } from '../utils/tooLarge.js';

const EXAMPLES = 5;
const IDENTICAL_LASTMOD_MIN_URLS = 10;

// Quotes below are from https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
// (updated 08 Jul 2026) unless marked as Search Console's sitemaps report help,
// https://support.google.com/webmasters/answer/7451001 (read 31 Oct 2026).

// Search Console: "Make sure your dates match one of the following W3C Datetime formats:
// 2005-02-21 2005-02-21T18:00:15+00:00 Specifying time is optional (the time defaults to
// 00:00:00Z), but if you do specify a time, you must also specify a time zone."
// Seconds and fractions are optional in W3C Datetime, so hh:mm and hh:mm:ss.s pass too.
const W3C_DATETIME =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d))?$/;

// The entities XML defines itself. Any other named entity needs an <!ENTITY> declaration.
const PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * "As with all XML files, all tag values must be entity escaped." fast-xml-parser's parse
 * reads past a bare `&` or `<` and an unclosed tag, so the well-formedness check runs on its
 * own and the lenient parse still feeds the rest of the audit. XMLValidator catches a bare
 * `&`, a bare `<` and a missing closing tag, but accepts an undeclared entity such as
 * `&nbsp;`, so that is checked here.
 */
function wellFormedness(body: string): Record<string, unknown> | undefined {
  const result = XMLValidator.validate(body);
  if (result !== true) return { reason: result.err.msg, line: result.err.line, column: result.err.col };
  if (!body.includes('&')) return undefined;
  // Text inside CDATA and comments is not parsed for entities. Blank it, keeping the newlines.
  const text = body.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '));
  const declared = new Set([...text.matchAll(/<!ENTITY\s+([A-Za-z_:][\w.:-]*)/g)].map((m) => m[1]));
  for (const m of text.matchAll(/&([A-Za-z_:][\w.:-]*);/g)) {
    if (PREDEFINED_ENTITIES.has(m[1]) || declared.has(m[1])) continue;
    return { reason: `Entity '${m[0]}' is not declared.`, line: lineAt(text, m.index), entity: m[0] };
  }
  return undefined;
}

function malformedFinding(details: Record<string, unknown>, sitemapUrl: string): AuditFinding {
  return {
    code: 'SITEMAP_MALFORMED_XML',
    severity: 'error',
    category: 'sitemap',
    message: `Sitemap is not well-formed XML (line ${String(details.line)}): ${sitemapUrl}`,
    explanation:
      'Google says "all tag values must be entity escaped" and reads a sitemap as XML. A bare & or <, a missing closing tag or an undeclared entity can make it drop URLs or the whole file. The rest of this audit ran on what a lenient parser could recover.',
    suggestion:
      'Escape & as &amp; and < as &lt; in every value (query strings are the usual cause), close every tag, and use numeric references such as &#233; instead of HTML entities.',
    details,
    url: sitemapUrl,
  };
}

function isAbsoluteUrl(loc: string): boolean {
  return /^https?:\/\//i.test(loc) && URL.canParse(loc);
}

function relativeUrlsFinding(locs: string[], sitemapUrl: string): AuditFinding[] {
  const relative = locs.filter((loc) => !isAbsoluteUrl(loc));
  if (relative.length === 0) return [];
  return [
    {
      code: 'SITEMAP_RELATIVE_URLS',
      severity: 'warning',
      category: 'sitemap',
      message: `${relative.length} sitemap <loc> value(s) are not absolute URLs`,
      explanation:
        'Google says "Use fully-qualified, absolute URLs in your sitemaps." and not "a URL such as /mypage.html (a relative URL)". It does not resolve these against the sitemap URL.',
      suggestion: 'Write each <loc> as a full URL, scheme and host included, such as https://example.com/mypage.html.',
      details: { count: relative.length, examples: relative.slice(0, EXAMPLES) },
      url: sitemapUrl,
    },
  ];
}

/** The checks on the <url> entries of one urlset file, one finding per code. */
function urlsetFindings(urls: SitemapUrl[], sitemapUrl: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  if (urls.length > SITEMAP_MAX_URLS) {
    findings.push({
      code: 'SITEMAP_TOO_MANY_URLS',
      severity: 'error',
      category: 'sitemap',
      message: `Sitemap lists ${urls.length} URLs, over Google's limit of ${SITEMAP_MAX_URLS}: ${sitemapUrl}`,
      explanation:
        'Google says "All formats limit a single sitemap to 50MB (uncompressed) or 50,000 URLs." A sitemap over the limit is not read in full.',
      suggestion:
        'Split it into sitemaps of at most 50,000 URLs each and list them in a sitemap index. In Next.js, generateSitemaps in app/sitemap.ts does this.',
      details: { count: urls.length, limit: SITEMAP_MAX_URLS },
      url: sitemapUrl,
    });
  }

  findings.push(...relativeUrlsFinding(urls.map((u) => u.loc), sitemapUrl));

  const lastmods = urls.map((u) => u.lastmod?.trim()).filter((v): v is string => v !== undefined && v !== '');
  const invalid = lastmods.filter((v) => !W3C_DATETIME.test(v));
  if (invalid.length > 0) {
    findings.push({
      code: 'SITEMAP_LASTMOD_INVALID',
      severity: 'warning',
      category: 'sitemap',
      message: `${invalid.length} <lastmod> value(s) are not W3C Datetime`,
      explanation:
        'Search Console reports "Invalid date" for these. Google accepts a date (2005-02-21) or a date and time with a time zone (2005-02-21T18:00:15+00:00): "if you do specify a time, you must also specify a time zone."',
      suggestion:
        'Write lastmod as YYYY-MM-DD or a full ISO 8601 timestamp with Z or an offset. In app/sitemap.ts, pass a Date or date.toISOString().',
      details: { count: invalid.length, examples: invalid.slice(0, EXAMPLES) },
      url: sitemapUrl,
    });
  }

  // Every URL carries a lastmod with a time, and all of them fall in the same second. Dates
  // without a time are left alone: a whole site updated on one day is plausible.
  if (urls.length >= IDENTICAL_LASTMOD_MIN_URLS && lastmods.length === urls.length) {
    const seconds = new Set(
      lastmods.map((v) => (v.includes('T') && W3C_DATETIME.test(v) ? Math.floor(Date.parse(v) / 1000) : NaN)),
    );
    const [only] = seconds;
    if (seconds.size === 1 && !Number.isNaN(only)) {
      findings.push({
        code: 'SITEMAP_LASTMOD_IDENTICAL',
        severity: 'info',
        category: 'sitemap',
        message: `All ${urls.length} <lastmod> values are the same timestamp: ${sitemapUrl}`,
        explanation:
          'Google uses lastmod only "if it\'s consistently and verifiably (for example by comparing to the last modification of the page) accurate." One timestamp on every URL is the build or request time, not when each page changed, so Google is likely to ignore lastmod for this sitemap.',
        suggestion:
          'Set lastmod from when each page last changed (CMS updatedAt, file mtime, git log), or leave it out. next-sitemap and an app/sitemap.ts that sets lastModified: new Date() cause this.',
        details: { count: urls.length, lastmod: urls[0].lastmod },
        url: sitemapUrl,
      });
    }
  }

  return findings;
}

function ignoredFieldsFinding(urls: SitemapUrl[], sitemapUrl: string): AuditFinding[] {
  const priority = urls.filter((u) => u.priority !== undefined).length;
  const changefreq = urls.filter((u) => u.changefreq !== undefined).length;
  if (priority === 0 && changefreq === 0) return [];
  return [
    {
      code: 'SITEMAP_IGNORED_FIELDS',
      severity: 'info',
      category: 'sitemap',
      message: 'Sitemap sets <priority> or <changefreq>, which Google ignores',
      explanation: 'Google says "Google ignores <priority> and <changefreq> values." They do no harm, and do nothing.',
      suggestion:
        'Drop them to keep the sitemap smaller, or keep them for other search engines. In app/sitemap.ts, leave out priority and changeFrequency.',
      details: { priority, changefreq },
      url: sitemapUrl,
    },
  ];
}

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
      details: { count: offHost.length, examples: offHost.slice(0, EXAMPLES) },
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
  // A redirect the walk refused to follow ends on a private address; that is
  // not this site's host.
  const ownHosts = [sitemapUrl, ctx.finalUrl ?? sitemapUrl];
  if (!reachesPrivateAddress(chain.finalUrl, sitemapUrl)) ownHosts.push(chain.finalUrl);
  const sitemapFetch = { ...ctx.fetchOptions, maxBytes: MAX_SITEMAP_BYTES };
  const offHost: string[] = [];
  const onHost = (url: string): boolean => {
    // An unparsable URL is left to fail on its own, as before.
    if (!URL.canParse(url) || ownHosts.some((own) => isSameHost(url, own))) return true;
    offHost.push(url);
    return false;
  };

  // 2. Fetch and parse the sitemap
  let sitemapBody: string;
  let sitemapTruncated = false;
  try {
    const res = await fetchPage(sitemapUrl, sitemapFetch);
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
    if (res.truncated) findings.push(responseTooLarge(sitemapUrl, 'sitemap', res.headers, 'sitemap'));
    sitemapBody = res.body;
    sitemapTruncated = res.truncated === true;
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

  // A body cut at the cap is broken XML by construction; RESPONSE_TOO_LARGE already says so.
  const malformed = sitemapTruncated ? undefined : wellFormedness(sitemapBody);
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
      ...(malformed ? { details: malformed } : {}),
      url: sitemapUrl,
    });
    return findings;
  }
  if (malformed) findings.push(malformedFinding(malformed, sitemapUrl));

  // 3. Handle sitemap index
  if (parsed.type === 'sitemapindex') {
    findings.push(...relativeUrlsFinding(parsed.sitemaps, sitemapUrl));
    // Resolve child sitemaps and collect all URLs for crawl mode. Only one level is
    // followed: a child that is itself an index is reported, not fetched further.
    const allUrls: string[] = [];
    const nested: string[] = [];
    let ignoredReported = false;
    for (const childUrl of parsed.sitemaps.filter(onHost)) {
      try {
        const childRes = await fetchPage(childUrl, sitemapFetch);
        if (childRes.status === 200) {
          if (childRes.truncated) findings.push(responseTooLarge(childUrl, 'sitemap', childRes.headers, 'sitemap'));
          const childMalformed = childRes.truncated ? undefined : wellFormedness(childRes.body);
          if (childMalformed) findings.push(malformedFinding(childMalformed, childUrl));
          const childParsed = parseSitemapXml(childRes.body);
          if (childParsed.type === 'urlset') {
            findings.push(...urlsetFindings(childParsed.urls, childUrl));
            if (!ignoredReported) {
              const ignored = ignoredFieldsFinding(childParsed.urls, childUrl);
              findings.push(...ignored);
              ignoredReported = ignored.length > 0;
            }
            allUrls.push(...childParsed.urls.map((u) => u.loc).filter(onHost));
          } else {
            nested.push(childUrl);
          }
        }
      } catch {
        // Skip unreachable child sitemaps
      }
    }
    ctx.sitemapUrls = allUrls;
    findings.push(...crossHostFinding(offHost, sitemapUrl));

    if (nested.length > 0) {
      findings.push({
        code: 'SITEMAP_INDEX_NESTED',
        severity: 'warning',
        category: 'sitemap',
        message: `Sitemap index lists ${nested.length} other sitemap index file(s)`,
        explanation:
          'Search Console reports "Nested sitemap indexes" here: "A sitemap index file can\'t list other sitemap index files, only sitemap files." The URLs in the nested indexes are likely never read. They were not followed here either.',
        suggestion:
          'List the sitemaps inside the nested index directly in this one, or submit the nested index on its own in Search Console.',
        details: { count: nested.length, examples: nested.slice(0, EXAMPLES) },
        url: sitemapUrl,
      });
    }

    if (!malformed) {
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
    }
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

  const structural = urlsetFindings(parsed.urls, sitemapUrl);
  findings.push(...structural, ...ignoredFieldsFinding(parsed.urls, sitemapUrl));
  const invalid = malformed !== undefined || structural.some((f) => f.severity === 'error');

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

  if (errorCount === 0 && sample.length > 0 && !invalid) {
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
