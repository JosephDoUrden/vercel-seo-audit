import type { AuditContext, AuditFinding } from '../types.js';
import { DEFAULT_PATHS, ROBOTS_TXT_MAX_BYTES } from '../constants.js';
import { detectChallenge, edgeChallengeFinding } from '../utils/challenge.js';
import { fetchPage } from '../utils/http.js';
import { getOrigin } from '../utils/url.js';

interface RobotsRule {
  userAgent: string;
  disallow: string[];
  allow: string[];
}

function parseRobotsTxt(txt: string): { rules: RobotsRule[]; sitemaps: string[] } {
  const lines = txt.split('\n').map((l) => l.trim());
  const rules: RobotsRule[] = [];
  const sitemaps: string[] = [];
  let current: RobotsRule | null = null;

  for (const line of lines) {
    if (line.startsWith('#') || line === '') continue;

    const [key, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const keyLower = key.toLowerCase().trim();

    if (keyLower === 'user-agent') {
      current = { userAgent: value, disallow: [], allow: [] };
      rules.push(current);
    } else if (keyLower === 'disallow' && current) {
      if (value) current.disallow.push(value);
    } else if (keyLower === 'allow' && current) {
      if (value) current.allow.push(value);
    } else if (keyLower === 'sitemap') {
      if (value) sitemaps.push(value);
    }
  }

  return { rules, sitemaps };
}

export async function auditRobots(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const origin = getOrigin(ctx.normalizedUrl);
  const robotsUrl = `${origin}${DEFAULT_PATHS.robotsTxt}`;

  let robotsTxt: string | undefined;
  try {
    const res = await fetchPage(robotsUrl, ctx.fetchOptions);
    const challenge = detectChallenge(res.headers, res.status);
    if (res.status === 200) {
      robotsTxt = res.body;
      // Store for cross-module use
      ctx.robotsTxt = robotsTxt;
    } else if (challenge) {
      // A challenged robots.txt may well exist; it just was not served to us.
      findings.push(edgeChallengeFinding(challenge, 'robots', 'robots.txt', robotsUrl));
      return findings;
    } else if (res.status >= 500 || res.status === 429) {
      // Google's robots.txt spec (updated 23 Oct 2026) on 5xx: "For the first 12 hours, Google
      // stops crawling the site but keeps trying to fetch the robots.txt file. If Google can't
      // fetch a new version, for the next 30 days Google will use the last good version". It
      // treats "all 4xx errors, except 429" as a missing file, so 429 is grouped with 5xx here.
      findings.push({
        code: 'ROBOTS_SERVER_ERROR',
        severity: 'error',
        category: 'robots',
        message: `robots.txt returned ${res.status}, so Google has paused crawling the site`,
        explanation:
          'Google treats a server error on robots.txt as a temporary stop: for the first 12 hours it crawls nothing on the site, then for up to 30 days it uses the last good copy it has cached, or no restrictions if it has none.',
        suggestion:
          'Make /robots.txt return 200, or a 404 if you do not want one. Check the route, middleware and any rate limiting in front of it.',
        details: { status: res.status },
        url: robotsUrl,
      });
      return findings;
    } else {
      // "Google's crawlers treat all 4xx errors, except 429, as if a valid robots.txt file
      // didn't exist. This means that Google assumes that there are no crawl restrictions."
      // The spec treats a redirect chain past five hops as a 404 as well; fetchPage does not
      // expose the hop count, so that case is not reported separately.
      findings.push({
        code: 'ROBOTS_MISSING',
        severity: 'warning',
        category: 'robots',
        message: `robots.txt not found (${res.status})`,
        explanation:
          'Google treats a 4xx on robots.txt, 401 and 403 included, as if the file did not exist: it assumes there are no crawl restrictions, and search engines get no guidance on which pages to crawl or avoid.',
        suggestion:
          'Create a robots.txt file at the root of your site. In Next.js App Router, use the metadata API.',
        details: { status: res.status },
        url: robotsUrl,
      });
      return findings;
    }
  } catch {
    findings.push({
      code: 'ROBOTS_MISSING',
      severity: 'warning',
      category: 'robots',
      message: 'robots.txt could not be fetched',
      explanation:
        'Without a robots.txt, search engines have no guidance on which pages to crawl or avoid.',
      suggestion:
        'Ensure robots.txt is accessible at the root of your domain.',
      url: robotsUrl,
    });
    return findings;
  }

  const bytes = Buffer.byteLength(robotsTxt, 'utf8');
  if (bytes > ROBOTS_TXT_MAX_BYTES) {
    findings.push({
      code: 'ROBOTS_TOO_LARGE',
      severity: 'warning',
      category: 'robots',
      message: `robots.txt is ${bytes} bytes, over Google's 500 KiB limit`,
      explanation:
        'Google reads the first 500 KiB of robots.txt and ignores everything after it, so rules past that point have no effect.',
      suggestion:
        'Shrink robots.txt by consolidating rules, for example by moving excluded material into one directory.',
      details: { bytes, limit: ROBOTS_TXT_MAX_BYTES },
      url: robotsUrl,
    });
  }

  const { rules, sitemaps } = parseRobotsTxt(robotsTxt);

  // Check for blocking all crawlers
  for (const rule of rules) {
    const ua = rule.userAgent.toLowerCase();
    if (ua === '*' && rule.disallow.includes('/')) {
      findings.push({
        code: 'ROBOTS_BLOCKS_ALL',
        severity: 'error',
        category: 'robots',
        message: 'robots.txt blocks all crawlers',
        explanation:
          'Disallow: / for all user agents prevents search engines from indexing any page on your site.',
        suggestion:
          'Remove or scope the Disallow: / rule unless you intentionally want to prevent indexing.',
        details: { rule },
        url: robotsUrl,
      });
    }

    if (
      (ua === 'googlebot' || ua === 'googlebot-news' || ua === 'googlebot-image') &&
      rule.disallow.includes('/')
    ) {
      findings.push({
        code: 'ROBOTS_BLOCKS_GOOGLEBOT',
        severity: 'error',
        category: 'robots',
        message: `robots.txt blocks ${rule.userAgent}`,
        explanation:
          'Blocking Googlebot prevents Google from indexing your site.',
        suggestion:
          `Remove the Disallow: / for ${rule.userAgent} unless intentional.`,
        details: { rule },
        url: robotsUrl,
      });
    }
  }

  // Check for sitemap directive
  if (sitemaps.length === 0) {
    findings.push({
      code: 'ROBOTS_NO_SITEMAP',
      severity: 'info',
      category: 'robots',
      message: 'No Sitemap directive found in robots.txt',
      explanation:
        'Declaring your sitemap URL in robots.txt helps search engines discover it faster.',
      suggestion:
        'Add a Sitemap: https://yourdomain.com/sitemap.xml line to robots.txt.',
      url: robotsUrl,
    });
  }

  return findings;
}
