import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isInside, loadConfig } from '../src/server/config';
import { PACKAGE_DIR, REPO_DIR } from './helpers';

const REAL_CONFIG = join(PACKAGE_DIR, 'command-center.config.json');

describe('isInside', () => {
  it('isInside matches whole path segments', () => {
    const root = join(tmpdir(), 'cc-isinside', 'shadow-jog');
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, join(root, 'docs', 'a.md'))).toBe(true);
    // A folder that only shares a name prefix with the root is another folder.
    expect(isInside(root, `${root}-old`)).toBe(false);
    expect(isInside(root, join(`${root}-old`, 'docs'))).toBe(false);
    expect(isInside(root, dirname(root))).toBe(false);
    // ".." is folded first: one that leaves the root is outside, one that stays inside is inside.
    expect(isInside(root, join(root, '..', 'other'))).toBe(false);
    expect(isInside(root, join(root, 'a', '..', 'b'))).toBe(true);
    // A trailing separator on the root changes nothing.
    expect(isInside(`${root}/`, join(root, 'docs'))).toBe(true);
  });

  it('isInside ignores case and slash style on Windows', () => {
    if (process.platform !== 'win32') {
      // Elsewhere the file system tells "Repo" and "repo" apart, so a different case is a different folder.
      expect(isInside('/work/Repo', '/work/repo/x')).toBe(false);
      return;
    }
    expect(isInside('C:\\Users\\Mark\\Shadow-Jog', 'c:/users/mark/shadow-jog/docs/A.md')).toBe(true);
    expect(isInside('c:/users/mark/shadow-jog/', 'C:\\Users\\MARK\\shadow-jog')).toBe(true);
    expect(isInside('C:\\Users\\Mark\\Shadow-Jog', 'C:\\Users\\Mark\\Shadow-Jog-old')).toBe(false);
    expect(isInside('C:\\Users\\Mark\\Shadow-Jog', 'D:\\Users\\Mark\\Shadow-Jog\\docs')).toBe(false);
  });
});

