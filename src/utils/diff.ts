import type { AuditFinding, AuditReport, DiffResult, IssueCode, ModuleId } from '../types.js';

// Reports saved before the pass findings got their own codes used the failure
// code at severity pass. Reading them under the new code keeps a found sitemap
// in an old report from matching a missing one in the new.
const LEGACY_PASS_CODES: Partial<Record<IssueCode, IssueCode>> = {
  SITEMAP_MISSING: 'SITEMAP_FOUND',
  JSONLD_MISSING: 'JSONLD_FOUND',
};

const codeOf = (f: AuditFinding) => (f.severity === 'pass' && LEGACY_PASS_CODES[f.code]) || f.code;

const toKey = (f: AuditFinding) => `${codeOf(f)}::${f.url ?? ''}`;

/**
 * Compares two reports by finding code and URL. When either run was limited
 * with `--only`, both are cut down to the modules they share, so findings from
 * a module only one of them ran are reported as neither new nor resolved. The
 * modules either run left out with `--skip-pack` are dropped from both the same way.
 * The `target` findings (the up-front fetch of the page) are always compared,
 * since every run makes that fetch.
 */
export function diffReports(current: AuditReport, previous: AuditReport): DiffResult {
  const skipped = new Set<string>([...current.skippedByPack ?? [], ...previous.skippedByPack ?? []]);
  const shared = (m: { module: string }) =>
    m.module === 'target'
    || !skipped.has(m.module)
    && (!current.only || current.only.includes(m.module as ModuleId))
    && (!previous.only || previous.only.includes(m.module as ModuleId));

  // Ignored findings stay in the diff (tagged by formatDiff). The previous
  // report has no ignored flags, so dropping them would show a newly
  // ignored code as resolved.
  const currentFindings = current.modules.filter(shared).flatMap((m) => m.findings);
  const previousFindings = previous.modules.filter(shared).flatMap((m) => m.findings);

  const previousKeys = new Set(previousFindings.map(toKey));
  const currentKeys = new Set(currentFindings.map(toKey));

  return {
    newIssues: currentFindings.filter((f) => !previousKeys.has(toKey(f))),
    resolvedIssues: previousFindings.filter((f) => !currentKeys.has(toKey(f))),
    unchanged: currentFindings.filter((f) => previousKeys.has(toKey(f))),
  };
}
