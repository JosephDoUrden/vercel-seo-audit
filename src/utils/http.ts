import { DEFAULT_TIMEOUT, MAX_HTML_BYTES, MAX_REDIRECTS, USER_AGENT } from '../constants.js';
import type { FetchOptions, RedirectChain, RedirectHop } from '../types.js';
import { reachesPrivateAddress } from './url.js';

function buildHeaders(userAgent?: string): Record<string, string> {
  return {
    'User-Agent': userAgent ?? USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
}

// Runs `load` once per key for the lifetime of the cache in `opts`. Concurrent
// callers share the pending promise; a rejected request is forgotten so a later
// caller can try again. Without a cache every call goes to the network.
function cached<T>(
  opts: FetchOptions | undefined,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const cache = opts?.cache;
  if (!cache) return load();

  const hit = cache.get(key) as Promise<T> | undefined;
  if (hit) return hit;

  const pending = load();
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}

// One deadline per call: every redirect hop, the headers and the body of one
// fetchPage share a single --timeout instead of getting a fresh one each.
function deadlineFor(opts?: FetchOptions): number {
  return Date.now() + (opts?.timeout ?? DEFAULT_TIMEOUT);
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

// Starts a timer that aborts `controller` at the deadline with an error that
// names the timeout, so callers never see a bare "This operation was aborted".
function abortAt(controller: AbortController, deadline: number, url: string, opts?: FetchOptions): NodeJS.Timeout {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  return setTimeout(
    () => controller.abort(new Error(`Timed out after ${timeout} ms fetching ${url}`)),
    remaining(deadline),
  );
}

/** A redirect walk that went round in a circle (`loop`) or ran past MAX_REDIRECTS (`limit`). */
export class RedirectError extends Error {
  constructor(
    readonly kind: 'loop' | 'limit',
    message: string,
  ) {
    super(message);
    this.name = 'RedirectError';
  }
}

// The URL whose network the call may reach: the audited one when known.
function auditedFrom(url: string, opts?: FetchOptions): string {
  return opts?.auditedUrl ?? url;
}

function refused(url: string): Error {
  return new Error(`Refused to fetch the private address ${new URL(url).hostname}`);
}

// The controller behind each hop response, kept so a body read that times out
// can tear the connection down after the header timer has already been cleared.
const hopControllers = new WeakMap<Response, AbortController>();

function fetchHop(url: string, opts: FetchOptions | undefined, deadline: number): Promise<Response> {
  return cached(opts, `MANUAL ${url}`, async () => {
    const controller = new AbortController();
    const timer = abortAt(controller, deadline, url, opts);

    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: buildHeaders(opts?.userAgent),
      });
      hopControllers.set(res, controller);
      return res;
    } finally {
      clearTimeout(timer);
    }
  });
}

export function fetchWithoutRedirect(
  url: string,
  opts?: FetchOptions,
): Promise<Response> {
  return fetchHop(url, opts, deadlineFor(opts));
}

// Walks redirects hop by hop. `response` is the first non-redirect response;
// otherwise `error` says why there is none: a failed hop, a loop, too many hops,
// or a private address reached from a public audit (recorded, never requested).
async function walkRedirects(
  url: string,
  opts: FetchOptions | undefined,
  deadline: number,
): Promise<{ chain: RedirectChain; response?: Response; error?: unknown }> {
  const hops: RedirectHop[] = [];
  const seen = new Set<string>();
  const from = auditedFrom(url, opts);
  let current = url;

  if (reachesPrivateAddress(url, from)) {
    return { chain: { hops, finalUrl: url, isCircular: false }, error: refused(url) };
  }

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (seen.has(current)) {
      const error = new RedirectError('loop', `Redirect loop at ${current}`);
      return { chain: { hops, finalUrl: current, isCircular: true }, error };
    }
    seen.add(current);

    let res: Response;
    try {
      res = await fetchHop(current, opts, deadline);
    } catch (error) {
      return { chain: { hops, finalUrl: current, isCircular: false }, error };
    }

    const status = res.status;
    const location = res.headers.get('location');

    if (location && status >= 300 && status < 400) {
      const resolved = new URL(location, current).href;
      hops.push({ url: current, status, location: resolved });
      if (reachesPrivateAddress(resolved, from)) {
        const error = new Error(`Refused to follow a redirect to the private address ${new URL(resolved).hostname}`);
        return { chain: { hops, finalUrl: resolved, isCircular: false }, error };
      }
      current = resolved;
    } else {
      return { chain: { hops, finalUrl: current, isCircular: false }, response: res };
    }
  }

  const error = new RedirectError('limit', `More than ${MAX_REDIRECTS} redirects from ${url}`);
  return { chain: { hops, finalUrl: current, isCircular: false }, error };
}

