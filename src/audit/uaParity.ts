import { Parser } from 'htmlparser2';
import { USER_AGENT, USER_AGENT_PRESETS, VERSION } from '../constants.js';
import type { AuditContext, AuditFinding } from '../types.js';
import { detectChallenge } from '../utils/challenge.js';
import { fetchPage } from '../utils/http.js';
import { BOT_PROBE_USER_AGENT } from './streamed-metadata.js';

// Why the same URL can answer differently by user agent on Next.js, all in vercel/next.js:
// - #95406 (opened 02 Jul 2026): a UA matched by a custom htmlLimitedBots but not the built-in
//   list drops every metadata tag under PPR, and "on Vercel this surfaces as HTTP 500s"
//   (comment of 06 Jul 2026, https://github.com/vercel/next.js/issues/95406#issuecomment-4888957082).
// - #96594 (opened 04 Aug 2026): from 16.3, UAs matched by htmlLimitedBots get
//   "private, no-cache, no-store, max-age=0, must-revalidate" on otherwise cacheable PPR pages,
//   and Googlebot gets private/no-store on 16.2 as well.
// - #82041 (opened 25 Jul 2025): with streaming blocked for a UA, notFound() and redirect() in
//   generateMetadata can still answer 200, so status codes depend on whether the UA streams.
//
// Google's spam policies (last updated 28 Aug 2026): "Cloaking refers to the practice of
// presenting different content to users and search engines". A parity gap is a cloaking risk
// as well as a bug. https://developers.google.com/search/docs/essentials/spam-policies#cloaking

/** A recent desktop Chrome, used when the plain crawler would only repeat the default user agent. */
export const PARITY_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** A crawler on no list at all, which Next.js streams to like a browser. */
export const PARITY_CRAWLER_USER_AGENT = `vercel-seo-audit/${VERSION} (+https://github.com/JosephDoUrden/vercel-seo-audit)`;

type Label = 'googlebot' | 'htmlLimitedBot' | 'crawler' | 'browser';

const NAMES: Record<Label | 'default', string> = {
  default: 'the default user agent',
  googlebot: 'Googlebot',
  htmlLimitedBot: 'facebookexternalhit',
  crawler: 'a plain crawler',
  browser: 'Chrome',
};

const PROBES = 3;

/**
 * The three user agents compared with the default one: Googlebot, the HTML-limited bot the
 * streamed-metadata check uses and a plain crawler, or Chrome when the default is already the
 * audit's own crawler user agent. One equal to the default is left out and the next one used.
 */
export function parityUserAgents(defaultUserAgent: string): { label: Label; userAgent: string }[] {
  const auditOwn = defaultUserAgent.startsWith('vercel-seo-audit/');
  const pool: { label: Label; userAgent: string }[] = [
    { label: 'googlebot', userAgent: USER_AGENT_PRESETS.googlebot },
    { label: 'htmlLimitedBot', userAgent: BOT_PROBE_USER_AGENT },
    ...(auditOwn ? [] : [{ label: 'crawler' as const, userAgent: PARITY_CRAWLER_USER_AGENT }]),
    { label: 'browser', userAgent: PARITY_BROWSER_USER_AGENT },
  ];
  return pool.filter((p) => p.userAgent !== defaultUserAgent).slice(0, PROBES);
}

interface View {
  userAgent: string;
  /** Unknown for the default view: phase 0 shares the page only when it was 2xx. */
  status?: number;
  ok: boolean;
  finalUrl?: string;
  challenge?: string;
  title: string | null;
  canonical: string | null;
  robots: string | null;
  xRobotsTag: string | null;
  cacheControl: string | null;
  bytes: number;
  h1: boolean;
}

const text = (v: string | undefined | null): string | null => v?.replace(/\s+/g, ' ').trim() || null;

// The fields a view compares, read in one streaming pass that keeps no document: the first
// <title>'s text, the href of the first <link rel="canonical">, the content of the first
// <meta name="robots"> and whether there is an <h1>, as the cheerio selectors would pick them.
// Every view goes through it, the audited page as well, so two views never differ because
// two parsers did. A full parse per probe cost hundreds of megabytes on a 10 MiB page, and a
// dynamic page differs on every request, so the audited page's parse could not be reused.
function scan(body: string): { title: string | null; canonical: string | null; robots: string | null; h1: boolean } {
  let title: string | undefined;
  let titleOpen = false;
  let canonical: string | undefined;
  let robots: string | undefined;
  let canonicalSeen = false;
  let robotsSeen = false;
  let h1 = false;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'title' && title === undefined) {
        titleOpen = true;
        title = '';
      } else if (name === 'link' && !canonicalSeen && attrs.rel === 'canonical') {
        canonicalSeen = true;
        canonical = attrs.href;
      } else if (name === 'meta' && !robotsSeen && attrs.name === 'robots') {
        robotsSeen = true;
        robots = attrs.content;
      } else if (name === 'h1') {
        h1 = true;
      }
    },
    ontext(data) {
      if (titleOpen) title += data;
    },
    onclosetag(name) {
      if (name === 'title') titleOpen = false;
    },
  });
  parser.end(body);
  return { title: text(title), canonical: text(canonical), robots: text(robots), h1 };
}

