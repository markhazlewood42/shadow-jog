import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE_LIMITS,
  agentStateOf,
  classifySession,
  countLineTypes,
  extractPrs,
  extractYourMove,
  hasConversationCwd,
  hasCwd,
  isDecisive,
  lastDecisiveTime,
  newestBranch,
  newestCwd,
  promptOf,
  readActivity,
  readJournal,
  readTitles,
  titleFromPrompt,
  workflowStateOf,
} from '../src/server/sessions/parse';
import {
  INSIDE,
  NOW,
  OUTSIDE,
  PREFIX_ONLY,
  ROOT,
  ROOT_PHASER,
  agentName,
  assistantText,
  assistantToolUse,
  at,
  attachment,
  box,
  costState,
  customTitle,
  lastPrompt,
  modeLine,
  prLink,
  systemLine,
  taskNotification,
  toolResult,
  userPrompt,
} from './sessions-helpers';
import { PACKAGE_DIR } from './helpers';

// The parsers of the lines of a session file. They take lines (JSON values) and never touch a file.
// A line can be anything that JSON can hold, so none of them may throw for a line that is not what
// they expect.

const ROOTS = [ROOT, ROOT_PHASER];

/** The state of lines that were written `ageSeconds` ago, with the limits of the shipped config. */
const stateOf = (lines: unknown[], ageSeconds = 30) => classifySession(lines, NOW - ageSeconds * 1000, NOW);

describe('line types', () => {
  it('unknown line types are skipped and counted, no throw', () => {
    const lines: unknown[] = [
      userPrompt('a prompt'),
      { type: 'from-the-future', x: 1 }, // a line type that a later Claude Code may write
      42,
      'text',
      null,
      [1, 2],
      {},
      { type: 7 },
      assistantText('a reply'),
      lastPrompt(),
    ];
    // Three lines are of a type that this module knows. The seven others are counted as unknown, and nothing throws.
    expect(countLineTypes(lines)).toEqual({ known: 3, unknown: 7 });
    expect(countLineTypes([])).toEqual({ known: 0, unknown: 0 });

    // Every parser reads past them. The newest line that it can read decides, as if the others were not there.
    expect(stateOf(lines)).toEqual({ state: 'waiting', reason: 'the last reply ended its turn' });
    expect(newestCwd(lines)).toBe(INSIDE);
    expect(newestBranch(lines)).toBe('fixture-branch');
    expect(readTitles(lines)).toEqual({ custom: null, agent: null, slug: null });
    expect(extractPrs(lines, 'octo-owner/octo-repo')).toEqual([]);
    expect(extractYourMove(lines, ROOTS)).toBeNull();
    expect(readJournal(lines).known).toBe(0);
  });

  it('knows every line type that the real files of Claude Code 2.1 were seen to hold', () => {
    const seen = ['user', 'assistant', 'attachment', 'system', 'custom-title', 'agent-name', 'ai-title', 'pr-link', 'last-prompt', 'cost-state', 'mode', 'permission-mode', 'queue-operation', 'file-history-snapshot', 'file-history-delta', 'bridge-session', 'dev-mods', 'atis-latch'];
    expect(countLineTypes(seen.map((type) => ({ type })))).toEqual({ known: seen.length, unknown: 0 });
  });
});

