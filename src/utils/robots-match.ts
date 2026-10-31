// Google's robots.txt matching, from https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
// (last updated 23 Oct 2026, read 31 Oct 2026):
// - Paths: "`*` designates 0 or more instances of any valid character", "`$` designates the end of
//   the URL", and the value "is case-sensitive". Google compares "rules against URLs using their
//   percent-encoded forms, and automatically canonicalize[s] raw UTF-8 rule paths into
//   percent-encoded forms".
// - Rules: "crawlers use the most specific rule based on the length of the rule path", and "In case
//   of conflicting rules, including those with wildcards, Google uses the least restrictive rule",
//   so an Allow and a Disallow of the same length resolve to the Allow.
// - Groups: "Only one group is valid for a particular crawler", the one "with the most specific user
//   agent that matches", and "User agent specific groups and global groups (`*`) are not combined".

export interface RobotsGroup {
  userAgent: string;
  disallow: string[];
  allow: string[];
}

export interface RobotsMatch {
  allowed: boolean;
  /** The rule that decided it; absent when no rule matched. */
  rule?: { directive: 'allow' | 'disallow'; path: string };
}

const patternCache = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (re) return re;
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[^\x00-\x7f]+/g, (s) => encodeURIComponent(s))
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  re = new RegExp(`^${body}${anchored ? '$' : ''}`);
  patternCache.set(pattern, re);
  return re;
}

/** Whether a robots.txt rule path matches a URL path (with its query string). */
export function matchesRobotsPath(pattern: string, path: string): boolean {
  return toRegExp(pattern).test(path);
}

/**
 * Applies one group's rules to a path: the longest matching rule wins, and an Allow wins a tie.
 * A path no rule matches is allowed.
 */
export function matchRobots(path: string, group: RobotsGroup): RobotsMatch {
  let best: RobotsMatch['rule'];
  const consider = (directive: 'allow' | 'disallow', rulePath: string) => {
    if (!matchesRobotsPath(rulePath, path)) return;
    if (
      !best ||
      rulePath.length > best.path.length ||
      (rulePath.length === best.path.length && directive === 'allow')
    ) {
      best = { directive, path: rulePath };
    }
  };
  for (const p of group.disallow) consider('disallow', p);
  for (const p of group.allow) consider('allow', p);
  return best ? { allowed: best.directive === 'allow', rule: best } : { allowed: true };
}

/**
 * The group a crawler follows: the groups naming its user-agent token (case-insensitive), combined,
 * or the `*` groups when none does. Undefined when neither exists.
 */
export function selectRobotsGroup(groups: readonly RobotsGroup[], token: string): RobotsGroup | undefined {
  const want = token.toLowerCase();
  let matched = groups.filter((g) => g.userAgent.trim().toLowerCase() === want);
  if (matched.length === 0) matched = groups.filter((g) => g.userAgent.trim() === '*');
  if (matched.length === 0) return undefined;
  if (matched.length === 1) return matched[0];
  return {
    userAgent: matched[0].userAgent === '*' ? '*' : want,
    allow: matched.flatMap((g) => g.allow),
    disallow: matched.flatMap((g) => g.disallow),
  };
}
