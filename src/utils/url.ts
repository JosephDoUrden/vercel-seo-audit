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
    a === 0 || // "this network", 0.0.0.0/8
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, where cloud metadata lives
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && Number(m[3]) === 0) || // IETF protocol assignments, 192.0.0.192 metadata included
    host === '168.63.129.16' || // Azure platform endpoint (wire server)
    (a === 198 && (b === 18 || b === 19)) || // benchmarking, 198.18.0.0/15
    a >= 224 // multicast 224.0.0.0/4 and reserved 240.0.0.0/4, broadcast included
  );
}

// The eight 16-bit groups of an IPv6 address, or undefined when `host` is not
// one. new URL() does the parsing, so every spelling (`::ffff:1.2.3.4`,
// uncompressed, upper case) arrives in one form.
function ipv6Groups(host: string): number[] | undefined {
  let canonical: string;
  try {
    canonical = new URL(`http://[${host}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
  const [head, tail] = canonical.split('::');
  const parse = (part: string | undefined): number[] => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  if (tail === undefined) return left;
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

// The IPv4 address held in two 16-bit groups.
function ipv4Of(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateIpv6(host: string): boolean {
  // A zone (`fe80::1%en0`) only says which interface; an address that will not
  // parse is refused rather than guessed at.
  const g = ipv6Groups(host.replace(/%.*$/, ''));
  if (!g) return true;
  const zero = (from: number, to: number): boolean => g.slice(from, to).every((x) => x === 0);

  // IPv4-mapped ::ffff:0:0/96 and IPv4-translated ::ffff:0:0:0/96 reach the IPv4 address inside.
  if (zero(0, 5) && g[5] === 0xffff) return isPrivateIpv4(ipv4Of(g[6], g[7]));
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return isPrivateIpv4(ipv4Of(g[6], g[7]));
  // ::/96: unspecified, loopback and the deprecated IPv4-compatible form.
  if (zero(0, 6)) return true;
  // NAT64 64:ff9b::/96 reaches the IPv4 address inside; local-use 64:ff9b:1::/48 is private.
  if (g[0] === 0x64 && g[1] === 0xff9b) return zero(2, 6) ? isPrivateIpv4(ipv4Of(g[6], g[7])) : g[2] === 1;
  // 6to4 2002::/16 carries the IPv4 address in the next two groups.
  if (g[0] === 0x2002) return isPrivateIpv4(ipv4Of(g[1], g[2]));
  // Teredo 2001::/32 carries the server's IPv4 address in groups 2-3 and the client's,
  // inverted, in groups 6-7; either one private is enough.
  if (g[0] === 0x2001 && g[1] === 0) {
    return isPrivateIpv4(ipv4Of(g[2], g[3])) || isPrivateIpv4(ipv4Of(g[6] ^ 0xffff, g[7] ^ 0xffff));
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local, fc00::/7
    (g[0] & 0xffc0) === 0xfe80 || // link-local, fe80::/10
    (g[0] & 0xffc0) === 0xfec0 || // site-local, fec0::/10
    (g[0] & 0xff00) === 0xff00 // multicast, ff00::/8
  );
}

/**
 * True for a loopback, private (RFC 1918), carrier-grade NAT, link-local
 * (169.254.169.254 and other cloud metadata endpoints), benchmarking, reserved,
 * multicast or unspecified address, IPv4 or IPv6, for 192.0.0.0/24 and the Azure
 * platform endpoint 168.63.129.16, for an IPv6 address that carries one of those
 * IPv4 addresses (mapped, NAT64, 6to4, Teredo), and for `localhost`. Pass
 * `new URL(...).hostname`, which has already turned spellings such as `2130706433`
 * or `0x7f.1` into dotted IPv4, or an address from a DNS answer.
 *
 * Literal addresses only, with no DNS lookup: the requests in http.ts check each
 * name again at connect time, against every address it resolves to.
 */
export function isPrivateAddress(hostname: string): boolean {
  // A trailing dot is the same name in DNS: `localhost.` is `localhost`.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return host.includes(':') ? isPrivateIpv6(host) : isPrivateIpv4(host);
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