describe('classifySession', () => {
  it('no known line type in the tail gives state unknown and the error "unknown file format"', () => {
    const unknownFormat = { state: 'unknown', reason: 'unknown file format' };
    expect(stateOf([{ type: 'from-the-future' }, { kind: 'x' }, 42])).toEqual(unknownFormat);
    // A window that holds no line at all (an empty file, or a last line that is longer than the window) is the same.
    expect(stateOf([])).toEqual(unknownFormat);
    // The age of the file does not turn a state that is not known into another one.
    expect(classifySession([{ type: 'zzz' }], 0, NOW)).toEqual(unknownFormat);
    // The type names are known but no user or assistant line is in the part that was read: the format is known, the answer is not.
    expect(stateOf([lastPrompt(), modeLine(), costState()])).toEqual({ state: 'unknown', reason: 'no user or assistant line in the part of the file that was read' });
  });

  it('state: assistant end_turn is waiting, a tool_result or task-notification after it is working, an old mtime is idle', () => {
    const reply = assistantText('Done.'); // stop_reason end_turn
    // The reply ended its turn: the session waits for Mark.
    expect(stateOf([userPrompt('go'), reply])).toEqual({ state: 'waiting', reason: 'the last reply ended its turn' });
    // After that reply, a tool result or a message from a background task starts work again. So does a new prompt.
    expect(stateOf([reply, toolResult('output')]).state).toBe('working');
    expect(stateOf([reply, taskNotification('a task finished')]).state).toBe('working');
    expect(stateOf([reply, userPrompt('and now this')]).state).toBe('working');
    // A reply that is not over (it asks for a tool, or is still being written) is work in progress.
    expect(stateOf([assistantToolUse('Bash', { command: 'ls' })]).state).toBe('working');
    expect(stateOf([assistantText('half a reply', { stop: null })]).state).toBe('working');
    // A stop reason that this does not know is not taken for an end of turn.
    expect(stateOf([assistantText('?', { stop: 'a_new_reason' })]).state).toBe('working');
    // Other ways that a turn ends: the model stopped at a stop sequence, a tool ended the turn (an agent hands its result back), Mark interrupted it.
    expect(stateOf([assistantText('x', { stop: 'stop_sequence' })]).state).toBe('waiting');
    expect(stateOf([assistantToolUse('SubagentHandback', {}), { ...toolResult('handed back'), toolEndsTurn: true }]).state).toBe('waiting');
    expect(stateOf([assistantToolUse('Bash', {}), userPrompt('[Request interrupted by user]')]).state).toBe('waiting');
    expect(stateOf([assistantToolUse('Bash', {}), { ...userPrompt('x'), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }]).state).toBe('waiting');

    // An old file is idle. Work that is in progress is idle after workingSeconds (300), a turn that ended after waitingSeconds (14 400).
    expect(stateOf([assistantToolUse('Bash', {})], 300).state).toBe('working');
    expect(stateOf([assistantToolUse('Bash', {})], 301).state).toBe('idle');
    expect(stateOf([reply], 14_400).state).toBe('waiting');
    expect(stateOf([reply], 14_401)).toEqual({ state: 'idle', reason: 'no write for more than 4 hours' });
    expect(stateOf([reply, toolResult('x')], 301).state).toBe('idle');
    // A file time that is ahead of the clock (the two clocks differ a little) is not an old file.
    expect(classifySession([assistantToolUse('Bash', {})], NOW + 5_000, NOW).state).toBe('working');
  });

  it('metadata, system and attachment lines never decide the state', () => {
    const waiting = { state: 'waiting', reason: 'the last reply ended its turn' };
    const noise = [attachment('a hook ran'), systemLine(), lastPrompt(), costState(), modeLine(), customTitle('A title'), prLink(1, 'a/b'), { type: 'queue-operation', operation: 'enqueue' }];
    // Whatever follows the last reply, in any number and in any order, the session still waits.
    expect(stateOf([assistantText('Done.'), ...noise])).toEqual(waiting);
    expect(stateOf([assistantText('Done.'), ...[...noise].reverse()])).toEqual(waiting);
    // And after a reply that asks for a tool, they do not turn the session into a waiting one.
    expect(stateOf([assistantToolUse('Bash', {}), ...noise]).state).toBe('working');
    // A message that the tool injected into the conversation (isMeta) is not a prompt and decides nothing.
    expect(stateOf([assistantText('Done.'), userPrompt('injected context', {}, { isMeta: true })])).toEqual(waiting);
    // Only noise: no line that decides.
    expect(stateOf(noise).state).toBe('unknown');
  });

  it('the limits are the ones of the shipped config', () => {
    const config = JSON.parse(readFileSync(join(PACKAGE_DIR, 'command-center.config.json'), 'utf8')) as { claude: { workingSeconds: number; waitingSeconds: number } };
    expect(DEFAULT_STATE_LIMITS).toEqual({ workingSeconds: config.claude.workingSeconds, waitingSeconds: config.claude.waitingSeconds });
    // A caller passes its own limits (the module passes the config's).
    const lines = [assistantToolUse('Bash', {})];
    expect(classifySession(lines, NOW - 10_000, NOW, { workingSeconds: 5, waitingSeconds: 10 }).state).toBe('idle');
    expect(classifySession(lines, NOW - 10_000, NOW, { workingSeconds: 60, waitingSeconds: 10 }).state).toBe('working');
    // The reason of an idle session says the limit in words, in the singular where it is one.
    const reasonAt = (limits: { workingSeconds: number; waitingSeconds: number }) => classifySession(lines, 0, NOW, limits).reason;
    expect(reasonAt({ workingSeconds: 60, waitingSeconds: 10 })).toBe('no write for more than 1 minute');
    expect(reasonAt({ workingSeconds: 3600, waitingSeconds: 10 })).toBe('no write for more than 1 hour');
    expect(reasonAt({ workingSeconds: 90, waitingSeconds: 10 })).toBe('no write for more than 90 seconds');
    expect(reasonAt({ workingSeconds: 7200, waitingSeconds: 10 })).toBe('no write for more than 2 hours');
  });

  it('readActivity says what the end of the lines is, without the age', () => {
    expect(readActivity([assistantText('x')]).kind).toBe('turn-ended');
    expect(readActivity([assistantToolUse('Bash', {})]).kind).toBe('in-turn');
    expect(readActivity([lastPrompt()]).kind).toBe('unknown');
    expect(isDecisive(assistantText('x'))).toBe(true);
    expect(isDecisive(userPrompt('x'))).toBe(true);
    expect(isDecisive(userPrompt('x', {}, { isMeta: true }))).toBe(false);
    for (const line of [attachment('x'), systemLine(), lastPrompt(), 42, null, 'user']) expect(isDecisive(line)).toBe(false);
  });
});

