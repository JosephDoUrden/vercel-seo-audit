import type { AuditContext, AuditFinding } from '../types.js';
import { DEFAULT_PATHS } from '../constants.js';
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
    if (res.status === 200) {
      robotsTxt = res.body;
      // Store for cross-module use
      ctx.robotsTxt = robotsTxt;
    } else {
      findings.push({
        code: 'ROBOTS_MISSING',
        severity: 'warning',
        category: 'robots',
        message: 'robots.txt not found',
        explanation:
          'Without a robots.txt, search engines have no guidance on which pages to crawl or avoid.',
        suggestion:
          'Create a robots.txt file at the root of your site. In Next.js App Router, use the metadata API.',
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
