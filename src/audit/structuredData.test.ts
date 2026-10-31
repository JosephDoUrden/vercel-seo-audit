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

  it('accepts a top-level @graph whose nodes all carry @type', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Person', name: 'Jane Doe' },
        { '@type': 'WebSite', name: 'Test', url: 'https://example.com' },
      ],
    })));
    const findings = await auditStructuredData(ctx);

    expect(findings.find((f) => f.code === 'JSONLD_MISSING_TYPE')).toBeUndefined();
    expect(findings.find((f) => f.code === 'JSONLD_MISSING_CONTEXT')).toBeUndefined();
    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass!.details?.types).toEqual(['Person', 'WebSite']);
  });

  it('checks required fields on @graph nodes', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebSite', name: 'Test' }],
    })));
    const findings = await auditStructuredData(ctx);

    const empty = findings.find((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty!.details?.missingFields).toEqual(['url']);
  });

  it('reports JSONLD_MISSING_TYPE for an untyped @graph node, naming its index', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Person', name: 'Jane Doe' },
        { name: 'Test', url: 'https://example.com' },
      ],
    })));
    const findings = await auditStructuredData(ctx);

    const missing = findings.filter((f) => f.code === 'JSONLD_MISSING_TYPE');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toBe('JSON-LD @graph node 1 missing @type');
    expect(missing[0].details).toEqual({ graphIndex: 1 });
    expect(findings.find((f) => f.severity === 'pass')!.details?.types).toEqual(['Person']);
  });

  it('reports JSONLD_MISSING_TYPE for a block with neither @type nor a usable @graph', async () => {
    for (const block of [
      { '@context': 'https://schema.org', name: 'Test' },
      { '@context': 'https://schema.org', '@graph': [] },
      { '@context': 'https://schema.org', '@graph': { '@type': 'Person' } },
    ]) {
      const findings = await auditStructuredData(makeCtx(wrap(JSON.stringify(block))));
      const missing = findings.find((f) => f.code === 'JSONLD_MISSING_TYPE');
      expect(missing!.message).toBe('JSON-LD block missing @type');
    }
  });

  it('splits an @type array into its member types', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': ['Person', 'Organization'],
    })));
    const findings = await auditStructuredData(ctx);

    expect(findings.find((f) => f.severity === 'pass')!.details?.types).toEqual(['Person', 'Organization']);
    const empty = findings.filter((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty).toHaveLength(1);
    expect(empty[0].details).toEqual({ type: 'Organization', missingFields: ['name'] });
  });

  it('checks required fields for every listed type on an @graph node', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Test', url: 'https://example.com' },
        { '@type': ['Organization', 'LocalBusiness'] },
      ],
    })));
    const findings = await auditStructuredData(ctx);

    expect(findings.find((f) => f.severity === 'pass')!.details?.types).toEqual([
      'WebSite',
      'Organization',
      'LocalBusiness',
    ]);
    const empty = findings.filter((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty.map((f) => f.details)).toEqual([
      { type: 'Organization', missingFields: ['name'], graphIndex: 1 },
      { type: 'LocalBusiness', missingFields: ['name', 'address'], graphIndex: 1 },
    ]);
  });

  it('includes graphIndex so two @graph nodes of the same type can be told apart', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Test', url: 'https://example.com' },
        { '@type': 'WebSite', name: 'Test' },
      ],
    })));
    const findings = await auditStructuredData(ctx);

    const empty = findings.filter((f) => f.code === 'JSONLD_EMPTY_FIELDS');
    expect(empty).toHaveLength(1);
    expect(empty[0].details).toEqual({ type: 'WebSite', missingFields: ['url'], graphIndex: 1 });
  });

  it('drops non-string members of an @type array', async () => {
    const ctx = makeCtx(wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': ['Organization', 42, null, { '@id': 'x' }],
      name: 'Acme',
    })));
    const findings = await auditStructuredData(ctx);

    expect(findings.find((f) => f.code === 'JSONLD_MISSING_TYPE')).toBeUndefined();
    expect(findings.find((f) => f.code === 'JSONLD_EMPTY_FIELDS')).toBeUndefined();
    expect(findings.find((f) => f.severity === 'pass')!.details?.types).toEqual(['Organization']);
  });

  it('reports JSONLD_MISSING_TYPE when @type has no usable string', async () => {
    for (const type of [[], [42, null], 42, { name: 'Person' }]) {
      const findings = await auditStructuredData(makeCtx(wrap(JSON.stringify({
        '@context': 'https://schema.org',
        '@type': type,
      }))));
      expect(findings.find((f) => f.code === 'JSONLD_MISSING_TYPE')!.message).toBe('JSON-LD block missing @type');
      expect(findings.find((f) => f.severity === 'pass')).toBeUndefined();
    }
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