function read(body: string, header: (name: string) => string | undefined | null) {
  return {
    ...scan(body),
    xRobotsTag: text(header('x-robots-tag')),
    cacheControl: text(header('cache-control')),
    bytes: Buffer.byteLength(body, 'utf-8'),
  };
}

// A fresh GET with the options the streamed-metadata probe uses. The shared cache is left out
// for the same reason it leaves it out: its key ignores the user agent, so it would hand back
// the phase 0 page. Its probe is uncached, so there is no copy of it to reuse either.
async function probe(url: string, userAgent: string, ctx: AuditContext): Promise<View | undefined> {
  let page: Awaited<ReturnType<typeof fetchPage>>;
  try {
    page = await fetchPage(url, {
      timeout: ctx.fetchOptions.timeout,
      userAgent,
      auditedUrl: ctx.fetchOptions.auditedUrl,
      signal: ctx.fetchOptions.signal,
      maxBytes: ctx.fetchOptions.maxBytes,
    });
  } catch {
    return undefined;
  }
  const ok = page.status >= 200 && page.status < 300;
  const challenge = detectChallenge(page.headers, page.status);
  return {
    userAgent,
    status: page.status,
    ok,
    finalUrl: page.finalUrl,
    ...(challenge && { challenge: challenge.provider }),
    ...read(page.body, (name) => page.headers.get(name)),
  };
}

type Field = 'title' | 'canonical' | 'robots' | 'xRobotsTag';
const FIELDS: readonly Field[] = ['title', 'canonical', 'robots', 'xRobotsTag'];

// Case and whitespace do not count, nor does a trailing slash on the canonical.
function comparable(field: Field, value: string | null): string | null {
  const v = value?.toLowerCase() ?? null;
  return v && field === 'canonical' ? v.replace(/\/+$/, '') : v;
}

const PRIVATE = /\b(?:private|no-store)\b/i;
const SIZE_GAP = 0.3;

function pick<K extends keyof View>(views: [string, View][], keys: readonly K[], extra?: (v: View) => object) {
  return Object.fromEntries(
    views.map(([label, v]) => [label, { ...Object.fromEntries(keys.map((k) => [k, v[k]])), ...extra?.(v) }]),
  );
}

