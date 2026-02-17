import type {
  AuditContext,
  AuditFinding,
  AuditModuleResult,
  AuditReport,
  FetchOptions,
} from './types.js';
import { normalizeUrl } from './utils/url.js';
import {
  auditRedirects,
  auditRobots,
  auditSitemap,
  auditMetadata,
  auditFavicon,
  auditNextjs,
  auditStructuredData,
} from './audit/index.js';

type AuditModule = {
  name: string;
  run: (ctx: AuditContext) => Promise<AuditFinding[]>;
};

const phase1Modules: AuditModule[] = [
  { name: 'robots', run: auditRobots },
  { name: 'redirects', run: auditRedirects },
];

const phase2Modules: AuditModule[] = [
  { name: 'sitemap', run: auditSitemap },
  { name: 'metadata', run: auditMetadata },
  { name: 'favicon', run: auditFavicon },
  { name: 'nextjs', run: auditNextjs },
  { name: 'structuredData', run: auditStructuredData },
];

async function runModules(
  modules: AuditModule[],
  ctx: AuditContext,
): Promise<AuditModuleResult[]> {
  const results = await Promise.allSettled(
    modules.map(async (mod) => {
      const findings = await mod.run(ctx);
      return { module: mod.name, findings } satisfies AuditModuleResult;
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
  opts: { verbose?: boolean; timeout?: number; pages?: string[]; userAgent?: string } = {},
): Promise<AuditReport> {
  const start = Date.now();
  const normalized = normalizeUrl(url);

  const fetchOptions: FetchOptions = {
    timeout: opts.timeout,
    userAgent: opts.userAgent,
  };

  const ctx: AuditContext = {
    url,
    normalizedUrl: normalized,
    fetchOptions,
    verbose: opts.verbose ?? false,
    pages: opts.pages,
  };

  // Phase 1: robots + redirects (parallel)
  const phase1Results = await runModules(phase1Modules, ctx);

  // Phase 2: sitemap, metadata, favicon, nextjs (parallel)
  const phase2Results = await runModules(phase2Modules, ctx);

  const allModules = [...phase1Results, ...phase2Results];

  // Compute summary
  const allFindings = allModules.flatMap((m) => m.findings);
  const summary = {
    errors: allFindings.filter((f) => f.severity === 'error').length,
    warnings: allFindings.filter((f) => f.severity === 'warning').length,
    info: allFindings.filter((f) => f.severity === 'info').length,
    passed: allFindings.filter((f) => f.severity === 'pass').length,
  };

  return {
    url: normalized,
    timestamp: new Date().toISOString(),
    duration: Date.now() - start,
    summary,
    modules: allModules,
  };
}
