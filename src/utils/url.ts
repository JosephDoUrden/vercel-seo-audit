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

/** Same host and port, any scheme: `http://example.com` and `https://example.com` match. */
export function isSameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, where cloud metadata lives
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * True for a hostname that is a literal loopback, private (RFC 1918), carrier-grade NAT,
 * link-local (169.254.169.254 and other cloud metadata endpoints) or unspecified address,
 * IPv4 or IPv6, or `localhost`. Pass `new URL(...).hostname`, which has already turned
 * spellings such as `2130706433` or `0x7f.1` into dotted IPv4.
 *
 * Literal addresses only: no DNS lookup is made, so a public name that resolves to a
 * private address is not caught. A lookup here would not close that gap anyway, since
 * the name can resolve differently when the request is made.
 */
export function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!host.includes(':')) return isPrivateIpv4(host);

  if (host === '::' || host === '::1') return true;
  // IPv4-mapped, as written (::ffff:127.0.0.1) or as new URL() prints it (::ffff:7f00:1)
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(host);
  if (mapped) {
    if (mapped[1]) return isPrivateIpv4(mapped[1]);
    const hi = parseInt(mapped[2], 16);
    const lo = parseInt(mapped[3], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  const first = parseInt(host.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local, fc00::/7
    (first & 0xffc0) === 0xfe80 // link-local, fe80::/10
  );
}

/**
 * True when `url` points at a private address (see isPrivateAddress) and `from`, the
 * audited URL, does not. A public site cannot send the audit into a private network
 * through a redirect, a sitemap or a link; an audit of a local server can still follow
 * its own links. Unparsable URLs are left to fail on their own.
 */
export function reachesPrivateAddress(url: string, from: string): boolean {
  try {
    return isPrivateAddress(new URL(url).hostname) && !isPrivateAddress(new URL(from).hostname);
  } catch {
    return false;
  }
}
