// Next.js sends x-powered-by: Next.js unless poweredByHeader is turned off.
export function poweredByNextjs(headers: Record<string, string>): boolean {
  return (headers['x-powered-by'] ?? '').toLowerCase().includes('next.js');
}

// Build markers Next.js leaves in the HTML: next-head-count and __next from the Pages
// Router, _next/static from the chunks of either router.
export function hasNextjsMarkers(html: string): boolean {
  return html.includes('next-head-count') || html.includes('__next') || html.includes('_next/static');
}

export function isNextjsPage(headers: Record<string, string>, html: string): boolean {
  return poweredByNextjs(headers) || hasNextjsMarkers(html);
}
