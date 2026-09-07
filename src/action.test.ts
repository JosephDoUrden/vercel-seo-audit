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
    // Stand-in for npx: record argv one per line, exit with NPX_EXIT_CODE.
    writeFileSync(
      join(bin, 'npx'),
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$NPX_ARGS_FILE"\nexit "${NPX_EXIT_CODE:-0}"\n',
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function run(inputs: Record<string, string>, npxExit = 0) {
    const [script] = runBlocks();
    const scriptPath = join(work, 'step.sh');
    writeFileSync(scriptPath, script);
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      GITHUB_OUTPUT: outputFile,
      NPX_ARGS_FILE: argsFile,
      NPX_EXIT_CODE: String(npxExit),
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
    return { status: result.status, stderr: result.stderr, argv, output: readFileSync(outputFile, 'utf8') };
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
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      expect.stringMatching(/^vercel-seo-audit@\d+\.\d+\.\d+$/),
      url,
      '--strict',
      '--user-agent', ua,
      '--pages', pages,
      '--report', 'json',
      '--timeout', '5000',
      '--verbose',
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
    expect(r.argv).toHaveLength(2);
    expect(r.argv![1]).toBe('https://example.com');
    expect(r.output).toBe('exit-code=0\n');
  });

  it('propagates the audit exit code and reports the md path', () => {
    const r = run({ INPUT_URL: 'https://example.com', INPUT_REPORT: 'md' }, 1);
    expect(r.status).toBe(1);
    expect(r.output).toContain('exit-code=1\n');
    expect(r.output).toContain('report-path=report.md\n');
  });
});
