import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseLive } from '../src/shared/live';
import { PACKAGE_DIR, freePort } from './helpers';
import { TOKEN } from './publish-helpers';

// The real server process in reporter mode (`main.ts --reporter`), against a small fake of the store and of the hosted page on this machine.
// The settings file lives in a temporary home folder, so the test never reads or writes the real ~/.shadow-jog-cc.

const scratch = mkdtempSync(join(tmpdir(), 'cc-reporter-main-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function config(port: number): string {
  const real = JSON.parse(readFileSync(join(PACKAGE_DIR, 'command-center.config.json'), 'utf8')) as { repoRoot: string; roots: string[]; claude: Record<string, unknown> };
  const absolute = (p: string) => resolve(PACKAGE_DIR, p);
  // An empty process-list folder and an empty projects folder: no session exists, and the test reads no real one.
  const sessionsRoot = join(scratch, `sessions-${port}`);
  const projectsRoot = join(scratch, `projects-${port}`);
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
  const file = join(scratch, `config-${port}.json`);
  writeFileSync(file, JSON.stringify({ ...real, port, repoRoot: absolute(real.repoRoot), roots: real.roots.map(absolute), claude: { ...real.claude, sessionsRoot, projectsRoot } }));
  return file;
}

function startReporterRun(configFile: string, home: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--config', configFile, '--reporter'], {
    cwd: PACKAGE_DIR,
    // os.homedir() reads USERPROFILE on Windows and HOME elsewhere.
    env: { ...process.env, CC_NO_OPEN: '1', HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => child.once('close', (code) => done({ code, stdout, stderr })));
  return { child, exited };
}

function homeWithSettings(name: string, lines: string[]): string {
  const home = join(scratch, name);
  mkdirSync(join(home, '.shadow-jog-cc'), { recursive: true });
  writeFileSync(join(home, '.shadow-jog-cc', 'upstash.env'), `${lines.join('\n')}\n`);
  return home;
}

type Seen = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string };

/** One local server that plays both the store (POST /) and the hosted page (GET /api/live). */
async function fakeWorld(hostedAnswer: { status: number; body?: string }) {
  const seen: Seen[] = [];
  const server = createServer((request, reply) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body });
      reply.setHeader('Content-Type', 'application/json');
      if (request.method === 'GET' && request.url === '/api/live') {
        reply.statusCode = hostedAnswer.status;
        reply.end(hostedAnswer.body ?? '');
      } else if (request.method === 'POST') {
        const command = JSON.parse(body) as string[];
        reply.end(JSON.stringify({ result: command[0] === 'SET' ? 'OK' : 1 }));
      } else {
        reply.statusCode = 404;
        reply.end('{}');
      }
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { seen, origin, close: () => new Promise<void>((done) => server.close(() => done())) };
}

const until = async (check: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) await new Promise((wait) => setTimeout(wait, 100));
  return check();
};

describe('main --reporter', () => {
  it('without the settings file: one clear line, no write, exit code 4', async () => {
    const home = join(scratch, 'empty-home');
    mkdirSync(home, { recursive: true });
    const run = await startReporterRun(config(await freePort()), home).exited;
    expect(run.code).toBe(4);
    const lines = run.stderr.split(/\r?\n/).filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('not publishing');
    expect(lines[0]).toContain('upstash.env');
  });

  it('with settings but no hosted address: no start, and the message names the variable and never a value', async () => {
    const home = homeWithSettings('no-hosted', ['KV_REST_API_URL=https://example.upstash.io', `KV_REST_API_TOKEN=${TOKEN}`]);
    const run = await startReporterRun(config(await freePort()), home).exited;
    expect(run.code).toBe(4);
    expect(run.stderr).toContain('CC_HOSTED_URL');
    expect(run.stderr + run.stdout).not.toContain(TOKEN);
  });

  it('publishes: checks the page without credentials, then writes SET live with the token, a body that passes parseLive and the 600 s expiry', async () => {
    const world = await fakeWorld({ status: 401 });
    const home = homeWithSettings('publish', [`KV_REST_API_URL=${world.origin}`, `KV_REST_API_TOKEN=${TOKEN}`, `CC_HOSTED_URL=${world.origin}`]);
    const { child, exited } = startReporterRun(config(await freePort()), home);
    try {
      expect(await until(() => world.seen.some((call) => call.method === 'POST'), 40_000)).toBe(true);
      const check = world.seen.find((call) => call.method === 'GET');
      expect(check?.url).toBe('/api/live');
      expect(check?.headers.authorization).toBeUndefined();
      expect(check?.headers.cookie).toBeUndefined();
      expect(JSON.stringify(check)).not.toContain(TOKEN);

      const write = world.seen.find((call) => call.method === 'POST');
      expect(write?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      const command = JSON.parse(write?.body ?? '[]') as string[];
      expect(command[0]).toBe('SET');
      expect(command[1]).toBe('live');
      expect(command.slice(3)).toEqual(['EX', '600']);
      const parsed = parseLive(JSON.parse(command[2] as string));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.live.sessions).toEqual([]); // the fake machine has no session
        expect(parsed.live.worktrees.length).toBeGreaterThan(0); // the repo this test runs in
      }
    } finally {
      child.kill();
      const run = await exited;
      expect(run.stdout + run.stderr).not.toContain(TOKEN);
    }
    await world.close();
  }, 60_000);

  it('a public page: nothing is written, the key is removed, exit code 3', async () => {
    const world = await fakeWorld({ status: 200, body: JSON.stringify({ reporter: { state: 'not-running' }, live: null }) });
    const home = homeWithSettings('public', [`KV_REST_API_URL=${world.origin}`, `KV_REST_API_TOKEN=${TOKEN}`, `CC_HOSTED_URL=${world.origin}`]);
    const { child, exited } = startReporterRun(config(await freePort()), home);
    try {
      const run = await Promise.race([exited, new Promise<null>((done) => setTimeout(() => done(null), 40_000))]);
      expect(run).not.toBeNull();
      expect(run?.code).toBe(3);
      expect(run?.stdout).toContain('STOP');
      expect(`${run?.stdout ?? ''}${run?.stderr ?? ''}`).not.toContain(TOKEN);
      const posts = world.seen.filter((call) => call.method === 'POST').map((call) => (JSON.parse(call.body) as string[])[0]);
      expect(posts).toEqual(['DEL']);
    } finally {
      child.kill();
      await exited;
    }
    await world.close();
  }, 60_000);

  it('--clear-live (what --stop runs): one DEL of the key, no server, exit code 0, and the token never printed', async () => {
    const world = await fakeWorld({ status: 401 });
    const home = homeWithSettings('clear-live', [`KV_REST_API_URL=${world.origin}`, `KV_REST_API_TOKEN=${TOKEN}`, `CC_HOSTED_URL=${world.origin}`]);
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--clear-live'], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, CC_NO_OPEN: '1', HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((done) => child.once('close', done));
    expect(code).toBe(0);
    expect(output).toContain('the live key was removed');
    expect(output).not.toContain(TOKEN);
    expect(world.seen.map((call) => `${call.method} ${(JSON.parse(call.body || '[]') as string[]).join(' ')}`.trim())).toEqual(['POST DEL live']);
    await world.close();
  }, 60_000);

  it('--clear-live without the settings file: one clear line and exit code 4, nothing sent', async () => {
    const home = join(scratch, 'clear-live-empty-home');
    mkdirSync(home, { recursive: true });
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--clear-live'], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((done) => child.once('close', done));
    expect(code).toBe(4);
    expect(stderr).toContain('cannot remove the live key');
  }, 60_000);
});
