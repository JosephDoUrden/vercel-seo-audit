import { DEFAULT_TIMEOUT, MAX_REDIRECTS, USER_AGENT } from '../constants.js';
import type { FetchOptions, RedirectChain, RedirectHop } from '../types.js';

function buildHeaders(userAgent?: string): Record<string, string> {
  return {
    'User-Agent': userAgent ?? USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
}

export async function fetchWithoutRedirect(
  url: string,
  opts?: FetchOptions,
): Promise<Response> {
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
}

export async function followRedirectChain(
  url: string,
  opts?: FetchOptions,
): Promise<RedirectChain> {
  const hops: RedirectHop[] = [];
  const seen = new Set<string>();
  let current = url;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (seen.has(current)) {
      return { hops, finalUrl: current, isCircular: true };
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
      return { hops, finalUrl: current, isCircular: false };
    }
  }

  return { hops, finalUrl: current, isCircular: false };
}

export async function fetchPage(
  url: string,
  opts?: FetchOptions,
): Promise<{ body: string; status: number; headers: Headers; finalUrl: string }> {
  const chain = await followRedirectChain(url, opts);
  const finalUrl = chain.finalUrl;

  const controller = new AbortController();
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
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
}

export async function fetchHead(
  url: string,
  opts?: FetchOptions,
): Promise<{ status: number; headers: Headers }> {
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
}
