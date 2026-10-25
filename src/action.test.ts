import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Guards the composite action against script injection: every input must
// reach the shell through env, never through a ${{ }} expression inside run.
// There is no YAML parser in the dependency tree, so the checks work on the
// raw text of action.yml.

const repoRoot = join(import.meta.dirname, '..');
const actionPath = join(repoRoot, 'action.yml');
const actionYml = readFileSync(actionPath, 'utf8');
const lines = actionYml.split('\n');

function declaredInputs(): string[] {
  const names: string[] = [];
  let inInputs = false;
  for (const line of lines) {
    if (/^inputs:\s*$/.test(line)) { inInputs = true; continue; }
    if (inInputs && /^\S/.test(line)) break;
    const m = inInputs ? line.match(/^  ([a-z-]+):\s*$/) : null;
    if (m) names.push(m[1]);
  }
  return names;
}

function runBlocks(): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*run:\s*\|\s*$/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const indent = lines[j].match(/^(\s*)/)![1];
    const body: string[] = [];
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') { body.push(''); continue; }
      if (!lines[j].startsWith(indent)) break;
      body.push(lines[j].slice(indent.length));
    }
    blocks.push(body.join('\n'));
  }
  return blocks;
}

function envMappedInputs(): string[] {
  const names: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s+[A-Z_]+:\s*\$\{\{\s*inputs\.([a-z-]+)\s*\}\}\s*$/);
    if (m) names.push(m[1]);
  }
  return names;
}

// The text of each step, from its "- name:" line to the next one.
function steps(): string[] {
  const start = actionYml.indexOf('\n  steps:\n');
  return actionYml.slice(start).split(/\n    - /).slice(1);
}

describe('action.yml (static)', () => {
  it('has a run block for the audit and one for the summary and comment', () => {
    expect(runBlocks()).toHaveLength(2);
    expect(runBlocks()[1].trim()).toBe('node "$GITHUB_ACTION_PATH/action/comment.mjs"');
  });

  it('runs the comment step after a failed audit and never lets it fail the job', () => {
    const step = steps().find((s) => s.includes('action/comment.mjs'))!;
    expect(step).toMatch(/^\s+if: always\(\)$/m);
    expect(step).toMatch(/^\s+continue-on-error: true$/m);
  });

  it('hands the comment step the report path and exit code from the audit step', () => {
    const step = steps().find((s) => s.includes('action/comment.mjs'))!;
    expect(step).toContain('REPORT_PATH: ${{ steps.audit.outputs.report-path }}');
    expect(step).toContain('AUDIT_EXIT_CODE: ${{ steps.audit.outputs.exit-code }}');
    expect(step).toContain('INPUT_COMMENT_KEY: ${{ inputs.comment-key }}');
  });

  it('maps the token once, to GH_TOKEN in the comment step', () => {
    const maps = actionYml.match(/^\s+[A-Z_]+:\s*\$\{\{\s*inputs\.github-token\s*\}\}\s*$/gm) ?? [];
    expect(maps).toEqual(['        GH_TOKEN: ${{ inputs.github-token }}']);
    const audit = steps().find((s) => s.includes('id: audit'))!;
    expect(audit).not.toContain('github-token');
    expect(audit).not.toContain('GH_TOKEN');
  });

  it('never interpolates an expression into the shell script', () => {
    for (const block of runBlocks()) {
      expect(block).not.toContain('${{');
    }
  });

  it('does not eval and does not float on @latest', () => {
    for (const block of runBlocks()) {
      expect(block).not.toMatch(/\beval\b/);
      expect(block).not.toContain('@latest');
    }
    expect(runBlocks()[0]).toMatch(/npx vercel-seo-audit@\d+\.\d+\.\d+/);
  });

  // summary, pr-comment and report reach both steps, so a name can repeat.
  it('passes every declared input through env', () => {
    const declared = declaredInputs();
    expect(declared.length).toBeGreaterThan(0);
    expect([...new Set(envMappedInputs())].sort()).toEqual([...declared].sort());
  });

  it('only references inputs from env values', () => {
    const refs = actionYml.match(/\$\{\{\s*inputs\.[a-z-]+\s*\}\}/g) ?? [];
    expect(refs).toHaveLength(envMappedInputs().length);
  });
});

