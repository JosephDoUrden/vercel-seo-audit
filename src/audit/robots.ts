import type { AuditContext, AuditFinding } from '../types.js';
import { AI_CRAWLERS, DEFAULT_PATHS, MAX_HTML_BYTES, ROBOTS_TXT_MAX_BYTES } from '../constants.js';
import { detectChallenge, edgeChallengeFinding } from '../utils/challenge.js';
import type * as cheerio from 'cheerio';
import { parseHtml } from '../utils/html-parser.js';
import { fetchPage } from '../utils/http.js';
import { matchRobots, selectRobotsGroup, type RobotsGroup } from '../utils/robots-match.js';
import { getOrigin } from '../utils/url.js';

type RobotsRule = RobotsGroup;

/** One Content-Signal line and the user agents of the group it sits in (empty outside any group). */
interface ContentSignal {
  userAgents: string[];
  signals: Record<string, string>;
}

// Cloudflare's Content Signals Policy (https://blog.cloudflare.com/content-signals-policy/, 24 Sep 2025,
// modified 15 Jul 2026, read 31 Oct 2026) writes them as comma-separated name=value pairs inside a group:
// "Content-Signal: search=yes, ai-train=no". The names are search, ai-input and ai-train; a name left out
// expresses no preference.
function parseContentSignal(value: string): Record<string, string> {
  const signals: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const [name, signal] = pair.split('=').map((s) => s.trim().toLowerCase());
    if (name && signal) signals[name] = signal;
  }
  return signals;
}

