// @ts-check
// Second step of the composite action: put report.md in the job summary and,
// when asked, in one pull request comment that later runs update in place.
// No dependencies, Node 20+. Runs with continue-on-error, so nothing here can
// change the audit's exit code.

import { appendFileSync, closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Characters of report kept in the comment. GitHub caps a comment at 65,536. */
export const MAX_CHARS = 60_000;

/** GitHub's cap on one step's job summary, in bytes. */
export const SUMMARY_MAX_BYTES = 1024 * 1024;

/** The only file the audit step ever hands over for the summary and comment. */
const REPORT_FILE = 'report.md';
const KEY = /^[A-Za-z0-9._-]{1,64}$/;
const DEFAULT_BOT = 'github-actions[bot]';
const PER_PAGE = 100;
const MAX_PAGES = 100;

/**
 * Hidden first line of the comment; how a rerun finds the comment to update.
 * One key per workflow or matrix leg keeps their comments apart.
 * @param {string} key
 */
export const marker = (key) => `<!-- vercel-seo-audit:${key} -->`;

/**
 * @typedef {Record<string, string | undefined>} Env
 * @typedef {{
 *   env: Env,
 *   fetch: typeof globalThis.fetch,
 *   cwd: string,
 *   log: (message: string) => void,
 * }} RunOptions
 * @typedef {'skipped' | 'summary' | 'posted' | 'updated'} Outcome
 * @typedef {{ id: number, body?: string | null, user?: { login?: string } | null }} IssueComment
 * @typedef {(method: string, path: string, payload?: unknown) => Promise<any>} Api
 */

class Forbidden extends Error {}

/**
 * Error and warning counts from the summary table of a markdown report.
 * @param {string} md
 */
export function counts(md) {
  /** @param {string} label */
  const row = (label) => Number(md.match(new RegExp(`^\\| \\S+ ${label} \\| (\\d+) \\|$`, 'm'))?.[1] ?? 0);
  return { errors: row('Errors'), warnings: row('Warnings') };
}

/**
 * Cut to at most `max` UTF-16 code units. A line break is used only when it
 * falls in the last tenth of the cut; a surrogate pair is never split.
 * @param {string} text
 * @param {number} max
 */
function truncateChars(text, max) {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  const nl = cut.lastIndexOf('\n');
  if (nl >= max * 0.9) cut = cut.slice(0, nl);
  else if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}

/**
 * Cut to at most `max` UTF-8 bytes without leaving half a character.
 * @param {string} text
 * @param {number} max
 */
function truncateBytes(text, max) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= max) return { text, truncated: false };
  return { text: bytes.subarray(0, max).toString('utf8').replace(/�+$/, ''), truncated: true };
}

/**
 * @param {string} key
 * @param {string} md
 * @param {{ text: string, truncated: boolean }} cut
 * @param {string} note
 */
function render(key, md, cut, note) {
  const { errors, warnings } = counts(md);
  const title = `vercel-seo-audit: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
  return [
    marker(key),
    `<details><summary>${title}</summary>`,
    '',
    cut.text.trimEnd(),
    ...(cut.truncated ? ['', note] : []),
    '',
    '</details>',
    '',
  ].join('\n');
}

/** @param {string} key */
const crashBody = (key) => `${marker(key)}\n**vercel-seo-audit:** the audit failed to run (exit code 2), see the job log.\n`;

/**
 * report.md from the working directory, only when the audit step handed it
 * over and it is a regular file: a symlink could point at any file on the
 * runner, and a FIFO would block.
 * @param {string} cwd
 * @param {string | undefined} handedOver
 * @param {(message: string) => void} log
 * @returns {string | undefined}
 */
function readReport(cwd, handedOver, log) {
  if (handedOver !== REPORT_FILE) {
    log(`vercel-seo-audit: the audit handed over no ${REPORT_FILE}; skipping the summary and comment.`);
    return undefined;
  }
  const path = join(cwd, REPORT_FILE);
  let fd;
  try {
    if (!lstatSync(path).isFile()) throw new Error('not a regular file');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(fd).isFile()) throw new Error('not a regular file');
    return readFileSync(fd, 'utf8');
  } catch (err) {
    const why = err instanceof Error && err.message === 'not a regular file' ? 'is not a regular file' : 'could not be read';
    log(`vercel-seo-audit: ${REPORT_FILE} ${why}; skipping the summary and comment.`);
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * @param {RunOptions} options
 * @returns {Promise<Outcome>}
 */
export async function run({ env, fetch, cwd, log }) {
  const summary = env.INPUT_SUMMARY === 'true';
  const prComment = env.INPUT_PR_COMMENT === 'true';
  if (!summary && !prComment) return 'skipped';

  const key = env.INPUT_COMMENT_KEY || 'default';
  if (!KEY.test(key)) {
    log('vercel-seo-audit: comment-key may only use letters, digits, ".", "_" and "-" (up to 64); skipping.');
    return 'skipped';
  }

  const report = env.INPUT_REPORT ?? '';
  if (report !== '' && report !== 'md') {
    log(`vercel-seo-audit: report: ${report} is set, so there is no report.md for the summary or comment; skipping.`);
    return 'skipped';
  }

  // A crash leaves no report. Say so in the summary, and replace an earlier
  // comment so it does not keep showing the last run's numbers.
  if (env.AUDIT_EXIT_CODE === '2') {
    if (summary && env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, crashBody(key));
    if (!prComment) return 'summary';
    return comment(env, fetch, log, key, crashBody(key), { updateOnly: true });
  }

  const md = readReport(cwd, env.REPORT_PATH, log);
  if (md === undefined) return 'skipped';

  if (summary && env.GITHUB_STEP_SUMMARY) {
    const body = render(key, md, truncateBytes(md, SUMMARY_MAX_BYTES - 1024), '_(truncated)_');
    appendFileSync(env.GITHUB_STEP_SUMMARY, body);
  }
  if (!prComment) return 'summary';

  const note = summary ? '_(truncated, full report in the job summary)_' : '_(truncated)_';
  return comment(env, fetch, log, key, render(key, md, truncateChars(md, MAX_CHARS), note), { updateOnly: false });
}

/**
 * Post or update the comment for `key` on the pull request this run belongs to.
 * @param {Env} env
 * @param {typeof globalThis.fetch} fetch
 * @param {(message: string) => void} log
 * @param {string} key
 * @param {string} body
 * @param {{ updateOnly: boolean }} options
 * @returns {Promise<Outcome>}
 */
async function comment(env, fetch, log, key, body, { updateOnly }) {
  if (!env.GH_TOKEN) {
    log('vercel-seo-audit: no github-token; skipping the pull request comment.');
    return 'skipped';
  }
  if (!env.GITHUB_REPOSITORY) {
    log('vercel-seo-audit: GITHUB_REPOSITORY is not set; skipping the pull request comment.');
    return 'skipped';
  }

  const api = client(fetch, env.GITHUB_API_URL || 'https://api.github.com', env.GH_TOKEN);
  const repo = `/repos/${env.GITHUB_REPOSITORY}`;
  try {
    const found = await pullNumber(api, repo, readEvent(env.GITHUB_EVENT_PATH), env.GITHUB_SHA);
    if (typeof found === 'string') {
      log(`vercel-seo-audit: ${found}; skipping the comment.`);
      return 'skipped';
    }
    const login = await tokenLogin(api);
    const existing = await findOwnComment(api, `${repo}/issues/${found}/comments`, marker(key), login);
    if (existing) {
      await api('PATCH', `${repo}/issues/comments/${existing.id}`, { body });
      log(`vercel-seo-audit: updated the comment on #${found}.`);
      return 'updated';
    }
    if (updateOnly) {
      log(`vercel-seo-audit: no earlier comment on #${found} to update.`);
      return 'skipped';
    }
    await api('POST', `${repo}/issues/${found}/comments`, { body });
    log(`vercel-seo-audit: commented on #${found}.`);
    return 'posted';
  } catch (err) {
    if (!(err instanceof Forbidden)) throw err;
    log(`vercel-seo-audit: ${err.message} (a fork pull request or a read-only token); the job summary has the report.`);
    return 'skipped';
  }
}

