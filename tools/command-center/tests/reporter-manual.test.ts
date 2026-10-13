import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { READY_MARKER, localConfig, pathsFor, prepareLocal, runLauncher, serverArgs } from '../scripts/reporter-launch.mjs';
import { ConfigError } from '../src/server/config';
import { readArgs } from '../src/server/main';
import { PACKAGE_DIR } from './helpers';

// The start by hand (the tray app): the reporter without the idle exit, one copy only, and the local server's config and page build.
// Only temporary folders and fakes. The launcher never starts a real server here.

const scratch = mkdtempSync(join(tmpdir(), 'cc-manual-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the idle exit mode of the server command line', () => {
  const paths = { config: '/x/reporter.config.json' };

  it('a start by the hook keeps the idle exit: the arguments have no --no-idle-exit', () => {
    expect(serverArgs(paths)).not.toContain('--no-idle-exit');
    expect(serverArgs(paths, false)).not.toContain('--no-idle-exit');
  });

  it('a start by hand adds --no-idle-exit after --reporter, and changes nothing else', () => {
    const manual = serverArgs(paths, true);
    expect(manual).toEqual([...serverArgs(paths), '--no-idle-exit']);
    expect(manual.indexOf('--no-idle-exit')).toBeGreaterThan(manual.indexOf('--reporter'));
  });

  it('main.ts reads --no-idle-exit only together with --reporter', () => {
    expect(readArgs(['--reporter']).idleExit).toBe(true);
    expect(readArgs(['--reporter', '--no-idle-exit']).idleExit).toBe(false);
    expect(readArgs([]).idleExit).toBe(true);
    expect(() => readArgs(['--no-idle-exit'])).toThrow(ConfigError);
  });
});

describe('runLauncher with manual', () => {
  /** Runs the whole launcher with fakes. `supervise` records the options it got and ends at once. */
  async function launch(name: string, manual: boolean | undefined) {
    const checkout = join(scratch, name);
    const paths = pathsFor(checkout);
    mkdirSync(paths.pinned, { recursive: true });
    writeFileSync(join(paths.pinned, READY_MARKER), 'x');
    const settingsFile = join(scratch, `${name}-settings.env`);
    writeFileSync(settingsFile, 'fake file made by the test\n');
    const seen: { manual?: boolean }[] = [];
    const code = await runLauncher({
      checkout,
      origin: 'o',
      settingsFile,
      ...(manual === undefined ? {} : { manual }),
      deps: {
        git: async () => ({ status: 1, stdout: '', stderr: '' }),
        install: async () => true,
        supervise: async (...args: unknown[]) => (seen.push((args[5] ?? {}) as { manual?: boolean }), 0),
      },
    });
    return { code, seen, paths };
  }

  it('passes manual to the supervisor when a person started it, and not otherwise', async () => {
    expect((await launch('manual-yes', true)).seen).toEqual([expect.objectContaining({ manual: true })]);
    expect((await launch('manual-no', undefined)).seen).toEqual([expect.objectContaining({ manual: false })]);
  });

  it('a second start while the first one runs does not start a second copy: it ends at once with code 0 and leaves the lock alone', async () => {
    const checkout = join(scratch, 'second-start');
    const paths = pathsFor(checkout);
    mkdirSync(paths.state, { recursive: true });
    const firstLock = JSON.stringify({ launcher: 424242, launcherStart: 'FIRST', server: 424243, serverStart: 'FIRST-SERVER', started: 'first' });
    writeFileSync(paths.lock, firstLock); // the lock of the running launcher: touched just now
    let supervised = 0;
    let gitCalls = 0;
    const code = await runLauncher({
      checkout,
      origin: 'o',
      manual: true,
      settingsFile: join(scratch, 'never-read.env'),
      deps: {
        git: async () => (gitCalls++, { status: 1, stdout: '', stderr: '' }),
        install: async () => true,
        supervise: async () => (supervised++, 0),
      },
    });
    expect(code).toBe(0);
    expect(supervised).toBe(0);
    expect(gitCalls).toBe(0);
    expect(readFileSync(paths.lock, 'utf8')).toBe(firstLock);
  });
});

describe('the local Command Center (port 3009)', () => {
  const original = { port: 3009, repoRoot: '../..', roots: ['../..', '../../../shadow-jog-phaser'], githubRepo: 'o/r' };

  it('localConfig points the repo root and the roots at the real checkout and keeps port 3009', () => {
    const checkout = resolve(scratch, 'real-checkout');
    const config = localConfig(original, checkout) as { port: number; repoRoot: string; roots: string[]; githubRepo: string };
    expect(config.port).toBe(3009);
    expect(config.repoRoot).toBe(checkout);
    expect(config.roots[0]).toBe(checkout);
    expect(config.githubRepo).toBe('o/r');
  });

  function prepared(name: string, ready: boolean) {
    const checkout = join(scratch, name);
    const paths = pathsFor(checkout);
    mkdirSync(paths.app, { recursive: true });
    writeFileSync(join(paths.app, 'command-center.config.json'), JSON.stringify(original));
    if (ready) writeFileSync(join(paths.pinned, READY_MARKER), 'x');
    return { checkout, paths };
  }

  it('prepareLocal writes local.config.json and builds the page with vite in the pinned copy', async () => {
    const { checkout, paths } = prepared('prepare-ok', true);
    const calls: { args: string[]; cwd: string | undefined }[] = [];
    const code = await prepareLocal(checkout, {
      run: async (_command: string, args: string[], options?: { cwd?: string }) => (calls.push({ args, cwd: options?.cwd }), { status: 0, stdout: '', stderr: '' }),
      log: () => {},
    });
    expect(code).toBe(0);
    expect(calls).toEqual([{ args: [join('node_modules', 'vite', 'bin', 'vite.js'), 'build'], cwd: paths.app }]);
    const written = JSON.parse(readFileSync(join(paths.state, 'local.config.json'), 'utf8')) as { port: number; repoRoot: string };
    expect(written.port).toBe(3009);
    expect(written.repoRoot).toBe(checkout);
  });

  it('prepareLocal gives 2 and builds nothing while the pinned copy is not ready', async () => {
    const { checkout, paths } = prepared('prepare-not-ready', false);
    let ran = 0;
    const code = await prepareLocal(checkout, { run: async () => (ran++, { status: 0, stdout: '', stderr: '' }), log: () => {} });
    expect(code).toBe(2);
    expect(ran).toBe(0);
    expect(existsSync(join(paths.state, 'local.config.json'))).toBe(false);
  });

  it('prepareLocal gives 1 when the page build fails', async () => {
    const { checkout } = prepared('prepare-build-fails', true);
    const logs: string[] = [];
    const code = await prepareLocal(checkout, { run: async () => ({ status: 1, stdout: '', stderr: 'boom' }), log: (message: string) => logs.push(message) });
    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('boom');
  });
});

describe('the tray script (scripts/command-center-tray.ps1)', () => {
  const script = join(PACKAGE_DIR, 'scripts', 'command-center-tray.ps1');

  it('has no non-ASCII character (Windows PowerShell 5.1 reads a file with no byte order mark as ANSI)', () => {
    expect([...readFileSync(script)].filter((byte) => byte > 127)).toEqual([]);
  });

  it('never stops a process by name: only by the ids that it kept', () => {
    const text = readFileSync(script, 'utf8');
    expect(text).not.toMatch(/taskkill(\.exe)?[^\n]*\/IM/i);
    expect(text).not.toMatch(/Stop-Process\s+-Name/i);
    expect(text).not.toMatch(/Get-Process\s+-Name/i);
    expect(text).toMatch(/taskkill\.exe \/PID \$id \/T \/F/);
  });

  it.skipIf(process.platform !== 'win32')('parses with zero errors in Windows PowerShell', () => {
    const command = `$e = $null; $t = $null; [System.Management.Automation.Language.Parser]::ParseFile('${script.replace(/'/g, "''")}', [ref]$t, [ref]$e) | Out-Null; if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { exit 0 }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });
});