describe('the working folder and the other facts of a line', () => {
  it('a trailing metadata line without a cwd does not hide the cwd of the last reply', () => {
    // An idle session ends in lines that have no working folder. The folder of the last reply is still the folder of the session.
    const lines = [userPrompt('a', { cwd: '/fixture/first' }), assistantText('b', { cwd: '/fixture/second' }), lastPrompt(), costState(), modeLine(), customTitle('A title')];
    expect(newestCwd(lines)).toBe('/fixture/second');
    expect(newestBranch([...lines, { type: 'mode' }])).toBe('fixture-branch');
  });

  it('the newest line that has a cwd decides, whatever its type, and a cwd that is empty or not text is no cwd', () => {
    expect(newestCwd([assistantText('b', { cwd: '/fixture/second' }), attachment('x', { cwd: '/fixture/third' })])).toBe('/fixture/third');
    expect(newestCwd([assistantText('b', { cwd: '/fixture/second' }), { type: 'user', cwd: '' }, { type: 'user', cwd: 7 }, { type: 'user', cwd: null }])).toBe('/fixture/second');
    expect(newestCwd([lastPrompt(), modeLine()])).toBeNull();
    expect(newestCwd([])).toBeNull();
    expect(hasCwd(userPrompt('x'))).toBe(true);
    expect(hasCwd(userPrompt('x', { cwd: null }))).toBe(false);
    expect(hasCwd({ cwd: '' })).toBe(false);
    expect(hasCwd('cwd')).toBe(false);
  });

  it('hasConversationCwd: a user or assistant line that has a cwd, and not an attachment or a system line that has one', () => {
    expect(hasConversationCwd(userPrompt('x'))).toBe(true);
    expect(hasConversationCwd(assistantText('x'))).toBe(true);
    expect(hasConversationCwd(userPrompt('x', { cwd: null }))).toBe(false); // a reply with no cwd
    expect(hasConversationCwd(userPrompt('x', {}, { isMeta: true }))).toBe(false); // an injected line is not the conversation
    expect(hasConversationCwd(attachment('x'))).toBe(false);
    expect(hasConversationCwd(systemLine())).toBe(false);
    expect(hasConversationCwd({ type: 'from-the-future', cwd: '/x' })).toBe(false);
    expect(hasConversationCwd(42)).toBe(false);
  });

  it('the branch is the one of the newest line that names one, and an empty name is a name (the folder is not in a git repo)', () => {
    expect(newestBranch([userPrompt('a', { branch: 'old' }), assistantText('b', { branch: 'new' }), lastPrompt()])).toBe('new');
    expect(newestBranch([userPrompt('a', { branch: 'old' }), assistantText('b', { branch: '' })])).toBe('');
    expect(newestBranch([lastPrompt()])).toBeNull();
  });

  it('the title is the newest custom title, the newest agent name and the newest slug, each on its own', () => {
    const lines = [
      customTitle('First name'),
      { ...assistantText('x'), slug: 'old-slug-words' },
      agentName('An agent'),
      customTitle('  Second name  '),
      { ...userPrompt('y'), slug: 'new-slug-words' },
    ];
    // The newest line of each kind decides, with the blank space cut off. The caller picks the first that is there:
    // the custom title, then the agent name, then the slug.
    expect(readTitles(lines)).toEqual({ custom: 'Second name', agent: 'An agent', slug: 'new-slug-words' });
    expect(readTitles([lastPrompt()])).toEqual({ custom: null, agent: null, slug: null });
    // A title that was cleared is no title: the newest line says so, and an older name does not come back.
    expect(readTitles([customTitle('Old name'), customTitle('  '), agentName('Old agent'), agentName('')])).toEqual({ custom: null, agent: null, slug: null });
    // A very long title is cut, so one line of a file cannot make an answer of any size.
    expect(readTitles([customTitle('x'.repeat(1000))]).custom).toHaveLength(200);
  });
});

