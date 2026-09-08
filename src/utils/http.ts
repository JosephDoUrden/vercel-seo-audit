import { DEFAULT_TIMEOUT, MAX_REDIRECTS, USER_AGENT } from '../constants.js';
import type { FetchOptions, RedirectChain, RedirectHop } from '../types.js';

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

export function fetchWithoutRedirect(
  url: string,
  opts?: FetchOptions,
): Promise<Response> {
  return cached(opts, `MANUAL ${url}`, async () => {
    const controller = new AbortController();
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      return await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: buildHeaders(opts?.userAgent),
      });
    } finally {
      clearTimeout(timer);
    }
  });
}

// Walks redirects hop by hop. `response` is the first non-redirect response,
// or undefined when a hop failed or MAX_REDIRECTS ran out.
async function walkRedirects(
  url: string,
  opts?: FetchOptions,
): Promise<{ chain: RedirectChain; response?: Response }> {
  const hops: RedirectHop[] = [];
  const seen = new Set<string>();
  let current = url;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (seen.has(current)) {
      return { chain: { hops, finalUrl: current, isCircular: true } };
    }
    seen.add(current);

    let res: Response;
    try {
      res = await fetchWithoutRedirect(current, opts);
    } catch {
      break;
    }

    const status = res.status;
    const location = res.headers.get('location');

    if (location && status >= 300 && status < 400) {
      const resolved = new URL(location, current).href;
      hops.push({ url: current, status, location: resolved });
      current = resolved;
    } else {
      return { chain: { hops, finalUrl: current, isCircular: false }, response: res };
    }
  }

  return { chain: { hops, finalUrl: current, isCircular: false } };
}

export async function followRedirectChain(
  url: string,
  opts?: FetchOptions,
): Promise<RedirectChain> {
  const { chain } = await walkRedirects(url, opts);
  return chain;
}

// The hop responses come back with the abort timer already cleared, so reading
// the body gets its own deadline.
async function readBody(res: Response, timeout: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out reading body of ${res.url}`)), timeout);
  });

  try {
    return await Promise.race([res.text(), expired]);
  } catch (err) {
    await res.body?.cancel().catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchPage(
  url: string,
  opts?: FetchOptions,
): Promise<{ body: string; status: number; headers: Headers; finalUrl: string }> {
  return cached(opts, `GET ${url}`, async () => {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    const { chain, response } = await walkRedirects(url, opts);
    const finalUrl = chain.finalUrl;

    // The last hop already carries the page; a body that some other caller has
    // consumed, or a walk that never produced a response, falls through to a
    // plain GET.
    if (response && !response.bodyUsed) {
      const body = await readBody(response, timeout);
      return { body, status: response.status, headers: response.headers, finalUrl };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(finalUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: buildHeaders(opts?.userAgent),
      });

      const body = await res.text();
      return { body, status: res.status, headers: res.headers, finalUrl };
    } finally {
      clearTimeout(timer);
    }
  });
}

export function fetchHead(
  url: string,
  opts?: FetchOptions,
): Promise<{ status: number; headers: Headers }> {
  return cached(opts, `HEAD ${url}`, async () => {
    const controller = new AbortController();
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: buildHeaders(opts?.userAgent),
      });
      return { status: res.status, headers: res.headers };
    } finally {
      clearTimeout(timer);
    }
  });
}