function parseRobotsTxt(txt: string): {
  rules: RobotsRule[];
  sitemaps: string[];
  contentSignals: ContentSignal[];
} {
  // A # starts a comment anywhere on the line
  const lines = txt.split('\n').map((l) => l.replace(/#.*/, '').trim());
  const rules: RobotsRule[] = [];
  const sitemaps: string[] = [];
  const contentSignals: ContentSignal[] = [];
  let current: RobotsRule | null = null;
  let groupAgents: string[] = [];
  let lastWasUserAgent = false;

  for (const line of lines) {
    if (line === '') continue;

    const [key, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const keyLower = key.toLowerCase().trim();

    if (keyLower === 'user-agent') {
      // Consecutive User-agent lines open one group: the rules that follow apply to each of them.
      current =
        lastWasUserAgent && current
          ? { userAgent: value, disallow: current.disallow, allow: current.allow }
          : { userAgent: value, disallow: [], allow: [] };
      if (!lastWasUserAgent) groupAgents = [];
      groupAgents.push(value);
      rules.push(current);
      lastWasUserAgent = true;
      continue;
    }
    lastWasUserAgent = false;

    if (keyLower === 'disallow' && current) {
      if (value) current.disallow.push(value);
    } else if (keyLower === 'allow' && current) {
      if (value) current.allow.push(value);
    } else if (keyLower === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (keyLower === 'content-signal') {
      const signals = parseContentSignal(value);
      if (Object.keys(signals).length > 0) contentSignals.push({ userAgents: groupAgents, signals });
    }
  }

  return { rules, sitemaps, contentSignals };
}

export async function auditRobots(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const origin = getOrigin(ctx.normalizedUrl);
  const robotsUrl = `${origin}${DEFAULT_PATHS.robotsTxt}`;

  let robotsTxt: string | undefined;
  try {
    // Read at the default cap whatever maxHtmlBytes says, so ROBOTS_TOO_LARGE still sees the
    // whole file; a lowered page cap would cut it without a word.
    const res = await fetchPage(robotsUrl, { ...ctx.fetchOptions, maxBytes: MAX_HTML_BYTES });
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

  const { rules, sitemaps, contentSignals } = parseRobotsTxt(robotsTxt);

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

  findings.push(...checkRenderAssets(ctx, rules, origin, robotsUrl));
  findings.push(...checkAiCrawlers(rules, contentSignals, robotsUrl));

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

// Google's robots.txt introduction (https://developers.google.com/search/docs/crawling-indexing/robots/intro,
// last updated 10 Dec 2025, read 31 Oct 2026): "if the absence of these resources make the page harder
// for Google's crawler to understand the page, don't block them, or else Google won't do a good job of
// analyzing pages that depend on those resources." JavaScript SEO basics
// (https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics, last
// updated 04 Mar 2026, read 31 Oct 2026): "Google Search won't render JavaScript from blocked files or
// on blocked pages." Next.js sites get here by disallowing /_next/ to save crawl budget; the reply on
// https://github.com/vercel/next.js/discussions/89939 (13 Feb 2026) says "Keep _next/static reachable".
const MAX_BLOCKED_LISTED = 10;

function sameOriginUrls(
  $: cheerio.CheerioAPI,
  selector: string,
  attr: string,
  base: string,
  origin: string,
): URL[] {
  const urls: URL[] = [];
  for (const el of $(selector).toArray()) {
    const value = $(el).attr(attr)?.trim();
    if (!value) continue;
    try {
      const url = new URL(value, base);
      if (url.origin === origin) urls.push(url);
    } catch {
      // Not a URL; the browser skips it too
    }
  }
  return urls;
}

function blockedBy(urls: URL[], group: RobotsGroup): { blocked: string[]; rule?: string } {
  const blocked: string[] = [];
  let rule: string | undefined;
  for (const href of new Set(urls.map((u) => u.href))) {
    const url = new URL(href);
    const match = matchRobots(url.pathname + url.search, group);
    if (match.allowed || !match.rule) continue;
    blocked.push(href);
    rule ??= `Disallow: ${match.rule.path}`;
  }
  return { blocked, rule };
}

function checkRenderAssets(
  ctx: AuditContext,
  rules: RobotsRule[],
  origin: string,
  robotsUrl: string,
): AuditFinding[] {
  // Phase 0 shares the page. Without it there is nothing to render, and the page modules report why.
  if (!ctx.html) return [];
  const group = selectRobotsGroup(rules, 'googlebot');
  if (!group) return [];

  const base = ctx.finalUrl ?? ctx.normalizedUrl;
  const page = new URL(base);
  // A blocked page is not rendered at all; ROBOTS_BLOCKS_ALL and ROBOTS_BLOCKS_GOOGLEBOT cover that.
  if (page.origin === origin && !matchRobots(page.pathname + page.search, group).allowed) return [];

  const $ = parseHtml(ctx.html);
  const findings: AuditFinding[] = [];

  const render = blockedBy(
    [
      ...sameOriginUrls($, 'script[src]', 'src', base, origin),
      ...sameOriginUrls($, 'link[rel~="stylesheet" i][href]', 'href', base, origin),
    ],
    group,
  );
  if (render.blocked.length > 0) {
    const nextStatic = render.blocked.every((u) => new URL(u).pathname.startsWith('/_next/static/'));
    findings.push({
      code: 'ROBOTS_BLOCKS_RENDER_ASSETS',
      severity: 'error',
      category: 'robots',
      message: `robots.txt blocks ${render.blocked.length} of the page's scripts and stylesheets from Googlebot`,
      explanation:
        'Googlebot does not fetch URLs that robots.txt disallows, so it cannot run these scripts or apply these styles. It cannot render the page and indexes the raw HTML only.',
      suggestion: nextStatic
        ? 'Remove the Disallow rule, or add Allow: /_next/static/ above it in the same group. Google applies the longest matching rule, so the Allow wins for the build assets.'
        : 'Remove the Disallow rule, or add an Allow rule for the asset paths above it in the same group. Google applies the longest matching rule.',
      details: { blocked: render.blocked.slice(0, MAX_BLOCKED_LISTED), rule: render.rule, group: group.userAgent },
      url: robotsUrl,
    });
  }

  // Images matter to Google Images, not to rendering, hence info
  const image = blockedBy(
    sameOriginUrls($, 'img[src]', 'src', base, origin).filter((u) => u.pathname === '/_next/image'),
    group,
  );
  if (image.blocked.length > 0) {
    findings.push({
      code: 'ROBOTS_BLOCKS_NEXT_IMAGE',
      severity: 'info',
      category: 'robots',
      message: `robots.txt blocks /_next/image, which ${image.blocked.length} of the page's images load through`,
      explanation:
        'Googlebot cannot fetch images served through the Next.js image optimiser, so they will not show in Google Images. Rendering is not affected.',
      suggestion: 'If the images should appear in image search, add Allow: /_next/image to the same group.',
      details: { blocked: image.blocked.slice(0, MAX_BLOCKED_LISTED), rule: image.rule, group: group.userAgent },
      url: robotsUrl,
    });
  }

  return findings;
}

type AiCrawlerClass = keyof typeof AI_CRAWLERS;
type Access = 'allow' | 'block';

const AI_CLASS_LABELS: Record<AiCrawlerClass, string> = { training: 'training', search: 'search', user: 'user fetch' };

function rootAccess(rules: RobotsRule[], token: string): Access {
  const group = selectRobotsGroup(rules, token);
  return !group || matchRobots('/', group).allowed ? 'allow' : 'block';
}

function countSummary(access: Record<string, Access>): string {
  const values = Object.values(access);
  const blocked = values.filter((a) => a === 'block').length;
  const allowed = values.length - blocked;
  return [blocked && `${blocked} blocked`, allowed && `${allowed} allowed`].filter(Boolean).join(' and ');
}

function checkAiCrawlers(rules: RobotsRule[], contentSignals: ContentSignal[], robotsUrl: string): AuditFinding[] {
  const matrix = {} as Record<AiCrawlerClass, Record<string, Access>>;
  for (const cls of Object.keys(AI_CRAWLERS) as AiCrawlerClass[]) {
    matrix[cls] = Object.fromEntries(AI_CRAWLERS[cls].map((token) => [token, rootAccess(rules, token)]));
  }

  const findings: AuditFinding[] = [];
  const summary = (Object.keys(matrix) as AiCrawlerClass[])
    .map((cls) => `${AI_CLASS_LABELS[cls]} ${countSummary(matrix[cls])}`)
    .join(', ');
  findings.push({
    code: 'AI_CRAWLER_ACCESS',
    severity: 'info',
    category: 'robots',
    message: `AI crawlers: ${summary}`,
    explanation:
      'Whether each AI crawler may fetch the site root, from the group robots.txt gives it, or the * group when it has none. Training crawlers feed model training, search crawlers decide whether the site appears in AI search answers, and user fetchers load a page a person asked about; OpenAI and Perplexity say their user fetchers may not follow robots.txt. This reads robots.txt only: an edge rule such as the Vercel AI Bots managed ruleset or a Cloudflare bot setting can block these crawlers regardless, and the audit cannot see that.',
    suggestion: 'Nothing to fix. Check the matrix matches what you meant to allow.',
    details: {
      ...matrix,
      source: 'robots.txt',
      ...(contentSignals.length > 0 && { contentSignal: contentSignals }),
    },
    url: robotsUrl,
  });

  const blocked = Object.entries(matrix.search)
    .filter(([, access]) => access === 'block')
    .map(([token]) => token);
  if (blocked.length > 0 && rootAccess(rules, 'googlebot') === 'allow') {
    findings.push({
      code: 'AI_SEARCH_BOT_BLOCKED',
      severity: 'warning',
      category: 'robots',
      message: `robots.txt blocks ${blocked.join(', ')} but allows Googlebot`,
      explanation:
        'Search crawlers decide whether the site can appear, with a link, in AI search answers; blocking them takes it out of those answers while it stays in Google. That is usually a side effect of blocking AI bots wholesale. Blocking training crawlers such as GPTBot or ClaudeBot is a separate, legitimate choice the audit does not judge. This reads robots.txt only; an edge rule can block these crawlers regardless.',
      suggestion: `If the site should appear in AI search answers, give ${blocked.join(', ')} a group with Allow: / and keep the training crawlers blocked.`,
      details: { blocked },
      url: robotsUrl,
    });
  }

  return findings;
}
