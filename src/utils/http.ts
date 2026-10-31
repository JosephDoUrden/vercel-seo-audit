import dns, { type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { DEFAULT_TIMEOUT, MAX_HTML_BYTES, MAX_REDIRECTS, USER_AGENT } from '../constants.js';
import type { FetchOptions, RedirectChain, RedirectHop } from '../types.js';
import { isPrivateAddress, reachesPrivateAddress } from './url.js';

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

// The caller's signal (`opts.signal`) reaches every request two ways: a request
// is never started once it has fired, and one in flight is aborted with it. A
// listener is used rather than AbortSignal.any() so it can be removed when the
// request is done; a crawl makes hundreds of requests against one signal.
function throwIfAborted(opts?: FetchOptions): void {
  opts?.signal?.throwIfAborted();
}

// Aborts `controller` when the caller's signal fires, with the caller's reason.
// Returns the function that unhooks it.
function follow(controller: AbortController, opts?: FetchOptions): () => void {
  const signal = opts?.signal;
  if (!signal) return () => undefined;
  const onAbort = (): void => controller.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

// A promise that rejects with the caller's reason when `signal` fires, for racing
// a read that no controller covers any more. `stop` unhooks it.
function whenAborted(signal: AbortSignal): { aborted: Promise<never>; stop: () => void } {
  let stop = (): void => undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    stop = () => signal.removeEventListener('abort', onAbort);
  });
  return { aborted, stop };
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

/**
 * A request refused because it would reach a private address (see isPrivateAddress)
 * from a public audit: a literal one in the URL, or one the name resolved to when
 * the connection was made. `address` is the resolved address, when there was one.
 */
export class PrivateAddressError extends Error {
  constructor(
    message: string,
    readonly hostname: string,
    readonly address?: string,
  ) {
    super(message);
    this.name = 'PrivateAddressError';
  }
}

function refused(url: string): PrivateAddressError {
  const { hostname } = new URL(url);
  return new PrivateAddressError(`Refused to fetch the private address ${hostname}`, hostname);
}

function refusedRedirect(url: string): PrivateAddressError {
  const { hostname } = new URL(url);
  return new PrivateAddressError(`Refused to follow a redirect to the private address ${hostname}`, hostname);
}

/**
 * A `lookup` for net.connect that refuses a name when any address it resolves to
 * is private. Every answer is checked, not only the one connected to, and a lookup
 * that fails or throws is an error, so a name never connects without passing.
 * Because it runs for each new connection, a name that resolves to a public
 * address for one request and a private one for the next is caught as well.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  // An error carries no address, as with dns.lookup itself.
  const fail = callback as (err: NodeJS.ErrnoException) => void;
  const done = (addresses: LookupAddress[]): void => {
    const blocked = addresses.find((a) => isPrivateAddress(a.address));
    if (blocked) {
      fail(
        new PrivateAddressError(
          `Refused to connect to ${hostname}: ${hostname} resolves to the private address ${blocked.address}`,
          hostname,
          blocked.address,
        ),
      );
    } else if (addresses.length === 0) {
      fail(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
    } else if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  };
  try {
    dns.lookup(hostname, { all: true, verbatim: true, family: options.family }, (err, addresses) => {
      if (err) fail(err);
      else done(addresses);
    });
  } catch (err) {
    fail(err as NodeJS.ErrnoException);
  }
};

// One pool for every public audit in the process; its connections pass through
// guardedLookup. A literal IP never reaches a lookup, which is why the URL checks
// in this file stay in front of it.
let guardedAgent: Agent | undefined;

// The dispatcher for a request in this call: the guarded one unless the audited
// URL is itself on a private host, whose audit may follow its own links anywhere.
function dispatcherFor(url: string, opts?: FetchOptions): Agent | undefined {
  let local = false;
  try {
    local = isPrivateAddress(new URL(auditedFrom(url, opts)).hostname);
  } catch {
    // An audited URL that will not parse gets the guard.
  }
  if (local) return undefined;
  guardedAgent ??= new Agent({ connect: { lookup: guardedLookup } });
  return guardedAgent;
}

// fetch wraps a connect failure as `TypeError: fetch failed`; a refusal is
// handed on as itself so callers and reports see why.
function unwrapRefusal(err: unknown): unknown {
  return err instanceof Error && err.cause instanceof PrivateAddressError ? err.cause : err;
}

// Every request in this file goes through here: manual redirects, so each hop
// is checked before it is requested, and the dispatcher that checks each name
// when it connects.
async function request(url: string, init: RequestInit, opts: FetchOptions | undefined): Promise<Response> {
  const dispatcher = dispatcherFor(url, opts);
  try {
    return await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: buildHeaders(opts?.userAgent),
      ...(dispatcher && { dispatcher }),
    } as RequestInit);
  } catch (err) {
    throw unwrapRefusal(err);
  }
}

// The controller behind each hop response, kept so a body read that times out
// can tear the connection down after the header timer has already been cleared.
const hopControllers = new WeakMap<Response, AbortController>();

function fetchHop(url: string, opts: FetchOptions | undefined, deadline: number): Promise<Response> {
  return cached(opts, `MANUAL ${url}`, async () => {
    throwIfAborted(opts);
    const controller = new AbortController();
    const timer = abortAt(controller, deadline, url, opts);
    const unfollow = follow(controller, opts);

    try {
      const res = await request(url, { signal: controller.signal }, opts);
      hopControllers.set(res, controller);
      return res;
    } finally {
      clearTimeout(timer);
      unfollow();
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
        const error = refusedRedirect(resolved);
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
// stops at `maxBytes` the same way, keeping what came before the cap, and at the
// caller's abort, which tears the connection down like a timeout.
async function readBody(res: Response, deadline: number, maxBytes: number, signal?: AbortSignal): Promise<BodyResult> {
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
  const caller = signal ? whenAborted(signal) : undefined;
  const stops = caller ? [expired, caller.aborted] : [expired];

  const close = async (): Promise<void> => {
    hopControllers.get(res)?.abort();
    await reader.cancel().catch(() => undefined);
  };

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), ...stops]);
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
    caller?.stop();
  }
}

type PageResult = BodyResult & { status: number; headers: Headers };

const maxBytesOf = (opts?: FetchOptions): number => opts?.maxBytes ?? MAX_HTML_BYTES;

async function fetchFollowing(url: string, opts: FetchOptions | undefined, deadline: number): Promise<PageResult> {
  throwIfAborted(opts);
  const controller = new AbortController();
  const timer = abortAt(controller, deadline, url, opts);
  const unfollow = follow(controller, opts);

  try {
    // Manual, like every request here: native redirects would skip the
    // private-address check.
    const res = await request(url, { signal: controller.signal }, opts);

    // Headers are in: retire the header timer and read the body against what
    // is left of the deadline, so a stall here reports the same error as the
    // main path instead of a bare abort.
    clearTimeout(timer);
    hopControllers.set(res, controller);
    return { ...(await readBody(res, deadline, maxBytesOf(opts), opts?.signal)), status: res.status, headers: res.headers };
  } finally {
    clearTimeout(timer);
    unfollow();
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
        return { ...(await readBody(response, deadline, maxBytesOf(opts), opts?.signal)), status: response.status, headers: response.headers };
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
    const unfollow = follow(controller, opts);

    // Redirects are walked here rather than by fetch, so each hop can be
    // checked before it is requested.
    try {
      const from = auditedFrom(url, opts);
      if (reachesPrivateAddress(url, from)) throw refused(url);
      let current = url;
      for (let i = 0; ; i++) {
        throwIfAborted(opts);
        const res = await request(current, { method: 'HEAD', signal: controller.signal }, opts);
        const location = res.headers.get('location');
        if (!location || res.status < 300 || res.status >= 400 || i >= MAX_REDIRECTS) {
          return { status: res.status, headers: res.headers };
        }
        const next = new URL(location, current).href;
        if (reachesPrivateAddress(next, from)) throw refusedRedirect(next);
        current = next;
      }
    } finally {
      clearTimeout(timer);
      unfollow();
    }
  });
}
