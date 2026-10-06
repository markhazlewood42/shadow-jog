import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunnerRefusal, createRunner, execProcess } from '../src/server/runner';
import { type TempRepo, makeTempRepo } from '../fixtures/make-temp-repo';
import { makeTestConfig } from './helpers';

const config = makeTestConfig();
const REPO = config.githubRepo;
const ROOT = config.repoRoot;

/** What the recording exec saw: the command as it would have started. */
type Seen = { cmd: string; args: string[]; cwd: string; timeoutMs: number };

/** A runner on top of a fake exec that records every call and never starts a process. */
function recordingRunner() {
  const seen: Seen[] = [];
  const runner = createRunner(config, async (cmd, args, o) => {
    seen.push({ cmd, args, cwd: o.cwd, timeoutMs: o.timeoutMs });
    return { code: 0, stdout: 'out', stderr: '' };
  });
  return { runner, seen };
}

describe('the runner', () => {
  it('the runner accepts only the listed read commands and the three write shapes, pins --repo to githubRepo, and refuses another --repo, git -c, --output, gh api with -f, -F, --input or a method flag, a cwd outside the roots, git push, gh pr merge, gh issue delete and gh issue edit with other labels', async () => {
    const events = `repos/${REPO}/issues/7/events`;

    // [label, command, what the caller passes, what the process really gets]
    const allowed: [string, 'git' | 'gh', string[], string[]][] = [
      // The git read commands pass through as they are.
      ['git log', 'git', ['log', '--format=%H', '-n', '5'], ['log', '--format=%H', '-n', '5']],
      ['git log with a path', 'git', ['log', '--follow', '--', 'docs/a.md'], ['log', '--follow', '--', 'docs/a.md']],
      ['git for-each-ref', 'git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], ['for-each-ref', '--format=%(refname)', 'refs/heads']],
      ['git show', 'git', ['show', 'abc1234:docs/a.md'], ['show', 'abc1234:docs/a.md']],
      ['git worktree list', 'git', ['worktree', 'list', '--porcelain'], ['worktree', 'list', '--porcelain']],
      ['git rev-parse', 'git', ['rev-parse', '--show-toplevel'], ['rev-parse', '--show-toplevel']],
      // gh pr and gh issue get --repo from the runner, right after the verb.
      ['gh pr list', 'gh', ['pr', 'list', '--json', 'number,title', '--limit', '30'], ['pr', 'list', '--repo', REPO, '--json', 'number,title', '--limit', '30']],
      ['gh pr view', 'gh', ['pr', 'view', '12', '--json', 'state'], ['pr', 'view', '--repo', REPO, '12', '--json', 'state']],
      ['gh issue list', 'gh', ['issue', 'list', '--label', 'decision', '--json', 'number'], ['issue', 'list', '--repo', REPO, '--label', 'decision', '--json', 'number']],
      ['gh issue view', 'gh', ['issue', 'view', '7', '--json', 'title,body,comments'], ['issue', 'view', '--repo', REPO, '7', '--json', 'title,body,comments']],
      // The right --repo from the caller is accepted, and it appears once.
      ['gh pr list with the pinned --repo', 'gh', ['pr', 'list', '--repo', REPO], ['pr', 'list', '--repo', REPO]],
      ['gh issue view with --repo=', 'gh', ['issue', 'view', '7', `--repo=${REPO}`], ['issue', 'view', '--repo', REPO, '7']],
      ['gh issue view with -R', 'gh', ['issue', 'view', '7', '-R', REPO], ['issue', 'view', '--repo', REPO, '7']],
      ['gh issue view with -R and the repo attached', 'gh', ['issue', 'view', '7', `-R${REPO}`], ['issue', 'view', '--repo', REPO, '7']],
      ['gh issue view with -R=', 'gh', ['issue', 'view', '7', `-R=${REPO}`], ['issue', 'view', '--repo', REPO, '7']],
      // Short flags that hold no R and no w are still fine, one by one.
      ['gh pr list with short flags', 'gh', ['pr', 'list', '-L', '30', '-s', 'all', '-d', '-l', 'bug'], ['pr', 'list', '--repo', REPO, '-L', '30', '-s', 'all', '-d', '-l', 'bug']],
      ['gh issue view with -c', 'gh', ['issue', 'view', '7', '-c'], ['issue', 'view', '--repo', REPO, '7', '-c']],
      ['gh pr list with a search that starts with a dash, written with --search=', 'gh', ['pr', 'list', '--search=-label:wip'], ['pr', 'list', '--repo', REPO, '--search=-label:wip']],
      // gh auth status and gh api have no --repo flag, so they get none.
      ['gh auth status', 'gh', ['auth', 'status'], ['auth', 'status']],
      ['gh api events', 'gh', ['api', events], ['api', events]],
      ['gh api events with read-only flags', 'gh', ['api', events, '--paginate', '--jq', '.[].event'], ['api', events, '--paginate', '--jq', '.[].event']],
      // The three write shapes.
      ['gh issue comment', 'gh', ['issue', 'comment', '7', '--body', 'Decision: A. Looks fine.'], ['issue', 'comment', '--repo', REPO, '7', '--body', 'Decision: A. Looks fine.']],
      ['gh issue edit (labels in one order)', 'gh', ['issue', 'edit', '7', '--add-label', 'decided', '--remove-label', 'decision'], ['issue', 'edit', '--repo', REPO, '7', '--add-label', 'decided', '--remove-label', 'decision']],
      ['gh issue edit (labels in the other order)', 'gh', ['issue', 'edit', '7', '--remove-label', 'decision', '--add-label', 'decided'], ['issue', 'edit', '--repo', REPO, '7', '--remove-label', 'decision', '--add-label', 'decided']],
      ['gh issue close', 'gh', ['issue', 'close', '7'], ['issue', 'close', '--repo', REPO, '7']],
    ];

    for (const [label, cmd, args, expected] of allowed) {
      const { runner, seen } = recordingRunner();
      const result = await runner(cmd, args);
      expect(result, label).toEqual({ code: 0, stdout: 'out', stderr: '' });
      expect(seen, label).toHaveLength(1);
      expect(seen[0]?.cmd, label).toBe(cmd);
      expect(seen[0]?.args, label).toEqual(expected);
    }

    const refused: [string, string, string[], { cwd?: string }?][] = [
      // git: only the listed read commands.
      ['git push', 'git', ['push']],
      ['git push origin main', 'git', ['push', 'origin', 'main']],
      ['git commit', 'git', ['commit', '-m', 'x']],
      ['git fetch', 'git', ['fetch']],
      ['git checkout', 'git', ['checkout', 'main']],
      ['git reset', 'git', ['reset', '--hard']],
      ['git config', 'git', ['config', 'user.name', 'x']],
      ['git branch', 'git', ['branch', '-D', 'x']],
      ['git worktree add', 'git', ['worktree', 'add', '../x']],
      ['git worktree remove', 'git', ['worktree', 'remove', 'x']],
      ['git worktree with no verb', 'git', ['worktree']],
      // git: an option before the command is how -c runs a program, so none is allowed there.
      ['git -c', 'git', ['-c', 'core.pager=evil', 'log']],
      ['git -c core.fsmonitor', 'git', ['-c', 'core.fsmonitor=evil', 'rev-parse', 'HEAD']],
      ['git -C', 'git', ['-C', '..', 'log']],
      ['git --git-dir', 'git', ['--git-dir=x', 'log']],
      ['git --exec-path', 'git', ['--exec-path=x', 'log']],
      // git: --output writes a file, also when it is shortened.
      ['git log --output=', 'git', ['log', '--output=out.txt']],
      ['git show --output', 'git', ['show', 'HEAD', '--output', 'out.txt']],
      ['git log --out= (short form)', 'git', ['log', '--out=out.txt']],
      ['git log --o', 'git', ['log', '--o=out.txt']],
      // gh: only the listed commands.
      ['gh pr merge', 'gh', ['pr', 'merge', '3']],
      ['gh pr create', 'gh', ['pr', 'create']],
      ['gh pr close', 'gh', ['pr', 'close', '3']],
      ['gh pr edit', 'gh', ['pr', 'edit', '3', '--add-label', 'x']],
      ['gh pr comment', 'gh', ['pr', 'comment', '3', '--body', 'x']],
      ['gh pr checkout', 'gh', ['pr', 'checkout', '3']],
      ['gh issue delete', 'gh', ['issue', 'delete', '7']],
      ['gh issue create', 'gh', ['issue', 'create', '--title', 'x']],
      ['gh issue reopen', 'gh', ['issue', 'reopen', '7']],
      ['gh repo delete', 'gh', ['repo', 'delete', REPO]],
      ['gh auth login', 'gh', ['auth', 'login']],
      ['gh auth token', 'gh', ['auth', 'token']],
      ['gh auth status --show-token', 'gh', ['auth', 'status', '--show-token']],
      ['gh auth status -t', 'gh', ['auth', 'status', '-t']],
      ['gh workflow run', 'gh', ['workflow', 'run', 'ci.yml']],
      ['gh secret list', 'gh', ['secret', 'list']],
      ['gh config set', 'gh', ['config', 'set', 'editor', 'evil']],
      ['gh extension install', 'gh', ['extension', 'install', 'x/y']],
      ['gh alias set', 'gh', ['alias', 'set', 'a', 'b']],
      ['gh with no arguments', 'gh', []],
      // gh: --repo must be the pinned repo, in every spelling.
      ['gh pr list --repo other', 'gh', ['pr', 'list', '--repo', 'someone/else']],
      ['gh pr list -R other', 'gh', ['pr', 'list', '-R', 'someone/else']],
      ['gh pr list -Rother', 'gh', ['pr', 'list', '-Rsomeone/else']],
      ['gh issue view --repo=other', 'gh', ['issue', 'view', '7', '--repo=someone/else']],
      ['gh pr list --repo with no value', 'gh', ['pr', 'list', '--repo']],
      ['gh auth status --repo', 'gh', ['auth', 'status', '--repo', REPO]],
      ['gh api --repo', 'gh', ['api', events, '--repo', REPO]],
      // gh: view takes a plain number, so a URL or a branch cannot point at another repo.
      ['gh pr view with a URL', 'gh', ['pr', 'view', 'https://github.com/someone/else/pull/1']],
      ['gh pr view with a branch', 'gh', ['pr', 'view', 'feature-branch']],
      ['gh issue view with no number', 'gh', ['issue', 'view']],
      ['gh issue view with a word', 'gh', ['issue', 'view', 'abc']],
      ['gh pr list with a positional', 'gh', ['pr', 'list', '12']],
      ['gh pr view --web', 'gh', ['pr', 'view', '12', '--web']],
      ['gh issue list -w', 'gh', ['issue', 'list', '-w']],
      // gh (pflag) reads several short flags in one argument: -cR other/repo is -c and -R other/repo,
      // and -wR is -w and -R. Any one-dash group that holds R or w is refused, even with the right repo.
      ['gh issue view -cR other', 'gh', ['issue', 'view', '7', '-cR', 'other/repo']],
      ['gh pr list -wR other', 'gh', ['pr', 'list', '-wR', 'other/repo']],
      ['gh pr list -dR other', 'gh', ['pr', 'list', '-dR', 'other/repo']],
      ['gh issue view -cRother/repo', 'gh', ['issue', 'view', '7', '-cRother/repo']],
      ['gh issue view -cR=other/repo', 'gh', ['issue', 'view', '7', '-cR=other/repo']],
      ['gh issue view -cR with the right repo', 'gh', ['issue', 'view', '7', '-cR', REPO]],
      ['gh issue view -cw', 'gh', ['issue', 'view', '7', '-cw']],
      ['gh pr list -dw', 'gh', ['pr', 'list', '-dw']],
      ['gh pr list -wd', 'gh', ['pr', 'list', '-wd']],
      // -R= takes the text after the = as the repo, so it counts like -R.
      ['gh pr list -R=other', 'gh', ['pr', 'list', '-R=someone/else']],
      ['gh pr list -R with no value', 'gh', ['pr', 'list', '-R']],
      ['gh pr list the right --repo and then another -R', 'gh', ['pr', 'list', '--repo', REPO, '-R', 'someone/else']],
      // A flag that is only on or off also takes =true, so every spelling of --web is refused.
      ['gh issue view --web=true', 'gh', ['issue', 'view', '7', '--web=true']],
      ['gh pr list --web=false', 'gh', ['pr', 'list', '--web=false']],
      // A known cost of the rule: a value with one dash and a w or R in it is refused too (write it as --search=-label:wip).
      ['gh pr list with a value like -label:wip', 'gh', ['pr', 'list', '--search', '-label:wip']],
      // gh api: one exact read path, and no flag that sends data or changes the method.
      ['gh api other repo', 'gh', ['api', 'repos/someone/else/issues/7/events']],
      ['gh api another endpoint', 'gh', ['api', `repos/${REPO}/issues/7/comments`]],
      ['gh api graphql', 'gh', ['api', 'graphql']],
      ['gh api with a leading slash', 'gh', ['api', `/${events}`]],
      ['gh api with a query string', 'gh', ['api', `${events}?per_page=1`]],
      ['gh api with a word for the issue number', 'gh', ['api', `repos/${REPO}/issues/seven/events`]],
      ['gh api with a longer path', 'gh', ['api', `${events}/extra`]],
      ['gh api with no path', 'gh', ['api']],
      ['gh api -f', 'gh', ['api', events, '-f', 'a=b']],
      ['gh api -F', 'gh', ['api', events, '-F', 'a=b']],
      ['gh api --raw-field', 'gh', ['api', events, '--raw-field', 'a=b']],
      ['gh api --field', 'gh', ['api', events, '--field=a=b']],
      ['gh api --input', 'gh', ['api', events, '--input', 'body.json']],
      ['gh api -X', 'gh', ['api', events, '-X', 'POST']],
      ['gh api -XPOST', 'gh', ['api', events, '-XPOST']],
      ['gh api --method', 'gh', ['api', events, '--method', 'DELETE']],
      ['gh api --method=', 'gh', ['api', events, '--method=PATCH']],
      ['gh api -H', 'gh', ['api', events, '-H', 'X-HTTP-Method-Override: DELETE']],
      // The write shapes are exact.
      ['gh issue edit with another label added', 'gh', ['issue', 'edit', '7', '--add-label', 'bug']],
      ['gh issue edit adding decided only', 'gh', ['issue', 'edit', '7', '--add-label', 'decided']],
      ['gh issue edit with the labels swapped around', 'gh', ['issue', 'edit', '7', '--add-label', 'decision', '--remove-label', 'decided']],
      ['gh issue edit with an extra label', 'gh', ['issue', 'edit', '7', '--add-label', 'decided', '--remove-label', 'decision', '--add-label', 'extra']],
      ['gh issue edit with a body', 'gh', ['issue', 'edit', '7', '--body', 'x']],
      ['gh issue edit with a title and the labels', 'gh', ['issue', 'edit', '7', '--add-label', 'decided', '--remove-label', 'decision', '--title', 'x']],
      ['gh issue edit with no number', 'gh', ['issue', 'edit', '--add-label', 'decided', '--remove-label', 'decision']],
      ['gh issue close with a reason', 'gh', ['issue', 'close', '7', '--reason', 'not planned']],
      ['gh issue close with a comment', 'gh', ['issue', 'close', '7', '--comment', 'x']],
      ['gh issue close with a word', 'gh', ['issue', 'close', 'seven']],
      ['gh issue comment with no body', 'gh', ['issue', 'comment', '7']],
      ['gh issue comment with an empty body', 'gh', ['issue', 'comment', '7', '--body', '   ']],
      ['gh issue comment with a body file', 'gh', ['issue', 'comment', '7', '--body-file', 'x.txt']],
      ['gh issue comment with an editor', 'gh', ['issue', 'comment', '7', '--body', 'x', '--editor']],
      ['gh issue comment with a word for the number', 'gh', ['issue', 'comment', 'seven', '--body', 'x']],
      ['gh issue comment with a huge body', 'gh', ['issue', 'comment', '7', '--body', 'x'.repeat(70_000)]],
      // A working folder must be inside a root, compared by whole path segments.
      ['a cwd in the temp folder', 'git', ['log'], { cwd: join(tmpdir(), 'elsewhere') }],
      ['a cwd that shares a name prefix with a root', 'git', ['log'], { cwd: `${ROOT}-old` }],
      ['a cwd that climbs out of a root', 'git', ['log'], { cwd: join(ROOT, '..', 'elsewhere') }],
      ['a cwd for gh outside the roots', 'gh', ['auth', 'status'], { cwd: join(tmpdir(), 'elsewhere') }],
      // Anything that is not git or gh.
      ['another program', 'rm', ['-rf', 'x']],
      ['git.exe spelled out', 'git.exe', ['log']],
      ['a path to a program', 'C:\\tools\\git', ['log']],
    ];

    const { runner, seen } = recordingRunner();
    for (const [label, cmd, args, o] of refused) {
      await expect(runner(cmd as 'git', args, o), label).rejects.toBeInstanceOf(RunnerRefusal);
    }
    // None of them reached the exec: a refusal happens before anything starts.
    expect(seen).toEqual([]);
  });

  it('a refusal says what was refused and why, without echoing a comment body', async () => {
    const { runner } = recordingRunner();
    const secretBody = 'a body that must not be echoed into an error message';
    const error = await runner('gh', ['issue', 'edit', '7', '--add-label', 'bug', '--body', secretBody]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerRefusal);
    expect((error as Error).message).toMatch(/gh issue edit/);
    expect((error as Error).message).not.toContain(secretBody);

    // An option in front of the git command is named as the reason (it is how -c makes git run a program).
    const early = await runner('git', ['-c', 'core.pager=evil', 'log']).catch((e: unknown) => e);
    expect((early as Error).message).toMatch(/^git refused: -c before the command/);
    const output = await runner('git', ['log', '--output=out.txt']).catch((e: unknown) => e);
    expect((output as Error).message).toMatch(/^git log refused: --output would write a file/);
  });

  it('runs in the repo root unless a cwd inside a root is given, and passes the timeout on', async () => {
    const { runner, seen } = recordingRunner();
    await runner('git', ['log']);
    await runner('git', ['log'], { cwd: join(ROOT, 'docs') });
    await runner('git', ['log'], { cwd: config.roots[1] as string, timeoutMs: 1234 });
    expect(seen.map((s) => s.cwd)).toEqual([resolve(ROOT), resolve(ROOT, 'docs'), resolve(config.roots[1] as string)]);
    expect(seen[0]?.timeoutMs).toBeGreaterThan(0);
    expect(seen[2]?.timeoutMs).toBe(1234);
    await expect(runner('git', ['log'], { timeoutMs: 0 })).rejects.toBeInstanceOf(RunnerRefusal);
    await expect(runner('git', ['log'], { timeoutMs: 3_600_000 })).rejects.toBeInstanceOf(RunnerRefusal);
  });

  describe('with the real git', () => {
    let repo: TempRepo;
    beforeAll(() => {
      repo = makeTempRepo();
    });
    afterAll(() => repo.remove());

    it('runs an allowed git command in a real repo and gives back its output', async () => {
      const realConfig = makeTestConfig({ repoRoot: repo.dir, roots: [repo.dir] });
      const runner = createRunner(realConfig);
      const log = await runner('git', ['log', '--format=%s']);
      expect(log.code).toBe(0);
      expect(log.stdout.trim().split(/\r?\n/)).toEqual(['Add the second doc', 'Add the first doc']);
      const top = await runner('git', ['rev-parse', '--show-toplevel']);
      expect(resolve(top.stdout.trim()).toLowerCase()).toBe(resolve(repo.dir).toLowerCase());
      // A git error is a result with a non-zero code, not an exception.
      const bad = await runner('git', ['show', 'no-such-ref']);
      expect(bad.code).not.toBe(0);
      expect(bad.stderr).not.toBe('');
    });
  });
});

describe('execProcess', () => {
  const here = { cwd: process.cwd(), timeoutMs: 10_000 };

  it('gives back the exit code, stdout and stderr of a process that ran', async () => {
    const ok = await execProcess(process.execPath, ['-e', 'process.stdout.write("hi"); process.stderr.write("warn")'], here);
    expect(ok).toEqual({ code: 0, stdout: 'hi', stderr: 'warn' });
    const failed = await execProcess(process.execPath, ['-e', 'process.stderr.write("bad"); process.exit(3)'], here);
    expect(failed).toEqual({ code: 3, stdout: '', stderr: 'bad' });
  });

  it('reports a missing program as code 127 instead of throwing', async () => {
    const result = await execProcess('cc-no-such-program', [], here);
    expect(result.code).toBe(127);
    expect(result.stderr).toContain('cc-no-such-program');
    expect(result.stderr).toContain('command not found');
  });

  it('says so when the working folder is missing, not that the program is missing', async () => {
    const result = await execProcess(process.execPath, ['-e', '0'], { cwd: join(tmpdir(), 'cc-no-such-folder-xyz'), timeoutMs: 5000 });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('working folder does not exist');
  });

  it('stops a process that runs too long and reports code 124', async () => {
    const started = Date.now();
    const result = await execProcess(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { cwd: process.cwd(), timeoutMs: 400 });
    expect(result.code).toBe(124);
    expect(result.stderr).toContain('timed out');
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it('closes stdin, so a program that waits for input does not hang', async () => {
    const result = await execProcess(process.execPath, ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("eof"))'], here);
    expect(result).toEqual({ code: 0, stdout: 'eof', stderr: '' });
  });
});