describe('extractPrs', () => {
  const repo = 'octo-owner/octo-repo';

  it('a pr-link for another repository is ignored', () => {
    const lines = [
      prLink(12, repo),
      prLink(99, 'other-owner/other-repo'),
      prLink(13, 'octo-owner/octo-repo-old'), // the start of the name is not the name
      prLink(14, 'octo-owner'),
      { ...prLink(15, repo), prRepository: undefined },
      assistantText('see https://github.com/other-owner/other-repo/pull/5'),
    ];
    expect(extractPrs(lines, repo)).toEqual([{ number: 12, url: 'https://github.com/octo-owner/octo-repo/pull/12' }]);
    expect(extractPrs([prLink(99, 'other-owner/other-repo')], repo)).toEqual([]);
    expect(extractPrs([], repo)).toEqual([]);
  });

  it('lists each pull request once, in the order the session first linked them, and takes only an http or https address from the file', () => {
    const lines = [
      prLink(12, repo),
      prLink(7, repo),
      { ...prLink(12, repo), prUrl: 'https://github.com/octo-owner/octo-repo/pull/12#issuecomment-1' }, // the same pull request again
      { ...prLink(8, repo), prUrl: 'javascript:alert(1)' }, // not an address that a page may link to
      { ...prLink(9, repo), prUrl: 42 },
      { ...prLink(10, repo), prNumber: '10' }, // the number is a number
      { ...prLink(11, repo), prNumber: -3 },
      { ...prLink(16, repo), prNumber: 1.5 },
    ];
    expect(extractPrs(lines, repo)).toEqual([
      { number: 12, url: 'https://github.com/octo-owner/octo-repo/pull/12#issuecomment-1' },
      { number: 7, url: 'https://github.com/octo-owner/octo-repo/pull/7' },
      { number: 8, url: 'https://github.com/octo-owner/octo-repo/pull/8' },
      { number: 9, url: 'https://github.com/octo-owner/octo-repo/pull/9' },
    ]);
    // GitHub does not tell two spellings of a name apart, so neither does the check.
    expect(extractPrs([prLink(3, 'Octo-Owner/Octo-Repo')], repo).map((pr) => pr.number)).toEqual([3]);
  });
});

