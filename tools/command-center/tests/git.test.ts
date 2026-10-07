import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseBranches, parseCommits } from '../src/server/git/git';
import { createGitSource } from '../src/server/git/module';
import { createHub } from '../src/server/hub';
import { registerGitRoutes } from '../src/server/routes/git';
import { type Runner, createRunner } from '../src/server/runner';
import type { GitInfo, Panel } from '../src/shared/types';
import { getFrom, makeApp, makeTestConfig } from './helpers';

// The git module: the current branch with how far it is ahead of and behind its upstream, the local
// branches (with the working folder of each that is checked out) and the newest commits. The parsers
// are tested on text that git prints; the module is tested on real repos made in the OS temp folder
// (a repo, a bare "origin" that it follows, and a second clone that pushes to it), so `git for-each-ref`
// and `git log` run for real through the real runner and its allow-list.

const SEP = '\t';
/** One line of `git for-each-ref` as git.ts asks for it: HEAD marker, name, time, upstream, track, worktree. */
const line = (...fields: string[]) => fields.join(SEP);

describe('parseBranches', () => {
  it('reads the HEAD marker, the upstream, the track and the working folder of each branch', () => {
    const out = [
      line('*', 'main', '1791282656', 'origin/main', '[ahead 2, behind 1]', 'C:/work/repo'),
      line(' ', 'feature/x', '1791255250', 'origin/feature/x', '[gone]', ''),
      line(' ', 'local-only', '1791251727', '', '', ''),
      line(' ', 'level', '1791234123', 'origin/level', '', 'C:/work/other-tree'),
      line(' ', 'only-behind', '1791200000', 'origin/only-behind', '[behind 3]', ''),
      '',
    ].join('\n');
    const { current, branches } = parseBranches(out);

    expect(current).toBe('main');
    expect(branches).toEqual([
      { name: 'main', date: '2026-10-06T10:30:56.000Z', upstream: 'origin/main', track: 'ahead 2, behind 1', worktree: 'C:/work/repo' },
      { name: 'feature/x', date: '2026-10-06T02:54:10.000Z', upstream: 'origin/feature/x', track: 'gone', worktree: null },
      { name: 'local-only', date: '2026-10-06T01:55:27.000Z', upstream: null, track: null, worktree: null },
      { name: 'level', date: '2026-10-05T21:02:03.000Z', upstream: 'origin/level', track: null, worktree: 'C:/work/other-tree' },
      { name: 'only-behind', date: '2026-10-05T11:33:20.000Z', upstream: 'origin/only-behind', track: 'behind 3', worktree: null },
    ]);
  });

  it('has no current branch when no line has the marker, and no branches for no output', () => {
    expect(parseBranches(line(' ', 'a', '1791282656', '', '', '')).current).toBeNull();
    expect(parseBranches('')).toEqual({ current: null, branches: [] });
    expect(parseBranches('\n\n')).toEqual({ current: null, branches: [] });
  });

  it('keeps a name that has a slash, and reads a line with Windows line breaks', () => {
    const { branches } = parseBranches(`${line('*', 'spike/phaser-stage', '1791132222', 'origin/spike/phaser-stage', '', 'C:/a b/c')}\r\n`);
    expect(branches[0]).toMatchObject({ name: 'spike/phaser-stage', worktree: 'C:/a b/c', track: null });
  });

  it('a line that is not a branch line is an error, not a branch with holes', () => {
    expect(() => parseBranches('garbage with no tabs\n')).toThrow(/for-each-ref/);
  });
});

