import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_DIR, freePort } from './helpers';

const scratch = mkdtempSync(join(tmpdir(), 'cc-main-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A copy of the real config with another port and absolute paths (the copy lives in another folder). */
function configWithPort(port: number): string {
  const real = JSON.parse(readFileSync(join(PACKAGE_DIR, 'command-center.config.json'), 'utf8')) as {
    port: number;
    repoRoot: string;
    roots: string[];
  };
  const absolute = (p: string) => resolve(PACKAGE_DIR, p);
  const file = join(scratch, `config-${port}.json`);
  writeFileSync(file, JSON.stringify({ ...real, port, repoRoot: absolute(real.repoRoot), roots: real.roots.map(absolute) }));
  return file;
}

type Run = { code: number | null; stdout: string; stderr: string };

/** Starts main.ts as its own process, the way `npm run cc` does, without opening a browser tab. */
function startMain(configFile: string) {
  // node starts with tsx as a loader. It does not go through a .cmd shim.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--config', configFile], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, CC_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<Run>((resolveRun) => {
    child.once('close', (code) => resolveRun({ code, stdout, stderr }));
  });
  return { child, exited, output: () => ({ stdout, stderr }) };
}

describe('main', () => {
  it('a busy port prints one line and exits 1', async () => {
    // Something else holds the port. (The test only opens it; it never stops any process.)
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>((ready) => blocker.listen(port, '127.0.0.1', ready));
    try {
      const { child, exited } = startMain(configWithPort(port));
      const timer = setTimeout(() => child.kill(), 15_000);
      const run = await exited;
      clearTimeout(timer);

      expect(run.code).toBe(1);
      expect(run.stdout.trim()).toBe('');
      const lines = run.stderr.split(/\r?\n/).filter((line) => line.trim() !== '');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(String(port));
      expect(lines[0]).toMatch(/already in use/i);
    } finally {
      await new Promise<void>((done) => blocker.close(() => done()));
    }
  });

  it('starts on a free port, prints its address and skips the browser tab when CC_NO_OPEN=1', async () => {
    const port = await freePort();
    const { child, exited, output } = startMain(configWithPort(port));
    try {
      // Wait until the process says it is listening, then ask it.
      const deadline = Date.now() + 15_000;
      while (!output().stdout.includes(`http://localhost:${port}`) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(output().stdout).toContain(`http://localhost:${port}`);
      expect(output().stdout).toContain('CC_NO_OPEN=1');
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, name: 'Shadow Jog Command Center' });
    } finally {
      // Stop only the process this test started, by its handle.
      child.kill();
      await exited;
    }
  });

  it('prints one line and exits 1 for a config it cannot read', async () => {
    const bad = join(scratch, 'bad-config.json');
    writeFileSync(bad, '{ "port": "not a number" }');
    const run = await startMain(bad).exited;
    expect(run.code).toBe(1);
    const lines = run.stderr.split(/\r?\n/).filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('bad-config.json');
  });
});
