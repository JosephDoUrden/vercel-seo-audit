import type {
  AuditContext,
  AuditFinding,
  AuditModuleResult,
  AuditReport,
  FetchOptions,
  IssueCategory,
  IssueCode,
  ModuleId,
  PageFacts,
} from './types.js';
import { MODULE_IDS } from './types.js';
import { normalizeUrl } from './utils/url.js';
import { fetchPage, RedirectError } from './utils/http.js';
import { isNextjsPage } from './utils/nextjs.js';
import { responseTooLarge } from './utils/tooLarge.js';
import { detectChallenge } from './utils/challenge.js';
import {
  auditRedirects,
  auditRobots,
  auditSitemap,
  auditMetadata,
  auditFavicon,
  auditNextjs,
  auditStructuredData,
  auditCrawl,
  auditI18n,
  auditImages,
  auditSecurity,
  auditPerformance,
  auditVercel,
  auditStreamedMetadata,
  auditHostLeak,
  auditUaParity,
  auditSoft404,
} from './audit/index.js';

type AuditModule = {
  name: ModuleId;
  run: (ctx: AuditContext) => Promise<AuditFinding[]>;
  /** Modules whose context this one reads; they are added when this one is selected. */
  deps?: readonly ModuleId[];
  /** Reads the page as HTML, so it is skipped when the page is not HTML. */
  html?: boolean;
};

// Phases run one after another; the modules inside a phase run in parallel.
// Phase 1 fills ctx.robotsTxt for sitemap, phase 2 fills ctx.sitemapUrls for soft404 and crawl.
export const phases: readonly (readonly AuditModule[])[] = [
  [
    { name: 'robots', run: auditRobots },
    { name: 'redirects', run: auditRedirects },
  ],
  [
    { name: 'sitemap', run: auditSitemap, deps: ['robots'] },
    { name: 'metadata', run: auditMetadata, html: true },
    { name: 'favicon', run: auditFavicon, html: true },
    { name: 'nextjs', run: auditNextjs },
    { name: 'structuredData', run: auditStructuredData, html: true },
    { name: 'i18n', run: auditI18n, html: true },
    { name: 'images', run: auditImages, html: true },
    { name: 'security', run: auditSecurity },
    { name: 'performance', run: auditPerformance, html: true },
    { name: 'vercel', run: auditVercel },
    { name: 'streamedMetadata', run: auditStreamedMetadata, html: true },
    { name: 'hostLeak', run: auditHostLeak, html: true },
    { name: 'uaParity', run: auditUaParity, html: true },
  ],
  [
    { name: 'soft404', run: auditSoft404, deps: ['sitemap'], html: true },
    { name: 'crawl', run: auditCrawl, deps: ['sitemap'] },
  ],
];

const registry = new Map<ModuleId, AuditModule>(phases.flat().map((m) => [m.name, m]));

/** Adds the dependencies of every selected module, transitively, and returns them in run order. */
function expandOnly(only: readonly ModuleId[]): ModuleId[] {
  const selected = new Set<ModuleId>();
  const add = (id: ModuleId): void => {
    if (selected.has(id)) return;
    selected.add(id);
    for (const dep of registry.get(id)?.deps ?? []) add(dep);
  };
  only.forEach(add);
  return MODULE_IDS.filter((id) => selected.has(id));
}

// The category a module's MODULE_FAILED finding is filed under.
const MODULE_CATEGORY: Record<ModuleId, IssueCategory> = {
  robots: 'robots',
  redirects: 'redirect',
  sitemap: 'sitemap',
  metadata: 'metadata',
  favicon: 'favicon',
  nextjs: 'nextjs',
  structuredData: 'structured-data',
  i18n: 'i18n',
  images: 'images',
  security: 'security',
  performance: 'performance',
  vercel: 'vercel',
  streamedMetadata: 'nextjs',
  hostLeak: 'metadata',
  uaParity: 'indexing',
  soft404: 'indexing',
  crawl: 'crawl',
};