describe('parseCommits', () => {
  const US = '\x1f';
  it('reads sha, time, author and subject, and keeps a subject that has tabs or colons', () => {
    const sha = 'a'.repeat(40);
    const out = [`${sha}${US}1791282656${US}Fixture Author${US}Add the thing: a\ttab`, `${'b'.repeat(40)}${US}1791282651${US}Other Author${US}`, ''].join('\n');
    expect(parseCommits(out)).toEqual([
      { sha, date: '2026-10-06T10:30:56.000Z', author: 'Fixture Author', subject: 'Add the thing: a\ttab' },
      { sha: 'b'.repeat(40), date: '2026-10-06T10:30:51.000Z', author: 'Other Author', subject: '' },
    ]);
    expect(parseCommits('')).toEqual([]);
  });

  it('a line that is not a commit line is an error', () => {
    expect(() => parseCommits('not a commit\n')).toThrow(/git log/);
  });
});

// ---- real repos ----

const root = mkdtempSync(join(tmpdir(), 'cc-git-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let sequence = 0;
const folder = (name: string) => join(root, `${name}-${++sequence}`);

/** Runs git in `dir` as a made-up person, so this works on a machine with no git identity. */
function git(dir: string, args: string[], date = '2026-01-01T00:00:00Z'): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'author@fixture.example',
      GIT_COMMITTER_NAME: 'Fixture Author',
      GIT_COMMITTER_EMAIL: 'author@fixture.example',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  }).trim();
}

/** Makes a repo with no commits. */
function emptyRepo(name = 'empty'): string {
  const dir = folder(name);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  return dir;
}

/** Commits a new file `name` in `dir`, at day `day` of January 2026. */
function commit(dir: string, name: string, day: number, message = `Add ${name}`): void {
  writeFileSync(join(dir, `${name}.txt`), `${name}\n`);
  git(dir, ['add', '--all']);
  git(dir, ['commit', '--quiet', '--no-verify', '-m', message], `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`);
}

/** A git module for the repo at `dir`, over the real runner. */
function moduleFor(dir: string, wrap: (real: Runner) => Runner = (real) => real) {
  const config = makeTestConfig({ repoRoot: dir, roots: [dir] });
  const source = createGitSource({ runner: wrap(createRunner(config)), hub: createHub() });
  return { config, source };
}

async function infoOf(source: ReturnType<typeof createGitSource>): Promise<GitInfo> {
  const panel = await source.get(true);
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return panel.data;
}

/** The same folder in the form git prints it (forward slashes), for a comparison that ignores case and slash style. */
const same = (a: string | null, b: string) => (a ?? '').replaceAll('\\', '/').toLowerCase() === realpathSync.native(b).replaceAll('\\', '/').toLowerCase();