describe('extractYourMove', () => {
  it('your move: the last box wins, a "nothing" box gives no items, a human prompt after it marks it answered, a task-notification does not', () => {
    const first = assistantText(box(['Review the diff', 'Tell me to commit']), { time: at(-300) });
    const second = assistantText(box(['Pick the colour']), { time: at(-200) });

    // The last box wins. Both were written inside the project.
    expect(extractYourMove([first, userPrompt('ok', { time: at(-250) }), second], ROOTS)).toEqual({
      light: 'yellow',
      items: ['Pick the colour'],
      nothing: false,
      at: at(-200),
      answered: false,
    });
    // The items are the checklist lines, in order, without the check box.
    expect(extractYourMove([first], ROOTS)?.items).toEqual(['Review the diff', 'Tell me to commit']);

    // A box that says "nothing" has no items, and as the last box it wins over an earlier one that had items.
    const nothing = assistantText(box([], { heading: '### 👉 Your move: nothing' }), { time: at(-100) });
    expect(extractYourMove([first, nothing], ROOTS)).toMatchObject({ nothing: true, items: [], at: at(-100), answered: false });
    const nothingWithWords = assistantText(box([], { heading: '### 👉 Your move: nothing (wait for the PR link)' }));
    expect(extractYourMove([nothingWithWords], ROOTS)).toMatchObject({ nothing: true, items: [] });
    // Items under a "nothing" heading are not Mark's moves either.
    expect(extractYourMove([assistantText(box(['stray line'], { heading: '### 👉 Your move: nothing' }))], ROOTS)).toMatchObject({ nothing: true, items: [] });

    // A prompt of Mark's after the box answers it.
    expect(extractYourMove([first, userPrompt('Done, thanks', { time: at(-250) })], ROOTS)?.answered).toBe(true);
    // A message from a background task does not. Nor does a tool result, a message from another session, an injected line, or an interrupt.
    expect(extractYourMove([first, taskNotification('a task finished')], ROOTS)?.answered).toBe(false);
    expect(extractYourMove([first, toolResult('output')], ROOTS)?.answered).toBe(false);
    expect(extractYourMove([first, userPrompt('from a peer', {}, { origin: { kind: 'peer' } })], ROOTS)?.answered).toBe(false);
    expect(extractYourMove([first, userPrompt('context', {}, { isMeta: true })], ROOTS)?.answered).toBe(false);
    expect(extractYourMove([first, userPrompt('[Request interrupted by user]')], ROOTS)?.answered).toBe(false);
    expect(extractYourMove([first, attachment('x'), systemLine(), lastPrompt()], ROOTS)?.answered).toBe(false);
    // A prompt that came before the box does not answer it. A prompt whose origin says "human" is a prompt.
    expect(extractYourMove([userPrompt('before'), first], ROOTS)?.answered).toBe(false);
    expect(extractYourMove([first, userPrompt('typed', {}, { origin: { kind: 'human' } })], ROOTS)?.answered).toBe(true);
    // The answer is for the last box only: a prompt between two boxes leaves the second one open.
    expect(extractYourMove([first, userPrompt('first answer'), second], ROOTS)?.answered).toBe(false);

    // A reply with no box does not take the last box away. A task that finished can make a session reply with a short line
    // while Mark still has not answered.
    expect(extractYourMove([first, taskNotification('done'), assistantText('A short line, no box.')], ROOTS)).toMatchObject({ items: ['Review the diff', 'Tell me to commit'], answered: false });
    // No box in the lines at all.
    expect(extractYourMove([userPrompt('hi'), assistantText('Hello.')], ROOTS)).toBeNull();
    expect(extractYourMove([], ROOTS)).toBeNull();
  });

  it('the light is the first character of the same reply', () => {
    const light = (text: string) => extractYourMove([assistantText(text)], ROOTS)?.light;
    expect(light(box(['x'], { light: '🟢' }))).toBe('green');
    expect(light(box(['x'], { light: '🟡' }))).toBe('yellow');
    expect(light(box(['x'], { light: '🔴' }))).toBe('red');
    // Blank space before the light does not matter. A reply that starts with anything else has no light.
    expect(light(`\n  ${box(['x'], { light: '🔴' })}`)).toBe('red');
    expect(light(box(['x'], { light: 'ok' }))).toBeNull();
    expect(light('Status: 🟢 fine\n\n### 👉 Your move\n- [ ] x')).toBeNull(); // a light that is not the first character is not the status light

    // The light of the reply that holds the box, never one from an earlier or a later reply.
    const earlier = assistantText('🟢 Everything is fine.', { time: at(-30) });
    const withBox = assistantText(box(['x'], { light: '🔴' }), { time: at(-20) });
    const later = assistantText('🟢 Thanks.', { time: at(-10) });
    expect(extractYourMove([earlier, withBox, later], ROOTS)?.light).toBe('red');
    expect(extractYourMove([earlier, assistantText('### 👉 Your move\n- [ ] x')], ROOTS)?.light).toBeNull();
  });

  it('a box written while cwd was outside a root is ignored', () => {
    const insideBox = assistantText(box(['inside item']), { cwd: INSIDE, time: at(-500) });
    // A reply that was written in a folder that is not inside a root has no say, however new it is.
    for (const cwd of [OUTSIDE, PREFIX_ONLY, null, '', 'tools/example']) {
      expect(extractYourMove([assistantText(box(['outside item']), { cwd })], ROOTS), String(cwd)).toBeNull();
    }
    // The newer box is outside, so the last box inside the project is the older one.
    const outsideBox = assistantText(box(['outside item']), { cwd: OUTSIDE, time: at(-100) });
    expect(extractYourMove([insideBox, outsideBox], ROOTS)).toMatchObject({ items: ['inside item'], at: at(-500) });
    // The second root counts like the first.
    expect(extractYourMove([assistantText(box(['phaser item']), { cwd: '/fixture/repo-phaser/src' })], ROOTS)?.items).toEqual(['phaser item']);
    // The cwd that counts is the one of the reply, not the one of a later line: the session may have moved on.
    expect(extractYourMove([outsideBox, userPrompt('x', { cwd: INSIDE })], ROOTS)).toBeNull();
    // Only a reply of the assistant can hold a box. The same words in a prompt or a tool result are not a box.
    expect(extractYourMove([userPrompt(box(['pasted'])), toolResult(box(['printed']))], ROOTS)).toBeNull();
  });

  it('reads the box as the replies write it: a heading, then list items, until anything else', () => {
    const items = (text: string) => extractYourMove([assistantText(text)], ROOTS)?.items;
    // The heading may be of another level, or without the pointing hand, in any case.
    expect(items('Done.\n\n---\n## Your move\n- [ ] one')).toEqual(['one']);
    expect(items('Done.\n\n#### 👉 YOUR MOVE\n- [ ] one')).toEqual(['one']);
    expect(items('Done.\n\n### 👉️ Your move\n- [ ] one')).toEqual(['one']); // the hand as an emoji, with its variation selector
    // Other bullets are items too. A box that is already ticked is not a move.
    expect(items('### 👉 Your move\n* [ ] star\n+ plus\n1. numbered\n- [x] done already\n- [ ] last')).toEqual(['star', 'plus', 'numbered', 'last']);
    // A wrapped item is one item. Blank lines between items do not end the box. Text, a rule or a heading after the list does.
    expect(items('### 👉 Your move\n- [ ] a long item\n  that wraps\n\n- [ ] second\nA closing line.\n- [ ] not part of it')).toEqual(['a long item that wraps', 'second']);
    expect(items('### 👉 Your move\n- [ ] one\n---\n- [ ] two')).toEqual(['one']);
    // Markdown inside an item stays as it was written.
    expect(items('### 👉 Your move\n- [ ] Run `npm run check` and read **the diff**')).toEqual(['Run `npm run check` and read **the diff**']);
    // A heading with no items is a box with no items (it is not "nothing" unless it says so).
    expect(extractYourMove([assistantText('### 👉 Your move\n')], ROOTS)).toMatchObject({ items: [], nothing: false });
    // The last heading of a reply is the box.
    expect(items('### 👉 Your move\n- [ ] early\n\ntext\n\n### 👉 Your move\n- [ ] late')).toEqual(['late']);
    // A heading that is shown inside a code block (a reply that explains the format) is not a box.
    expect(extractYourMove([assistantText('The format is:\n\n```markdown\n### 👉 Your move\n- [ ] an example\n```\n')], ROOTS)).toBeNull();
    // Other headings that only mention it are not boxes.
    expect(extractYourMove([assistantText('### Your moves so far\n- [ ] x\n\n### What is your move?\n- [ ] y')], ROOTS)).toBeNull();
    // Nothing in a box is longer than a line of a page: an item is cut, and so is a list.
    expect(items(`### 👉 Your move\n- [ ] ${'x'.repeat(2000)}`)?.[0]).toHaveLength(500);
    expect(items(`### 👉 Your move\n${Array.from({ length: 40 }, (_, i) => `- [ ] item ${i}`).join('\n')}`)).toHaveLength(20);
  });

  it('a reply whose text is in several blocks is read as one text, and a reply with no text has no box', () => {
    const parts = { ...assistantText(''), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '🟢 Done.\n' }, { type: 'tool_use', id: 'x', name: 'Bash', input: {} }, { type: 'text', text: '### 👉 Your move\n- [ ] one' }] } };
    expect(extractYourMove([parts], ROOTS)).toMatchObject({ light: 'green', items: ['one'] });
    const stringContent = { ...assistantText(''), message: { role: 'assistant', stop_reason: 'end_turn', content: box(['as a string']) } };
    expect(extractYourMove([stringContent], ROOTS)?.items).toEqual(['as a string']);
    for (const message of [undefined, null, 'text', { content: 7 }, { content: [null, 5, { type: 'text' }] }]) {
      expect(extractYourMove([{ ...assistantText(''), message }], ROOTS), JSON.stringify(message)).toBeNull();
    }
  });
});

