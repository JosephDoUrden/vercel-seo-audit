import { describe, it, expect } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditStructuredData } from './structuredData.js';

function makeCtx(html?: string): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    html,
  };
}

function wrap(jsonld: string): string {
  return `<html><head><script type="application/ld+json">${jsonld}</script></head><body></body></html>`;
}

describe('auditStructuredData', () => {
  it('reports JSONLD_MISSING when no script tags exist', async () => {
    const ctx = makeCtx('<html><head></head><body></body></html>');
    const findings = await auditStructuredData(ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('JSONLD_MISSING');
    expect(findings[0].severity).toBe('warning');
  });

  it('reports JSONLD_INVALID_JSON for malformed JSON', async () => {
    const ctx = makeCtx(wrap('{ not valid json }'));
    const findings = await auditStructuredData(ctx);

    const invalid = findings.find((f) => f.code === 'JSONLD_INVALID_JSON');
    expect(invalid).toBeDefined();
    expect(invalid!.severity).toBe('error');
  });

  it('reports JSONLD_MISSING_CONTEXT when @context is absent', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({ '@type': 'WebSite', name: 'Test', url: 'https://example.com' })));
    const findings = await auditStructuredData(ctx);

    const missing = findings.find((f) => f.code === 'JSONLD_MISSING_CONTEXT');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('warning');
  });

  it('reports JSONLD_MISSING_TYPE when @type is absent', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({ '@context': 'https://schema.org' })));
    const findings = await auditStructuredData(ctx);

    const missing = findings.find((f) => f.code === 'JSONLD_MISSING_TYPE');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('warning');
  });

  it('reports JSONLD_EMPTY_FIELDS for known type with missing required fields', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
    })));
    const findings = await auditStructuredData(ctx);

    const empty = findings.find((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty).toBeDefined();
    expect(empty!.severity).toBe('warning');
    expect(empty!.details?.missingFields).toEqual(['headline', 'author']);
  });

  it('reports JSONLD_EMPTY_FIELDS when required field is empty string', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: '',
    })));
    const findings = await auditStructuredData(ctx);

    const empty = findings.find((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty).toBeDefined();
    expect(empty!.details?.missingFields).toEqual(['name']);
  });

  it('reports JSONLD_EMPTY_FIELDS when required field is empty array', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [],
    })));
    const findings = await auditStructuredData(ctx);

    const empty = findings.find((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty).toBeDefined();
    expect(empty!.details?.missingFields).toEqual(['itemListElement']);
  });

  it('returns pass finding for valid structured data', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Acme Inc',
    })));
    const findings = await auditStructuredData(ctx);

    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
    expect(pass!.details?.types).toEqual(['Organization']);
  });

  it('handles multiple JSON-LD blocks', async () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Test', url: 'https://example.com' })}</script>
      <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' })}</script>
    </head><body></body></html>`;
    const ctx = makeCtx(html);
    const findings = await auditStructuredData(ctx);

    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
    expect(pass!.details?.types).toEqual(['WebSite', 'Organization']);
  });

  it('handles JSON-LD arrays', async () => {
    const ctx = makeCtx(wrap(JSON.stringify([
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Test', url: 'https://example.com' },
      { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' },
    ])));
    const findings = await auditStructuredData(ctx);

    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
    expect(pass!.details?.types).toEqual(['WebSite', 'Organization']);
  });

  it('does not report empty fields for unknown @type', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SomeCustomType',
    })));
    const findings = await auditStructuredData(ctx);

    const empty = findings.find((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty).toBeUndefined();

    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
  });

  it('sets ctx.html after processing', async () => {
    const html = wrap(JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Test', url: 'https://example.com' }));
    const ctx = makeCtx(html);
    await auditStructuredData(ctx);

    expect(ctx.html).toBe(html);
  });

  it('skips empty script tags', async () => {
    const html = `<html><head>
      <script type="application/ld+json">   </script>
      <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Test', url: 'https://example.com' })}</script>
    </head><body></body></html>`;
    const ctx = makeCtx(html);
    const findings = await auditStructuredData(ctx);

    const invalid = findings.find((f) => f.code === 'JSONLD_INVALID_JSON');
    expect(invalid).toBeUndefined();

    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
  });
});
