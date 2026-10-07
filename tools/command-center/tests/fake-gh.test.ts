import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clearGhCalls, createFakeGh, readGhCalls, resetGh, setGhMode } from '../e2e/fake-gh';
import { createRunner } from '../src/server/runner';
import { makeTestConfig } from './helpers';

// The fake gh is what the end-to-end tests of later tasks stand on, so it is tested like code.

const dir = mkdtempSync(join(tmpdir(), 'cc-fake-gh-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = makeTestConfig();
const REPO = config.githubRepo;
const where = { cwd: config.repoRoot, timeoutMs: 5000 };
const fake = createFakeGh(dir);
const gh = (...args: string[]) => fake('gh', args, where);

describe('the fake gh', () => {
  beforeEach(() => resetGh(dir));

  it('answers like a signed-in gh with empty data when no mode is set, and records each call', async () => {
    expect(await gh('auth', 'status')).toMatchObject({ code: 0 });
    expect(await gh('pr', 'list', '--repo', REPO, '--json', 'number')).toEqual({ code: 0, stdout: '[]', stderr: '' });
    expect(await gh('issue', 'list', '--repo', REPO)).toEqual({ code: 0, stdout: '[]', stderr: '' });
    expect(await gh('issue', 'view', '--repo', REPO, '7')).toEqual({ code: 0, stdout: '{}', stderr: '' });
    expect(await gh('api', `repos/${REPO}/issues/7/events`)).toEqual({ code: 0, stdout: '[]', stderr: '' });
    expect(await gh('issue', 'comment', '--repo', REPO, '7', '--body', 'x')).toMatchObject({ code: 0 });

    const calls = readGhCalls(dir);
    expect(calls.map((c) => c.args.slice(0, 2).join(' '))).toEqual(['auth status', 'pr list', 'issue list', 'issue view', 'api repos/octo-owner/octo-repo/issues/7/events', 'issue comment']);
    expect(calls[0]).toMatchObject({ args: ['auth', 'status'], cwd: config.repoRoot, mode: 'ok', code: 0 });
    expect(Number.isNaN(Date.parse(calls[0]?.at ?? ''))).toBe(false);
  });

  it('answers with the replies a test sets, the most specific key first', async () => {
    setGhMode({
      mode: 'ok',
      replies: {
        'pr list': { stdout: '[{"number":1}]' },
        'issue view': { stdout: '{"title":"any issue"}' },
        'issue view 7': { stdout: '{"title":"seven"}' },
        'api events 7': { stdout: '[{"event":"labeled"}]' },
        'issue edit': { code: 1, stderr: 'nope' },
      },
    }, dir);
    expect((await gh('pr', 'list', '--repo', REPO)).stdout).toBe('[{"number":1}]');
    expect((await gh('issue', 'view', '--repo', REPO, '7')).stdout).toBe('{"title":"seven"}');
    expect((await gh('issue', 'view', '--repo', REPO, '8')).stdout).toBe('{"title":"any issue"}');
    expect((await gh('api', `repos/${REPO}/issues/7/events`, '--paginate')).stdout).toBe('[{"event":"labeled"}]');
    expect(await gh('issue', 'edit', '--repo', REPO, '7', '--add-label', 'decided', '--remove-label', 'decision')).toEqual({ code: 1, stdout: '', stderr: 'nope' });
  });

  it('signed-out: every call fails the way gh does when you are not logged in', async () => {
    setGhMode({ mode: 'signed-out' }, dir);
    const status = await gh('auth', 'status');
    expect(status.code).toBe(1);
    expect(status.stderr).toContain('not logged into any GitHub hosts');
    const other = await gh('pr', 'list', '--repo', REPO);
    expect(other.code).toBe(4);
    expect(other.stderr).toContain('gh auth login');
  });

  it('missing: gh is not installed, as the runner reports it (code 127, command not found)', async () => {
    setGhMode({ mode: 'missing' }, dir);
    expect(await gh('auth', 'status')).toEqual({ code: 127, stdout: '', stderr: 'gh: command not found' });
  });

  it('offline: gh cannot reach GitHub', async () => {
    setGhMode({ mode: 'offline' }, dir);
    const result = await gh('pr', 'list', '--repo', REPO);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('error connecting to api.github.com');
  });

  it('timeout: the call ends as the runner reports a timeout (code 124) and names the limit it was given', async () => {
    setGhMode({ mode: 'timeout' }, dir);
    const result = await fake('gh', ['pr', 'list', '--repo', REPO], { cwd: config.repoRoot, timeoutMs: 4321 });
    expect(result.code).toBe(124);
    expect(result.stderr).toContain('timed out after 4321 ms');
  });

  it('write-fails: only the named write step fails, the others work, and every call is recorded', async () => {
    const comment = ['issue', 'comment', '--repo', REPO, '7', '--body', 'Decision: A'];
    const edit = ['issue', 'edit', '--repo', REPO, '7', '--add-label', 'decided', '--remove-label', 'decision'];
    const close = ['issue', 'close', '--repo', REPO, '7'];
    for (const step of ['comment', 'edit', 'close'] as const) {
      setGhMode({ mode: 'write-fails', step }, dir);
      clearGhCalls(dir);
      const results = [await gh(...comment), await gh(...edit), await gh(...close)];
      const failed = results.map((r) => r.code !== 0);
      expect(failed, `step ${step}`).toEqual([step === 'comment', step === 'edit', step === 'close']);
      const failedAt = failed.indexOf(true);
      expect(results[failedAt]?.stderr, `step ${step}`).not.toBe('');
      // A read still works while a write is set to fail.
      expect((await gh('pr', 'list', '--repo', REPO)).code).toBe(0);
      // Every call, the failed one too, is on the record, in order.
      expect(readGhCalls(dir).map((c) => c.args)).toEqual([comment, edit, close, ['pr', 'list', '--repo', REPO]]);
      expect(readGhCalls(dir)[failedAt]?.code).not.toBe(0);
    }
  });

  it('reads the mode file at every call, so a test can change it between calls', async () => {
    expect((await gh('auth', 'status')).code).toBe(0);
    setGhMode({ mode: 'signed-out' }, dir);
    expect((await gh('auth', 'status')).code).toBe(1);
    setGhMode({ mode: 'ok' }, dir);
    expect((await gh('auth', 'status')).code).toBe(0);
    expect(readGhCalls(dir).map((c) => c.mode)).toEqual(['ok', 'signed-out', 'ok']);
  });

  it('clearGhCalls empties the record and resetGh also returns to the ok mode', async () => {
    setGhMode({ mode: 'offline' }, dir);
    await gh('auth', 'status');
    expect(readGhCalls(dir)).toHaveLength(1);
    clearGhCalls(dir);
    expect(readGhCalls(dir)).toEqual([]);
    expect((await gh('auth', 'status')).code).toBe(1); // still offline
    resetGh(dir);
    expect(readGhCalls(dir)).toEqual([]);
    expect((await gh('auth', 'status')).code).toBe(0);
  });

  it('fails loudly on a mode file it cannot read, instead of answering as if all were well', async () => {
    writeFileSync(join(dir, 'gh-mode.json'), '{ "mode": "sleepy" }');
    await expect(gh('auth', 'status')).rejects.toThrow(/gh-mode\.json/);
    writeFileSync(join(dir, 'gh-mode.json'), 'not json at all');
    await expect(gh('auth', 'status')).rejects.toThrow(/gh-mode\.json/);
    writeFileSync(join(dir, 'gh-mode.json'), '{ "mode": "write-fails" }'); // the step is missing
    await expect(gh('auth', 'status')).rejects.toThrow(/step/);
  });

  it('sits under the real runner, so the allow-list still applies and the recorded calls hold the pinned --repo', async () => {
    const runner = createRunner(config, (cmd, args, o) => (cmd === 'gh' ? fake(cmd, args, o) : Promise.reject(new Error('git is not faked here'))));
    await runner('gh', ['pr', 'list', '--json', 'number']);
    await expect(runner('gh', ['pr', 'merge', '3'])).rejects.toThrow(/refused/i);
    expect(readGhCalls(dir).map((c) => c.args)).toEqual([['pr', 'list', '--repo', REPO, '--json', 'number']]);
  });
});
