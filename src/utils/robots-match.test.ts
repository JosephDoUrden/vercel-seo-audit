import { describe, it, expect } from 'vitest';
import { matchRobots, matchesRobotsPath, selectRobotsGroup, type RobotsGroup } from './robots-match.js';

function group(allow: string[], disallow: string[], userAgent = '*'): RobotsGroup {
  return { userAgent, allow, disallow };
}

// The path-matching table in Google's robots.txt spec.
describe('matchesRobotsPath', () => {
  const cases: [string, string[], string[]][] = [
    [
      '/fish',
      ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'],
      ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish'],
    ],
    [
      '/fish*',
      ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'],
      ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish'],
    ],
    [
      '/fish/',
      ['/fish/', '/fish/?id=anything', '/fish/salmon.htm'],
      ['/fish', '/fish.html', '/animals/fish/', '/Fish/Salmon.asp'],
    ],
    [
      '/*.php',
      [
        '/index.php',
        '/filename.php',
        '/folder/filename.php',
        '/folder/filename.php?parameters',
        '/folder/any.php.file.html',
        '/filename.php/',
      ],
      ['/', '/windows.PHP'],
    ],
    [
      '/*.php$',
      ['/filename.php', '/folder/filename.php'],
      ['/filename.php?parameters', '/filename.php/', '/filename.php5', '/windows.PHP'],
    ],
    ['/fish*.php', ['/fish.php', '/fishheads/catfish.php?parameters'], ['/Fish.PHP']],
  ];

  for (const [pattern, matches, misses] of cases) {
    it.each(matches)(`${pattern} matches %s`, (path) => {
      expect(matchesRobotsPath(pattern, path)).toBe(true);
    });
    it.each(misses)(`${pattern} does not match %s`, (path) => {
      expect(matchesRobotsPath(pattern, path)).toBe(false);
    });
  }

  it('treats regex characters in the rule as literals', () => {
    expect(matchesRobotsPath('/a.b', '/a.b')).toBe(true);
    expect(matchesRobotsPath('/a.b', '/axb')).toBe(false);
    expect(matchesRobotsPath('/a+(b)', '/a+(b)/c')).toBe(true);
  });

  it('compares a raw UTF-8 rule against the percent-encoded path', () => {
    expect(matchesRobotsPath('/foo/bar/ツ', '/foo/bar/%E3%83%84')).toBe(true);
    expect(matchesRobotsPath('/foo/bar/%E3%83%84', '/foo/bar/%E3%83%84')).toBe(true);
  });
});

// The precedence table in Google's robots.txt spec.
describe('matchRobots', () => {
  it.each([
    ['/page', ['/p'], ['/'], true, '/p'],
    ['/folder/page', ['/folder'], ['/folder'], true, '/folder'],
    ['/page.htm', ['/page'], ['/*.htm'], false, '/*.htm'],
    ['/page.php5', ['/page'], ['/*.ph'], true, '/page'],
    ['/', ['/$'], ['/'], true, '/$'],
    ['/page.htm', ['/$'], ['/'], false, '/'],
  ])('%s with allow %j and disallow %j', (path, allow, disallow, allowed, rulePath) => {
    const result = matchRobots(path, group(allow, disallow));
    expect(result.allowed).toBe(allowed);
    expect(result.rule?.path).toBe(rulePath);
    expect(result.rule?.directive).toBe(allowed ? 'allow' : 'disallow');
  });

  it('allows a path no rule matches', () => {
    expect(matchRobots('/about', group([], ['/_next/']))).toEqual({ allowed: true });
  });

  it('lets a longer Allow win over a shorter Disallow whatever the order', () => {
    const result = matchRobots('/_next/static/chunks/main.js', group(['/_next/static/'], ['/_next/']));
    expect(result).toEqual({ allowed: true, rule: { directive: 'allow', path: '/_next/static/' } });
  });

  it('blocks with the longest Disallow', () => {
    const result = matchRobots('/_next/static/chunks/main.js', group([], ['/_next/', '/_next/static/']));
    expect(result).toEqual({ allowed: false, rule: { directive: 'disallow', path: '/_next/static/' } });
  });
});

describe('selectRobotsGroup', () => {
  const star = group([], ['/_next/'], '*');
  const googlebot = group([], ['/private/'], 'Googlebot');

  it('picks the googlebot group over *', () => {
    expect(selectRobotsGroup([star, googlebot], 'googlebot')).toEqual(googlebot);
  });

  it('falls back to * when there is no group for the crawler', () => {
    expect(selectRobotsGroup([star, group([], ['/'], 'bingbot')], 'googlebot')).toEqual(star);
  });

  it('does not treat googlebot-image as googlebot', () => {
    expect(selectRobotsGroup([star, group([], ['/'], 'Googlebot-Image')], 'googlebot')).toEqual(star);
  });

  it('combines every group for the same crawler', () => {
    const merged = selectRobotsGroup(
      [group(['/a'], ['/b'], 'googlebot'), star, group([], ['/c'], 'GOOGLEBOT')],
      'googlebot',
    );
    expect(merged).toEqual({ userAgent: 'googlebot', allow: ['/a'], disallow: ['/b', '/c'] });
  });

  it('returns undefined when no group applies', () => {
    expect(selectRobotsGroup([group([], ['/'], 'bingbot')], 'googlebot')).toBeUndefined();
  });
});