export async function followRedirectChain(
  url: string,
  opts?: FetchOptions,
): Promise<RedirectChain> {
  const { chain } = await walkRedirects(url, opts, deadlineFor(opts));
  return chain;
}

type BodyResult = { body: string; truncated?: true };

// The hop responses come back with the abort timer already cleared, so the
// body is read through a reader with what is left of the deadline. On timeout
// the hop's controller is aborted and the reader cancelled, which closes the
// socket; `res.text()` would have locked the stream and left it open. Reading
// stops at `maxBytes` the same way, keeping what came before the cap.
async function readBody(res: Response, deadline: number, maxBytes: number): Promise<BodyResult> {
  if (!res.body) return { body: '' };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  let truncated = false;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out reading body of ${res.url}`)), remaining(deadline));
  });

  const close = async (): Promise<void> => {
    hopControllers.get(res)?.abort();
    await reader.cancel().catch(() => undefined);
  };

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), expired]);
      if (done) break;
      if (bytes + value.byteLength > maxBytes) {
        chunks.push(decoder.decode(value.subarray(0, maxBytes - bytes), { stream: true }));
        truncated = true;
        await close();
        break;
      }
      bytes += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return truncated ? { body: chunks.join(''), truncated } : { body: chunks.join('') };
  } catch (err) {
    await close();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type PageResult = BodyResult & { status: number; headers: Headers };

const maxBytesOf = (opts?: FetchOptions): number => opts?.maxBytes ?? MAX_HTML_BYTES;

async function fetchFollowing(url: string, opts: FetchOptions | undefined, deadline: number): Promise<PageResult> {
  const controller = new AbortController();
  const timer = abortAt(controller, deadline, url, opts);

  try {
    // Manual, like every request here: native redirects would skip the
    // private-address check.
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: buildHeaders(opts?.userAgent),
    });

    // Headers are in: retire the header timer and read the body against what
    // is left of the deadline, so a stall here reports the same error as the
    // main path instead of a bare abort.
    clearTimeout(timer);
    hopControllers.set(res, controller);
    return { ...(await readBody(res, deadline, maxBytesOf(opts))), status: res.status, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GETs `url`, following redirects, within one `--timeout` for the whole call.
 * The body is cut at `opts.maxBytes` (MAX_HTML_BYTES by default), and
 * `truncated` is set when it was. A loop or a chain past MAX_REDIRECTS rejects
 * with a RedirectError.
 */
export function fetchPage(
  url: string,
  opts?: FetchOptions,
): Promise<{ body: string; status: number; headers: Headers; finalUrl: string; truncated?: true }> {
  return cached(opts, `GET ${url}`, async () => {
    const deadline = deadlineFor(opts);
    const { chain, response, error } = await walkRedirects(url, opts, deadline);
    // A hop that failed has used up the deadline or will fail again, and a
    // loop stays a loop; retrying as a plain GET only doubles the wait.
    if (error !== undefined || !response) throw error;
    const finalUrl = chain.finalUrl;

    // The last hop already carries the page. Its text is cached under the
    // final URL so chains that converge on one page share a single read; a
    // body some other caller has consumed falls through to a fresh GET.
    const page = await cached(opts, `PAGE ${finalUrl}`, async (): Promise<PageResult> => {
      if (!response.bodyUsed) {
        return { ...(await readBody(response, deadline, maxBytesOf(opts))), status: response.status, headers: response.headers };
      }
      return fetchFollowing(finalUrl, opts, deadline);
    });

    return { ...page, finalUrl };
  });
}

export function fetchHead(
  url: string,
  opts?: FetchOptions,
): Promise<{ status: number; headers: Headers }> {
  return cached(opts, `HEAD ${url}`, async () => {
    const controller = new AbortController();
    const timer = abortAt(controller, deadlineFor(opts), url, opts);

    // Redirects are walked here rather than by fetch, so each hop can be
    // checked before it is requested.
    try {
      const from = auditedFrom(url, opts);
      if (reachesPrivateAddress(url, from)) throw refused(url);
      let current = url;
      for (let i = 0; ; i++) {
        const res = await fetch(current, {
          method: 'HEAD',
          redirect: 'manual',
          signal: controller.signal,
          headers: buildHeaders(opts?.userAgent),
        });
        const location = res.headers.get('location');
        if (!location || res.status < 300 || res.status >= 400 || i >= MAX_REDIRECTS) {
          return { status: res.status, headers: res.headers };
        }
        const next = new URL(location, current).href;
        if (reachesPrivateAddress(next, from)) {
          throw new Error(`Refused to follow a redirect to the private address ${new URL(next).hostname}`);
        }
        current = next;
      }
    } finally {
      clearTimeout(timer);
    }
  });
}
