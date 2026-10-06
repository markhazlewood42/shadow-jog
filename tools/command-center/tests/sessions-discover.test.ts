import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PanelError } from '../src/server/source';
import { cwdInsideRoots, findScriptName, keepSession, listSessionFiles, listSessionTree, sessionSources } from '../src/server/sessions/discover';
import { INSIDE, MIXED_FOLDER, NOW, OUTSIDE, PREFIX_ONLY, ROOT, ROOT_PHASER, WHOLE_FOLDER, sessionsConfig, writeAged } from './sessions-helpers';

// How the module decides which files and folders are about Shadow Jog: the folders are named one by one,
// a session that sits in a mixed folder is kept only by its working folder, and a working folder is
// compared by whole path segments.

const parent = mkdtempSync(join(tmpdir(), 'cc-discover-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

const ROOTS = [ROOT, ROOT_PHASER];

describe('cwdInsideRoots', () => {
  it('the cwd match is by path segments, so shadow-jog-old is outside', () => {
    const roots = [resolve('/work/shadow-jog'), resolve('/work/shadow-jog-phaser')];
    expect(cwdInsideRoots('/work/shadow-jog', roots)).toBe(true);
    expect(cwdInsideRoots('/work/shadow-jog/tools/command-center', roots)).toBe(true);
    expect(cwdInsideRoots('/work/shadow-jog-phaser/src', roots)).toBe(true); // the second root
    // A folder that only starts with the root's name is another folder.
    expect(cwdInsideRoots('/work/shadow-jog-old', roots)).toBe(false);
    expect(cwdInsideRoots('/work/shadow-jog-old/shadow-jog', roots)).toBe(false);
    expect(cwdInsideRoots('/work/shadow-jogger', roots)).toBe(false);
    // The folder above a root is not inside it, and a path that climbs out with ".." is not either.
    expect(cwdInsideRoots('/work', roots)).toBe(false);
    expect(cwdInsideRoots('/work/shadow-jog/../elsewhere', roots)).toBe(false);
    expect(cwdInsideRoots('/work/shadow-jog/./tools/../src', roots)).toBe(true);
  });

  it('a cwd that is empty or not a full path is outside, even when the server itself runs inside a root', () => {
    // "." and "tools/x" would be read against the folder the server runs in (inside the repo), so they must not count.
    for (const cwd of ['', '.', 'tools/command-center', '..', ' ']) {
      expect(cwdInsideRoots(cwd, [process.cwd(), resolve(process.cwd(), '..')]), JSON.stringify(cwd)).toBe(false);
    }
  });

  it.skipIf(process.platform !== 'win32')('on Windows a cwd is compared as Windows compares paths: the slash, the case and the drive letter do not matter', () => {
    const roots = ['C:\\Work\\Shadow-Jog'];
    expect(cwdInsideRoots('C:\\Work\\Shadow-Jog\\tools', roots)).toBe(true);
    expect(cwdInsideRoots('c:/work/shadow-jog/tools', roots)).toBe(true);
    expect(cwdInsideRoots('C:\\Work\\Shadow-Jog-Old', roots)).toBe(false);
    expect(cwdInsideRoots('D:\\Work\\Shadow-Jog', roots)).toBe(false);
  });
});

describe('keepSession', () => {
  it('a session whose newest cwd left the root is dropped', () => {
    // It started inside, and its newest line is somewhere else: only the newest cwd counts. In both kinds of folder.
    expect(keepSession('folder', OUTSIDE, ROOTS)).toBe(false);
    expect(keepSession('cwd', OUTSIDE, ROOTS)).toBe(false);
    expect(keepSession('folder', PREFIX_ONLY, ROOTS)).toBe(false);
    expect(keepSession('cwd', PREFIX_ONLY, ROOTS)).toBe(false);
  });

  it('a session whose newest cwd is inside a root is kept', () => {
    expect(keepSession('folder', INSIDE, ROOTS)).toBe(true);
    expect(keepSession('cwd', INSIDE, ROOTS)).toBe(true);
    expect(keepSession('cwd', '/fixture/repo-phaser/src', ROOTS)).toBe(true);
  });

  it('a session with an unknown cwd is kept in a whole folder and dropped in a home-base folder', () => {
    // A whole folder is all Shadow Jog's, so a session that does not say where it works is still its own. A mixed folder proves nothing.
    expect(keepSession('folder', null, ROOTS)).toBe(true);
    expect(keepSession('cwd', null, ROOTS)).toBe(false);
  });
});

describe('sessionSources', () => {
  it('names the folders one by one: the whole folders first, then the mixed ones, and a folder that is in both lists once', () => {
    expect(sessionSources({ folders: ['a', 'b'], cwdMatchFolders: ['c'] })).toEqual([
      { folder: 'a', matchedBy: 'folder' },
      { folder: 'b', matchedBy: 'folder' },
      { folder: 'c', matchedBy: 'cwd' },
    ]);
    // Named in both lists, a folder is a whole folder and is not listed twice.
    expect(sessionSources({ folders: ['a'], cwdMatchFolders: ['a', 'c'] })).toEqual([
      { folder: 'a', matchedBy: 'folder' },
      { folder: 'c', matchedBy: 'cwd' },
    ]);
    expect(sessionSources({ folders: [], cwdMatchFolders: [] })).toEqual([]);
  });
});

describe('listSessionFiles', () => {
  const projects = join(parent, 'projects');

  beforeAll(() => {
    const session = (folder: string, name: string, ageSeconds = 60) => writeAged(join(projects, folder, name), '{"type":"user"}\n', ageSeconds);
    session(WHOLE_FOLDER, 'a-recent.jsonl');
    session(WHOLE_FOLDER, 'b-week-old.jsonl', 604_800 - 1);
    session(WHOLE_FOLDER, 'c-too-old.jsonl', 604_800 + 1);
    session(MIXED_FOLDER, 'd-mixed.jsonl');
    // What lives next to the session files, and is not one of them.
    writeAged(join(projects, WHOLE_FOLDER, 'e-notes.txt'), 'x');
    writeAged(join(projects, WHOLE_FOLDER, 'a-recent.jsonl.bak'), '{"type":"user"}\n'); // a backup of a session file is not a second session
    writeAged(join(projects, WHOLE_FOLDER, 'f-title.json'), '{}');
    writeAged(join(projects, WHOLE_FOLDER, 'a-recent', 'subagents', 'agent-x.jsonl'), '{"type":"user"}\n');
    mkdirSync(join(projects, WHOLE_FOLDER, 'g-folder.jsonl'), { recursive: true }); // a folder that is named like a file
    // Folders that share the start of a listed name. They hold recent session files that would be kept, if they were read.
    session(`${WHOLE_FOLDER}-old`, 'h-prefix.jsonl');
    session(`${WHOLE_FOLDER}-phaser`, 'i-prefix.jsonl');
    session(`${MIXED_FOLDER}-two`, 'j-prefix.jsonl');
    session('fixture', 'k-shorter-name.jsonl');
  });

  it('lists the recent session files of the named folders, with the kind of folder, and nothing else', async () => {
    const files = await listSessionFiles(sessionsConfig(projects), NOW);
    expect(files.map((file) => [file.folder, file.matchedBy, file.id])).toEqual([
      [WHOLE_FOLDER, 'folder', 'a-recent'],
      [WHOLE_FOLDER, 'folder', 'b-week-old'], // exactly inside the week
      [MIXED_FOLDER, 'cwd', 'd-mixed'],
    ]);
    const first = files[0];
    expect(first?.path).toBe(join(projects, WHOLE_FOLDER, 'a-recent.jsonl'));
    expect(first?.size).toBe(Buffer.byteLength('{"type":"user"}\n'));
    expect(Math.abs((first?.mtimeMs ?? 0) - (NOW - 60_000))).toBeLessThan(1); // the file system may keep a fraction of a millisecond
    expect(first?.birthtimeMs).toBeGreaterThan(0);
  });

  it('a folder that only shares a name prefix with a listed folder is not scanned', async () => {
    const files = await listSessionFiles(sessionsConfig(projects), NOW);
    const ids = files.map((file) => file.id);
    for (const sibling of ['h-prefix', 'i-prefix', 'j-prefix', 'k-shorter-name']) expect(ids).not.toContain(sibling);
    expect(new Set(files.map((file) => file.folder))).toEqual(new Set([WHOLE_FOLDER, MIXED_FOLDER]));
    // The folders are read by their exact names. The next test shows that a bigger list reads more, so the list is what decides.
    const more = await listSessionFiles(sessionsConfig(projects, { folders: [WHOLE_FOLDER, `${WHOLE_FOLDER}-old`] }), NOW);
    expect(more.map((file) => file.id)).toContain('h-prefix');
  });

  it('a week is the config setting: a shorter one leaves out the older files', async () => {
    const files = await listSessionFiles(sessionsConfig(projects, { recentSeconds: 3600 }), NOW);
    expect(files.map((file) => file.id)).toEqual(['a-recent', 'd-mixed']);
  });

  it('a file that is exactly as old as the week is still in it, and one a second older is not', async () => {
    const dir = join(parent, 'boundary');
    writeAged(join(dir, WHOLE_FOLDER, 'a-exactly.jsonl'), '{"type":"user"}\n', 604_800);
    writeAged(join(dir, WHOLE_FOLDER, 'b-just-over.jsonl'), '{"type":"user"}\n', 604_801);
    expect((await listSessionFiles(sessionsConfig(dir), NOW)).map((file) => file.id)).toEqual(['a-exactly']);
  });

  it('a folder that is missing, or that is a file, is no error: there are no sessions in it', async () => {
    const config = sessionsConfig(projects, { folders: ['not-there', WHOLE_FOLDER, 'a-file'], cwdMatchFolders: [] });
    writeFileSync(join(projects, 'a-file'), 'this is a file');
    expect((await listSessionFiles(config, NOW)).map((file) => file.id)).toEqual(['a-recent', 'b-week-old']);
    // The whole projects folder missing is the same: a machine that has no Claude folder yet has no sessions.
    expect(await listSessionFiles(sessionsConfig(join(parent, 'no-projects-here')), NOW)).toEqual([]);
  });

  it('a folder that cannot be read is an error that names the folder and the reason, and nothing else', async () => {
    // A name that Windows and Linux both refuse to open as a folder: a null character cannot be in a path.
    const config = sessionsConfig(projects, { folders: ['bad\0name'], cwdMatchFolders: [] });
    const error = await listSessionFiles(config, NOW).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PanelError);
    expect((error as PanelError).code).toBe('sessions-unreadable');
    expect((error as PanelError).message).toContain('bad');
    expect((error as PanelError).message).not.toContain(parent); // no path of this machine
  });
});

describe('listSessionTree', () => {
  const sessionDir = join(parent, 'tree', 'session-1');

  beforeAll(() => {
    const agent = (relative: string, ageSeconds = 60) => writeAged(join(sessionDir, relative), '{"type":"user"}\n', ageSeconds);
    agent('subagents/agent-aaa.jsonl');
    agent('subagents/agent-aaa.meta.json');
    agent('subagents/agent-old.jsonl', 604_800 + 10); // older than a week
    agent('subagents/agent-bad name.jsonl'); // not a name that Claude Code makes
    agent('subagents/notes.jsonl');
    agent('subagents/agent-bbb.txt');
    agent('subagents/workflows/wf_1111-aaa/journal.jsonl');
    agent('subagents/workflows/wf_1111-aaa/agent-w1.jsonl');
    agent('subagents/workflows/wf_1111-aaa/agent-w2.jsonl', 120);
    agent('subagents/workflows/wf_2222-bbb/journal.jsonl', 604_800 + 10); // a whole run that is old
    agent('subagents/workflows/wf_2222-bbb/agent-w3.jsonl', 604_800 + 10);
    agent('subagents/workflows/wf_3333-ccc/agent-w4.jsonl'); // an agent file and no journal (the journal is missing, or not yet written)
    agent('subagents/workflows/not a run/agent-w5.jsonl');
  });

  it('finds the agents of a session and the agents and journals of its workflow runs, and leaves out what is older than the week or is not an agent file', async () => {
    const tree = await listSessionTree(sessionDir, NOW, 604_800);
    expect(tree.agents.map((agent) => [agent.id, agent.workflowId])).toEqual([['aaa', null]]);
    expect(tree.workflows.map((run) => run.id).sort()).toEqual(['wf_1111-aaa', 'wf_3333-ccc']);

    const run = tree.workflows.find((candidate) => candidate.id === 'wf_1111-aaa');
    expect(run?.journal?.path).toBe(join(sessionDir, 'subagents', 'workflows', 'wf_1111-aaa', 'journal.jsonl'));
    expect(run?.agents.map((agent) => [agent.id, agent.workflowId]).sort()).toEqual([
      ['w1', 'wf_1111-aaa'],
      ['w2', 'wf_1111-aaa'],
    ]);
    expect(Math.abs((run?.agents.find((agent) => agent.id === 'w2')?.mtimeMs ?? 0) - (NOW - 120_000))).toBeLessThan(1);
    expect(tree.workflows.find((candidate) => candidate.id === 'wf_3333-ccc')?.journal).toBeNull();
  });

  it('a session with no folder of its own has no agents and no workflows, and that is not an error', async () => {
    expect(await listSessionTree(join(parent, 'tree', 'no-such-session'), NOW, 604_800)).toEqual({ agents: [], workflows: [] });
  });
});

describe('findScriptName', () => {
  const projects = join(parent, 'scripts');
  const script = (folder: string, session: string, file: string) => writeAged(join(projects, folder, session, 'workflows', 'scripts', file), '// a synthetic script\n');

  beforeAll(() => {
    script(WHOLE_FOLDER, 'session-1', 'build-the-thing-wf_1111-aaa.js');
    script(MIXED_FOLDER, 'session-2', 'review-wf_2222-bbb.js');
    script(`${WHOLE_FOLDER}-old`, 'session-3', 'hidden-wf_3333-ccc.js'); // a folder that is not named
    script(WHOLE_FOLDER, 'session-1', 'xwf_4444-ddd.js');
    script(WHOLE_FOLDER, 'session-1', 'other-wf_5555-eee.js');
    // Files that hold an id and are not the script of it: the id is not at the end of the name.
    script(WHOLE_FOLDER, 'session-1', 'a-script-wf_7777-ggg.js.bak');
    script(WHOLE_FOLDER, 'session-1', 'another-wf_8888-hhh-extra.js');
  });

  it('the name of a workflow is the script file name without the id, found in the folder of the launch cwd', async () => {
    const config = sessionsConfig(projects);
    // The script of a session whose file is in one folder can be in another named folder: the folder where the launch cwd was.
    expect(await findScriptName(config, 'session-1', 'wf_1111-aaa')).toBe('build-the-thing');
    expect(await findScriptName(config, 'session-2', 'wf_2222-bbb')).toBe('review');
    // Another session's folder never gives its names to this one.
    expect(await findScriptName(config, 'session-2', 'wf_1111-aaa')).toBeNull();
  });

  it('gives null when no named folder has the script, and never reads a folder that is not named', async () => {
    const config = sessionsConfig(projects);
    expect(await findScriptName(config, 'session-3', 'wf_3333-ccc')).toBeNull();
    expect(await findScriptName(config, 'session-1', 'wf_9999-zzz')).toBeNull();
    // An id that is the end of another id is not that id: only "-<id>.js" is the script of <id>.
    expect(await findScriptName(config, 'session-1', 'wf_4444-ddd')).toBeNull();
    expect(await findScriptName(config, 'session-1', 'wf_5555-eee')).toBe('other');
    // A file that has the id in the middle of its name, or that ends in something else, is not the script either.
    expect(await findScriptName(config, 'session-1', 'wf_7777-ggg')).toBeNull();
    expect(await findScriptName(config, 'session-1', 'wf_8888-hhh')).toBeNull();
  });

  it('a script file that has no name before the id gives no name', async () => {
    script(WHOLE_FOLDER, 'session-6', '-wf_6666-fff.js');
    expect(await findScriptName(sessionsConfig(projects), 'session-6', 'wf_6666-fff')).toBeNull();
  });
});
