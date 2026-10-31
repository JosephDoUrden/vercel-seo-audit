import type { AuditFinding, IssueCategory } from '../types.js';

export interface EdgeChallenge {
  status: number;
  provider: 'vercel' | 'cloudflare';
  header: string;
}

// The statuses an edge challenge page is served with.
const CHALLENGE_STATUSES = new Set([403, 429, 503]);

// Each provider marks a challenge response with one header set to "challenge".
// - Vercel: x-vercel-mitigated. Not in Vercel's response header reference (checked 31 Oct 2026);
//   reported as "returning 403 with X-Vercel-Mitigated: challenge on every path (including
//   /robots.txt and /)" for non-JS clients at
//   https://community.vercel.com/t/legitimate-crawler-blocked-by-vercel-bot-mitigation-on-hobby-plan/49307
//   (16 Sep 2026).
// - Cloudflare: cf-mitigated. "the Challenge Page response ... will have the `cf-mitigated` header
//   present and set to `challenge`", and "`challenge` is the only valid value"
//   (https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response,
//   last updated 05 May 2026, read 31 Oct 2026).
const MARKERS = [
  { header: 'x-vercel-mitigated', provider: 'vercel' },
  { header: 'cf-mitigated', provider: 'cloudflare' },
] as const;

/** Returns the challenge when the response is an edge challenge page rather than the content. */
export function detectChallenge(
  headers: Headers | Record<string, string>,
  status: number,
): EdgeChallenge | undefined {
  if (!CHALLENGE_STATUSES.has(status)) return undefined;
  const get = (name: string) => (headers instanceof Headers ? headers.get(name) : headers[name]) ?? '';
  for (const { header, provider } of MARKERS) {
    if (get(header).trim().toLowerCase() === 'challenge') return { status, provider, header };
  }
  return undefined;
}

// Vercel lets verified bots through Attack Challenge Mode: "Search engine crawlers like Googlebot
// are automatically allowed through Attack Mode without being challenged", and it is recommended
// "primarily when facing highly targeted attacks rather than as a permanent setting"
// (https://vercel.com/docs/attack-challenge-mode, read 31 Oct 2026).
const PROVIDERS = {
  vercel: {
    name: 'Vercel',
    exemption:
      'Vercel lets verified bots such as Googlebot through, so Google may still index the site, but other crawlers, link preview tools and this audit get the challenge.',
    suggestion:
      'Check Attack Challenge Mode and the Firewall rules for this path, and add bypass rules for the crawlers you rely on. Vercel recommends Attack Challenge Mode for targeted attacks rather than as a permanent setting, so turn it off once the attack is over.',
  },
  cloudflare: {
    name: 'Cloudflare',
    exemption:
      'Whether search engine crawlers get the same challenge depends on the zone\'s security and bot settings, which the audit cannot see; other crawlers and link preview tools very likely do.',
    suggestion:
      'Check the WAF custom rules, Bot Fight Mode and Under Attack Mode for this path, and skip the challenge for the crawlers you rely on.',
  },
} as const;

/** The EDGE_CHALLENGE finding for a challenged response. `what` names the resource, e.g. "robots.txt". */
export function edgeChallengeFinding(
  challenge: EdgeChallenge,
  category: IssueCategory,
  what: string,
  url: string,
): AuditFinding {
  const provider = PROVIDERS[challenge.provider];
  return {
    code: 'EDGE_CHALLENGE',
    severity: 'error',
    category,
    message: `${provider.name} served a challenge instead of ${what} to the audit as an unverified client (${challenge.status}, ${challenge.header}: challenge)`,
    explanation: `${provider.name} answered with a challenge page that only a JavaScript-running browser can pass, so a crawler that does not run JavaScript gets a ${challenge.status} and no content. The audit's requests are not from a verified bot. ${provider.exemption}`,
    suggestion: provider.suggestion,
    details: { ...challenge },
    url,
  };
}
