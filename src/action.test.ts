import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Guards the composite action against script injection: every input must
// reach the shell through env, never through a ${{ }} expression inside run.
// There is no YAML parser in the dependency tree, so the checks work on the
// raw text of action.yml.

const actionPath = join(import.meta.dirname, '..', 'action.yml');
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

describe('action.yml (static)', () => {
  it('has exactly one run block', () => {
    expect(runBlocks()).toHaveLength(1);
  });

  it('never interpolates an expression into the shell script', () => {
    for (const block of runBlocks()) {
      expect(block).not.toContain('${{');
    }
  });

  it('does not eval and does not float on @latest', () => {
    const [script] = runBlocks();
    expect(script).not.toMatch(/\beval\b/);
    expect(script).not.toContain('@latest');
    expect(script).toMatch(/npx vercel-seo-audit@\d+\.\d+\.\d+/);
  });

  it('passes every declared input through env', () => {
    const declared = declaredInputs();
    expect(declared.length).toBeGreaterThan(0);
    expect(envMappedInputs().sort()).toEqual([...declared].sort());
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

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'vsa-action-'));
    bin = join(work, 'bin');
    mkdirSync(bin);
    argsFile = join(work, 'npx-args');
    outputFile = join(work, 'github-output');
    writeFileSync(outputFile, '');
    // Stand-in for npx: record argv one per line, optionally write the report
    // file the real CLI would have written, exit with NPX_EXIT_CODE.
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

  function run(inputs: Record<string, string>, npxExit = 0, writeReport = '') {
    const [script] = runBlocks();
    const scriptPath = join(work, 'step.sh');
    writeFileSync(scriptPath, script);
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      GITHUB_OUTPUT: outputFile,
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
      ...inputs,
    };
    // Same invocation GitHub uses for `shell: bash` in a composite action.
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], {
      cwd: work,
      env,
      encoding: 'utf8',
    });
    const argv = existsSync(argsFile) ? readFileSync(argsFile, 'utf8').split('\n').slice(0, -1) : null;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      argv,
      output: readFileSync(outputFile, 'utf8'),
    };
  }

  it('passes hostile input to npx as literal arguments', () => {
    const url = 'https://x.test/$(touch canary-a); touch canary-b #';
    const ua = 'Mozilla `touch canary-c` "x" $HOME';
    const pages = '/a,/b; touch canary-d';
    const r = run({
      INPUT_URL: url,
      INPUT_STRICT: 'true',
      INPUT_USER_AGENT: ua,
      INPUT_PAGES: pages,
      INPUT_REPORT: 'json',
      INPUT_TIMEOUT: '5000',
      INPUT_VERBOSE: 'true',
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
      '--',
      url,
    ]);
    for (const c of ['canary-a', 'canary-b', 'canary-c', 'canary-d']) {
      expect(existsSync(join(work, c)), c).toBe(false);
    }
    expect(r.output).toContain('exit-code=0\n');
    expect(r.output).toContain('report-path=report.json\n');
  });

  it('sends only the url when every optional input is at its default', () => {
    const r = run({ INPUT_URL: 'https://example.com' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
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

  it('refuses an empty url instead of passing an empty argument', () => {
    const r = run({ INPUT_URL: '' });
    expect(r.status).toBe(2);
    expect(r.argv).toBeNull();
    expect(r.stderr + r.stdout).toContain('::error::');
    expect(r.output).toBe('');
  });

  it('omits --timeout when the timeout input is empty', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_TIMEOUT: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      '--',
      'https://example.com',
    ]);
  });

  it('forwards a non-default timeout', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_TIMEOUT: '2500' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
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
});
