import { describe, expect, it, vi } from 'vitest';
import { splitFrontmatter } from '../src/server/docs/frontmatter';
import { render } from './doc-helpers';

// A doc opens with a block of `key: value` lines between two `---` lines. splitFrontmatter cuts
// that block off and reads it. It never throws: a problem comes back in `error`, and the rest of
// the doc is still the body, so the page can show the doc and say what is wrong with its header.

describe('splitFrontmatter', () => {
  it('reads the key: value lines between two --- lines and returns what follows as the body', () => {
    const result = splitFrontmatter(
      '---\ntype: design\ntitle: "A: B"\nstatus: approved 2026-10-05\ncreated: 2026-10-05\ntags: [one, two]\n---\n# Heading\n\nBody.\n',
    );
    expect(result).toEqual({
      data: { type: 'design', title: 'A: B', status: 'approved 2026-10-05', created: '2026-10-05', tags: ['one', 'two'] },
      body: '# Heading\n\nBody.\n',
      error: null,
    });
  });

  it('keeps a date as the text that was written, not a Date object', () => {
    const { data } = splitFrontmatter('---\nupdated: 2026-10-05\nat: 2026-10-05T10:00:00Z\n---\n');
    expect(data).toEqual({ updated: '2026-10-05', at: '2026-10-05T10:00:00Z' });
  });

  it('a source that does not start with a --- line has no frontmatter and no error', () => {
    for (const src of [
      '# Title\n\nText\n',
      '\n---\na: 1\n---\nBody\n', // a blank line first: not at the very top
      '----\na: 1\n----\nBody\n', // four dashes are a thematic break, not a fence
      'Text\n\n---\n\nMore text\n', // a thematic break in the middle
      '',
    ]) {
      expect(splitFrontmatter(src), JSON.stringify(src)).toEqual({ data: {}, body: src, error: null });
    }
  });

  it('an empty block, and a block of only comments, give empty data and no error', () => {
    expect(splitFrontmatter('---\n---\nBody\n')).toEqual({ data: {}, body: 'Body\n', error: null });
    expect(splitFrontmatter('---\n# nothing here yet\n---\nBody\n')).toEqual({ data: {}, body: 'Body\n', error: null });
  });

  it('reads CRLF and lone CR line breaks, trailing spaces on the fence lines and a leading byte order mark', () => {
    expect(splitFrontmatter('\uFEFF---  \r\ntitle: Win\r\n---\t\r\nBody\r\nMore\r\n')).toEqual({
      data: { title: 'Win' },
      body: 'Body\nMore\n',
      error: null,
    });
    expect(splitFrontmatter('---\rtitle: Old Mac\r---\rBody\r')).toEqual({ data: { title: 'Old Mac' }, body: 'Body\n', error: null });
    // The byte order mark goes even when there is no frontmatter, or the first heading would not be a heading.
    expect(splitFrontmatter('\uFEFF# Title\n')).toEqual({ data: {}, body: '# Title\n', error: null });
  });

  it('a --- line later in the body stays in the body', () => {
    expect(splitFrontmatter('---\na: 1\n---\nText\n\n---\n\nMore\n').body).toBe('Text\n\n---\n\nMore\n');
  });

  it('a block that never closes is an error, and the whole source stays as the body', () => {
    const src = '---\ntitle: Never closed\n\n# Heading\n\nText\n';
    const result = splitFrontmatter(src);
    expect(result.data).toEqual({});
    expect(result.body).toBe(src);
    expect(result.error).toMatch(/does not end with a --- line/);
  });

  it('bad YAML: the doc renders and frontmatterError is set', () => {
    const src = '---\ntitle: Foo: Bar\ntype: [unclosed\n---\n# The real title\n\nBody text.\n';
    // The split: no data, an error that names the problem and its line, and the body without the bad block.
    const result = splitFrontmatter(src);
    expect(result.data).toEqual({});
    expect(result.body).toBe('# The real title\n\nBody text.\n');
    expect(result.error).toMatch(/^Invalid YAML in the frontmatter: .+ \(line 2\)$/);
    // The whole pipeline: the same error comes out of renderDoc, and the doc still renders.
    const doc = render(src);
    expect(doc.frontmatterError).toBe(result.error);
    expect(doc.frontmatter).toEqual({});
    expect(doc.title).toBe('The real title');
    expect(doc.html).toContain('<h1 id="the-real-title">The real title</h1>');
    expect(doc.html).toContain('<p>Body text.</p>');
    expect(doc.html).not.toContain('Foo: Bar');
  });

  it('frontmatter that is a list or a single value, not key: value lines, is an error', () => {
    for (const block of ['- a\n- b\n', 'just some text\n', '42\n']) {
      const result = splitFrontmatter(`---\n${block}---\nBody\n`);
      expect(result.data, block).toEqual({});
      expect(result.body, block).toBe('Body\n');
      expect(result.error, block).toMatch(/key: value/);
    }
  });

  it('a repeated key is an error, not a silent pick of one value', () => {
    const result = splitFrontmatter('---\nstatus: draft\nstatus: approved\n---\nBody\n');
    expect(result.data).toEqual({});
    expect(result.error).toMatch(/unique \(line 3\)$/);
  });

  it('an odd but harmless header is read without a warning on the console', () => {
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const result = splitFrontmatter('---\n[x]: 1\n---\nBody\n'); // a list used as a key: the library would warn
      expect(result.error).toBeNull();
      expect(result.body).toBe('Body\n');
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it('a key named __proto__ is plain data and changes no prototype', () => {
    const result = splitFrontmatter('---\n__proto__:\n  polluted: true\n---\n');
    expect(result.error).toBeNull();
    expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('YAML tags that name code are not run, and an alias bomb is an error, not a hang or a throw', () => {
    const tagged = splitFrontmatter('---\nx: !!js/function "function () { globalThis.pwned = 1 }"\n---\n');
    expect(tagged.error).toBeNull();
    expect(typeof tagged.data.x).toBe('string');
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();

    const level = (name: string, previous: string) => `${name}: &${name} [${Array(9).fill(`*${previous}`).join(', ')}]\n`;
    const bomb = `a: &a [x, x, x, x, x, x, x, x, x]\n${level('b', 'a')}${level('c', 'b')}${level('d', 'c')}${level('e', 'd')}`;
    expect(() => splitFrontmatter(`---\n${bomb}---\nBody\n`)).not.toThrow();
    const result = splitFrontmatter(`---\n${bomb}---\nBody\n`);
    expect(result.data).toEqual({});
    expect(result.body).toBe('Body\n');
    expect(result.error).toMatch(/^Invalid YAML in the frontmatter: /);
  });
});
