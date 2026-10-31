import { HTML_LIMITED_BOT_UA_RE, USER_AGENT } from '../constants.js';
import type { AuditContext, AuditFinding } from '../types.js';
import { locateMetadata, type MetadataTag } from '../utils/html-parser.js';
import { fetchPage } from '../utils/http.js';
import { isNextjsPage } from '../utils/nextjs.js';

// On Next.js's HTML-limited list, so it gets metadata in <head>. Googlebot is not used on
// purpose: it runs JavaScript, and Next.js streams to it like any browser.
export const BOT_PROBE_USER_AGENT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

// The CDN answered from its cache instead of bypassing it for the crawler, so this copy is
// what the crawler gets until the entry expires, whoever's request filled it.
const CACHED = new Set(['HIT', 'STALE']);

type FailReason = 'error' | 'status' | 'redirected' | 'not-nextjs';

type BotView =
  | { botRequest: 'ok' | 'cached'; head: Set<MetadataTag>; botStatus: number; botFinalUrl: string; botCache?: string }
  | { botRequest: 'failed'; reason: FailReason; botStatus?: number; botFinalUrl?: string };

// One more GET for the page as an HTML-limited bot. The options leave out the shared cache
// on purpose: its key ignores the user agent, so it would hand back the phase 0 response.
// A redirect, a non-2xx or a page that is not Next.js is most likely a bot challenge, whose
// own <title> would read as "the bot gets <head> metadata", so it counts as a failed request.
async function probe(url: string, ctx: AuditContext): Promise<BotView> {
  let page: Awaited<ReturnType<typeof fetchPage>>;
  try {
    page = await fetchPage(url, { timeout: ctx.fetchOptions.timeout, userAgent: BOT_PROBE_USER_AGENT, signal: ctx.fetchOptions.signal });
  } catch {
    return { botRequest: 'failed', reason: 'error' };
  }
  const seen = { botStatus: page.status, botFinalUrl: page.finalUrl };
  if (page.status < 200 || page.status >= 300) return { botRequest: 'failed', reason: 'status', ...seen };
  if (page.finalUrl !== url) return { botRequest: 'failed', reason: 'redirected', ...seen };
  const headers = Object.fromEntries(page.headers.entries());
  if (!isNextjsPage(headers, page.body)) return { botRequest: 'failed', reason: 'not-nextjs', ...seen };

  const { head } = locateMetadata(page.body);
  const cache = (headers['x-vercel-cache'] ?? '').toUpperCase();
  return CACHED.has(cache)
    ? { botRequest: 'cached', head, botCache: cache, ...seen }
    : { botRequest: 'ok', head, ...seen };
}

