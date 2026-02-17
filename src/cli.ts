import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { runAudit } from './runner.js';
import { formatReport, formatJson, formatMarkdown, formatDiff, formatDiffJson } from './utils/output.js';
import { getExitCode } from './exitCode.js';
import { parsePagesFlag } from './utils/parsePagesFlag.js';
import { USER_AGENT_PRESETS } from './constants.js';
import type { AuditFinding, AuditReport, DiffResult } from './types.js';

const program = new Command();

program
  .name('vercel-seo-audit')
  .description('Diagnose SEO and indexing issues for Next.js/Vercel websites')
  .version('0.5.0')
  .argument('<url>', 'URL to audit (e.g. https://yusufhan.dev)')
  .option('--json', 'Output results as JSON')
  .option('--verbose', 'Show detailed information for each finding')
  .option('-S, --strict', 'Fail on any SEO issues found, including warnings')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--pages <paths>', 'Comma-separated page paths to check for redirects (e.g. /about,/pricing)')
  .option('--user-agent <preset|string>', 'User-Agent for requests: googlebot, bingbot, or a custom string')
  .option('--report <format>', 'Write report to file: json or md')
  .option('--diff <path>', 'Compare against a previous report.json')
  .action(async (url: string, options: { json?: boolean; verbose?: boolean; strict?: boolean; timeout: string; pages?: string; userAgent?: string; report?: string; diff?: string }) => {
    const timeout = parseInt(options.timeout, 10);
    if (isNaN(timeout) || timeout <= 0) {
      console.error('Error: --timeout must be a positive number');
      process.exit(2);
    }

    // Validate URL
    try {
      const testUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      new URL(testUrl);
    } catch {
      console.error(`Error: Invalid URL "${url}"`);
      process.exit(2);
    }

    let pages: string[] | undefined;
    if (options.pages) {
      try {
        pages = parsePagesFlag(options.pages);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(2);
      }
    }

    // Validate --report format
    if (options.report && options.report !== 'json' && options.report !== 'md') {
      console.error('Error: --report must be "json" or "md"');
      process.exit(2);
    }

    // Resolve user-agent preset or custom string
    let userAgent: string | undefined;
    if (options.userAgent) {
      const lower = options.userAgent.toLowerCase();
      userAgent = USER_AGENT_PRESETS[lower] ?? options.userAgent;
    }

    try {
      const report = await runAudit(url, {
        verbose: options.verbose,
        timeout,
        pages,
        userAgent,
      });

      if (options.json) {
        console.log(formatJson(report));
      } else {
        console.log(formatReport(report, options.verbose ?? false));
      }

      // Write report file if requested
      if (options.report) {
        const fileName = options.report === 'json' ? 'report.json' : 'report.md';
        const content = options.report === 'json' ? formatJson(report) : formatMarkdown(report);
        const filePath = resolve(process.cwd(), fileName);
        writeFileSync(filePath, content, 'utf-8');
        console.log(`\nReport written to ${fileName}`);
      }

      // Diff against previous report
      if (options.diff) {
        let previousReport: AuditReport;
        try {
          const raw = readFileSync(resolve(process.cwd(), options.diff), 'utf-8');
          previousReport = JSON.parse(raw) as AuditReport;
          if (!Array.isArray(previousReport.modules)) {
            throw new Error('Invalid report: missing modules array');
          }
        } catch (err) {
          console.error(`Error reading previous report: ${err instanceof Error ? err.message : err}`);
          process.exit(2);
        }

        const toKey = (f: AuditFinding) => `${f.code}::${f.url ?? ''}`;

        const currentFindings = report.modules.flatMap((m) => m.findings);
        const previousFindings = previousReport.modules.flatMap((m) => m.findings);

        const previousKeys = new Set(previousFindings.map(toKey));
        const currentKeys = new Set(currentFindings.map(toKey));

        const diff: DiffResult = {
          newIssues: currentFindings.filter((f) => !previousKeys.has(toKey(f))),
          resolvedIssues: previousFindings.filter((f) => !currentKeys.has(toKey(f))),
          unchanged: currentFindings.filter((f) => previousKeys.has(toKey(f))),
        };

        if (options.json) {
          console.log(formatDiffJson(diff));
        } else {
          console.log(formatDiff(diff));
        }
      }

      // Exit code based on findings
      const code = getExitCode(report.summary, options.strict ?? false);
      if (code !== 0 && options.strict && report.summary.warnings > 0) {
        console.error('Warnings found in strict mode');
      }
      process.exit(code);
    } catch (err) {
      console.error('Fatal error:', err instanceof Error ? err.message : err);
      process.exit(2);
    }
  });

program.parse();
