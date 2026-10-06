import { describe, expect, it } from 'vitest';
import { docApiPath, docPath, slugFromPath } from '../src/web/docs/paths';

// The page and the server both name a doc by its slug (`engine/decisions`). These helpers turn a slug
// into the address of its page and the address of its data, and back.

describe('docPath', () => {
  it('puts the slug after /docs/', () => {
    expect(docPath('engine/decisions')).toBe('/docs/engine/decisions');
    expect(docPath('README')).toBe('/docs/README');
    expect(docPath('PHASE-0.2')).toBe('/docs/PHASE-0.2');
  });

  it('percent-encodes each segment and keeps the slashes between them', () => {
    expect(docPath('a b/ü?#')).toBe('/docs/a%20b/%C3%BC%3F%23');
  });

  it('adds a heading id as a hash, encoded', () => {
    expect(docPath('engine/decisions', 'e12')).toBe('/docs/engine/decisions#e12');
    expect(docPath('a', 'über uns')).toBe('/docs/a#%C3%BCber%20uns');
    expect(docPath('a', '')).toBe('/docs/a');
  });
});

describe('docApiPath', () => {
  it('is the same address under /api, so the server finds the slug after /api/docs/', () => {
    expect(docApiPath('engine/decisions')).toBe('/api/docs/engine/decisions');
    expect(docApiPath('a b')).toBe('/api/docs/a%20b');
  });
});

describe('slugFromPath', () => {
  it('gives the slug of a doc page, and null for the overview', () => {
    expect(slugFromPath('/docs')).toBeNull();
    expect(slugFromPath('/docs/')).toBeNull();
    expect(slugFromPath('/docs/engine/decisions')).toBe('engine/decisions');
    expect(slugFromPath('/docs/engine/decisions/')).toBe('engine/decisions');
  });

  it('decodes each segment', () => {
    expect(slugFromPath('/docs/a%20b/%C3%BC')).toBe('a b/ü');
  });

  it('keeps a segment that is not valid percent-encoding as it was written', () => {
    expect(slugFromPath('/docs/100%/x')).toBe('100%/x');
  });

  it('gives null for an address that is not under /docs', () => {
    expect(slugFromPath('/')).toBeNull();
    expect(slugFromPath('/documents/x')).toBeNull();
    expect(slugFromPath('/decisions/12')).toBeNull();
  });

  it('is the opposite of docPath', () => {
    for (const slug of ['README', 'engine/decisions', 'a b/ü?#', 'PHASE-0.2', 'deep/er/still']) {
      expect(slugFromPath(docPath(slug))).toBe(slug);
    }
  });
});