/**
 * @param {typeof globalThis.fetch} fetch
 * @param {string} base
 * @param {string} token
 * @returns {Api}
 */
function client(fetch, base, token) {
  const root = base.replace(/\/+$/, '');
  return async (method, path, payload) => {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (res.status === 403) throw new Forbidden(`${method} ${path} returned 403`);
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}`);
    return res.json();
  };
}

/** @param {string | undefined} path */
function readEvent(path) {
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * The pull request from the event, or else the one open pull request whose
 * head is the commit (deployment_status, push and the like). A reason string
 * when there is none, or more than one.
 * @param {Api} api
 * @param {string} repo
 * @param {any} event
 * @param {string | undefined} fallbackSha
 * @returns {Promise<number | string>}
 */
async function pullNumber(api, repo, event, fallbackSha) {
  const direct = event?.pull_request?.number;
  if (Number.isInteger(direct) && direct > 0) return direct;
  const sha = event?.deployment?.sha || fallbackSha;
  if (!sha) return 'no commit to look up';
  /** @type {{ number: number, state: string, head?: { sha?: string } }[]} */
  const pulls = await api('GET', `${repo}/commits/${encodeURIComponent(sha)}/pulls`);
  const open = pulls.filter((p) => p.state === 'open' && p.head?.sha === sha);
  if (open.length === 1) return open[0].number;
  if (open.length === 0) return `no open pull request has ${sha} as its head`;
  return `${open.length} open pull requests have ${sha} as their head`;
}

/**
 * Who the token writes as. A personal access token can read /user; the
 * default GITHUB_TOKEN cannot, and writes as github-actions[bot].
 * @param {Api} api
 * @returns {Promise<string>}
 */
async function tokenLogin(api) {
  try {
    const user = await api('GET', '/user');
    if (typeof user?.login === 'string' && user.login !== '') return user.login;
  } catch {
    // fall through to the default token's identity
  }
  return DEFAULT_BOT;
}

/**
 * An earlier comment of ours: written by the token's own login and starting
 * with this key's marker, so nobody else's comment is ever overwritten.
 * @param {Api} api
 * @param {string} path
 * @param {string} mark
 * @param {string} login
 * @returns {Promise<IssueComment | undefined>}
 */
async function findOwnComment(api, path, mark, login) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    /** @type {IssueComment[]} */
    const comments = await api('GET', `${path}?per_page=${PER_PAGE}&page=${page}`);
    const own = comments.find((c) => c.user?.login === login && typeof c.body === 'string' && c.body.startsWith(mark));
    if (own) return own;
    if (comments.length < PER_PAGE) return undefined;
  }
  return undefined;
}

// realpath, because GITHUB_ACTION_PATH can reach this file through a symlink
// and import.meta.url is always the resolved path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  run({ env: process.env, fetch: globalThis.fetch, cwd: process.cwd(), log: console.log }).catch((err) => {
    console.log(`::warning::vercel-seo-audit could not write the pull request comment: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