function moduleFailed(module: ModuleId, err: unknown, url: string): AuditFinding {
  const message = describeError(err);
  return {
    code: 'MODULE_FAILED',
    severity: 'error',
    category: MODULE_CATEGORY[module],
    message: `The ${module} checks failed to run: ${message}`,
    explanation: 'The module threw before it could report, so its checks are missing from this report.',
    suggestion: 'Run the audit again. If it keeps failing, open an issue with this message.',
    details: { module, message },
    url,
  };
}

// A module that throws is reported as a MODULE_FAILED error in its own slot,
// so the failure shows in the report and the exit code instead of vanishing.
async function runModules(
  modules: AuditModule[],
  ctx: AuditContext,
): Promise<AuditModuleResult[]> {
  const results = await Promise.allSettled(modules.map((mod) => mod.run(ctx)));

  return results.map((r, i) => {
    const module = modules[i].name;
    return r.status === 'fulfilled'
      ? { module, findings: r.value }
      : { module, findings: [moduleFailed(module, r.reason, ctx.normalizedUrl)] };
  });
}

/** The error's message, with its cause's when fetch wraps one (`fetch failed: getaddrinfo ENOTFOUND ...`). */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause && cause !== err.message ? `${err.message}: ${cause}` : err.message;
}

// A response without a content-type is read as HTML, the way browsers sniff it.
function isHtmlType(contentType: string | null): boolean {
  if (!contentType) return true;
  const type = contentType.split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml';
}

function unreachable(url: string, error: string): AuditFinding {
  return {
    code: 'TARGET_UNREACHABLE',
    severity: 'error',
    category: 'indexing',
    message: `Could not fetch ${url}: ${error}`,
    explanation:
      'The page did not answer, so nothing else was audited. A search engine that hits the same failure cannot crawl it either.',
    suggestion:
      'Check the URL, its DNS record and TLS certificate, and that the site is up. If it is only slow, raise --timeout.',
    details: { error },
    url,
  };
}

function httpError(url: string, status: number, finalUrl: string): AuditFinding {
  return {
    code: 'TARGET_HTTP_ERROR',
    severity: 'error',
    category: 'indexing',
    message: `The audited page returned HTTP ${status}`,
    explanation:
      'Search engines drop pages that answer with a 4xx or 5xx status. The other checks still ran, against what the server returned to them.',
    suggestion: 'Check that this is the URL you meant to audit, then fix the page or the server error.',
    details: { status, finalUrl },
    url,
  };
}

function notHtml(url: string, contentType: string | null, body: string): AuditFinding {
  const empty = isHtmlType(contentType);
  return {
    code: 'TARGET_NOT_HTML',
    severity: 'warning',
    category: 'indexing',
    message: empty ? 'The audited page returned an empty body' : `The audited page is ${contentType}, not HTML`,
    explanation:
      'The checks that read the page as HTML (metadata, favicon, structured data, hreflang, images, performance and streamed metadata) were skipped. The robots.txt, redirect, sitemap and header checks still ran.',
    suggestion: 'Audit an HTML page, usually the site root.',
    details: { contentType, bytes: Buffer.byteLength(body, 'utf-8') },
    url,
  };
}

/** Options for {@link runAudit}; each one matches the CLI flag of the same name. */
export interface RunAuditOptions {
  verbose?: boolean;
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  /** Page paths to check for redirects, in place of the common ones (`/about`, `/contact`, ...). */
  pages?: string[];
  /** Sent as-is; the CLI's presets (`googlebot`, ...) are resolved before this. */
  userAgent?: string;
  /** Crawl up to this many sitemap pages. Crawl is off when unset. */
  crawl?: number;
  /** Findings with these codes stay in the report, marked `ignored`, and leave the counts. */
  ignore?: readonly IssueCode[];
  /** Run only these modules (and the modules they depend on). The page is still fetched once. */
  only?: readonly ModuleId[];
}

/**
 * Audits one URL and returns the full report. Every request it makes, the page's
 * redirects, sitemap URLs and crawled links included, is refused when it points at
 * a private address and `url` does not, so a caller passing user input gets the same
 * guard as the CLI.
 */