describe('the journal of a workflow, and the states of agents and workflows', () => {
  const started = (agentId: string, phase: string) => ({ type: 'started', key: `${phase}/${agentId}`, agentId, label: `label of ${agentId}`, phase });
  const result = (agentId: string) => ({ type: 'result', key: `x/${agentId}`, agentId, result: { text: 'a result' } });

  it('reads the phases in the order the journal names them, with the agents started and done in each', () => {
    const journal = readJournal([
      { type: 'launched' },
      started('a1', 'Research'),
      started('a2', 'Research'),
      started('b1', 'Build'),
      result('a2'),
      started('c1', 'Verify'),
      result('a1'),
      result('c1'),
      { type: 'from-the-future' },
    ]);
    expect(journal.phases).toEqual([
      { name: 'Research', started: 2, done: 2 },
      { name: 'Build', started: 1, done: 0 },
      { name: 'Verify', started: 1, done: 1 },
    ]);
    expect(journal).toMatchObject({ started: 4, done: 3, known: 8 });
    expect(journal.doneIds.sort()).toEqual(['a1', 'a2', 'c1']);
  });

  it('counts an agent once, ignores a result of an agent that never started in the part that was read, and keeps a phase that has no name', () => {
    const journal = readJournal([
      started('a1', 'Research'),
      started('a1', 'Research'), // the same agent again
      result('a1'),
      result('a1'),
      result('ghost'), // its start is not in the part of the journal that was read
      { type: 'started', agentId: 'n1' }, // no phase
      { type: 'started', agentId: '' }, // no agent
      { type: 'started', phase: 'Lost' },
      { type: 'result' },
    ]);
    expect(journal.phases).toEqual([
      { name: 'Research', started: 1, done: 1 },
      { name: '', started: 1, done: 0 },
    ]);
    expect(journal).toMatchObject({ started: 2, done: 1 });
  });

  it('a workflow is done when every agent that started has a result, running while something is being written, and stopped when not', () => {
    const open = readJournal([{ type: 'launched' }, started('a1', 'P'), started('a2', 'P'), result('a1')]);
    const finished = readJournal([{ type: 'launched' }, started('a1', 'P'), result('a1')]);
    expect(workflowStateOf(open, true)).toBe('running');
    expect(workflowStateOf(open, false)).toBe('stopped');
    expect(workflowStateOf(finished, false)).toBe('done');
    expect(workflowStateOf(finished, true)).toBe('done'); // a result for each start is the end, whatever file was written a moment ago
    // A run that has launched and started no agent yet is not done.
    expect(workflowStateOf(readJournal([{ type: 'launched' }]), true)).toBe('running');
    expect(workflowStateOf(readJournal([{ type: 'launched' }]), false)).toBe('stopped');
    // A journal that holds no row that this knows says nothing.
    expect(workflowStateOf(readJournal([]), true)).toBe('unknown');
    expect(workflowStateOf(readJournal([{ type: 'from-the-future' }]), true)).toBe('unknown');
  });

  it('an agent is done when it ended or its workflow has its result, running while its file is fresh, and stopped when it is not', () => {
    expect(agentStateOf({ ended: true, fresh: true, hasResult: false })).toBe('done');
    expect(agentStateOf({ ended: false, fresh: false, hasResult: true })).toBe('done');
    expect(agentStateOf({ ended: false, fresh: true, hasResult: false })).toBe('running');
    expect(agentStateOf({ ended: false, fresh: false, hasResult: false })).toBe('stopped');
  });

  it('the time an agent ended is the time of its last line of the conversation', () => {
    const lines = [userPrompt('go', { time: at(-100) }), assistantText('done', { time: at(-40) }), attachment('late', { time: at(-5) }), lastPrompt()];
    expect(lastDecisiveTime(lines)).toBe(at(-40));
    expect(lastDecisiveTime([lastPrompt(), attachment('x')])).toBeNull();
    expect(lastDecisiveTime([{ type: 'assistant', timestamp: 'not a time' }])).toBeNull();
  });
});

