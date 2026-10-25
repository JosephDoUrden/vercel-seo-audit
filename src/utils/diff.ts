import type { AuditFinding, AuditReport, DiffResult, ModuleId } from '../types.js';

const toKey = (f: AuditFinding) => `${f.code}::${f.url ?? ''}`;

/**
 * Compares two reports by finding code and URL. When either run was limited
 * with `--only`, both are cut down to the modules they share, so findings from
 * a module only one of them ran are reported as neither new nor resolved.
 */
export function diffReports(current: AuditReport, previous: AuditReport): DiffResult {
  const shared = (m: { module: string }) =>
    (!current.only || current.only.includes(m.module as ModuleId))
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
