import chalk from 'chalk';
import type { AuditFinding, AuditReport, IssueSeverity } from '../types.js';

const severityColors: Record<IssueSeverity, (text: string) => string> = {
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
  pass: chalk.green,
};

const severityIcons: Record<IssueSeverity, string> = {
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  pass: '✔',
};

function formatFinding(finding: AuditFinding, verbose: boolean): string {
  const color = severityColors[finding.severity];
  const icon = severityIcons[finding.severity];
  const lines: string[] = [];

  lines.push(color(`  ${icon} [${finding.severity.toUpperCase()}] ${finding.message}`));
  lines.push(chalk.dim(`    ${finding.explanation}`));
  lines.push(chalk.cyan(`    → ${finding.suggestion}`));

  if (finding.url) {
    lines.push(chalk.dim(`    URL: ${finding.url}`));
  }

  if (verbose && finding.details && Object.keys(finding.details).length > 0) {
    lines.push(chalk.dim(`    Details: ${JSON.stringify(finding.details, null, 2).split('\n').join('\n    ')}`));
  }

  return lines.join('\n');
}

export function formatReport(report: AuditReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold.underline(`SEO Audit Report for ${report.url}`));
  lines.push(chalk.dim(`  Completed in ${report.duration}ms at ${report.timestamp}`));
  lines.push('');

  // Summary
  const { errors, warnings, info, passed } = report.summary;
  lines.push(chalk.bold('  Summary:'));
  if (errors > 0) lines.push(chalk.red(`    ✖ ${errors} error${errors !== 1 ? 's' : ''}`));
  if (warnings > 0) lines.push(chalk.yellow(`    ⚠ ${warnings} warning${warnings !== 1 ? 's' : ''}`));
  if (info > 0) lines.push(chalk.blue(`    ℹ ${info} info`));
  if (passed > 0) lines.push(chalk.green(`    ✔ ${passed} passed`));
  lines.push('');

  // Group findings by category
  const allFindings: AuditFinding[] = report.modules.flatMap((m) => m.findings);
  const categories = new Map<string, AuditFinding[]>();

  for (const finding of allFindings) {
    const cat = finding.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(finding);
  }

  for (const [category, findings] of categories) {
    lines.push(chalk.bold(`  ${category.toUpperCase()}`));
    lines.push(chalk.dim(`  ${'─'.repeat(40)}`));

    for (const finding of findings) {
      lines.push(formatFinding(finding, verbose));
      lines.push('');
    }
  }

  if (allFindings.length === 0) {
    lines.push(chalk.green('  No issues found!'));
  }

  return lines.join('\n');
}

export function formatJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
