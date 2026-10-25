import type {
  AuditContext,
  AuditFinding,
  AuditModuleResult,
  AuditReport,
  FetchOptions,
  IssueCode,
  ModuleId,
  PageFacts,
} from './types.js';
import { MODULE_IDS } from './types.js';
import { normalizeUrl } from './utils/url.js';
import { fetchPage } from './utils/http.js';
import { isNextjsPage } from './utils/nextjs.js';
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
} from './audit/index.js';

type AuditModule = {
  name: ModuleId;
  run: (ctx: AuditContext) => Promise<AuditFinding[]>;
  /** Modules whose context this one reads; they are added when this one is selected. */
  deps?: readonly ModuleId[];
};

// Phases run one after another; the modules inside a phase run in parallel.
// Phase 1 fills ctx.robotsTxt for sitemap, phase 2 fills ctx.sitemapUrls for crawl.
export const phases: readonly (readonly AuditModule[])[] = [
  [
    { name: 'robots', run: auditRobots },
    { name: 'redirects', run: auditRedirects },
  ],
  [
    { name: 'sitemap', run: auditSitemap, deps: ['robots'] },
    { name: 'metadata', run: auditMetadata },
    { name: 'favicon', run: auditFavicon },
    { name: 'nextjs', run: auditNextjs },
    { name: 'structuredData', run: auditStructuredData },
    { name: 'i18n', run: auditI18n },
    { name: 'images', run: auditImages },
    { name: 'security', run: auditSecurity },
    { name: 'performance', run: auditPerformance },
    { name: 'vercel', run: auditVercel },
    { name: 'streamedMetadata', run: auditStreamedMetadata },
  ],
  [{ name: 'crawl', run: auditCrawl, deps: ['sitemap'] }],
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

async function runModules(
  modules: AuditModule[],
  ctx: AuditContext,
): Promise<AuditModuleResult[]> {
  const results = await Promise.allSettled(
    modules.map(async (mod): Promise<AuditModuleResult> => {
      const findings = await mod.run(ctx);
      return { module: mod.name, findings };
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<AuditModuleResult> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value);
}

export async function runAudit(
  url: string,
  opts: {
    verbose?: boolean;
    timeout?: number;
    pages?: string[];
    userAgent?: string;
    crawl?: number;
    ignore?: readonly IssueCode[];
    /** Run only these modules (and the modules they depend on). The page is still fetched once. */
    only?: readonly ModuleId[];
  } = {},
): Promise<AuditReport> {
  const start = Date.now();
  const normalized = normalizeUrl(url);

  const fetchOptions: FetchOptions = {
    timeout: opts.timeout,
    userAgent: opts.userAgent,
    cache: new Map(),
  };

  const ctx: AuditContext = {
    url,
    normalizedUrl: normalized,
    fetchOptions,
    verbose: opts.verbose ?? false,
    pages: opts.pages,
    crawlLimit: opts.crawl,
  };

  // Phase 0: fetch the page once and share it. A failed or non-2xx fetch is
  // not shared and is dropped from the cache, so the modules try again for
  // themselves and report what they can.
  const pageFacts: PageFacts = { status: null, finalUrl: null, nextjs: false };
  try {
    const page = await fetchPage(normalized, fetchOptions);
    pageFacts.status = page.status;
    pageFacts.finalUrl = page.finalUrl;
    pageFacts.nextjs = isNextjsPage(Object.fromEntries(page.headers.entries()), page.body);
    if (page.status >= 200 && page.status < 300) {
      ctx.html = page.body;
      ctx.headers = Object.fromEntries(page.headers.entries());
      ctx.finalUrl = page.finalUrl;
    } else {
      fetchOptions.cache?.clear();
    }
  } catch {
    // Left unset on purpose
  }

  // Phases 1-3. Crawl runs when --crawl is set, or when it is named in only.
  // An only without crawl wins over --crawl, and says so.
  const only = opts.only && opts.only.length > 0 ? expandOnly(opts.only) : undefined;
  const selected = new Set<ModuleId>(only ?? MODULE_IDS.filter((id) => id !== 'crawl' || opts.crawl !== undefined));
  if (only && opts.crawl !== undefined && !selected.has('crawl')) {
    process.stderr.write('--crawl has no effect: "crawl" is not in --only\n');
  }

  let allModules: AuditModuleResult[] = [];
  for (const phase of phases) {
    const modules = phase.filter((m) => selected.has(m.name));
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
