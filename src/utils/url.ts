export function normalizeUrl(input: string): string {
  let url = input.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  const parsed = new URL(url);
  // Remove default ports
  if (
    (parsed.protocol === 'https:' && parsed.port === '443') ||
    (parsed.protocol === 'http:' && parsed.port === '80')
  ) {
    parsed.port = '';
  }

  return parsed.href;
}

export function hasTrailingSlash(url: string): boolean {
  const pathname = new URL(url).pathname;
  return pathname.length > 1 && pathname.endsWith('/');
}

export function addTrailingSlash(url: string): string {
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname += '/';
  }
  return parsed.href;
}

export function removeTrailingSlash(url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.href;
}

export function resolveUrl(base: string, relative: string): string {
  return new URL(relative, base).href;
}

export function isHttps(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

export function isSameOrigin(a: string, b: string): boolean {
  const urlA = new URL(a);
  const urlB = new URL(b);
  return urlA.origin === urlB.origin;
}

export function getOrigin(url: string): string {
  return new URL(url).origin;
}

export function toHttpUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = 'http:';
  return parsed.href;
}
