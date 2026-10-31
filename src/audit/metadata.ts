import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage, fetchHead } from '../utils/http.js';
import {
  type CanonicalLink,
  getCanonicalLinks,
  getNoindexDirective,
  getCharset,
  getViewport,
  getTitle,
  getMetaTag,
} from '../utils/html-parser.js';
import { isNextjsPage } from '../utils/nextjs.js';
import { isSameHost, isSameOrigin, reachesPrivateAddress } from '../utils/url.js';

// The quotes below are from Google's "How to specify a canonical with rel="canonical" and
// other methods" (updated 10 Jul 2026) unless they name another page.
const CANONICAL_DOC = 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls';

// noindex or none (noindex, nofollow), in a robots meta value or an X-Robots-Tag header.
const NOINDEX_RE = /\b(?:noindex|none)\b/i;

// Link params that make a canonical an alternate-version annotation, which Google does not
// use (see getCanonicalLinks).
const ALTERNATE_PARAMS = ['hreflang', 'lang', 'media', 'type'];

/**
 * The targets of the rel=canonical links in a Link header (RFC 8288), in order. Links are
 * comma-separated, and a comma inside <…> or a quoted param value does not split them. Only
 * the first rel param of a link counts, as RFC 8288 says.
 */
export function canonicalsFromLinkHeader(value: string): string[] {
  const canonicals: string[] = [];
  let i = 0;
  while (i < value.length) {
    const open = value.indexOf('<', i);
    const close = open === -1 ? -1 : value.indexOf('>', open);
    if (close === -1) break;
    const target = value.slice(open + 1, close).trim();
    const params = new Map<string, string>();
    i = close + 1;
    while (i < value.length && value[i] !== ',') {
      const param =
        value[i] === ';' ? /^;\s*([^=;,\s]+)\s*(?:=\s*(?:"((?:[^"\\]|\\.)*)"|([^;,]*)))?/.exec(value.slice(i)) : null;
      if (!param) {
        i++;
        continue;
      }
      const name = param[1].toLowerCase();
      if (!params.has(name)) params.set(name, (param[2]?.replace(/\\(.)/g, '$1') ?? param[3] ?? '').trim());
      i += param[0].length;
    }
    const rel = (params.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (target && rel.includes('canonical') && !ALTERNATE_PARAMS.some((p) => params.has(p))) canonicals.push(target);
  }
  return canonicals;
}

/**
 * How many different URLs the <head> canonicals name, each resolved against base. The same URL
 * written twice does not conflict, so more than one is a conflict.
 */
export function distinctCanonicalCount(headTags: readonly CanonicalLink[], base: string): number {
  return new Set(headTags.map((t) => resolve(t.href, base) ?? t.href)).size;
}

/** 'fragment' or 'relative' for a canonical href Google advises against, otherwise undefined. */
export function canonicalHrefKind(href: string): 'fragment' | 'relative' | undefined {
  return href.includes('#') ? 'fragment' : /^[a-z][a-z\d+.-]*:/i.test(href) ? undefined : 'relative';
}