describe('the first prompt as a title', () => {
  it('titleFromPrompt: the first line of the text, with the white space collapsed and no blank line before it', () => {
    expect(titleFromPrompt('Fix the   widget \t colours\nand then the second line')).toBe('Fix the widget colours');
    expect(titleFromPrompt('\n\n   First real line  \nSecond')).toBe('First real line');
    expect(titleFromPrompt('A line that ends in CRLF\r\nThe second line')).toBe('A line that ends in CRLF');
    // Markdown stays as it was written: the page shows it as text.
    expect(titleFromPrompt('# A heading with `code`')).toBe('# A heading with `code`');
    expect(titleFromPrompt('')).toBeNull();
    expect(titleFromPrompt('  \n \t \n')).toBeNull();
  });

  it('titleFromPrompt: at most 80 characters, cut with an ellipsis, counted in characters and not in code units', () => {
    const title = titleFromPrompt('word '.repeat(60)) as string;
    expect([...title]).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
    expect(title.startsWith('word word word')).toBe(true);
    // 80 characters stay whole, 81 are cut to 79 and the ellipsis.
    expect(titleFromPrompt('x'.repeat(80))).toBe('x'.repeat(80));
    expect(titleFromPrompt('x'.repeat(81))).toBe(`${'x'.repeat(79)}…`);
    // A picture is one character, though it is two code units: the cut never lands inside one.
    expect(titleFromPrompt('🟢'.repeat(100))).toBe(`${'🟢'.repeat(79)}…`);
  });

  it('titleFromPrompt: a line that is only markup is left out, and the words of a line that one tag wraps are used', () => {
    // A scheduler wraps its prompt in a tag of its own: the first line is the tag, the second is the words.
    expect(titleFromPrompt('<scheduled-task name="weekly" file="weekly.md">\nRun the weekly check\n</scheduled-task>')).toBe('Run the weekly check');
    expect(titleFromPrompt('<pasted_content>\nthe first line of what was pasted')).toBe('the first line of what was pasted');
    // A slash command is written as one line with its name in a tag.
    expect(titleFromPrompt('<command-message>dream</command-message>\n<command-name>/dream</command-name>')).toBe('dream');
    // Text that has a < or a > in it is not markup: only a whole line that is a tag, or one tag around a line, is.
    expect(titleFromPrompt('Fix the Map<string, number> typing')).toBe('Fix the Map<string, number> typing');
    expect(titleFromPrompt('when a < b and c > d, stop')).toBe('when a < b and c > d, stop');
    expect(titleFromPrompt('<only-a-tag>')).toBeNull();
    expect(titleFromPrompt('<a>\n</a>\n   \n')).toBeNull();
  });

  it('promptOf: a user line of Mark gives its first line, and an injected line, a tool result, a task notification, a message of another session and an interrupt give none', () => {
    expect(promptOf(userPrompt('Make the title\nand more'))).toBe('Make the title');
    expect(promptOf(userPrompt('Typed by Mark', {}, { origin: { kind: 'human' } }))).toBe('Typed by Mark'); // a newer file says so; an older one has no origin
    expect(promptOf(userPrompt('injected', {}, { isMeta: true }))).toBeNull();
    expect(promptOf(toolResult('output'))).toBeNull();
    expect(promptOf(taskNotification('a task finished'))).toBeNull();
    expect(promptOf(userPrompt('from a peer', {}, { origin: { kind: 'peer' } }))).toBeNull();
    expect(promptOf(userPrompt('[Request interrupted by user]'))).toBeNull();
    expect(promptOf({ ...toolResult('x'), toolEndsTurn: true })).toBeNull();
  });

  it('promptOf: a prompt that was queued gives its first line, and a queued notification of a task does not', () => {
    const queued = (content: unknown, operation = 'enqueue') => ({ type: 'queue-operation', operation, timestamp: at(0), sessionId: 's', content });
    expect(promptOf(queued('The queued prompt\nand its second line'))).toBe('The queued prompt');
    expect(promptOf(queued('<task-notification>LEAK a task finished</task-notification>'))).toBeNull();
    expect(promptOf(queued('  <task-notification>indented</task-notification>'))).toBeNull();
    expect(promptOf(queued('<scheduled-task name="x">\nThe words of the task\n</scheduled-task>'))).toBe('The words of the task');
    // Only an enqueue holds a prompt: a dequeue and a remove hold none, and a queued value that is not text is none.
    expect(promptOf(queued('The prompt', 'dequeue'))).toBeNull();
    expect(promptOf(queued('The prompt', 'remove'))).toBeNull();
    expect(promptOf(queued(42))).toBeNull();
    expect(promptOf(queued(undefined))).toBeNull();
  });

  it('promptOf: only text counts: the text blocks of a prompt, none for a prompt that is a picture, and none for any other line', () => {
    const blocks = (...content: unknown[]) => ({ ...userPrompt(''), message: { role: 'user', content } });
    expect(promptOf(blocks({ type: 'image', source: {} }, { type: 'text', text: 'Look at this\nplease' }))).toBe('Look at this');
    expect(promptOf(blocks({ type: 'text', text: '  ' }, { type: 'text', text: 'The second block' }))).toBe('The second block');
    expect(promptOf(blocks({ type: 'image', source: {} }))).toBeNull();
    expect(promptOf(blocks())).toBeNull();
    for (const line of [assistantText('A reply'), attachment('x'), systemLine(), lastPrompt('x'), customTitle('x'), 42, 'text', null, [1], {}]) expect(promptOf(line)).toBeNull();
  });
});