describe.skipIf(process.platform === 'win32')('action.yml (executed)', () => {
  let work: string;
  let bin: string;
  let argsFile: string;
  let outputFile: string;
  let summaryFile: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'vsa-action-'));
    bin = join(work, 'bin');
    mkdirSync(bin);
    argsFile = join(work, 'npx-args');
    outputFile = join(work, 'github-output');
    writeFileSync(outputFile, '');
    summaryFile = join(work, 'step-summary');
    writeFileSync(summaryFile, '');
    // Stand-in for npx: record argv one per line, optionally write the report
    // file the real CLI would have written, exit with NPX_EXIT_CODE.
    // The comment step runs for real, with node and the actual script.
    writeFileSync(
      join(bin, 'npx'),
      [
        '#!/bin/sh',
        'printf \'%s\\n\' "$@" > "$NPX_ARGS_FILE"',
        'if [ -n "$NPX_WRITE_REPORT" ]; then echo "{}" > "$NPX_WRITE_REPORT"; fi',
        'exit "${NPX_EXIT_CODE:-0}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  // Both steps in order, as GitHub runs them: the second has if: always(),
  // so it runs whatever the audit returned. Inputs mirror GitHub's defaults.
  function run(inputs: Record<string, string>, npxExit = 0, writeReport = '') {
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_ACTION_PATH: repoRoot,
      NPX_ARGS_FILE: argsFile,
      NPX_EXIT_CODE: String(npxExit),
      NPX_WRITE_REPORT: writeReport,
      INPUT_URL: '',
      INPUT_STRICT: 'false',
      INPUT_USER_AGENT: '',
      INPUT_PAGES: '',
      INPUT_REPORT: '',
      INPUT_TIMEOUT: '10000',
      INPUT_VERBOSE: 'false',
      INPUT_IGNORE: '',
      INPUT_SUMMARY: 'true',
      INPUT_PR_COMMENT: 'false',
      INPUT_COMMENT_KEY: 'default',
      GH_TOKEN: '',
      ...inputs,
    };
    const [auditScript, commentScript] = runBlocks();
    const step = (script: string, i: number, stepEnv: Record<string, string>): SpawnSyncReturns<string> => {
      const scriptPath = join(work, `step-${i}.sh`);
      writeFileSync(scriptPath, script);
      // Same invocation GitHub uses for `shell: bash` in a composite action.
      return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], {
        cwd: work,
        env: stepEnv,
        encoding: 'utf8',
      });
    };
    const audit = step(auditScript, 0, env);
    // steps.audit.outputs, as the comment step's env maps them.
    const outputs = Object.fromEntries(
      readFileSync(outputFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)),
    );
    const comment = step(commentScript, 1, {
      ...env,
      REPORT_PATH: outputs['report-path'] ?? '',
      AUDIT_EXIT_CODE: outputs['exit-code'] ?? '',
    });
    const argv = existsSync(argsFile) ? readFileSync(argsFile, 'utf8').split('\n').slice(0, -1) : null;
    return {
      status: audit.status,
      stdout: audit.stdout,
      stderr: audit.stderr,
      commentStatus: comment.status,
      commentStdout: comment.stdout,
      commentStderr: comment.stderr,
      argv,
      output: readFileSync(outputFile, 'utf8'),
      summary: readFileSync(summaryFile, 'utf8'),
    };
  }

  it('passes hostile input to npx as literal arguments', () => {
    const url = 'https://x.test/$(touch canary-a); touch canary-b #';
    const ua = 'Mozilla `touch canary-c` "x" $HOME';
    const pages = '/a,/b; touch canary-d';
    const ignore = 'ROBOTS_MISSING,$(touch canary-e)';
    const r = run({
      INPUT_URL: url,
      INPUT_STRICT: 'true',
      INPUT_USER_AGENT: ua,
      INPUT_PAGES: pages,
      INPUT_REPORT: 'json',
      INPUT_TIMEOUT: '5000',
      INPUT_VERBOSE: 'true',
      INPUT_IGNORE: ignore,
    }, 0, 'report.json');
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--strict',
      '--user-agent', ua,
      '--pages', pages,
      '--report', 'json',
      '--timeout', '5000',
      '--verbose',
      '--ignore', ignore,
      '--',
      url,
    ]);
    for (const c of ['canary-a', 'canary-b', 'canary-c', 'canary-d', 'canary-e']) {
      expect(existsSync(join(work, c)), c).toBe(false);
    }
    expect(r.output).toContain('exit-code=0\n');
    expect(r.output).toContain('report-path=report.json\n');
  });

  // summary defaults to true, so report.md is asked for.
  it('sends the url and --report md when every optional input is at its default', () => {
    const r = run({ INPUT_URL: 'https://example.com' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--report', 'md',
      '--',
      'https://example.com',
    ]);
    expect(r.output).toBe('exit-code=0\n');
  });

  // A url that starts with "-" must reach the CLI as the positional argument,
  // never as a flag (commander stops option parsing at "--").
  it('passes a url that starts with a dash after the -- separator', () => {
    const url = '--diff=../../../../../../../../etc/passwd';
    const r = run({ INPUT_URL: url });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--report', 'md',
      '--',
      url,
    ]);
    expect(r.argv!.indexOf('--')).toBeLessThan(r.argv!.indexOf(url));
  });

  it('keeps every flag before the -- separator', () => {
    const r = run({ INPUT_URL: '-', INPUT_STRICT: 'true', INPUT_REPORT: 'md' });
    expect(r.status, r.stderr).toBe(0);
    const sep = r.argv!.indexOf('--');
    expect(sep).toBeGreaterThan(0);
    expect(r.argv!.slice(sep)).toEqual(['--', '-']);
    expect(r.argv!.slice(1, sep)).toEqual(['--strict', '--report', 'md']);
  });

  it('sends no url argument at all when the url input is empty', () => {
    const r = run({ INPUT_URL: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/), '--report', 'md']);
  });

  it('omits --timeout when the timeout input is empty', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_TIMEOUT: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--report', 'md',
      '--',
      'https://example.com',
    ]);
  });

  it('forwards a non-default timeout', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_TIMEOUT: '2500' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--report', 'md',
      '--timeout', '2500',
      '--',
      'https://example.com',
    ]);
  });

  it('omits every optional flag whose input is empty', () => {
    const r = run({
      INPUT_URL: 'https://example.com',
      INPUT_STRICT: '',
      INPUT_USER_AGENT: '',
      INPUT_PAGES: '',
      INPUT_REPORT: '',
      INPUT_TIMEOUT: '',
      INPUT_VERBOSE: '',
      INPUT_IGNORE: '',
      INPUT_SUMMARY: '',
      INPUT_PR_COMMENT: '',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--',
      'https://example.com',
    ]);
    expect(r.output).toBe('exit-code=0\n');
  });

  it('propagates exit code 1 and reports the md path when the file was written', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_REPORT: 'md' }, 1, 'report.md');
    expect(r.status).toBe(1);
    expect(r.output).toContain('exit-code=1\n');
    expect(r.output).toContain('report-path=report.md\n');
  });

  it('does not report a path when the audit crashed without writing the file', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_REPORT: 'md' }, 2);
    expect(r.status).toBe(2);
    expect(r.output).toBe('exit-code=2\n');
    expect(r.output).not.toContain('report-path');
  });

  it('does not report a path when the file is missing even on exit 0', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_REPORT: 'json' }, 0);
    expect(r.status).toBe(0);
    expect(r.output).toBe('exit-code=0\n');
  });

  it('never overrides an explicit report input', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_REPORT: 'json', INPUT_PR_COMMENT: 'true' }, 0, 'report.json');
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv!.filter((a) => a === '--report')).toHaveLength(1);
    expect(r.argv).toContain('json');
    expect(r.argv).not.toContain('md');
    expect(r.output).toContain('report-path=report.json\n');
    expect(r.commentStatus, r.commentStderr).toBe(0);
    expect(r.commentStdout).toContain('report: json');
  });

  it('asks for report.md for pr-comment alone and reports its path', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_SUMMARY: 'false', INPUT_PR_COMMENT: 'true' }, 0, 'report.md');
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--report', 'md',
      '--',
      'https://example.com',
    ]);
    expect(r.output).toContain('report-path=report.md\n');
  });

  it('asks for no report when summary and pr-comment are both off', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_SUMMARY: 'false', INPUT_PR_COMMENT: 'false' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).not.toContain('--report');
    expect(r.commentStatus, r.commentStderr).toBe(0);
    expect(r.summary).toBe('');
  });

  it('writes the job summary after a failing audit', () => {
    const r = run({ INPUT_URL: 'https://example.com' }, 1, 'report.md');
    expect(r.status).toBe(1);
    expect(r.output).toContain('exit-code=1\n');
    expect(r.commentStatus, r.commentStderr).toBe(0);
    expect(r.summary).toContain('<!-- vercel-seo-audit:default -->');
    expect(r.summary).toContain('<details><summary>vercel-seo-audit: 0 errors, 0 warnings</summary>');
  });

  it('skips the comment without a token and without touching the network', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_PR_COMMENT: 'true', GITHUB_API_URL: 'http://127.0.0.1:9' }, 0, 'report.md');
    expect(r.commentStatus, r.commentStderr).toBe(0);
    expect(r.commentStdout).toContain('no github-token');
  });

  it('removes a report left in the directory before the audit, so it is never posted', () => {
    writeFileSync(join(work, 'report.md'), '| ❌ Errors | 9 |\n');
    const r = run({ INPUT_URL: 'https://example.com' }, 0);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(work, 'report.md'))).toBe(false);
    expect(r.output).not.toContain('report-path');
    expect(r.summary).not.toContain('9 errors');
  });

  it('never writes through a symlinked report.md', () => {
    const secret = join(work, 'secret');
    writeFileSync(secret, 'GH_TOKEN=ghs_secret\n');
    symlinkSync(secret, join(work, 'report.md'));
    const r = run({ INPUT_URL: 'https://example.com' }, 0, 'report.md');
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(secret, 'utf8')).toBe('GH_TOKEN=ghs_secret\n');
    expect(lstatSync(join(work, 'report.md')).isSymbolicLink()).toBe(false);
    expect(r.summary).not.toContain('ghs_secret');
  });

  it('clears every report format before the audit writes one', () => {
    for (const f of ['report.md', 'report.json', 'report.html']) writeFileSync(join(work, f), 'stale');
    const r = run({ INPUT_URL: 'https://example.com', INPUT_REPORT: 'json' }, 0);
    expect(r.status, r.stderr).toBe(0);
    for (const f of ['report.md', 'report.json', 'report.html']) expect(existsSync(join(work, f)), f).toBe(false);
    expect(r.output).not.toContain('report-path');
  });

  it('does not abort when a directory has a report name', () => {
    mkdirSync(join(work, 'report.md'));
    writeFileSync(join(work, 'report.md', 'inside'), 'x');
    const r = run({ INPUT_URL: 'https://example.com' }, 0, 'report.md');
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).not.toBeNull();
    expect(lstatSync(join(work, 'report.md')).isFile()).toBe(true);
    expect(r.output).toContain('report-path=report.md\n');
  });

  it('leaves files alone when no report is asked for', () => {
    writeFileSync(join(work, 'report.md'), 'mine');
    run({ INPUT_URL: 'https://example.com', INPUT_SUMMARY: 'false', INPUT_PR_COMMENT: 'false' });
    expect(readFileSync(join(work, 'report.md'), 'utf8')).toBe('mine');
  });

  it('says the audit failed to run when it crashed', () => {
    const r = run({ INPUT_URL: 'https://example.com' }, 2);
    expect(r.status).toBe(2);
    expect(r.commentStatus, r.commentStderr).toBe(0);
    expect(r.summary).toMatch(/failed to run/);
  });
});
