import { MODULE_IDS } from '../types.js';
import type {
  AuditFinding,
  AuditReport,
  DiffResult,
  IssueCategory,
  IssueCode,
  IssueSeverity,
  ModuleId,
  OutputFormat,
  SeoAuditConfig,
} from '../types.js';
import { CONFIG_FILE } from './config.js';

const FORMATS: readonly OutputFormat[] = ['text', 'agent'];

/** Caps on `details`, so one finding cannot flood an agent's context. */
export const MAX_DETAIL_ITEMS = 10;
export const MAX_DETAIL_CHARS = 200;

export interface AgentFinding {
  code: IssueCode;
  severity: Exclude<IssueSeverity, 'pass'>;
  category: IssueCategory;
  /** The module that reported it, or `target` for the up-front fetch of the page. */
  module: string;
  message: string;
  url: string | null;
  /** What to change, from the finding's suggestion; `null` when it has none. */
  fix: string | null;
  details?: Record<string, unknown>;
}

/**
 * The `--format agent` output: the stable contract for coding agents. `--json`
 * is the full report and may change shape; this does not, short of a major version.
 */
export interface AgentReport {
  tool: 'vercel-seo-audit';
  version: string;
  url: string;
  finalUrl: string | null;
  exitCode: number;
  summary: { errors: number; warnings: number; info: number };
  findings: AgentFinding[];
  /** Module ids that did not run: left out by `--only`, skipped on a non-HTML page, or never reached. */
  skipped: ModuleId[];
  /** Whether any `details` were cut to the caps above. */
  truncated: boolean;
  /** With `--diff`: new and resolved findings, and how many stayed; pass and ignored findings left out. */
  diff?: { new: AgentFinding[]; resolved: AgentFinding[]; unchanged: number };
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

// `target` runs before every module, so it sorts first.
const moduleRank = (module: string): number => (module === 'target' ? -1 : MODULE_IDS.indexOf(module as ModuleId));

/** Caps arrays and strings, at any depth, and reports whether it cut anything. */
function cap(value: unknown, cut: { truncated: boolean }): unknown {
  if (typeof value === 'string') {
    if (value.length <= MAX_DETAIL_CHARS) return value;
    cut.truncated = true;
    return value.slice(0, MAX_DETAIL_CHARS);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_DETAIL_ITEMS) cut.truncated = true;
    return value.slice(0, MAX_DETAIL_ITEMS).map((v) => cap(v, cut));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cap(v, cut)]));
  }
  return value;
}

function toAgentFinding(f: AuditFinding, module: string, cut: { truncated: boolean }): AgentFinding {
  return {
    code: f.code,
    severity: f.severity as AgentFinding['severity'],
    category: f.category,
    module,
    message: f.message,
    url: f.url ?? null,
    fix: f.suggestion ? f.suggestion : null,
    ...(f.details && Object.keys(f.details).length > 0 && { details: cap(f.details, cut) as Record<string, unknown> }),
  };
}

const actionable = (f: AuditFinding): boolean => f.severity !== 'pass' && !f.ignored;

// Pass and ignored findings are dropped; the rest sort error, warning, info,
// then by module run order, keeping each module's own order within that.
function agentFindings(entries: { finding: AuditFinding; module: string }[], cut: { truncated: boolean }): AgentFinding[] {
  return entries
    .filter(({ finding }) => actionable(finding))
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) =>
      SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity]
      || moduleRank(a.module) - moduleRank(b.module)
      || a.index - b.index)
    .map(({ finding, module }) => toAgentFinding(finding, module, cut));
}

/**
 * Builds the `--format agent` object. With `--diff`, the comparison is nested
 * under `diff` so the output stays one JSON document; `previous` is the report
 * it was compared against, which the resolved findings come from.
 */
export function buildAgentReport(
  report: AuditReport,
  opts: { version: string; exitCode: number; diff?: { result: DiffResult; previous: AuditReport } },
): AgentReport {
  const cut = { truncated: false };
  const entriesOf = (r: AuditReport) => r.modules.flatMap((m) => m.findings.map((finding) => ({ finding, module: m.module })));
  const entries = entriesOf(report);
  const findings = agentFindings(entries, cut);

  const ran = new Set(report.modules.map((m) => m.module));
  const skipped = MODULE_IDS.filter((id) => !ran.has(id));

  const result: AgentReport = {
    tool: 'vercel-seo-audit',
    version: opts.version,
    url: report.url,
    finalUrl: report.page?.finalUrl ?? null,
    exitCode: opts.exitCode,
    summary: { errors: report.summary.errors, warnings: report.summary.warnings, info: report.summary.info },
    findings,
    skipped,
    truncated: false,
  };

  if (opts.diff) {
    // diffReports hands back the reports' own finding objects, so each one maps to its module.
    const { result: diff, previous } = opts.diff;
    const moduleOf = new Map([...entries, ...entriesOf(previous)].map(({ finding, module }) => [finding, module]));
    const withModule = (list: AuditFinding[]) =>
      list.map((finding) => ({ finding, module: moduleOf.get(finding) ?? 'unknown' }));
    result.diff = {
      new: agentFindings(withModule(diff.newIssues), cut),
      resolved: agentFindings(withModule(diff.resolvedIssues), cut),
      unchanged: diff.unchanged.filter(actionable).length,
    };
  }

  result.truncated = cut.truncated;
  return result;
}

/** One line of JSON: agents parse it, people pipe it to `jq`. */
export function formatAgent(report: AuditReport, opts: Parameters<typeof buildAgentReport>[1]): string {
  return JSON.stringify(buildAgentReport(report, opts));
}

/** `--format` on the command line wins over `format` in `.seoauditrc.json`; `text` when neither sets it. */
export function resolveFormat(opts: { cliValue?: string; config?: SeoAuditConfig }): OutputFormat {
  const [source, value] = opts.cliValue !== undefined
    ? ['--format', opts.cliValue]
    : [CONFIG_FILE, opts.config?.format];
  if (value === undefined) return 'text';
  if (!(FORMATS as readonly string[]).includes(value)) {
    throw new Error(`Error in ${source}: unknown format "${value}" (valid: ${FORMATS.join(', ')})`);
  }
  return value as OutputFormat;
}
