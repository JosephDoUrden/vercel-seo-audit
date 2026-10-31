/**
 * The programmatic API: run the audit from code without spawning the CLI.
 * Nothing here imports `cli.ts`, so importing the package does not parse argv
 * or exit the process.
 */
export { runAudit } from './runner.js';
export type { RunAuditOptions } from './runner.js';
export { buildAgentReport, formatAgent } from './utils/agent-format.js';
export type { AgentFinding, AgentReport } from './utils/agent-format.js';
export { diffReports } from './utils/diff.js';
export { describeCode } from './utils/catalog.js';
export type { CodeEntry, FindingSource } from './utils/catalog.js';
export { getExitCode } from './exitCode.js';
export { ISSUE_CODES, ISSUE_DESCRIPTIONS, MODULE_IDS } from './types.js';
export type {
  AuditFinding,
  AuditModuleResult,
  AuditReport,
  DiffResult,
  IssueCategory,
  IssueCode,
  IssueSeverity,
  IssueSeverity as Severity,
  ModuleId,
  PageFacts,
} from './types.js';
export { VERSION } from './constants.js';