function list(tags: readonly string[]): string {
  return tags.length < 2 ? tags.join('') : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`;
}

const STREAMS =
  'Next.js 15.2 and later stream generateMetadata output into <body> for every user agent not on its HTML-limited bot list, when generateMetadata is dynamic (static metadata and prerendered pages stay in <head>).';
const NOT_LISTED =
  'Crawlers that are not on that list and do not run JavaScript, such as GPTBot, ClaudeBot, PerplexityBot and SEO crawlers that fetch without rendering, find no title or description in <head>.';
const DOCUMENT_WIDE =
  'The metadata checks read the whole document, so they still count these tags as present.';

/**
 * Next.js 15.2+ streams generateMetadata output into <body> for user agents that are not on
 * its HTML-limited bot list. Reads where the metadata sits in the phase 0 response and, only
 * when some of it is in <body> alone, asks for the page once more as a bot on that list.
 */
export async function auditStreamedMetadata(ctx: AuditContext): Promise<AuditFinding[]> {
  const { html, headers } = ctx;
  if (!html || !headers || !isNextjsPage(headers, html)) return [];

  // Auditing as a bot on the list already is the bot view; there is nothing to compare.
  const defaultUserAgent = ctx.fetchOptions.userAgent ?? USER_AGENT;
  if (HTML_LIMITED_BOT_UA_RE.test(defaultUserAgent)) return [];

  const url = ctx.finalUrl ?? ctx.normalizedUrl;
  const located = locateMetadata(html);
  const bodyOnly = [...located.bodyOnly];
  if (bodyOnly.length === 0) {
    // A pass, so a JSON run can tell "all in <head>" apart from "not Next.js" (no finding).
    // With none of the tags at all there is nothing in <head>; the metadata checks report that.
    const headTags = [...located.head];
    if (headTags.length === 0) return [];
    return [
      {
        code: 'METADATA_IN_HEAD',
        severity: 'pass',
        category: 'nextjs',
        message: 'Page metadata is in <head> for the default user agent',
        explanation: `With the audit's user agent, ${list(headTags)} ${headTags.length === 1 ? 'was' : 'were'} in <head>, and none of the tags this check reads was in <body> alone, so nothing was streamed and no second request was made.`,
        suggestion: 'No action needed.',
        details: { headTags, defaultCache: headers['x-vercel-cache'], nextjs: true },
        url,
      },
    ];
  }

  const bot = await probe(url, ctx);
  const tags = list(bodyOnly);
  const base = {
    defaultUserAgent,
    botUserAgent: BOT_PROBE_USER_AGENT,
    defaultCache: headers['x-vercel-cache'],
    bodyOnly,
  };

  if (bot.botRequest === 'failed') {
    const { botRequest, reason, botStatus, botFinalUrl } = bot;
    return [
      {
        code: 'METADATA_STREAMED_TO_BODY',
        severity: 'info',
        category: 'nextjs',
        message: 'Page metadata is only in <body>; the bot view could not be confirmed',
        explanation: `With the audit's user agent, ${tags} appeared only in <body>. ${STREAMS} The second request, as facebookexternalhit, failed, did not return 2xx, was redirected or did not look like Next.js (a bot challenge, most likely), so whether bots on the list get these tags in <head> is not known. ${NOT_LISTED} ${DOCUMENT_WIDE}`,
        suggestion:
          'Request the page with a facebookexternalhit user agent (--user-agent) and check that the tags are in <head>. Export static metadata where the values do not depend on the request.',
        details: { ...base, botRequest, reason, botStatus, botFinalUrl },
        url,
      },
    ];
  }

  const botHead = bodyOnly.filter((tag) => bot.head.has(tag));
  const missing = bodyOnly.filter((tag) => !bot.head.has(tag));
  const details = {
    ...base,
    botHead,
    missing,
    botRequest: bot.botRequest,
    botStatus: bot.botStatus,
    botFinalUrl: bot.botFinalUrl,
    ...(bot.botCache && { botCache: bot.botCache }),
  };

  if (missing.length === 0) {
    return [
      {
        code: 'METADATA_STREAMED_TO_BODY',
        severity: 'info',
        category: 'nextjs',
        message: 'Page metadata is likely streamed into <body> (Next.js 15.2+)',
        explanation: `With the audit's user agent, ${tags} appeared only in <body>; requested as facebookexternalhit, the same tags were in <head>. ${STREAMS} React 19 places late metadata the same way. The listed bots get <head>, and for crawlers that run JavaScript, Vercel says it has verified Googlebot reads them. ${NOT_LISTED} ${DOCUMENT_WIDE}`,
        suggestion:
          'Export static metadata where the values do not depend on the request, or add the crawlers you care about to htmlLimitedBots in next.config: extend the default list (setting the option replaces it). Then audit again with one of their user agents (--user-agent) to confirm they get the tags in <head>.',
        details,
        url,
      },
    ];
  }

  const cached =
    bot.botRequest === 'cached'
      ? ` The bot copy was served from the CDN cache; the entry may have been filled by a browser request, re-run after it expires to confirm (x-vercel-cache: ${bot.botCache}).`
      : '';
  return [
    {
      code: 'METADATA_NOT_IN_HEAD',
      severity: 'warning',
      category: 'nextjs',
      message: 'Page metadata is not in <head>, even for HTML-limited bots',
      explanation: `With the audit's user agent, ${tags} appeared only in <body>, and as facebookexternalhit (a bot Next.js lists as unable to run JavaScript and serves metadata in <head>) ${list(missing)} ${missing.length === 1 ? 'was' : 'were'} still not in <head>. Link previews and crawlers that do not run JavaScript read <head> and miss ${missing.length === 1 ? 'it' : 'them'}. This happens when htmlLimitedBots is set to a narrower list, a proxy drops or rewrites the user agent, or the tags are rendered by client code.${cached} ${DOCUMENT_WIDE}`,
      suggestion:
        'Set the title, description, canonical and Open Graph tags through the Metadata API (metadata or generateMetadata) rather than in components, and check htmlLimitedBots in next.config and any proxy in front of the site.',
      details,
      url,
    },
  ];
}
