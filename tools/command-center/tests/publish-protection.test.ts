import { describe, expect, it } from 'vitest';
import { checkProtection } from '../src/server/publish/protection';
import { fakeHttp, response } from './publish-helpers';

const HOST = 'https://cc.example.vercel.app';

describe('the protection verdict', () => {
  it('401 is protected', async () => {
    const { http } = fakeHttp(response(401));
    expect((await checkProtection(http, HOST)).kind).toBe('protected');
  });

  it.each([302, 303, 307, 308])('a %s redirect to the Vercel login is protected', async (status) => {
    const { http } = fakeHttp(response(status, '', 'https://vercel.com/sso-api?url=https%3A%2F%2Fcc.example.vercel.app%2Fapi%2Flive'));
    expect((await checkProtection(http, HOST)).kind).toBe('protected');
  });

  it('a redirect to a Vercel subdomain login is protected', async () => {
    const { http } = fakeHttp(response(302, '', 'https://login.vercel.com/login?next=%2Fx'));
    expect((await checkProtection(http, HOST)).kind).toBe('protected');
  });

  it('a redirect to some other host is NOT proof of protection (unknown), so it never unlocks publishing', async () => {
    const { http } = fakeHttp(response(302, '', 'https://evil.example.com/vercel.com'));
    expect((await checkProtection(http, HOST)).kind).toBe('unknown');
    const same = fakeHttp(response(301, '', '/api/live/'));
    expect((await checkProtection(same.http, HOST)).kind).toBe('unknown');
    const none = fakeHttp(response(302));
    expect((await checkProtection(none.http, HOST)).kind).toBe('unknown');
  });

  it('a look-alike host (vercel.com.evil.example) is not the Vercel login', async () => {
    const { http } = fakeHttp(response(302, '', 'https://vercel.com.evil.example/login'));
    expect((await checkProtection(http, HOST)).kind).toBe('unknown');
  });

  // F8: a redirect counts only when it is https, on vercel.com, and a login or SSO path.
  it.each([
    ['the marketing page', 'https://vercel.com/'],
    ['the marketing page without a slash', 'https://vercel.com'],
    ['a pricing page', 'https://vercel.com/pricing'],
    ['a project transfer page', 'https://vercel.com/account/transfer?id=abc'],
    ['a dashboard page', 'https://vercel.com/dashboard'],
    ['a docs host', 'https://docs.vercel.com/docs'],
    ['plain http, even to the login path', 'http://vercel.com/login'],
    ['a path that only starts like a login word', 'https://vercel.com/loginfo'],
  ])('F8: a redirect to %s is unknown', async (_label, location) => {
    const { http } = fakeHttp(response(307, '', location));
    expect((await checkProtection(http, HOST)).kind).toBe('unknown');
  });

  it.each([
    'https://vercel.com/login',
    'https://vercel.com/login?next=%2Fapi%2Flive',
    'https://vercel.com/sso',
    'https://vercel.com/sso-api?url=https%3A%2F%2Fcc.example.vercel.app%2Fapi%2Flive',
    'https://vercel.com/sso/start',
    'https://vercel.com/some/path?next=%2Fx',
    'https://vercel.com/some/path?redirect=%2Fx',
    'https://vercel.com/some/path?redirectUrl=%2Fx',
    'https://login.vercel.com/login',
  ])('F8: a redirect to %s is protected', async (location) => {
    const { http } = fakeHttp(response(307, '', location));
    expect((await checkProtection(http, HOST)).kind).toBe('protected');
  });

  it('F8: the unknown answer names the place of the redirect without its query', async () => {
    const { http } = fakeHttp(response(307, '', 'https://vercel.com/pricing?secret=1'));
    const verdict = await checkProtection(http, HOST);
    expect(verdict.why).toContain('https://vercel.com/pricing');
    expect(verdict.why).not.toContain('secret=1');
  });

  it('200 with a JSON body is PUBLIC', async () => {
    const { http } = fakeHttp(response(200, JSON.stringify({ reporter: { state: 'online' }, live: { sessions: [] } })));
    expect((await checkProtection(http, HOST)).kind).toBe('public');
    const empty = fakeHttp(response(200, '{}'));
    expect((await checkProtection(empty.http, HOST)).kind).toBe('public');
  });

  it('200 with a body that is not JSON is unknown', async () => {
    const { http } = fakeHttp(response(200, '<html>login</html>'));
    expect((await checkProtection(http, HOST)).kind).toBe('unknown');
  });

  it.each([
    ['500', response(500)],
    ['503', response(503)],
    ['404', response(404)],
    ['403', response(403)],
    ['a network error', new TypeError('fetch failed')],
    ['a timeout', Object.assign(new Error('x'), { name: 'TimeoutError' })],
  ])('%s is unknown, and never throws', async (_label, answer) => {
    const { http } = fakeHttp(answer);
    expect((await checkProtection(http, HOST)).kind).toBe('unknown');
  });

  it('asks <hosted address>/api/live with GET and an Accept header only', async () => {
    const { http, calls } = fakeHttp(response(401));
    await checkProtection(http, HOST);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${HOST}/api/live`);
    expect(calls[0]?.request.method).toBe('GET');
    expect(Object.keys(calls[0]?.request.headers ?? {})).toEqual(['Accept']);
    expect(calls[0]?.request.body).toBeUndefined();
  });
});
