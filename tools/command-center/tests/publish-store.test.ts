import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { HOSTED_URL_VAR, TOKEN_VAR, UPSTASH_URL_VAR, loadSettings, parseEnvFile } from '../src/server/publish/env-file';
import { Secret } from '../src/server/publish/secret';
import { LIVE_TTL_SECONDS, UpstashError, createLiveStore } from '../src/server/publish/upstash';
import { TOKEN, fakeHttp, response } from './publish-helpers';

const GOOD_FILE = `# the reporter settings
${UPSTASH_URL_VAR}=https://eu-1.upstash.io/
${TOKEN_VAR}="${TOKEN}"
export ${HOSTED_URL_VAR}=https://cc.example.vercel.app
`;

describe('the settings file', () => {
  it('uses the variable names of the hosted functions (KV_REST_API_URL) and the read-write token name that the functions refuse to hold', () => {
    expect(UPSTASH_URL_VAR).toBe('KV_REST_API_URL');
    expect(TOKEN_VAR).toBe('KV_REST_API_TOKEN');
    expect(HOSTED_URL_VAR).toBe('CC_HOSTED_URL');
  });

  it('reads the three values, trims quotes and the path of the address', () => {
    const result = loadSettings('x', () => GOOD_FILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.upstashUrl).toBe('https://eu-1.upstash.io');
    expect(result.settings.hostedUrl).toBe('https://cc.example.vercel.app');
    expect(result.settings.token.reveal()).toBe(TOKEN);
  });

  it('parses comments, blank lines and CRLF', () => {
    expect(parseEnvFile('# c\r\n\r\nA=1\r\nB = "two"\r\n')).toEqual({ A: '1', B: 'two' });
  });

  it('says "missing-file" without a file, and does not throw', () => {
    const missing = loadSettings('x', () => {
      throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    });
    expect(missing).toMatchObject({ ok: false, reason: 'missing-file' });
  });

  it('names the variables that are missing, never a value', () => {
    const result = loadSettings('x', () => `${UPSTASH_URL_VAR}=https://a.upstash.io\n${TOKEN_VAR}=${TOKEN}\n`);
    expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
    expect(JSON.stringify(result)).toContain(HOSTED_URL_VAR);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('refuses an address that is not https (a token must not travel in the clear), and keeps the token out of the message', () => {
    const result = loadSettings('x', () => `${UPSTASH_URL_VAR}=http://a.upstash.io\n${TOKEN_VAR}=${TOKEN}\n${HOSTED_URL_VAR}=https://cc.example.vercel.app\n`);
    expect(result).toMatchObject({ ok: false, reason: 'bad-url' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(loadSettings('x', () => GOOD_FILE.replace('https://cc.example', 'ftp://cc.example')).ok).toBe(false);
  });
});

describe('the Secret', () => {
  it('prints [hidden] in every common way to show a value', () => {
    const secret = new Secret(TOKEN);
    expect(String(secret)).toBe('[hidden]');
    expect(`${secret}`).toBe('[hidden]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[hidden]"}');
    expect(inspect(secret)).toBe('[hidden]');
    expect(inspect({ settings: { secret } }, { depth: 5 })).not.toContain(TOKEN);
    expect(secret.reveal()).toBe(TOKEN);
  });
});

describe('the live store', () => {
  const secret = new Secret(TOKEN);

  it('sends SET live <json> EX 600 as a POST body with the bearer token', async () => {
    const { http, calls } = fakeHttp(response(200, '{"result":"OK"}'));
    await createLiveStore({ url: 'https://eu-1.upstash.io', token: secret, http }).setLive('{"a":1}');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://eu-1.upstash.io');
    expect(calls[0]?.request.method).toBe('POST');
    expect(calls[0]?.request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]?.request.body as string)).toEqual(['SET', 'live', '{"a":1}', 'EX', String(LIVE_TTL_SECONDS)]);
    expect(LIVE_TTL_SECONDS).toBe(600);
  });

  it('sends DEL live to remove the key', async () => {
    const { http, calls } = fakeHttp(response(200, '{"result":1}'));
    await createLiveStore({ url: 'https://eu-1.upstash.io', token: secret, http }).deleteLive();
    expect(JSON.parse(calls[0]?.request.body as string)).toEqual(['DEL', 'live']);
  });

  it.each([
    ['a 401', response(401, `{"error":"bad token ${TOKEN}"}`)],
    ['a 500', response(500, 'boom')],
    ['a body that is not JSON', response(200, 'oops')],
    ['no result', response(200, '{}')],
    ['a result that is not OK', response(200, '{"result":"NOPE"}')],
    ['a network error', new TypeError(`fetch failed for https://eu-1.upstash.io with ${TOKEN}`)],
  ])('throws an UpstashError for %s, and the message holds neither the token nor the answer text', async (_label, answer) => {
    const { http } = fakeHttp(answer);
    const error = await createLiveStore({ url: 'https://eu-1.upstash.io', token: secret, http }).setLive('{}').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstashError);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain('eu-1.upstash.io');
  });
});
