import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, marker, MAX_CHARS, SUMMARY_MAX_BYTES } from './comment.mjs';

// The second step of the composite action. No network: fetch is a mock that
// answers from a table of routes, and every request it saw is kept.

const API = 'https://api.github.test';
const REPO = 'acme/site';
const MARKER = marker('default');
const BOT = 'github-actions[bot]';

const REPORT_MD = [
  '# SEO Audit Report for https://example.com',
  '',
  '## Summary',
  '',
  '| Severity | Count |',
  '|----------|-------|',
  '| ❌ Errors | 2 |',
  '| ⚠️ Warnings | 3 |',
  '| ✅ Passed | 7 |',
  '',
].join('\n');

type Route = { status?: number; body?: unknown };
type Seen = { method: string; url: string; headers: Record<string, string>; body?: unknown };

function mockFetch(routes: Record<string, Route | Route[]>) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const url = String(input);
    seen.push({
      method,
      url,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const key = `${method} ${url}`;
    let route = routes[key];
    if (Array.isArray(route)) route = route.shift();
    if (!route) return new Response(JSON.stringify({ message: `no route for ${key}` }), { status: 599 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
  });
  return { fetch, seen };
}

const comment = (id: number, body: string, login = BOT, type = 'Bot') => ({ id, body, user: { login, type } });
const writes = (seen: Seen[]) => seen.filter((r) => r.method === 'POST' || r.method === 'PATCH');
const sent = (r: Seen) => (r.body as { body: string }).body;

const COMMENTS_7 = `GET ${API}/repos/${REPO}/issues/7/comments?per_page=100&page=1`;
const POST_7 = `POST ${API}/repos/${REPO}/issues/7/comments`;
const USER = `GET ${API}/user`;
// What GET /user answers for the default GITHUB_TOKEN.
const userForbidden = { [USER]: { status: 403, body: { message: 'Resource not accessible by integration' } } };

describe('action/comment.mjs', () => {
  let work: string;
  let summaryFile: string;
  let eventFile: string;
  let logs: string[];

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'vsa-comment-'));
    summaryFile = join(work, 'step-summary');
    eventFile = join(work, 'event.json');
    writeFileSync(summaryFile, '');
    writeFileSync(join(work, 'report.md'), REPORT_MD);
    writeFileSync(eventFile, JSON.stringify({ pull_request: { number: 7 } }));
    logs = [];
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
      INPUT_SUMMARY: 'true',
      INPUT_PR_COMMENT: 'false',
      INPUT_REPORT: '',
      INPUT_COMMENT_KEY: 'default',
      REPORT_PATH: 'report.md',
      AUDIT_EXIT_CODE: '0',
      GH_TOKEN: 'ghs_test',
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_EVENT_PATH: eventFile,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REPOSITORY: REPO,
      GITHUB_SHA: 'merge-sha',
      GITHUB_API_URL: API,
      ...overrides,
    };
  }

  function go(e: Record<string, string | undefined>, fetch: typeof globalThis.fetch) {
    return run({ env: e, fetch, cwd: work, log: (m: string) => logs.push(m) });
  }

  const summary = () => readFileSync(summaryFile, 'utf8');
  const on = (o: Record<string, string | undefined> = {}) => env({ INPUT_PR_COMMENT: 'true', ...o });

  describe('job summary', () => {
    it('appends a collapsible block with the counts', async () => {
      writeFileSync(summaryFile, 'earlier step\n');
      const { fetch } = mockFetch({});
      await go(env(), fetch);
      const s = summary();
      expect(s.startsWith('earlier step\n')).toBe(true);
      expect(s).toContain('<details><summary>vercel-seo-audit: 2 errors, 3 warnings</summary>');
      expect(s).toContain('| ❌ Errors | 2 |');
      expect(s).toContain('</details>');
    });

    it('says 1 error, 0 warnings in the singular and when a row is missing', async () => {
      writeFileSync(join(work, 'report.md'), '| ❌ Errors | 1 |\n');
      const { fetch } = mockFetch({});
      await go(env(), fetch);
      expect(summary()).toContain('vercel-seo-audit: 1 error, 0 warnings');
    });

    it('keeps the full report when it is over the comment limit', async () => {
      const md = `${'a'.repeat(99)}\n`.repeat(1000); // 100,000 characters
      writeFileSync(join(work, 'report.md'), md);
      const { fetch } = mockFetch({});
      await go(env(), fetch);
      expect(summary()).toContain(md.trimEnd());
      expect(summary()).not.toContain('truncated');
    });

    it('caps the summary at 1 MiB, counted in bytes', async () => {
      writeFileSync(join(work, 'report.md'), '€'.repeat(400_000)); // 1.2 MB in UTF-8
      const { fetch } = mockFetch({});
      await go(env(), fetch);
      const s = summary();
      expect(Buffer.byteLength(s)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
      expect(s).toContain('_(truncated)_');
      expect(s).not.toContain('�');
    });

    it('writes nothing and calls nothing when summary and pr-comment are both off', async () => {
      const { fetch } = mockFetch({});
      expect(await go(env({ INPUT_SUMMARY: 'false' }), fetch)).toBe('skipped');
      expect(summary()).toBe('');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('makes no API call when pr-comment is off', async () => {
      const { fetch } = mockFetch({});
      await go(env(), fetch);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('reading the report', () => {
    it('skips when the audit handed over no report path', async () => {
      const { fetch } = mockFetch({});
      expect(await go(on({ REPORT_PATH: '' }), fetch)).toBe('skipped');
      expect(fetch).not.toHaveBeenCalled();
      expect(summary()).toBe('');
    });

    it('reads only report.md, whatever path it is handed', async () => {
      writeFileSync(join(work, 'other.md'), REPORT_MD);
      const { fetch } = mockFetch({});
      expect(await go(on({ REPORT_PATH: 'other.md' }), fetch)).toBe('skipped');
      expect(await go(on({ REPORT_PATH: '/etc/passwd' }), fetch)).toBe('skipped');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('skips a report.md that is a symlink, so it cannot post another file', async () => {
      const secret = join(work, 'secret');
      writeFileSync(secret, 'GH_TOKEN=ghs_secret\n');
      rmSync(join(work, 'report.md'));
      symlinkSync(secret, join(work, 'report.md'));
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] }, [POST_7]: { status: 201 } });
      expect(await go(on(), fetch)).toBe('skipped');
      expect(writes(seen)).toHaveLength(0);
      expect(summary()).not.toContain('ghs_secret');
      expect(logs.join('\n')).toMatch(/not a regular file/);
    });

    it.skipIf(process.platform === 'win32')('skips a report.md that is a FIFO instead of blocking on it', async () => {
      rmSync(join(work, 'report.md'));
      execFileSync('mkfifo', [join(work, 'report.md')]);
      const { fetch } = mockFetch({});
      expect(await go(on(), fetch)).toBe('skipped');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('skips with a log line when report is json, without calling the API', async () => {
      const { fetch } = mockFetch({});
      expect(await go(on({ INPUT_REPORT: 'json', REPORT_PATH: 'report.json' }), fetch)).toBe('skipped');
      expect(fetch).not.toHaveBeenCalled();
      expect(summary()).toBe('');
      expect(logs.join('\n')).toMatch(/report: json/);
    });
  });

  describe('pull request comment', () => {
    it('posts a new marked comment on a pull_request event', async () => {
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] }, [POST_7]: { status: 201 } });
      expect(await go(on(), fetch)).toBe('posted');
      const [post] = writes(seen);
      expect(sent(post).startsWith(`${MARKER}\n`)).toBe(true);
      expect(sent(post)).toContain('vercel-seo-audit: 2 errors, 3 warnings');
      expect(post.headers).toMatchObject({
        Authorization: 'Bearer ghs_test',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      });
      expect(summary()).toContain('vercel-seo-audit: 2 errors');
    });

    it('defaults the API base to api.github.com', async () => {
      const { fetch, seen } = mockFetch({
        'GET https://api.github.com/repos/acme/site/issues/7/comments?per_page=100&page=1': { body: [] },
        'POST https://api.github.com/repos/acme/site/issues/7/comments': { status: 201 },
      });
      expect(await go(on({ GITHUB_API_URL: undefined }), fetch)).toBe('posted');
      expect(seen.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true);
    });

    it('updates the github-actions[bot] comment, found on a later page', async () => {
      const filler = Array.from({ length: 100 }, (_, i) => comment(100 + i, 'lgtm', 'someone', 'User'));
      const { fetch, seen } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: { body: filler },
        [`GET ${API}/repos/${REPO}/issues/7/comments?per_page=100&page=2`]: { body: [comment(42, `${MARKER}\nold`)] },
        [`PATCH ${API}/repos/${REPO}/issues/comments/42`]: { body: { id: 42 } },
      });
      expect(await go(on(), fetch)).toBe('updated');
      const [patch] = writes(seen);
      expect(patch.method).toBe('PATCH');
      expect(sent(patch)).toContain('2 errors, 3 warnings');
    });

    it('never overwrites a marked comment written by a person', async () => {
      const { fetch, seen } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: { body: [comment(5, `${MARKER}\nfake`, 'someone', 'User')] },
        [POST_7]: { status: 201 },
      });
      expect(await go(on(), fetch)).toBe('posted');
      expect(seen.some((r) => r.method === 'PATCH')).toBe(false);
    });

    it('never overwrites a marked comment from another bot', async () => {
      const { fetch, seen } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: { body: [comment(5, `${MARKER}\nfrom another app`, 'some-app[bot]')] },
        [POST_7]: { status: 201 },
      });
      expect(await go(on(), fetch)).toBe('posted');
      expect(seen.some((r) => r.method === 'PATCH')).toBe(false);
    });

    it('ignores a bot comment that only quotes the marker further down', async () => {
      const { fetch } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: { body: [comment(5, `see ${MARKER}`)] },
        [POST_7]: { status: 201 },
      });
      expect(await go(on(), fetch)).toBe('posted');
    });

    it('matches on the token owner when the token is a personal access token', async () => {
      const { fetch, seen } = mockFetch({
        [USER]: { body: { login: 'release-bot-user' } },
        [COMMENTS_7]: {
          body: [comment(5, `${MARKER}\nby actions`), comment(6, `${MARKER}\nours`, 'release-bot-user', 'User')],
        },
        [`PATCH ${API}/repos/${REPO}/issues/comments/6`]: { body: { id: 6 } },
      });
      expect(await go(on(), fetch)).toBe('updated');
      expect(writes(seen).map((r) => r.url)).toEqual([`${API}/repos/${REPO}/issues/comments/6`]);
    });

    it('keeps one comment per comment-key', async () => {
      const { fetch, seen } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: {
          body: [comment(5, `${MARKER}\ndefault run`), comment(6, `${marker('mobile')}\nmobile run`)],
        },
        [`PATCH ${API}/repos/${REPO}/issues/comments/6`]: { body: { id: 6 } },
      });
      expect(await go(on({ INPUT_COMMENT_KEY: 'mobile' }), fetch)).toBe('updated');
      const [patch] = writes(seen);
      expect(patch.url).toBe(`${API}/repos/${REPO}/issues/comments/6`);
      expect(sent(patch).startsWith('<!-- vercel-seo-audit:mobile -->\n')).toBe(true);
    });

    it('does not treat one key as a prefix of another', async () => {
      const { fetch, seen } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: { body: [comment(5, `${marker('default2')}\nother`)] },
        [POST_7]: { status: 201 },
      });
      expect(await go(on(), fetch)).toBe('posted');
      expect(seen.some((r) => r.method === 'PATCH')).toBe(false);
    });

    it('defaults the key to default', async () => {
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] }, [POST_7]: { status: 201 } });
      await go(on({ INPUT_COMMENT_KEY: '' }), fetch);
      expect(sent(writes(seen)[0]).startsWith('<!-- vercel-seo-audit:default -->\n')).toBe(true);
    });

    it('rejects a comment-key that could close the marker', async () => {
      const { fetch } = mockFetch({});
      expect(await go(on({ INPUT_COMMENT_KEY: 'x --> <img src=x>' }), fetch)).toBe('skipped');
      expect(fetch).not.toHaveBeenCalled();
      expect(logs.join('\n')).toMatch(/comment-key/);
    });

    it('truncates only the comment, by characters, and points to the job summary', async () => {
      const md = `${'a'.repeat(99)}\n`.repeat(1000);
      writeFileSync(join(work, 'report.md'), md);
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] }, [POST_7]: { status: 201 } });
      await go(on(), fetch);
      const body = sent(writes(seen)[0]);
      expect(body.length).toBeLessThan(MAX_CHARS + 500);
      expect(body).toContain('_(truncated, full report in the job summary)_');
      expect(summary()).toContain(md.trimEnd());
    });

    it('does not count bytes when truncating the comment', async () => {
      const md = '€'.repeat(MAX_CHARS - 1000); // three bytes each in UTF-8
      writeFileSync(join(work, 'report.md'), md);
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] }, [POST_7]: { status: 201 } });
      await go(on(), fetch);
      expect(sent(writes(seen)[0])).toContain(md);
    });

    it('cuts at a line break only when it is near the limit', async () => {
      const md = `short line\n${'b'.repeat(MAX_CHARS * 2)}`;
      writeFileSync(join(work, 'report.md'), md);
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] }, [POST_7]: { status: 201 } });
      await go(on(), fetch);
      expect(sent(writes(seen)[0]).length).toBeGreaterThan(MAX_CHARS - 10);
    });

    it('never splits a surrogate pair when truncating', async () => {
      writeFileSync(join(work, 'report.md'), '😀'.repeat(MAX_CHARS));
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] }, [POST_7]: { status: 201 } });
      await go(on({ INPUT_SUMMARY: 'false' }), fetch);
      const body = sent(writes(seen)[0]);
      expect(body).toContain('_(truncated)_');
      expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it('keeps the summary and skips the comment on a 403 (fork pull request, read-only token)', async () => {
      const { fetch } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: { body: [] },
        [POST_7]: { status: 403, body: { message: 'Resource not accessible by integration' } },
      });
      expect(await go(on(), fetch)).toBe('skipped');
      expect(logs.join('\n')).toMatch(/403/);
      expect(summary()).toContain('vercel-seo-audit: 2 errors');
    });

    it('throws on any other API failure, so the step shows it', async () => {
      const { fetch } = mockFetch({ ...userForbidden, [COMMENTS_7]: { status: 500 } });
      await expect(go(on(), fetch)).rejects.toThrow(/500/);
      expect(summary()).toContain('vercel-seo-audit');
    });

    it('skips the comment when there is no token', async () => {
      const { fetch } = mockFetch({});
      expect(await go(on({ GH_TOKEN: '' }), fetch)).toBe('skipped');
      expect(fetch).not.toHaveBeenCalled();
      expect(summary()).toContain('vercel-seo-audit');
    });

    it('never prints the token', async () => {
      const { fetch } = mockFetch({ ...userForbidden, [COMMENTS_7]: { status: 403 } });
      await go(on(), fetch);
      expect(logs.join('\n')).not.toContain('ghs_test');
    });
  });

  describe('finding the pull request from a commit', () => {
    const PULLS = `GET ${API}/repos/${REPO}/commits/deploy-sha/pulls`;
    const deployment = () => on({ GITHUB_EVENT_NAME: 'deployment_status', GITHUB_SHA: 'deploy-sha' });
    const pr = (number: number, state: string, sha = 'deploy-sha') => ({ number, state, head: { sha } });

    beforeEach(() => {
      writeFileSync(eventFile, JSON.stringify({ deployment: { sha: 'deploy-sha' }, deployment_status: { state: 'success' } }));
    });

    it('comments on the one open pull request whose head is the commit', async () => {
      const { fetch, seen } = mockFetch({
        ...userForbidden,
        [PULLS]: { body: [pr(3, 'closed'), pr(9, 'open'), pr(11, 'open', 'other-sha')] },
        [`GET ${API}/repos/${REPO}/issues/9/comments?per_page=100&page=1`]: { body: [] },
        [`POST ${API}/repos/${REPO}/issues/9/comments`]: { status: 201 },
      });
      expect(await go(deployment(), fetch)).toBe('posted');
      expect(`GET ${seen[0].url}`).toBe(PULLS);
    });

    it('skips when the commit is only in an open pull request as an older commit', async () => {
      const { fetch, seen } = mockFetch({ [PULLS]: { body: [pr(9, 'open', 'newer-sha')] } });
      expect(await go(deployment(), fetch)).toBe('skipped');
      expect(seen).toHaveLength(1);
      expect(logs.join('\n')).toMatch(/no open pull request/i);
    });

    it('skips when more than one open pull request has the commit as head', async () => {
      const { fetch, seen } = mockFetch({ [PULLS]: { body: [pr(9, 'open'), pr(10, 'open')] } });
      expect(await go(deployment(), fetch)).toBe('skipped');
      expect(seen).toHaveLength(1);
      expect(logs.join('\n')).toMatch(/2 open pull requests/);
    });

    it('skips when the commit has no open pull request', async () => {
      const { fetch, seen } = mockFetch({ [PULLS]: { body: [pr(3, 'closed')] } });
      expect(await go(deployment(), fetch)).toBe('skipped');
      expect(seen).toHaveLength(1);
      expect(summary()).toContain('vercel-seo-audit');
    });

    it('uses GITHUB_SHA on a push event', async () => {
      writeFileSync(eventFile, JSON.stringify({}));
      const { fetch, seen } = mockFetch({ [`GET ${API}/repos/${REPO}/commits/merge-sha/pulls`]: { body: [] } });
      expect(await go(on({ GITHUB_EVENT_NAME: 'push' }), fetch)).toBe('skipped');
      expect(seen).toHaveLength(1);
    });
  });

  describe('when the audit crashed', () => {
    const crashed = (o: Record<string, string | undefined> = {}) => on({ AUDIT_EXIT_CODE: '2', REPORT_PATH: '', ...o });

    it('replaces an earlier result with a failed-to-run note', async () => {
      const { fetch, seen } = mockFetch({
        ...userForbidden,
        [COMMENTS_7]: { body: [comment(42, `${MARKER}\n0 errors`)] },
        [`PATCH ${API}/repos/${REPO}/issues/comments/42`]: { body: { id: 42 } },
      });
      expect(await go(crashed(), fetch)).toBe('updated');
      const body = sent(writes(seen)[0]);
      expect(body.startsWith(`${MARKER}\n`)).toBe(true);
      expect(body).toMatch(/failed to run/);
      expect(body).not.toMatch(/\d+ errors?/);
    });

    it('posts nothing new when there is no earlier comment', async () => {
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] } });
      expect(await go(crashed(), fetch)).toBe('skipped');
      expect(writes(seen)).toHaveLength(0);
    });

    it('does not post a stale report.md left in the directory', async () => {
      const { fetch, seen } = mockFetch({ ...userForbidden, [COMMENTS_7]: { body: [] } });
      await go(crashed({ REPORT_PATH: 'report.md' }), fetch);
      expect(writes(seen)).toHaveLength(0);
      expect(summary()).not.toContain('2 errors');
      expect(summary()).toMatch(/failed to run/);
    });

    it('makes no API call with pr-comment off', async () => {
      const { fetch } = mockFetch({});
      await go(env({ AUDIT_EXIT_CODE: '2', REPORT_PATH: '' }), fetch);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  // The action runs the file as `node "$GITHUB_ACTION_PATH/action/comment.mjs"`,
  // and GITHUB_ACTION_PATH can go through a symlink.
  it.skipIf(process.platform === 'win32')('runs as a script when started through a symlinked path', () => {
    const link = join(work, 'linked');
    symlinkSync(import.meta.dirname, link);
    const out = execFileSync(process.execPath, [join(link, 'comment.mjs')], {
      cwd: work,
      env: { PATH: process.env.PATH, INPUT_SUMMARY: 'true', INPUT_REPORT: 'json' },
      encoding: 'utf8',
    });
    expect(out).toMatch(/report: json/);
  });
});