function resolve(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

export async function auditMetadata(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  let html: string;
  let headers: Headers;
  let finalUrl: string;

  if (ctx.html && ctx.headers) {
    html = ctx.html;
    headers = new Headers(ctx.headers);
    finalUrl = ctx.finalUrl ?? normalizedUrl;
  } else {
    try {
      const page = await fetchPage(normalizedUrl, fetchOptions);
      html = page.body;
      headers = page.headers;
      finalUrl = page.finalUrl;
      ctx.html = html;
      ctx.headers = Object.fromEntries(headers.entries());
      ctx.finalUrl = finalUrl;
    } catch {
      return findings;
    }
  }

  // 1. Noindex check — meta tag
  const metaNoindex = getNoindexDirective(html);
  if (metaNoindex) {
    findings.push({
      code: 'NOINDEX_DETECTED',
      severity: 'error',
      category: 'indexing',
      message: 'noindex meta tag detected on the audited page',
      explanation:
        'A noindex directive tells search engines not to include this page in search results.',
      suggestion:
        'Remove the noindex directive unless you intentionally want to prevent indexing.',
      url: normalizedUrl,
    });
  }

  // 2. Noindex check — X-Robots-Tag header
  const xRobots = headers.get('x-robots-tag') ?? '';
  if (xRobots.toLowerCase().includes('noindex')) {
    findings.push({
      code: 'X_ROBOTS_NOINDEX',
      severity: 'error',
      category: 'indexing',
      message: 'X-Robots-Tag: noindex header detected',
      explanation:
        'The X-Robots-Tag header with noindex prevents search engines from indexing this page.',
      suggestion:
        'Remove the X-Robots-Tag noindex header from your server configuration or middleware.',
      details: { header: xRobots },
      url: normalizedUrl,
    });
  }

  // 3. Canonical URL checks. Google reads only the canonicals in <head>, so the first of those
  // is the tag; one in <body> alone is used for the checks below as well, after its own finding.
  // With no tag, the Link header stands in.
  const tags = getCanonicalLinks(html);
  const headTags = tags.filter((t) => t.inHead);
  const tag = (headTags[0] ?? tags[0])?.href;
  const headerCanonical = canonicalsFromLinkHeader(headers.get('link') ?? '')[0];
  const canonical = tag ?? headerCanonical;
  const canonicalFull = canonical === undefined ? undefined : resolve(canonical, finalUrl);

  // 3a. Google, "JavaScript SEO basics" (updated 04 Mar 2026): "Conflicting or multiple
  // rel="canonical" link tags may lead to unexpected results." The same URL written twice
  // does not conflict, so only distinct URLs count.
  if (distinctCanonicalCount(headTags, finalUrl) > 1) {
    findings.push({
      code: 'CANONICAL_MULTIPLE',
      severity: 'error',
      category: 'metadata',
      message: `${headTags.length} canonical tags name different URLs`,
      explanation:
        'Google says conflicting or multiple rel="canonical" link tags "may lead to unexpected results": it can pick one you did not mean, or ignore them and choose the canonical itself.',
      suggestion:
        'Keep one <link rel="canonical"> in <head>. A layout and a page that both set it, or a script that adds a second, are the usual causes.',
      details: { hrefs: headTags.map((t) => t.href) },
      url: normalizedUrl,
    });
  }

  // 3b. "The rel="canonical" link element is only accepted if it appears in the <head> section
  // of the HTML, so make sure at least the <head> section is valid HTML." On a Next.js page a
  // canonical in <body> alone is most likely streamed metadata, which Googlebot reads after
  // rendering; the streamed metadata check reports that case.
  const headerRecord = Object.fromEntries(headers.entries());
  if (tags.length > 0 && headTags.length === 0 && !isNextjsPage(headerRecord, html)) {
    findings.push({
      code: 'CANONICAL_IN_BODY',
      severity: 'error',
      category: 'metadata',
      message: 'The canonical tag is in <body>, where Google does not accept it',
      explanation:
        'Google says the rel="canonical" link element "is only accepted if it appears in the <head> section of the HTML". An element <head> does not allow, such as a <div> or an <img>, ends <head> early and pushes the tags after it into <body>.',
      suggestion:
        'Move <link rel="canonical"> into <head>, ahead of anything that is not allowed there.',
      details: { hrefs: tags.map((t) => t.href) },
      url: normalizedUrl,
    });
  }

  // 3c. "We recommend that you choose one of these and go with that; while supported, using
  // both methods at the same time is more error prone (for example, you might provide one URL
  // in the HTTP header, and another URL in the rel="canonical" link element)."
  if (tag !== undefined && headerCanonical !== undefined) {
    const tagFull = resolve(tag, finalUrl) ?? tag;
    const headerFull = resolve(headerCanonical, finalUrl) ?? headerCanonical;
    if (tagFull !== headerFull) {
      findings.push({
        code: 'CANONICAL_HEADER_CONFLICT',
        severity: 'warning',
        category: 'metadata',
        message: 'The Link header and the canonical tag name different URLs',
        explanation:
          'Google supports a canonical in the Link HTTP header or in the HTML, and says using both "is more error prone (for example, you might provide one URL in the HTTP header, and another URL in the rel="canonical" link element)". With two answers, Google may not use either.',
        suggestion:
          'Set the canonical in one place. Drop the rel="canonical" Link header from the server or middleware, or make it name the same URL as the tag.',
        details: { header: headerFull, tag: tagFull },
        url: normalizedUrl,
      });
    }
  }

  // 3d. "Use absolute paths rather than relative paths with the rel="canonical" link element."
  // "Even though relative paths are supported by Google, they can cause problems in the long
  // run (for example, if you unintentionally allow your testing site to be crawled) and thus we
  // don't recommend them." And: "Don't specify a URL fragment as canonical, as Google generally
  // doesn't support URL fragments." The other checks use the href resolved against the page.
  if (canonical !== undefined && canonicalFull !== undefined) {
    const kind = canonicalHrefKind(canonical);
    if (kind) {
      findings.push({
        code: 'CANONICAL_RELATIVE',
        severity: 'warning',
        category: 'metadata',
        message: kind === 'fragment' ? 'The canonical URL carries a fragment' : 'The canonical URL is relative',
        explanation:
          kind === 'fragment'
            ? 'Google says not to specify a URL fragment as canonical, "as Google generally doesn\'t support URL fragments".'
            : 'Google supports relative canonicals but recommends absolute URLs: a relative one points at whichever host serves the page, so a crawled preview or testing deployment names itself as canonical.',
        suggestion: `Use the full absolute URL, with scheme and host and no fragment (${CANONICAL_DOC}).`,
        details: { href: canonical, resolved: canonicalFull, kind },
        url: normalizedUrl,
      });
    }
  }

  // 3e. Google's page advises against noindex for choosing a canonical ("We don't recommend
  // using noindex to prevent selection of a canonical page within a single site, because it
  // will completely block the page from Search.") but does not name this combination. Google,
  // "Robots meta tag, data-nosnippet, and X-Robots-Tag specifications" (updated 24 Mar 2026),
  // defines noindex as "Do not show this page, media, or resource in search results." Reading
  // noindex beside a canonical to another URL as contradictory signals is this tool's
  // interpretation: one says drop this URL, the other says fold it into that one.
  const headerNoindex = NOINDEX_RE.test(xRobots);
  if (
    (metaNoindex || headerNoindex) &&
    canonicalFull !== undefined &&
    canonicalFull !== finalUrl &&
    canonicalFull !== normalizedUrl
  ) {
    findings.push({
      code: 'CANONICAL_NOINDEX_CONFLICT',
      severity: 'error',
      category: 'indexing',
      message: 'The page is noindex and also names another URL as canonical',
      explanation:
        'noindex asks Google to drop this URL from results, while the canonical asks it to treat this URL as a duplicate of another and pass its signals there. Google advises against using noindex to choose a canonical, because it "will completely block the page from Search"; sent together, the two are contradictory signals (this reading is the tool\'s, not a sentence from Google).',
      suggestion:
        'Pick one: remove noindex and keep the canonical to consolidate the duplicate, or keep noindex and make the canonical self-referencing (or remove it).',
      details: { canonical: canonicalFull, source: metaNoindex ? 'meta' : 'header' },
      url: normalizedUrl,
    });
  }

  if (!canonical) {
    findings.push({
      code: 'CANONICAL_MISSING',
      severity: 'warning',
      category: 'metadata',
      message: 'No canonical URL found on the audited page',
      explanation:
        'Without a canonical tag, search engines may index duplicate versions of your page.',
      suggestion:
        'Add a <link rel="canonical"> tag pointing to the preferred URL of this page.',
      url: normalizedUrl,
    });
  } else if (canonicalFull !== undefined) {
    try {
      if (canonicalFull !== finalUrl && canonicalFull !== normalizedUrl) {
        findings.push({
          code: 'CANONICAL_MISMATCH',
          severity: 'warning',
          category: 'metadata',
          message: 'Canonical URL does not match the page URL',
          explanation:
            'A mismatched canonical signals to search engines that this page is a duplicate of another.',
          suggestion:
            'Ensure the canonical URL matches the page URL, or verify the mismatch is intentional.',
          details: { canonical: canonicalFull, pageUrl: finalUrl },
          url: normalizedUrl,
        });
      }

      if (!isSameOrigin(canonicalFull, normalizedUrl)) {
        findings.push({
          code: 'CANONICAL_EXTERNAL',
          severity: 'info',
          category: 'metadata',
          message: 'Canonical URL points to a different domain',
          explanation:
            'An external canonical tells search engines that this content originates on another domain.',
          suggestion:
            'Verify this is intentional. External canonicals transfer ranking signals to the other domain.',
          details: { canonical: canonicalFull },
          url: normalizedUrl,
        });
      }
    } catch {
      // Invalid canonical URL
    }
  }

  // 4. Charset
  const charset = getCharset(html);
  if (!charset) {
    findings.push({
      code: 'CHARSET_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No charset declaration found',
      explanation:
        'Without a charset declaration, browsers may misinterpret special characters on your page.',
      suggestion: 'Add <meta charset="utf-8"> to the <head> of your document.',
      url: normalizedUrl,
    });
  }

  // 5. Viewport
  const viewport = getViewport(html);
  if (!viewport) {
    findings.push({
      code: 'VIEWPORT_MISSING',
      severity: 'warning',
      category: 'metadata',
      message: 'No viewport meta tag found',
      explanation:
        'Without a viewport tag, mobile devices may render the page at desktop width, harming mobile SEO.',
      suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      url: normalizedUrl,
    });
  }

  // 6. Title
  const title = getTitle(html);
  if (!title) {
    findings.push({
      code: 'TITLE_MISSING',
      severity: 'warning',
      category: 'metadata',
      message: 'No <title> tag found',
      explanation:
        'The title tag is one of the most important on-page SEO elements. Missing titles hurt rankings.',
      suggestion: 'Add a unique, descriptive <title> tag to your page.',
      url: normalizedUrl,
    });
  }

  // 7. Meta description
  const description = getMetaTag(html, 'description');
  if (!description) {
    findings.push({
      code: 'DESCRIPTION_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No meta description found',
      explanation:
        'Meta descriptions appear in search results and can improve click-through rates.',
      suggestion: 'Add a <meta name="description"> tag with a compelling summary of your page.',
      url: normalizedUrl,
    });
  }

  // 8. Open Graph tags
  const ogTitle = getMetaTag(html, 'og:title');
  const ogDescription = getMetaTag(html, 'og:description');
  const ogImage = getMetaTag(html, 'og:image');

  if (!ogTitle) {
    findings.push({
      code: 'OG_TITLE_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No og:title meta tag found',
      explanation:
        'Open Graph tags control how your page appears when shared on social media platforms.',
      suggestion: 'Add <meta property="og:title"> for better social sharing previews.',
      url: normalizedUrl,
    });
  }

  if (!ogDescription) {
    findings.push({
      code: 'OG_DESCRIPTION_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No og:description meta tag found',
      explanation:
        'og:description controls the description shown in social media previews.',
      suggestion: 'Add <meta property="og:description"> for better social sharing.',
      url: normalizedUrl,
    });
  }

  if (!ogImage) {
    findings.push({
      code: 'OG_IMAGE_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No og:image meta tag found',
      explanation:
        'Social media platforms display a default placeholder when no og:image is set.',
      suggestion: 'Add <meta property="og:image"> with a representative image URL.',
      url: normalizedUrl,
    });
  } else {
    // 8a. Check if og:image uses a relative URL
    if (!ogImage.startsWith('http://') && !ogImage.startsWith('https://')) {
      findings.push({
        code: 'OG_IMAGE_RELATIVE',
        severity: 'warning',
        category: 'metadata',
        message: 'og:image uses a relative URL',
        explanation:
          'Many social media crawlers do not resolve relative URLs for og:image, which means your image may not appear in previews.',
        suggestion: 'Use an absolute URL (starting with https://) for og:image.',
        details: { ogImage },
        url: normalizedUrl,
      });
    }

    // 8b. Verify og:image URL returns 2xx. One on a private address is not
    // requested from a public site (see reachesPrivateAddress).
    try {
      const absoluteOgImage = ogImage.startsWith('http') ? ogImage : new URL(ogImage, finalUrl).href;
      const status = !fetchOptions.allowPrivate && reachesPrivateAddress(absoluteOgImage, normalizedUrl)
        ? undefined
        : (await fetchHead(absoluteOgImage, fetchOptions)).status;
      if (status !== undefined && (status < 200 || status >= 300)) {
        findings.push({
          code: 'OG_IMAGE_BROKEN',
          severity: 'warning',
          category: 'metadata',
          message: `og:image URL returned HTTP ${status}`,
          explanation:
            'A broken og:image means social media platforms cannot display your preview image.',
          suggestion: 'Ensure the og:image URL is accessible and returns a valid image.',
          details: { ogImage: absoluteOgImage, status },
          url: normalizedUrl,
        });
      }
    } catch {
      findings.push({
        code: 'OG_IMAGE_BROKEN',
        severity: 'warning',
        category: 'metadata',
        message: 'og:image URL could not be fetched',
        explanation:
          'A broken og:image means social media platforms cannot display your preview image.',
        suggestion: 'Ensure the og:image URL is accessible and returns a valid image.',
        details: { ogImage },
        url: normalizedUrl,
      });
    }
  }

  // 9. Twitter Card tags
  const twitterCard = getMetaTag(html, 'twitter:card');
  const twitterImage = getMetaTag(html, 'twitter:image');

  if (!twitterCard) {
    findings.push({
      code: 'TWITTER_CARD_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No twitter:card meta tag found',
      explanation:
        'Without a twitter:card tag, Twitter/X may not display rich previews when your page is shared.',
      suggestion:
        'Add <meta name="twitter:card" content="summary_large_image"> for rich previews.',
      url: normalizedUrl,
    });
  }

  if (!twitterImage) {
    findings.push({
      code: 'TWITTER_IMAGE_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No twitter:image meta tag found',
      explanation:
        'Without a twitter:image, Twitter/X falls back to og:image or shows no preview image.',
      suggestion:
        'Add <meta name="twitter:image"> with a URL to your preview image (recommended: 1200x628px).',
      url: normalizedUrl,
    });
  } else {
    // 9a. Verify twitter:image URL returns 2xx
    try {
      const absoluteTwitterImage = twitterImage.startsWith('http') ? twitterImage : new URL(twitterImage, finalUrl).href;
      const status = !fetchOptions.allowPrivate && reachesPrivateAddress(absoluteTwitterImage, normalizedUrl)
        ? undefined
        : (await fetchHead(absoluteTwitterImage, fetchOptions)).status;
      if (status !== undefined && (status < 200 || status >= 300)) {
        findings.push({
          code: 'TWITTER_IMAGE_BROKEN',
          severity: 'warning',
          category: 'metadata',
          message: `twitter:image URL returned HTTP ${status}`,
          explanation:
            'A broken twitter:image means Twitter/X cannot display your preview image.',
          suggestion: 'Ensure the twitter:image URL is accessible and returns a valid image.',
          details: { twitterImage: absoluteTwitterImage, status },
          url: normalizedUrl,
        });
      }
    } catch {
      findings.push({
        code: 'TWITTER_IMAGE_BROKEN',
        severity: 'warning',
        category: 'metadata',
        message: 'twitter:image URL could not be fetched',
        explanation:
          'A broken twitter:image means Twitter/X cannot display your preview image.',
        suggestion: 'Ensure the twitter:image URL is accessible and returns a valid image.',
        details: { twitterImage },
        url: normalizedUrl,
      });
    }
  }

  // 10. The canonical target. Last, because reading its HTML replaces the parsed page.
  if (canonicalFull !== undefined) {
    const target = await checkCanonicalTarget(canonicalFull, finalUrl, ctx);
    if (target) findings.push(target);
  }

  return findings;
}

// A canonical should name a page Google can index: "Redirects: A strong signal that the
// target of the redirect should become canonical", and noindex "will completely block the
// page from Search". One GET through the shared cache, only for another URL on the same host;
// a target that cannot be fetched at all is left alone.
async function checkCanonicalTarget(
  canonicalFull: string,
  finalUrl: string,
  ctx: AuditContext,
): Promise<AuditFinding | undefined> {
  const target = new URL(canonicalFull);
  target.hash = '';
  const url = target.href;
  if (url === finalUrl || !isSameHost(url, finalUrl)) return undefined;

  let page: Awaited<ReturnType<typeof fetchPage>>;
  try {
    page = await fetchPage(url, ctx.fetchOptions);
  } catch {
    return undefined;
  }

  const redirectedTo = page.finalUrl !== url ? page.finalUrl : undefined;
  const served = page.status === 200 && !redirectedTo;
  // The robots meta of a redirect or an error page says nothing about the target.
  const noindex =
    NOINDEX_RE.test(page.headers.get('x-robots-tag') ?? '') ||
    (served && NOINDEX_RE.test(page.body) && getNoindexDirective(page.body));
  if (served && !noindex) return undefined;

  const problem = redirectedTo
    ? `redirects to ${redirectedTo}`
    : page.status !== 200
      ? `answers HTTP ${page.status}`
      : 'is noindex';
  return {
    code: 'CANONICAL_TARGET_NOT_OK',
    severity: 'warning',
    category: 'metadata',
    message: `The canonical URL ${problem}`,
    explanation:
      'A canonical should name a page Google can index. A redirect is itself a strong canonical signal for its target, so a canonical that redirects sends two answers; an error page or a noindex page cannot become the canonical, and Google then chooses one itself.',
    suggestion:
      'Point the canonical at the final, indexable URL that answers 200: no redirect, no noindex meta tag or X-Robots-Tag.',
    details: { canonical: url, status: page.status, ...(redirectedTo && { redirectedTo }), noindex },
    url: ctx.normalizedUrl,
  };
}
