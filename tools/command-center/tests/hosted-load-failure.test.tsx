// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The hosted page loads its data layer (src/web/hosted/store.ts) as a file of its own. That file can fail to load: a deploy replaced it while the tab was open, or the
// network failed. The page must say that the connection is off, log the reason once, and never throw. In this test the loader of the store rejects (api.hostedLoaders).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Now page file brings the glass (PlasmaUI), which needs a renderer that a test document has not. This test only draws the Live label from that file.
vi.mock('../src/web/now/GlassPanel', () => ({ GlassPanel: () => null }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a data layer that cannot be loaded', () => {
  it('hosted: says that the connection is offline, logs the reason once, and the Live label shows "off"', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(String(url));
      throw new Error('no network in this test');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = await import('../src/web/api');
    // The file of the store cannot be loaded.
    api.hostedLoaders.store = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));

    const seen: string[] = [];
    const stopFirst = api.subscribeEvents((event) => seen.push(event.type === 'connection' ? `connection:${event.state}` : event.type));
    const stopSecond = api.subscribeEvents(() => {});
    await vi.waitFor(() => expect(seen).toContain('connection:offline'));
    // Two listeners, one failure, one line in the log.
    expect(logged.mock.calls.filter((call) => String(call[0]).includes('data layer of the hosted page'))).toHaveLength(1);
    // Stopping after the failure does not throw.
    expect(() => {
      stopFirst();
      stopSecond();
    }).not.toThrow();

    // The Live label of the Now page says "off".
    const { LiveStatus } = await import('../src/web/now/NowPage');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<LiveStatus />);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Live: off'));
    act(() => root.unmount());
    host.remove();
    // Nothing polled: there was no store to poll.
    expect(fetched).toEqual([]);
  });
});