describe('the git module', () => {
  it('git: ahead and behind, a [gone] track, a detached HEAD, a repo with no commits', async () => {
    // A bare "origin", a working repo that follows it, and a second clone that pushes to it.
    const origin = folder('origin');
    mkdirSync(origin, { recursive: true });
    git(origin, ['init', '--quiet', '--bare', '--initial-branch=main']);
    const work = emptyRepo('work');
    git(work, ['remote', 'add', 'origin', origin]);
    commit(work, 'one', 1);
    git(work, ['push', '--quiet', '--set-upstream', 'origin', 'main']);
    const { source } = moduleFor(work);

    // Level with the upstream: 0 ahead and 0 behind (that is not the same as "no upstream", which is null).
    let info = await infoOf(source);
    expect(info).toMatchObject({ current: 'main', ahead: 0, behind: 0 });
    expect(info.branches).toEqual([expect.objectContaining({ name: 'main', upstream: 'origin/main', track: null })]);
    expect(info.commits.map((c) => c.subject)).toEqual(['Add one']);

    // One commit that origin lacks: ahead 1.
    commit(work, 'two', 2);
    info = await infoOf(source);
    expect(info).toMatchObject({ current: 'main', ahead: 1, behind: 0 });
    expect(info.branches[0]?.track).toBe('ahead 1');

    // A second clone pushes a commit, and a fetch brings the news: ahead 1 and behind 1.
    const other = folder('other');
    git(root, ['clone', '--quiet', origin, other]);
    commit(other, 'three', 3);
    git(other, ['push', '--quiet', 'origin', 'main']);
    git(work, ['fetch', '--quiet']);
    info = await infoOf(source);
    expect(info).toMatchObject({ current: 'main', ahead: 1, behind: 1 });
    expect(info.branches.find((b) => b.name === 'main')?.track).toBe('ahead 1, behind 1');

    // A branch whose upstream was deleted on origin has the track "gone", and then it has no count.
    git(work, ['checkout', '--quiet', '-b', 'topic']);
    git(work, ['push', '--quiet', '--set-upstream', 'origin', 'topic']);
    git(origin, ['branch', '--quiet', '-D', 'topic']);
    git(work, ['fetch', '--quiet', '--prune']);
    info = await infoOf(source);
    expect(info).toMatchObject({ current: 'topic', ahead: null, behind: null });
    expect(info.branches.find((b) => b.name === 'topic')).toMatchObject({ upstream: 'origin/topic', track: 'gone' });

    // A branch with no upstream at all has no count either.
    git(work, ['checkout', '--quiet', '-b', 'lonely']);
    info = await infoOf(source);
    expect(info).toMatchObject({ current: 'lonely', ahead: null, behind: null });
    expect(info.branches.find((b) => b.name === 'lonely')).toMatchObject({ upstream: null, track: null });

    // A detached HEAD: no current branch and no count, but the commits of HEAD are there, and so are the branches.
    git(work, ['checkout', '--quiet', '--detach', 'main']);
    info = await infoOf(source);
    expect(info.current).toBeNull();
    expect(info.ahead).toBeNull();
    expect(info.behind).toBeNull();
    expect(info.branches.map((b) => b.name).sort()).toEqual(['lonely', 'main', 'topic']);
    expect(info.commits[0]?.subject).toBe('Add two');

    // A repo with no commits: nothing to list, and no error.
    const fresh = moduleFor(emptyRepo());
    const none = await fresh.source.get(true);
    expect(none.ok).toBe(true);
    expect(none.ok && none.data).toEqual({ current: null, ahead: null, behind: null, branches: [], commits: [] });
  });

  it('a worktree path shows on its branch', async () => {
    const repo = emptyRepo('main-tree');
    commit(repo, 'one', 1);
    git(repo, ['branch', 'side']);
    git(repo, ['branch', 'free']);
    const tree = folder('side-tree');
    git(repo, ['worktree', 'add', '--quiet', tree, 'side']);

    const info = await infoOf(moduleFor(repo).source);
    const byName = new Map(info.branches.map((b) => [b.name, b]));
    // The branch checked out in the other working folder shows that folder, the one checked out here shows this folder,
    // and a branch that is checked out nowhere shows none.
    expect(same(byName.get('side')?.worktree ?? null, tree)).toBe(true);
    expect(same(byName.get('main')?.worktree ?? null, repo)).toBe(true);
    expect(byName.get('free')?.worktree).toBeNull();
    expect(info.current).toBe('main');
  });

  it('lists the newest 5 commits of HEAD, the newest first, with the author and only the first line of the message', async () => {
    const repo = emptyRepo('log');
    for (let day = 1; day <= 7; day++) commit(repo, `file${day}`, day, day === 7 ? 'Add file7\n\nA long body that is not the subject.' : `Add file${day}`);
    const { commits } = await infoOf(moduleFor(repo).source);

    expect(commits.map((c) => c.subject)).toEqual(['Add file7', 'Add file6', 'Add file5', 'Add file4', 'Add file3']);
    expect(commits[0]).toEqual({ sha: expect.stringMatching(/^[0-9a-f]{40}$/), date: '2026-01-07T00:00:00.000Z', author: 'Fixture Author', subject: 'Add file7' });
    expect(commits[0]?.sha).toBe(git(repo, ['rev-parse', 'HEAD']));
  });

  it('lists the branches with the newest first', async () => {
    const repo = emptyRepo('order');
    commit(repo, 'one', 1);
    git(repo, ['checkout', '--quiet', '-b', 'older']);
    git(repo, ['checkout', '--quiet', 'main']);
    commit(repo, 'two', 5);
    git(repo, ['checkout', '--quiet', '-b', 'newest']);
    commit(repo, 'three', 9);
    const { branches } = await infoOf(moduleFor(repo).source);
    expect(branches.map((b) => b.name)).toEqual(['newest', 'main', 'older']);
    expect(branches.map((b) => b.date)).toEqual(['2026-01-09T00:00:00.000Z', '2026-01-05T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
  });

  it('runs only commands that the runner allows: a runner that records them sees for-each-ref, rev-parse and log', async () => {
    const repo = emptyRepo('allowed');
    commit(repo, 'one', 1);
    const seen: string[] = [];
    const { source } = moduleFor(repo, (real) => async (cmd, args, o) => {
      seen.push(`${cmd} ${args[0]}`);
      return real(cmd, args, o);
    });
    await infoOf(source);
    expect(seen.sort()).toEqual(['git for-each-ref', 'git log', 'git rev-parse']);
  });

  it('git is not installed: the panel fails with the code git-missing', async () => {
    const { source } = moduleFor(emptyRepo('nogit'), () => async () => ({ code: 127, stdout: '', stderr: 'git: command not found' }));
    const panel = await source.get(true);
    expect(panel.ok).toBe(false);
    expect(panel.ok ? '' : panel.error.code).toBe('git-missing');
  });

  it('each of the three git commands, when it fails, gives git-failed with what it was doing and the first line of git', async () => {
    const repo = emptyRepo('failing');
    commit(repo, 'one', 1);
    /** A module whose `command` fails with `code` and `stderr`, while the other two run for real. */
    const failing = (command: string, code: number, stderr: string) =>
      moduleFor(repo, (real) => async (cmd, args, o) => (args[0] === command ? { code, stdout: '', stderr } : real(cmd, args, o)));

    for (const [command, doing] of [['for-each-ref', 'read the branches'], ['rev-parse', 'look at HEAD'], ['log', 'read the commits']] as const) {
      const panel = await failing(command, 128, `\nfatal: boom of ${command}\nsecond line`).source.get(true);
      expect(panel.ok, command).toBe(false);
      if (panel.ok) return;
      expect(panel.error.code, command).toBe('git-failed');
      expect(panel.error.message, command).toBe(`git could not ${doing}: fatal: boom of ${command}`);
    }
    // With no words from git, the exit code says what there is to say.
    const quiet = await failing('log', 3, '').source.get(true);
    expect(quiet.ok ? '' : quiet.error.message).toBe('git could not read the commits: exit code 3');
  });

  it('a folder that is not a repo fails with the code git-failed and git\'s own words, and the old data stays', async () => {
    const repo = emptyRepo('later-gone');
    commit(repo, 'one', 1);
    // One source, one folder that stops being a repo: its .git folder is removed.
    const { source } = moduleFor(repo);
    expect((await source.get(true)).ok).toBe(true);
    rmSync(join(repo, '.git'), { recursive: true, force: true });
    const panel = await source.get(true);
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('git-failed');
    expect(panel.error.message).toMatch(/not a git repository/i);
    expect(panel.lastGood?.data.commits.map((c) => c.subject)).toEqual(['Add one']);
  });

  it('answers GET /api/git with the panel', async () => {
    const repo = emptyRepo('route');
    commit(repo, 'one', 1);
    const { config, source } = moduleFor(repo);
    const { app } = makeApp({ config });
    registerGitRoutes(app, source);

    const res = await getFrom(app, '/api/git', config);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Panel<GitInfo>;
    expect(body.ok).toBe(true);
    expect(body.ok && body.data.current).toBe('main');
  });
});