function names(labels: string[]): string {
  const n = labels.map((l) => NAMES[l as Label]);
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

const UNVERIFIED =
  'These requests come from the audit, not from the real crawlers. Vercel and Cloudflare verify Googlebot and other known bots by IP address, so a block or a difference seen here may not apply to Google, and Google may get something this check cannot see.';
const CLOAKING =
  'Google\'s spam policies define cloaking as "presenting different content to users and search engines", so a gap between what crawlers and browsers get is a cloaking risk as well as a bug.';

/**
 * Fetches the entry page as three more user agents and compares the status, title, canonical,
 * robots directives, cache-control and size with what the default user agent got.
 */
export async function auditUaParity(ctx: AuditContext): Promise<AuditFinding[]> {
  // Phase 0 shares the page only when it answered 2xx with HTML, so this also skips an
  // unreachable page, a non-2xx and an edge challenge (served as 403, 429 or 503).
  const { html, headers } = ctx;
  if (!html || !headers) return [];

  const url = ctx.finalUrl ?? ctx.normalizedUrl;
  const defaultUserAgent = ctx.fetchOptions.userAgent ?? USER_AGENT;
  const base: View = {
    userAgent: defaultUserAgent,
    ok: true,
    ...read(html, (name) => headers[name]),
  };

  const agents = parityUserAgents(defaultUserAgent);
  const probed = await Promise.all(agents.map((a) => probe(url, a.userAgent, ctx)));
  const views: [string, View][] = [['default', base]];
  agents.forEach((a, i) => {
    const view = probed[i];
    if (view) views.push([a.label, view]);
  });
  const others = views.slice(1);
  const ok = views.filter(([, v]) => v.ok);
  const findings: AuditFinding[] = [];

  const failed = others.filter(([, v]) => !v.ok);
  if (failed.length > 0) {
    const what = failed.map(([label, v]) => `${NAMES[label as Label]} got HTTP ${v.status}${v.challenge ? ` (a ${v.challenge === 'vercel' ? 'Vercel' : 'Cloudflare'} challenge)` : ''}`);
    findings.push({
      code: 'UA_STATUS_DIFFERS',
      severity: 'error',
      category: 'indexing',
      message: `The page answers 2xx to the default user agent, but ${what.join(', ')}`,
      explanation: `The same URL answered with a different status depending on the user agent. On Next.js this happens when htmlLimitedBots and the built-in bot list disagree, which on Vercel can surface as a 500 (vercel/next.js#95406), or when notFound() or redirect() in generateMetadata answer differently with streaming blocked (vercel/next.js#82041). ${UNVERIFIED}`,
      suggestion:
        'Request the page with each of these user agents (--user-agent) and read the server logs for the failing one. Check htmlLimitedBots in next.config, middleware or proxy rules that look at the user agent, and Firewall or bot rules for this path.',
      details: { byUserAgent: pick(views, ['userAgent', 'status', 'finalUrl', 'challenge'], (v) => ({ statusClass: v.status === undefined ? '2xx' : `${Math.floor(v.status / 100)}xx` })) },
      url,
    });
  }

  const fields = FIELDS.filter((field) => {
    const want = comparable(field, base[field]);
    return ok.slice(1).some(([, v]) => comparable(field, v[field]) !== want);
  });
  if (fields.length > 0) {
    const differing = ok.slice(1).filter(([, v]) => fields.some((f) => comparable(f, v[f]) !== comparable(f, base[f])));
    findings.push({
      code: 'UA_METADATA_DIFFERS',
      severity: 'warning',
      category: 'indexing',
      message: `${names(differing.map(([l]) => l))} got a different ${fields.join(', ')} from the default user agent`,
      explanation: `The title, canonical or robots directives changed with the user agent (case, whitespace and a trailing slash on the canonical are ignored). Under PPR, a user agent on a custom htmlLimitedBots list but not the built-in one can get no metadata at all (vercel/next.js#95406). ${CLOAKING} ${UNVERIFIED}`,
      suggestion:
        'Compare the <head> each user agent gets (--user-agent). Set metadata through the Metadata API rather than per request, and check htmlLimitedBots and any middleware that branches on the user agent.',
      details: { fields, byUserAgent: pick(ok, ['userAgent', ...FIELDS]) },
      url,
    });
  }

  const privateFor = ok.filter(([, v]) => PRIVATE.test(v.cacheControl ?? ''));
  if (privateFor.length > 0 && privateFor.length < ok.length) {
    findings.push({
      code: 'UA_CACHE_DIFFERS',
      severity: 'info',
      category: 'indexing',
      message: `${names(privateFor.map(([l]) => l))} got a private or no-store cache-control and the others did not`,
      explanation: `Some user agents get a response the CDN may not cache, so they are served from the function on every request. From Next.js 16.3, user agents matched by htmlLimitedBots get "private, no-cache, no-store" on otherwise cacheable PPR pages, and Googlebot gets it on earlier versions too (vercel/next.js#96594), so this is expected Next.js behaviour rather than a fault. ${UNVERIFIED}`,
      suggestion:
        'Nothing to fix if the page is Next.js 16.3 or later and the user agents above are on htmlLimitedBots. Otherwise check what sets cache-control for them; keep htmlLimitedBots to bots, since a broad pattern makes browser traffic uncacheable too.',
      details: { byUserAgent: pick(ok, ['userAgent', 'cacheControl'], (v) => ({ privateOrNoStore: PRIVATE.test(v.cacheControl ?? '') })) },
      url,
    });
  }

  const sizes = ok.map(([, v]) => v.bytes);
  const largest = Math.max(...sizes);
  if (ok.length > 1 && largest > 0 && (largest - Math.min(...sizes)) / largest > SIZE_GAP) {
    findings.push({
      code: 'UA_SIZE_DIFFERS',
      severity: 'info',
      category: 'indexing',
      message: `The page size differs by more than ${SIZE_GAP * 100}% between user agents`,
      explanation: `Two 2xx responses to the same URL differed in size by more than ${SIZE_GAP * 100}%, so some user agents get less of the page, or a different one. Streamed and blocking renders differ a little in size; a gap this large usually means missing content or a different page. sizeRatio is the size against the default user agent's, to the nearest 10%. ${CLOAKING} ${UNVERIFIED}`,
      suggestion:
        'Compare the body each user agent gets (--user-agent) and check for content rendered only on the client, or middleware and A/B rules that branch on the user agent.',
      details: {
        byUserAgent: pick(ok, ['userAgent', 'bytes', 'h1'], (v) => ({
          sizeRatio: base.bytes > 0 ? Math.round((v.bytes / base.bytes) * 10) / 10 : null,
        })),
      },
      url,
    });
  }

  return findings;
}
