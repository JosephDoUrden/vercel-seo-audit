import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ISSUE_CODES } from '../types.js';
import type { IssueCode, SeoAuditConfig } from '../types.js';
import { CONFIG_FILE } from './config.js';

const IGNORE_FILE = '.seoauditignore';


const knownCodes = new Set<string>(ISSUE_CODES);

/** One code per line. Blank lines and anything after `#` are skipped. */
export function parseIgnoreFile(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line.length > 0);
}

function readIgnoreFile(cwd: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(resolve(cwd, IGNORE_FILE), 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Error in ${IGNORE_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseIgnoreFile(raw);
}

/**
 * Collects ignored issue codes from `--ignore`, `.seoauditignore` in `cwd` and
 * the `ignore` array in `.seoauditrc.json`, and returns their union. An unknown
 * code throws an error that names the source it came from.
 */
export function resolveIgnore(opts: {
  cliValues?: string[];
  cwd: string;
  config?: SeoAuditConfig;
}): IssueCode[] {
  const sources: [string, string[]][] = [
    ['--ignore', (opts.cliValues ?? []).flatMap((v) => v.split(',')).map((c) => c.trim()).filter(Boolean)],
    [IGNORE_FILE, readIgnoreFile(opts.cwd)],
    [CONFIG_FILE, opts.config?.ignore ?? []],
  ];

  const codes = new Set<IssueCode>();
  for (const [source, values] of sources) {
    for (const code of values) {
      if (!knownCodes.has(code)) {
        throw new Error(`Error in ${source}: unknown issue code "${code}"`);
      }
      codes.add(code as IssueCode);
    }
  }
  return [...codes];
}
