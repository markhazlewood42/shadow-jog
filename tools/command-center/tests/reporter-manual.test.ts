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

  // Static checks of the script text (the tray itself is a GUI and is not run here). Each check is a function of the text, so the test can also run it on a
  // mutant (the text with the safeguard removed) and expect it to fail: a check that cannot fail would prove nothing.
  const read = () => readFileSync(script, 'utf8');
  /** The code lines only: a comment line may name a file or a flag without using it. */
  const code = (text: string) => text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  /** The body of `function <name>`: up to the next top-level function or section line. */
  const body = (text: string, name: string) => {
    const start = text.indexOf(`function ${name}`);
    if (start < 0) throw new Error(`no function ${name}`);
    const rest = text.slice(start + 1);
    const end = rest.search(/\n(function |# ----)/);
    return end < 0 ? rest : rest.slice(0, end);
  };

  const checkMutex = (text: string) => {
    expect(text).toMatch(/\$MutexName = 'Local\\ShadowJogCommandCenterTray'/);
    expect(text).toMatch(/New-Object System\.Threading\.Mutex\(\$true, \$MutexName, \[ref\]\$createdMutex\)/);
    expect(text).toMatch(/if \(-not \$createdMutex\) \{[\s\S]*?\n {4}exit 0\n\}/);
    expect(text).toMatch(/\$Mutex\.ReleaseMutex\(\)/);
  };
  it('allows one tray: a named mutex, a second start exits 0, Quit releases it', () => {
    checkMutex(read());
    expect(() => checkMutex(read().replace('New-Object System.Threading.Mutex($true, $MutexName', 'New-Object System.Threading.Mutex($false, $MutexName'))).toThrow();
    expect(() => checkMutex(read().replace('    exit 0\n}', '    # no exit\n}'))).toThrow();
  });

  const checkSecretFile = (text: string) => {
    const lines = code(text);
    // The settings file is named in one place and read in one place, by one call.
    expect(lines.match(/Join-Path \$HOME/g)).toHaveLength(1);
    expect(lines.match(/Join-Path \$HOME[^\n]*upstash\.env/g)).toHaveLength(1);
    expect(lines.match(/ReadAllLines/g)).toHaveLength(1);
    expect(lines).not.toMatch(/Get-Content|Select-String|\[System\.IO\.File\]::(ReadAllText|OpenRead|ReadLines)/);
    // Only the key CC_HOSTED_URL is extracted, and the key is matched case-sensitively.
    const reader = body(text, 'Get-HostedUrl');
    expect(reader).toContain('ReadAllLines');
    expect(reader).toMatch(/-cmatch '\^\\s\*CC_HOSTED_URL\\s\*=/);
    expect(reader.match(/-c?match/g)).toHaveLength(2); // the key, then the https check of the value
    expect(reader).toMatch(/\$value -match '\^https:\/\/\\S\+\$'/);
    // No other function touches the loop variable or the value.
    expect(code(text.replace(reader, ''))).not.toMatch(/\$line\b|\$Matches\b/);
  };
  it('reads upstash.env in one place, and extracts only CC_HOSTED_URL', () => {
    checkSecretFile(read());
    expect(() => checkSecretFile(read().replace('function Start-Services {', "function Start-Services {\n    $x = [System.IO.File]::ReadAllLines((Join-Path $HOME '.shadow-jog-cc\\upstash.env'))"))).toThrow();
    expect(() => checkSecretFile(read().replace('-cmatch', '-match'))).toThrow();
    expect(() => checkSecretFile(read().replace('CC_HOSTED_URL\\s*=', '[A-Z_]+\\s*='))).toThrow();
  });

  const checkNoValueInLogs = (text: string) => {
    // A log line or a balloon tip may carry a fixed text or an exception message, never the URL, the value, the file line or the match.
    const loggers = code(text).split('\n').filter((line) => /Write-TrayLog|Show-Balloon/.test(line));
    expect(loggers.length).toBeGreaterThan(10);
    for (const line of loggers) expect(line).not.toMatch(/\$(url|value|line|matches)\b/i);
  };
  it('never passes the URL, the value or a line of upstash.env to a log line or a balloon tip', () => {
    checkNoValueInLogs(read());
    expect(() => checkNoValueInLogs(read().replace('Write-TrayLog ("could not open a page: {0}" -f $_.Exception.Message)', 'Write-TrayLog ("could not open {0}" -f $Url)'))).toThrow();
    expect(() => checkNoValueInLogs(read().replace("Show-Balloon 'There is no log file yet.'", 'Show-Balloon $value'))).toThrow();
  });

  const checkJob = (text: string) => {
    expect(text).toMatch(/KillOnJobClose = 0x2000;/);
    expect(text).toMatch(/limits\.Basic\.LimitFlags = KillOnJobClose;/);
    expect(text).toMatch(/ExtendedLimitInformation = 9;/);
    expect(text).toMatch(/SetInformationJobObject\(job, ExtendedLimitInformation/);
    // No breakaway: a child cannot leave the job.
    expect(code(text)).not.toMatch(/BREAKAWAY/i);
    // Every child is added to the job, right after it starts.
    expect(body(text, 'Start-Child')).toMatch(/\[ShadowJog\.ChildJob\]::Add\(\$script:Job, \$process\.Handle\)/);
    // The job is made before the first child, and a new one is made after each stop.
    expect(body(text, 'Reset-Job')).toMatch(/\[ShadowJog\.ChildJob\]::Create\(\)/);
    expect(body(text, 'Finish-Stop')).toContain('Reset-Job');
    expect(body(text, 'Start-Services')).toContain('Reset-Job');
  };
  it('puts every child in a job object with KILL_ON_JOB_CLOSE and no breakaway', () => {
    checkJob(read());
    expect(() => checkJob(read().replace('limits.Basic.LimitFlags = KillOnJobClose;', ''))).toThrow();
    expect(() => checkJob(read().replace('[ShadowJog.ChildJob]::Add($script:Job, $process.Handle)', '$null'))).toThrow();
    expect(() => checkJob(read().replace('private const int ExtendedLimitInformation = 9;', 'private const int ExtendedLimitInformation = 9; private const uint BreakawayOk = 0x800; // JOB_OBJECT_LIMIT_BREAKAWAY_OK'))).toThrow();
  });

  const checkStop = (text: string) => {
    // The design's --stop always runs: Begin-Stop has no condition on the tray's own launcher (Test-Alive), and Quit and Restart both go through it.
    const begin = body(text, 'Begin-Stop');
    expect(begin).toMatch(/--stop --repo/);
    expect(begin).not.toMatch(/Test-Alive|\$script:Launcher/);
    expect(body(text, 'Close-Tray')).toContain('Begin-Stop');
    expect(text).toMatch(/\$ItemRestart\.Add_Click\(\{[\s\S]*?Begin-Stop \{/);
    expect(text).not.toContain('function Stop-Services');
    // The UI thread never waits: no WaitForExit, no sleep, in the stop path.
    expect(code(text)).not.toMatch(/WaitForExit/);
    // The tray exits only after the children ended: Exit-Tray runs from Finish-Stop.
    expect(body(text, 'Finish-Stop')).toContain('& $then');
    expect(body(text, 'Close-Tray')).toMatch(/Begin-Stop \{ Exit-Tray \}/);
    // taskkill: judged by the exit code; 128 (no such process) is fine.
    const tree = body(text, 'Stop-Tree');
    expect(tree).toContain('$LASTEXITCODE');
    expect(tree).toMatch(/-eq 128/);
  };
  it('Quit and Restart always run --stop, never block the UI thread, and judge taskkill by its exit code', () => {
    checkStop(read());
    expect(() => checkStop(read().replace("if ($Node) {\n            $script:StopProc", 'if ($Node -and (Test-Alive $script:Launcher)) {\n            $script:StopProc'))).toThrow();
    expect(() => checkStop(read().replace('Begin-Stop { Exit-Tray }', 'Exit-Tray'))).toThrow();
    expect(() => checkStop(read().replace('$null -eq $script:StopProc) -or', '$null -eq $script:StopProc) -or $script:StopProc.WaitForExit(35000) -or'))).toThrow();
    expect(() => checkStop(read().replace('$code = $LASTEXITCODE', '$code = 0'))).toThrow();
  });

  it('shows an error balloon tip when a page, Notepad or the poll fails (no silent log-only catch)', () => {
    const text = read();
    expect(body(text, 'Open-Url')).toContain('Show-Balloon');
    expect(text).toMatch(/Write-TrayLog \("could not open a log in Notepad[^\n]*\n\s*Show-Balloon/);
    expect(text).toMatch(/Write-TrayLog \("poll failed[\s\S]*?Show-Balloon[\s\S]*?\}\n\}\)/);
    // The poll balloon is rate limited.
    expect(text).toMatch(/\$script:LastPollBalloon\)\.TotalMinutes -ge 10/);
    // The mutants: take the balloon out of Open-Url, and the rate limit out of the poll.
    expect(body(text.replace(/(could not open a page[^\n]*\n)\s*Show-Balloon[^\n]*\n/, '$1'), 'Open-Url')).not.toContain('Show-Balloon');
    expect(text.replace('-ge 10', '-ge 0')).not.toMatch(/TotalMinutes -ge 10/);
  });

  it('defines $Timer before the first function that uses it at exit (Exit-Tray)', () => {
    const text = read();
    expect(text.indexOf('$Timer = New-Object')).toBeGreaterThan(0);
    expect(text.indexOf('$Timer = New-Object')).toBeLessThan(text.indexOf('function Exit-Tray'));
    expect(text.indexOf('$Timer = New-Object')).toBeLessThan(text.indexOf('function Close-Tray'));
  });

  it.skipIf(process.platform !== 'win32')('parses with zero errors in Windows PowerShell', () => {
    const command = `$e = $null; $t = $null; [System.Management.Automation.Language.Parser]::ParseFile('${script.replace(/'/g, "''")}', [ref]$t, [ref]$e) | Out-Null; if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { exit 0 }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });
});
