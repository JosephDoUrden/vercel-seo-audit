import { Command } from "commander";
import { runAudit } from "./runner.js";
import { formatReport, formatJson } from "./utils/output.js";

const program = new Command();

program
  .name("vercel-seo-audit")
  .description("Diagnose SEO and indexing issues for Next.js/Vercel websites")
  .version("0.1.0")
  .argument("<url>", "URL to audit (e.g. https://example.com)")
  .option("--json", "Output results as JSON")
  .option("--verbose", "Show detailed information for each finding")
  .option("-S, --strict", "Fail on any SEO issues found, including warnings")
  .option("--timeout <ms>", "Request timeout in milliseconds", "10000")
  .action(
    async (
      url: string,
      options: {
        json?: boolean;
        verbose?: boolean;
        strict?: boolean;
        timeout: string;
      },
    ) => {
      const timeout = parseInt(options.timeout, 10);
      if (isNaN(timeout) || timeout <= 0) {
        console.error("Error: --timeout must be a positive number");
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

      try {
        const report = await runAudit(url, {
          verbose: options.verbose,
          timeout,
          strict: options.strict,
        });

        if (options.json) {
          console.log(formatJson(report));
        } else {
          console.log(formatReport(report, options.verbose ?? false));
        }

        // Exit code based on findings
        if (report.summary.errors > 0) {
          process.exit(1);
        }

        if (options.strict && report.summary.warnings > 0) {
          console.error("Warnings found in strict mode");
          process.exit(1);
        }
        process.exit(0);
      } catch (err) {
        console.error("Fatal error:", err instanceof Error ? err.message : err);
        process.exit(2);
      }
    },
  );

program.parse();
