import chalk from 'chalk';
import type { AuditFinding, AuditReport, DiffResult, IssueSeverity } from '../types.js';

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

const severityMdIcons: Record<IssueSeverity, string> = {
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  pass: '✅',
};

function formatFindingMd(finding: AuditFinding): string {
  const icon = severityMdIcons[finding.severity];
  const lines: string[] = [];

  lines.push(`- ${icon} **[${finding.severity.toUpperCase()}]** ${finding.message}`);
  lines.push(`  - ${finding.explanation}`);
  lines.push(`  - **Fix:** ${finding.suggestion}`);

  if (finding.url) {
    lines.push(`  - URL: \`${finding.url}\``);
  }

  return lines.join('\n');
}

export function formatMarkdown(report: AuditReport): string {
  const lines: string[] = [];

  lines.push(`# SEO Audit Report for ${report.url}`);
  lines.push('');
  lines.push(`> Completed in ${report.duration}ms at ${report.timestamp}`);
  lines.push('');

  // Summary
  const { errors, warnings, info, passed } = report.summary;
  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  if (errors > 0) lines.push(`| ❌ Errors | ${errors} |`);
  if (warnings > 0) lines.push(`| ⚠️ Warnings | ${warnings} |`);
  if (info > 0) lines.push(`| ℹ️ Info | ${info} |`);
  if (passed > 0) lines.push(`| ✅ Passed | ${passed} |`);
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
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push('');
    for (const finding of findings) {
      lines.push(formatFindingMd(finding));
    }
    lines.push('');
  }

  if (allFindings.length === 0) {
    lines.push('**No issues found!**');
    lines.push('');
  }

  return lines.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatHtml(report: AuditReport): string {
  const { errors, warnings, info, passed } = report.summary;

  const allFindings: AuditFinding[] = report.modules.flatMap((m) => m.findings);
  const categories = new Map<string, AuditFinding[]>();
  for (const finding of allFindings) {
    const cat = finding.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(finding);
  }

  const severityHtmlIcons: Record<string, string> = {
    error: '&#10006;',
    warning: '&#9888;',
    info: '&#8505;',
    pass: '&#10004;',
  };

  let findingsHtml = '';
  if (allFindings.length === 0) {
    findingsHtml = '<p class="no-issues">No issues found!</p>';
  } else {
    for (const [category, findings] of categories) {
      const label = escapeHtml(category.charAt(0).toUpperCase() + category.slice(1));
      const items = findings
        .map((f) => {
          const icon = severityHtmlIcons[f.severity] ?? '';
          let html = `<div class="finding" data-severity="${f.severity}">`;
          html += `<span class="finding-icon severity-${f.severity}">${icon}</span>`;
          html += `<div class="finding-content">`;
          html += `<strong>[${escapeHtml(f.severity.toUpperCase())}]</strong> ${escapeHtml(f.message)}`;
          html += `<div class="finding-explanation">${escapeHtml(f.explanation)}</div>`;
          html += `<div class="finding-suggestion">&rarr; ${escapeHtml(f.suggestion)}</div>`;
          if (f.url) {
            html += `<div class="finding-url">URL: ${escapeHtml(f.url)}</div>`;
          }
          html += `</div></div>`;
          return html;
        })
        .join('\n');
      findingsHtml += `<details class="category" open><summary>${label}</summary>${items}</details>`;
    }
  }

  const summaryCards = [
    { label: 'Errors', count: errors, cls: 'error' },
    { label: 'Warnings', count: warnings, cls: 'warning' },
    { label: 'Info', count: info, cls: 'info' },
    { label: 'Passed', count: passed, cls: 'pass' },
  ]
    .map((c) => `<div class="card severity-${c.cls}"><div class="card-count">${c.count}</div><div class="card-label">${c.label}</div></div>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SEO Audit Report — ${escapeHtml(report.url)}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0;padding:0;background:#f5f7fa;color:#1a1a2e}
.container{max-width:900px;margin:0 auto;padding:24px}
header{margin-bottom:32px}
h1{font-size:1.5rem;margin:0 0 8px}
.meta{color:#6b7280;font-size:.875rem}
.summary{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:32px}
.card{flex:1;min-width:120px;padding:16px;border-radius:8px;text-align:center;background:#fff;border:1px solid #e5e7eb}
.card-count{font-size:2rem;font-weight:700}
.card-label{font-size:.875rem;color:#6b7280;margin-top:4px}
.card.severity-error .card-count{color:#dc2626}
.card.severity-warning .card-count{color:#d97706}
.card.severity-info .card-count{color:#2563eb}
.card.severity-pass .card-count{color:#16a34a}
.filters{margin-bottom:24px;display:flex;gap:8px;flex-wrap:wrap}
.filter-btn{padding:6px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:.875rem}
.filter-btn.active{background:#1a1a2e;color:#fff;border-color:#1a1a2e}
.category{margin-bottom:16px;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden}
.category summary{padding:12px 16px;font-weight:600;cursor:pointer;background:#fafafa;font-size:1rem}
.finding{display:flex;gap:12px;padding:12px 16px;border-top:1px solid #f0f0f0}
.finding-icon{font-size:1.1rem;flex-shrink:0;width:24px;text-align:center}
.severity-error{color:#dc2626}
.severity-warning{color:#d97706}
.severity-info{color:#2563eb}
.severity-pass{color:#16a34a}
.finding-content{flex:1;font-size:.9rem;line-height:1.5}
.finding-explanation{color:#6b7280;margin-top:2px}
.finding-suggestion{color:#0369a1;margin-top:2px}
.finding-url{color:#6b7280;font-size:.8rem;margin-top:2px}
.no-issues{text-align:center;color:#16a34a;font-size:1.1rem;padding:32px}
.finding.hidden{display:none}
</style>
</head>
<body>
<div class="container">
<header>
<h1>SEO Audit Report</h1>
<div class="meta">URL: ${escapeHtml(report.url)} &mdash; ${escapeHtml(report.timestamp)} &mdash; ${report.duration}ms</div>
</header>
<section class="summary">${summaryCards}</section>
<div class="filters">
<button class="filter-btn active" data-filter="all">All</button>
<button class="filter-btn" data-filter="error">Errors</button>
<button class="filter-btn" data-filter="warning">Warnings</button>
<button class="filter-btn" data-filter="info">Info</button>
<button class="filter-btn" data-filter="pass">Passed</button>
</div>
<section class="findings">${findingsHtml}</section>
</div>
<script>
document.querySelectorAll('.filter-btn').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.querySelectorAll('.filter-btn').forEach(function(b){b.classList.remove('active')});
    btn.classList.add('active');
    var filter=btn.getAttribute('data-filter');
    document.querySelectorAll('.finding').forEach(function(el){
      if(filter==='all'||el.getAttribute('data-severity')===filter){
        el.classList.remove('hidden');
      }else{
        el.classList.add('hidden');
      }
    });
  });
});
</script>
</body>
</html>`;
}

export function formatDiff(diff: DiffResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold.underline('Diff against previous report'));
  lines.push('');
  lines.push(
    `  ${chalk.green(`+ ${diff.newIssues.length} new`)}  ` +
    `${chalk.red(`- ${diff.resolvedIssues.length} resolved`)}  ` +
    `${chalk.dim(`= ${diff.unchanged.length} unchanged`)}`
  );
  lines.push('');

  if (diff.newIssues.length > 0) {
    lines.push(chalk.green.bold('  New issues:'));
    for (const f of diff.newIssues) {
      const color = severityColors[f.severity];
      lines.push(color(`    + [${f.severity.toUpperCase()}] ${f.message}${f.url ? ` (${f.url})` : ''}`));
    }
    lines.push('');
  }

  if (diff.resolvedIssues.length > 0) {
    lines.push(chalk.red.bold('  Resolved issues:'));
    for (const f of diff.resolvedIssues) {
      lines.push(chalk.dim(`    - [${f.severity.toUpperCase()}] ${f.message}${f.url ? ` (${f.url})` : ''}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatDiffJson(diff: DiffResult): string {
  return JSON.stringify(diff, null, 2);
}
