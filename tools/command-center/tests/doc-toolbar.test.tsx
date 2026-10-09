// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyForLlm, saveAsFile } from '../src/web/docs/DocToolbar';

// The two helpers behind the Copy and Download buttons of a doc. They are plain async functions, so no button needs to be pressed.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveAsFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('F2: the Blob URL is revoked after a delay, not at once', () => {
    const create = vi.fn(() => 'blob:fake');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    saveAsFile('text', 'x.md');
    expect(create).toHaveBeenCalledOnce();
    // Firefox and Safari start the download after click() returns: the URL must still be alive.
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});

describe('copyForLlm', () => {
  const doc = { id: 'docs/x.md', slug: 'x', title: 'The X doc' };

  function stub(health: 'ok' | 'fail', source: 'ok' | 'fail'): ReturnType<typeof vi.fn> {
    const write = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/source')) return source === 'ok' ? new Response('# The X doc\nBody', { status: 200 }) : new Response('no', { status: 500 });
        if (health === 'fail') throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ ok: true, githubRepo: 'o/r' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    return write;
  }

  it('F3: Copy for LLM still copies when /api/health fails', async () => {
    const write = stub('fail', 'ok');
    await copyForLlm(doc);
    expect(write).toHaveBeenCalledWith('The X doc\ndocs/x.md\n\n# The X doc\nBody');
  });

  it('keeps the address in the header when /api/health answers, and fails when the doc text cannot be fetched', async () => {
    const write = stub('ok', 'ok');
    await copyForLlm(doc);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('docs/x.md https://github.com/o/r/blob/main/docs/x.md'));
    stub('ok', 'fail');
    await expect(copyForLlm(doc)).rejects.toThrow();
  });
});
