import { describe, expect, it } from 'vitest';
import { buildCopyText, downloadName } from '../src/web/docs/copyText';

// The text that the Copy button puts on the clipboard, and the name that the Download button gives the file
// (revision 2, design 5.7). Both are pure functions, so no page and no network are needed.

const SOURCE = '---\ntitle: Engine decisions\n---\n# Engine decisions\r\n\r\nText with   spaces,\n\n\ttabs and a last line with no end';

describe('the copy text', () => {
  it('copy text has a two-line header and the file text as it is', () => {
    const text = buildCopyText({ title: 'Engine decisions', id: 'docs/engine/decisions.md', githubRepo: 'owner/repo', source: SOURCE });
    // Line 1 is the title. Line 2 is the repo path and its GitHub address. Then one blank line. Then the file, untouched.
    expect(text).toBe(`Engine decisions\ndocs/engine/decisions.md https://github.com/owner/repo/blob/main/docs/engine/decisions.md\n\n${SOURCE}`);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Engine decisions');
    expect(lines[1]).toBe('docs/engine/decisions.md https://github.com/owner/repo/blob/main/docs/engine/decisions.md');
    expect(lines[2]).toBe('');
    // The frontmatter is in the text.
    expect(lines[3]).toBe('---');
    // A file that ends in a new line, and one that is empty, are not changed either.
    expect(buildCopyText({ title: 'T', id: 'status.md', githubRepo: 'o/r', source: 'a\n' }).endsWith('\n\na\n')).toBe(true);
    expect(buildCopyText({ title: 'T', id: 'status.md', githubRepo: 'o/r', source: '' })).toBe('T\nstatus.md https://github.com/o/r/blob/main/status.md\n\n');
  });

  it('copy text keeps the header to two lines, and writes an address that works for a path with a space', () => {
    const text = buildCopyText({ title: 'A title\nover two lines', id: 'docs/other doc.md', githubRepo: 'o/r', source: 'body' });
    expect(text.split('\n').slice(0, 4)).toEqual(['A title over two lines', 'docs/other doc.md https://github.com/o/r/blob/main/docs/other%20doc.md', '', 'body']);
  });
});

describe('the download name', () => {
  it('download name is the file name of the doc', () => {
    expect(downloadName('docs/engine/decisions.md')).toBe('decisions.md');
    expect(downloadName('status.md')).toBe('status.md');
    expect(downloadName('docs/a/b/c/other doc.md')).toBe('other doc.md');
  });
});