describe('loadConfig', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cc-config-test-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** Writes a config file with this content and returns its path. */
  function writeConfig(content: unknown, name = 'config.json'): string {
    const file = join(scratch, name);
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  }

  /** The real config file, parsed, so a case can break one thing in it. */
  function realConfigJson(): Record<string, unknown> & { claude: Record<string, unknown> } {
    return JSON.parse(readFileSync(REAL_CONFIG, 'utf8'));
  }

  it('reads the real config and resolves its paths against the config file', () => {
    const config = loadConfig(REAL_CONFIG);
    expect(config.port).toBe(3009);
    expect(config.repoRoot).toBe(REPO_DIR);
    // Both allowed roots: this repo and the shadow-jog-phaser checkout next to it.
    expect(config.roots).toEqual([REPO_DIR, resolve(REPO_DIR, '..', 'shadow-jog-phaser')]);
    expect(config.githubRepo).toBe('markhazlewood42/shadow-jog');
    expect(config.gameUrl).toBe('http://localhost:3007');
    expect(config.links.length).toBeGreaterThan(0);
  });

  it('writes the approval ref of PR #17 into the config (ruling R5)', () => {
    expect(loadConfig(REAL_CONFIG).approvalRef).toBe('467fffd6a93a331114958045f4ba645068e9aac6');
  });

  it('resolves projectsRoot to ~/.claude/projects at run time and keeps the session folders by exact name', () => {
    const { claude } = loadConfig(REAL_CONFIG);
    expect(claude.projectsRoot).toBe(join(homedir(), '.claude', 'projects'));
    expect(claude.folders).toEqual(['C--Users-markh-home-base-projects-shadow-jog', 'C--Users-markh-home-base-projects-shadow-jog-phaser']);
    expect(claude.cwdMatchFolders).toEqual(['C--Users-markh-home-base']);
    expect(claude.recentSeconds).toBe(604800);
    expect(claude.workingSeconds).toBeGreaterThan(0);
    expect(claude.waitingSeconds).toBeGreaterThan(claude.workingSeconds);
  });

  it('lists no SDK runs by default: the config file says includeSdk is false, and a file without the key means false (ruling R18)', () => {
    expect(JSON.parse(readFileSync(REAL_CONFIG, 'utf8')).claude.includeSdk).toBe(false); // the file says so itself
    expect(loadConfig(REAL_CONFIG).claude.includeSdk).toBe(false);
    const json = realConfigJson();
    delete json.claude.includeSdk;
    expect(loadConfig(writeConfig(json, 'no-include-sdk.json')).claude.includeSdk).toBe(false);
  });

  it('reads includeSdk true and false as they are written', () => {
    for (const value of [true, false]) {
      const json = realConfigJson();
      json.claude.includeSdk = value;
      expect(loadConfig(writeConfig(json, `include-sdk-${value}.json`)).claude.includeSdk).toBe(value);
    }
  });

  it('config reads the new keys and rejects bad values', () => {
    // The real file holds the three settings of the agents module, with their defaults: the folder of the process list and the two times.
    const file = realConfigJson() as Record<string, unknown> & { claude: Record<string, unknown>; agents: Record<string, unknown> };
    expect(file.claude.sessionsRoot).toBe('~/.claude/sessions');
    expect(file.agents).toEqual({ pollMs: 3000, lingerSeconds: 300 });
    const real = loadConfig(REAL_CONFIG);
    expect(real.claude.sessionsRoot).toBe(join(homedir(), '.claude', 'sessions'));
    expect(real.agents).toEqual({ pollMs: 3000, lingerSeconds: 300 });

    // A file that leaves the keys out means the same defaults (an older config file keeps working), also when the whole `agents` object is left out.
    const bare = realConfigJson();
    delete bare.claude.sessionsRoot;
    delete bare.agents;
    const defaults = loadConfig(writeConfig(bare, 'no-agents-keys.json'));
    expect(defaults.claude.sessionsRoot).toBe(join(homedir(), '.claude', 'sessions'));
    expect(defaults.agents).toEqual({ pollMs: 3000, lingerSeconds: 300 });
    const half = realConfigJson();
    half.agents = { pollMs: 1500 };
    expect(loadConfig(writeConfig(half, 'half-agents.json')).agents).toEqual({ pollMs: 1500, lingerSeconds: 300 });

    // The values are read as they are written. A finished agent may leave at once (0 seconds), and a relative folder starts at the file's folder.
    const custom = realConfigJson();
    custom.agents = { pollMs: 100, lingerSeconds: 0 };
    custom.claude.sessionsRoot = 'processes';
    const loaded = loadConfig(writeConfig(custom, 'custom-agents.json'));
    expect(loaded.agents).toEqual({ pollMs: 100, lingerSeconds: 0 });
    expect(loaded.claude.sessionsRoot).toBe(join(scratch, 'processes'));

    // Bad values stop the start with a message that names the setting.
    const bad: [string, (c: Record<string, unknown> & { claude: Record<string, unknown>; agents: Record<string, unknown> }) => void, RegExp][] = [
      ['a poll time of 0', (c) => (c.agents.pollMs = 0), /agents\.pollMs/],
      ['a negative poll time', (c) => (c.agents.pollMs = -3000), /agents\.pollMs/],
      ['a poll time below 100 ms', (c) => (c.agents.pollMs = 99), /agents\.pollMs/],
      ['a poll time above one hour', (c) => (c.agents.pollMs = 3_600_001), /agents\.pollMs/],
      ['a poll time that is not a whole number', (c) => (c.agents.pollMs = 3000.5), /agents\.pollMs/],
      ['a poll time given as text', (c) => (c.agents.pollMs = '3000'), /agents\.pollMs/],
      ['a poll time set to null', (c) => (c.agents.pollMs = null), /agents\.pollMs/],
      ['a negative linger time', (c) => (c.agents.lingerSeconds = -1), /agents\.lingerSeconds/],
      ['a linger time that is not a whole number', (c) => (c.agents.lingerSeconds = 1.5), /agents\.lingerSeconds/],
      ['a linger time given as text', (c) => (c.agents.lingerSeconds = '300'), /agents\.lingerSeconds/],
      ['a linger time above a year', (c) => (c.agents.lingerSeconds = 31_536_001), /agents\.lingerSeconds/],
      ['a linger time set to null', (c) => (c.agents.lingerSeconds = null), /agents\.lingerSeconds/],
      ['agents that is not an object', (c) => (c.agents = 5 as unknown as Record<string, unknown>), /agents/],
      ['agents that is a list', (c) => (c.agents = [] as unknown as Record<string, unknown>), /agents/],
      ['an unknown agents key', (c) => (c.agents.pollMS = 3000), /agents\.pollMS/],
      ['an empty sessionsRoot', (c) => (c.claude.sessionsRoot = ''), /claude\.sessionsRoot/],
      ['a blank sessionsRoot', (c) => (c.claude.sessionsRoot = '   '), /claude\.sessionsRoot/],
      ['a sessionsRoot that is not text', (c) => (c.claude.sessionsRoot = 5), /claude\.sessionsRoot/],
      ['a sessionsRoot set to null', (c) => (c.claude.sessionsRoot = null), /claude\.sessionsRoot/],
      ['a sessionsRoot with the wrong case of its name', (c) => (c.claude.sessionsroot = '~/.claude/sessions'), /claude\.sessionsroot/],
    ];
    for (const [label, breakIt, message] of bad) {
      const json = realConfigJson() as Parameters<typeof breakIt>[0];
      breakIt(json);
      expect(() => loadConfig(writeConfig(json, 'bad-agents.json')), label).toThrow(message);
    }
  });

  it('the config file holds no absolute path (the repo is public)', () => {
    const text = readFileSync(REAL_CONFIG, 'utf8');
    // A Windows drive path such as C:\ or C:/ (a lone letter, so the "p:/" in "http://" is not one), or a Unix home path.
    expect(text).not.toMatch(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/);
    expect(text).not.toMatch(/\/(?:home|Users)\//);
    expect(text).not.toContain(homedir());
  });

  it('keeps an absolute path as it is and resolves a relative one against the file', () => {
    const absolute = join(scratch, 'abs-repo');
    const file = writeConfig({ ...realConfigJson(), repoRoot: absolute, roots: [absolute, 'sibling'] });
    const config = loadConfig(file);
    expect(config.repoRoot).toBe(absolute);
    expect(config.roots).toEqual([absolute, join(scratch, 'sibling')]);
  });

  const BROKEN: [string, (c: Record<string, unknown> & { claude: Record<string, unknown> }) => void, RegExp][] = [
    ['a missing field', (c) => delete c.githubRepo, /githubRepo/],
    ['a port above 65535', (c) => (c.port = 70000), /port/],
    ['a port that is not a whole number', (c) => (c.port = 3009.5), /port/],
    ['a port given as text', (c) => (c.port = '3009'), /port/],
    ['an unknown top-level key', (c) => (c.portt = 1), /portt/],
    ['an unknown claude key', (c) => (c.claude.workingSecond = 5), /workingSecond/],
    ['a githubRepo without an owner', (c) => (c.githubRepo = 'shadow-jog'), /githubRepo/],
    ['a game url that is not a url', (c) => (c.gameUrl = 'localhost 3007'), /gameUrl/],
    ['a link that is not http or https', (c) => (c.links = [{ label: 'x', url: 'javascript:alert(1)' }]), /links/],
    ['a link without a label', (c) => (c.links = [{ url: 'http://localhost:3007' }]), /links/],
    ['an approvalRef that looks like an option', (c) => (c.approvalRef = '--output=x'), /approvalRef/],
    ['an empty approvalRef', (c) => (c.approvalRef = ''), /approvalRef/],
    ['roots that is not a list', (c) => (c.roots = '../..'), /roots/],
    ['an empty roots list', (c) => (c.roots = []), /roots/],
    ['a session folder name with a path separator', (c) => (c.claude.folders = ['a/b']), /folders/],
    ['a session folder name that is ..', (c) => (c.claude.cwdMatchFolders = ['..']), /cwdMatchFolders/],
    ['zero workingSeconds', (c) => (c.claude.workingSeconds = 0), /workingSeconds/],
    ['negative recentSeconds', (c) => (c.claude.recentSeconds = -5), /recentSeconds/],
    ['includeSdk given as text', (c) => (c.claude.includeSdk = 'true'), /includeSdk/],
    ['includeSdk given as a number', (c) => (c.claude.includeSdk = 1), /includeSdk/],
    ['includeSdk set to null', (c) => (c.claude.includeSdk = null), /includeSdk/],
    ['includeSdk with the wrong case of its name', (c) => (c.claude.includeSDK = true), /includeSDK/],
  ];

  it.each(BROKEN)('rejects %s and names the setting', (_label, breakIt, message) => {
    const json = realConfigJson();
    breakIt(json);
    expect(() => loadConfig(writeConfig(json))).toThrow(message);
  });

  it('rejects a file that is not JSON and a file that is missing', () => {
    expect(() => loadConfig(writeConfig('{ not json', 'broken.json'))).toThrow(/JSON/);
    expect(() => loadConfig(join(scratch, 'does-not-exist.json'))).toThrow(/does-not-exist\.json/);
  });
});
