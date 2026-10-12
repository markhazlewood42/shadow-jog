import { describe, expect, it } from 'vitest';
import { clearLive } from '../src/server/publish/clear-live';
import { Secret } from '../src/server/publish/secret';
import { TOKEN, fakeHttp, response } from './publish-helpers';

// `main.ts --clear-live` (used by `--stop`): one DEL of the key `live`, bounded in time, never throwing. A fake network only.

const settings = { upstashUrl: 'https://eu-1.upstash.io', token: new Secret(TOKEN), hostedUrl: 'https://cc.example.vercel.app' };

describe('clearLive', () => {
  it('sends one DEL live with the token and says that the key was removed', async () => {
    const net = fakeHttp(response(200, '{"result":1}'));
    const logs: string[] = [];
    expect(await clearLive(settings, (message) => logs.push(message), net.http)).toBe(true);
    expect(net.calls).toHaveLength(1);
    expect(JSON.parse(net.calls[0]?.request.body ?? '[]')).toEqual(['DEL', 'live']);
    expect(net.calls[0]?.request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(logs).toEqual(['the live key was removed']);
  });

  it('logs a failure without the token and gives false', async () => {
    const net = fakeHttp(response(500));
    const logs: string[] = [];
    expect(await clearLive(settings, (message) => logs.push(message), net.http)).toBe(false);
    expect(logs.join('\n')).toContain('could not be removed');
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('gives up after the time limit when the store never answers', async () => {
    const hang = () => new Promise<never>(() => {});
    const logs: string[] = [];
    const started = Date.now();
    expect(await clearLive(settings, (message) => logs.push(message), hang, 100)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(logs.join('\n')).toContain('timed out');
  });
});
