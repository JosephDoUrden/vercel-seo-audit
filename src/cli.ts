import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { runAudit } from './runner.js';
import { formatReport, formatJson, formatMarkdown, formatHtml, formatDiff, formatDiffJson, formatFixes } from './utils/output.js';
import { getExitCode } from './exitCode.js';
import { parsePagesFlag } from './utils/parsePagesFlag.js';
import { loadConfig } from './utils/config.js';
import { resolveIgnore } from './utils/ignore.js';
import { resolveOnly } from './utils/only.js';
import { diffReports } from './utils/diff.js';
import { generateFixes } from './fixes/index.js';
import { USER_AGENT_PRESETS, DEFAULT_CRAWL_LIMIT } from './constants.js';
import type { AuditReport } from './types.js';

const program = new Command();

program
  .name('vercel-seo-audit')
  .description('Diagnose SEO and indexing issues for Next.js/Vercel websites')
  .version('2.10.0') // x-release-please-version
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
  .option('--fix', 'Show auto-fix suggestions for supported findings')
  .option('--apply', 'Write suggested fixes to disk (requires --fix)')
  .option('--ignore <codes>', 'Comma-separated issue codes to ignore, repeatable (e.g. ROBOTS_MISSING,FAVICON_MISSING)', (value: string, previous: string[]) => [...previous, value], [] as string[])
  .option('--only <modules>', 'Comma-separated audit modules to run, repeatable; their dependencies are added (e.g. vercel,streamedMetadata)', (value: string, previous: string[]) => [...previous, value], [] as string[])
  .action(async (urlArg: string | undefined, options: { json?: boolean; verbose?: boolean; strict?: boolean; timeout: string; pages?: string; userAgent?: string; report?: string; crawl?: boolean | string; diff?: string; fix?: boolean; apply?: boolean; ignore: string[]; only: string[] }) => {
    // Load config file
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }

    // Ignore list: union of --ignore, .seoauditignore and config
    let ignore;
    try {
      ignore = resolveIgnore({ cliValues: options.ignore, cwd: process.cwd(), config });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }

    // Module selection: --only replaces config
    let only;
    try {
      only = resolveOnly({ cliValues: options.only, config });
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

    // Validate --apply requires --fix
    if (options.apply && !options.fix) {
      console.error('Error: --apply requires --fix');
      process.exit(2);
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
        ignore,
        only,
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

        // With --only, the previous report is compared on the same modules.
        const diff = diffReports(auditReport, previousReport);

        if (options.json) {
          console.log(formatDiffJson(diff));
        } else {
          console.log(formatDiff(diff));
        }
      }

      // Show fix suggestions if --fix (ignored findings get no fix)
      if (options.fix) {
        const allFindings = auditReport.modules.flatMap((m) => m.findings);
        const fixes = generateFixes(allFindings, auditReport.url);

        console.log(formatFixes(fixes));

        if (options.apply && fixes.length > 0) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((res) => {
            rl.question(`Write ${fixes.length} file(s) to disk? [y/N] `, res);
          });
          rl.close();

          if (answer.toLowerCase() === 'y') {
            for (const fix of fixes) {
              const filePath = resolve(process.cwd(), fix.filePath);
              if (existsSync(filePath)) {
                console.log(`  Skipped ${fix.filePath} (already exists)`);
                continue;
              }
              const dir = dirname(filePath);
              mkdirSync(dir, { recursive: true });
              writeFileSync(filePath, fix.content, 'utf-8');
              console.log(`  Created ${fix.filePath}`);
            }
          } else {
            console.log('  No files written.');
          }
        }
      }

      // Exit code based on findings; 2 when the page could not be fetched at all
      const code = getExitCode(auditReport.summary, strict ?? false, auditReport.page?.status !== null);
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