export async function runAudit(url: string, opts: RunAuditOptions = {}): Promise<AuditReport> {
  const start = Date.now();
  const normalized = normalizeUrl(url);

  const fetchOptions: FetchOptions = {
    timeout: opts.timeout,
    userAgent: opts.userAgent,
    cache: new Map(),
    auditedUrl: normalized,
  };

  const ctx: AuditContext = {
    url,
    normalizedUrl: normalized,
    fetchOptions,
    verbose: opts.verbose ?? false,
    pages: opts.pages,
    crawlLimit: opts.crawl,
  };

  // Phase 0: fetch the page once and share it. A non-2xx page is reported, but
  // not shared, and is dropped from the cache, so the modules try again for
  // themselves and report what they can. A page that cannot be fetched at all
  // stops the audit: every module would only report the same dead host. A
  // redirect loop does not; the modules run without the page.
  const pageFacts: PageFacts = { status: null, finalUrl: null, nextjs: false };
  const targetFindings: AuditFinding[] = [];
  let reached = false;
  let isHtml = true;
  try {
    const page = await fetchPage(normalized, fetchOptions);
    reached = true;
    pageFacts.status = page.status;
    pageFacts.finalUrl = page.finalUrl;
    pageFacts.nextjs = isNextjsPage(Object.fromEntries(page.headers.entries()), page.body);
    if (page.truncated) targetFindings.push(responseTooLarge(normalized, 'performance', page.headers));
    if (page.status >= 200 && page.status < 300) {
      const contentType = page.headers.get('content-type');
      isHtml = isHtmlType(contentType) && page.body.trim() !== '';
      if (isHtml) ctx.html = page.body;
      else targetFindings.push(notHtml(normalized, contentType, page.body));
      ctx.headers = Object.fromEntries(page.headers.entries());
      ctx.finalUrl = page.finalUrl;
    } else {
      // A challenge page is reported by the vercel module as EDGE_CHALLENGE.
      if (page.status >= 400 && !detectChallenge(page.headers, page.status)) {
        targetFindings.push(httpError(normalized, page.status, page.finalUrl));
      }
      fetchOptions.cache?.clear();
    }
  } catch (err) {
    // A redirect loop or a chain past MAX_REDIRECTS is the site answering; the
    // redirects module reports it, and the HTML modules find no page.
    if (err instanceof RedirectError) reached = true;
    else targetFindings.push(unreachable(normalized, describeError(err)));
  }

  // Phases 1-3. Crawl runs when --crawl is set, or when it is named in only.
  // An only without crawl wins over --crawl, and says so.
  const only = opts.only && opts.only.length > 0 ? expandOnly(opts.only) : undefined;
  const selected = new Set<ModuleId>(only ?? MODULE_IDS.filter((id) => id !== 'crawl' || opts.crawl !== undefined));
  if (only && opts.crawl !== undefined && !selected.has('crawl')) {
    process.stderr.write('--crawl has no effect: "crawl" is not in --only\n');
  }

  let allModules: AuditModuleResult[] = [];
  if (targetFindings.length > 0) allModules.push({ module: 'target', findings: targetFindings });
  for (const phase of reached ? phases : []) {
    const modules = phase.filter((m) => selected.has(m.name) && (isHtml || !m.html));
    if (modules.length > 0) {
      allModules.push(...(await runModules(modules, ctx)));
    }
  }

  // Mark ignored findings. They stay in the report but not in the counts.
  const ignore = new Set<IssueCode>(opts.ignore ?? []);
  if (ignore.size > 0) {
    allModules = allModules.map((m) => ({
      ...m,
      findings: m.findings.map((f) => (ignore.has(f.code) ? { ...f, ignored: true } : f)),
    }));
  }

  // Compute summary
  const allFindings = allModules.flatMap((m) => m.findings);
  const counted = allFindings.filter((f) => !f.ignored);
  const ignoredCount = allFindings.length - counted.length;
  const summary = {
    errors: counted.filter((f) => f.severity === 'error').length,
    warnings: counted.filter((f) => f.severity === 'warning').length,
    info: counted.filter((f) => f.severity === 'info').length,
    passed: counted.filter((f) => f.severity === 'pass').length,
    ...(ignoredCount > 0 && { ignored: ignoredCount }),
  };

  return {
    url: normalized,
    timestamp: new Date().toISOString(),
    duration: Date.now() - start,
    summary,
    modules: allModules,
    ...(only && { only }),
    page: pageFacts,
  };
}
