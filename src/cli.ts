import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { runAudit } from './runner.js';
import { formatReport, formatJson, formatMarkdown, formatHtml, formatDiff, formatDiffJson } from './utils/output.js';
import { getExitCode } from './exitCode.js';
import { parsePagesFlag } from './utils/parsePagesFlag.js';
import { loadConfig } from './utils/config.js';
import { USER_AGENT_PRESETS, DEFAULT_CRAWL_LIMIT } from './constants.js';
import type { AuditFinding, AuditReport, DiffResult } from './types.js';

const program = new Command();

program
  .name('vercel-seo-audit')
  .description('Diagnose SEO and indexing issues for Next.js/Vercel websites')
  .version('2.3.1') // x-release-please-version
  .argument('[url]', 'URL to audit (e.g. https://yusufhan.dev)')
  .option('--json', 'Output results as JSON')
  .option('--verbose', 'Show detailed information for each finding')
  .option('-S, --strict', 'Fail on any SEO issues found, including warnings')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--pages <paths>', 'Comma-separated page paths to check for redirects (e.g. /about,/pricing)')
  .option('--user-agent <preset|string>', 'User-Agent for requests: googlebot, bingbot, or a custom string')
  .option('--report <format>', 'Write report to file: json, md, or html')
  .option('--crawl [limit]', 'Crawl sitemap URLs and audit each page (default: 50)')
  .option('--diff <path>', 'Compare against a previous report.json')
  .action(async (urlArg: string | undefined, options: { json?: boolean; verbose?: boolean; strict?: boolean; timeout: string; pages?: string; userAgent?: string; report?: string; crawl?: boolean | string; diff?: string }) => {
    // Load config file
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }

    // Resolve URL: CLI arg > config > error
    const url = urlArg ?? config?.url;
    if (!url) {
      console.error('Error: URL is required. Provide it as an argument or set "url" in .seoauditrc.json');
      process.exit(2);
    }

    // Merge options: CLI flags > config > defaults
    const verbose = options.verbose ?? config?.verbose;
    const strict = options.strict ?? config?.strict;

    const timeoutSource = program.getOptionValueSource('timeout');
    const timeout = timeoutSource === 'cli'
      ? parseInt(options.timeout, 10)
      : config?.timeout ?? parseInt(options.timeout, 10);
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

    // Merge pages: CLI flag > config
    let pages: string[] | undefined;
    if (options.pages) {
      try {
        pages = parsePagesFlag(options.pages);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(2);
      }
    } else if (config?.pages) {
      pages = config.pages;
    }

    // Merge report: CLI flag > config
    const report = options.report ?? config?.report;
    if (report && report !== 'json' && report !== 'md' && report !== 'html') {
      console.error('Error: --report must be "json", "md", or "html"');
      process.exit(2);
    }

    // Parse --crawl option (CLI-only)
    let crawl: number | undefined;
    if (options.crawl !== undefined) {
      crawl = options.crawl === true ? DEFAULT_CRAWL_LIMIT : parseInt(String(options.crawl), 10);
      if (isNaN(crawl) || crawl <= 0) {
        console.error('Error: --crawl must be a positive number');
        process.exit(2);
      }
    }

    // Merge user-agent: CLI flag > config
    const userAgentRaw = options.userAgent ?? config?.userAgent;
    let userAgent: string | undefined;
    if (userAgentRaw) {
      const lower = userAgentRaw.toLowerCase();
      userAgent = USER_AGENT_PRESETS[lower] ?? userAgentRaw;
    }

    try {
      const auditReport = await runAudit(url, {
        verbose,
        timeout,
        pages,
        userAgent,
        crawl,
      });

      if (options.json) {
        console.log(formatJson(auditReport));
      } else {
        console.log(formatReport(auditReport, verbose ?? false));
      }

      // Write report file if requested
      if (report) {
        const fileNames: Record<string, string> = { json: 'report.json', md: 'report.md', html: 'report.html' };
        const formatters: Record<string, () => string> = {
          json: () => formatJson(auditReport),
          md: () => formatMarkdown(auditReport),
          html: () => formatHtml(auditReport),
        };
        const fileName = fileNames[report];
        const content = formatters[report]();
        const filePath = resolve(process.cwd(), fileName);
        writeFileSync(filePath, content, 'utf-8');
        console.log(`\nReport written to ${fileName}`);
      }

      // Diff against previous report (CLI-only)
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

        const currentFindings = auditReport.modules.flatMap((m) => m.findings);
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
      const code = getExitCode(auditReport.summary, strict ?? false);
      if (code !== 0 && strict && auditReport.summary.warnings > 0) {
        console.error('Warnings found in strict mode');
      }
      process.exit(code);
    } catch (err) {
      console.error('Fatal error:', err instanceof Error ? err.message : err);
      process.exit(2);
    }
  });

program.parse();
