import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { lastChangedDates } from '../src/server/docs/dates';
import { splitFrontmatter } from '../src/server/docs/frontmatter';
import { parseNavFile } from '../src/server/docs/nav';
import { readmeWaitsForMark } from '../src/server/engine/decisions';
import { createGitSource } from '../src/server/git/module';
import { classifyGhError } from '../src/server/github/errors';
import { createHub } from '../src/server/hub';
import { MESSAGES, PROGRAM_TEXT_WORDS, clipWords, fill, say } from '../src/server/messages';
import { PanelError } from '../src/server/source';
import { makeDocsRepo, makeIndex, realRunner } from './doc-index-helpers';
import { PACKAGE_DIR } from './helpers';

// The guard for the text that the server makes and a page shows (design 5.8, Task 19b). Every message of
// src/server/messages.ts is filled with sample values and checked: one line, at most 20 words, no contraction
// and no word that ASD-STE100 avoids. A new message that breaks a rule fails here, so the rule holds for
// the messages of the future too.

const MAX_WORDS = 20;

/** A table of messages by id: the real one, or a copy of it with one message changed (the mutation tests below). */
type Table = Record<string, string>;

/**
 * The value that fills each placeholder. A value that a person writes (a path, a number, a name, an error code) is one word,
 * as a real one almost always is. Some values are longer, and have the words of the longest real one that the code can make:
 * the column names of the engine table; `line`, a line of git output that the git module cuts at 40 characters (6 words is a
 * normal line; a line of one-letter words could have more, which is not covered); `listed`, the options of a decision.
 * The text that a program wrote (a name in PROGRAM_TEXT_WORDS: git, gh, YAML, JSON.parse and OS errors) has no sample here:
 * it is filled with a text of 60 words, and `fill` cuts it as the server does, so the worst case is the real cut.
 * A new placeholder needs a value here, or a number in PROGRAM_TEXT_WORDS: the test fails until it has one.
 */
const SAMPLE: Record<string, string> = {
  address: 'engine/decisions',
  arg: '--output',
  call: 'gh issue edit',
  code: 'EACCES',
  columns: '"#", "Decision", "Recommendation", "Needed before", "Who decides", "Your answer"',
  command: 'git for-each-ref',
  count: '12',
  docPath: 'docs/a.md',
  doing: 'read the branches',
  file: 'gh',
  first: 'Start here',
  flags: '--branch main --limit 1 --json status,conclusion,url,createdAt',
  folder: 'projects',
  group: 'issue',
  href: '../docs/gone.md',
  id: 'docs/engine/decisions.md',
  item: '{"page":"/x"}',
  label: 'Engine design',
  line: 'abc def ghi jkl mno pqr',
  listed: 'A, B, C',
  max: '120000',
  ms: '30000',
  name: 'decided',
  names: '"#", "Decision", "Recommendation", "Needed before", "Who decides" and "Your answer"',
  number: '12',
  option: 'A',
  owner: 'docs/a.md',
  path: 'docs/engine/decisions.md',
  position: '3',
  ref: 'b14887acf5a8',
  repo: 'markhazlewood42/shadow-jog',
  scheme: 'javascript',
  seconds: '10',
  second: 'Engine',
  section: 'nav.json, section 12',
  size: '2',
  slug: 'engine/decisions',
  state: '"MERGED"',
  subject: 'decision issues',
  title: 'Engine design',
  verdict: 'deferred',
  where: 'nav.json, section "Command center"',
};

/** A text of 60 words, longer than any cut in PROGRAM_TEXT_WORDS: it stands for the longest text that a program can print. */
const LONG_PROGRAM_TEXT = Array.from({ length: 60 }, (_, index) => `word${index + 1}`).join(' ');

/**
 * A placeholder that holds another message of this file. It takes the longest message with that id prefix,
 * so a message that is made of two messages is checked with the longest one it can get.
 */
const FRAGMENT_PREFIX: Record<string, string> = {
  frontmatterError: 'frontmatter',
  ghDetail: 'ghDetail',
  linkReason: 'linkReason',
  problem: 'problem',
  reason: 'reason',
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The text of a message with every placeholder filled, the longest sample for a placeholder that holds a message. */
function filled(table: Table, id: string, depth = 0): string {
  if (depth > 3) throw new Error(`${id}: messages nest too deep`);
  const text = table[id] ?? '';
  const values: Record<string, string> = {};
  for (const [, name = ''] of text.matchAll(/\{(\w+)\}/g)) {
    const prefix = FRAGMENT_PREFIX[name];
    if (name in PROGRAM_TEXT_WORDS) {
      values[name] = LONG_PROGRAM_TEXT;
    } else if (prefix !== undefined) {
      const candidates = Object.keys(table)
        .filter((other) => other.startsWith(prefix) && other !== id)
        .map((other) => filled(table, other, depth + 1));
      if (candidates.length === 0) throw new Error(`${id}: no message starts with "${prefix}" for {${name}}`);
      values[name] = candidates.sort((a, b) => wordCount(b) - wordCount(a))[0] ?? '';
    } else {
      const sample = SAMPLE[name];
      if (sample === undefined) throw new Error(`${id}: no sample value for {${name}}. Add one to SAMPLE in this test.`);
      values[name] = sample;
    }
  }
  // The real `fill` of the server: it cuts the text of a program to its number of words.
  return fill(text, values);
}

// Words that end in "ing" and are not a verb form: a technical name, or an adjective.
const ING_OK = new Set(['heading', 'reading', 'missing']);
const MODALS = /\b(?:may|might|could|would|should)\b/i;
const CONTRACTION = /\b[A-Za-z]+['’](?:s|t|re|ve|ll|d|m)\b/;
const BRITISH = /\b(?:colour|behaviour|centre|grey|licence|catalogue|organis|recognis|favour|neighbour|cancelled|analyse)/i;

/** What is wrong with a text, as a list of short reasons (empty when it is fine). */
function problemsOf(text: string): string[] {
  const problems: string[] = [];
  if (/[\r\n]/.test(text)) problems.push('has a line break');
  const words = wordCount(text);
  if (words > MAX_WORDS) problems.push(`has ${words} words (the limit is ${MAX_WORDS})`);
  if (CONTRACTION.test(text)) problems.push('has a contraction');
  if (text.includes(';')) problems.push('has a semicolon');
  if (MODALS.test(text)) problems.push('has a modal verb (may, might, could, would, should)');
  const ing = text.match(/\b[a-z]{3,}ing\b/gi)?.find((word) => !ING_OK.has(word.toLowerCase()));
  if (ing !== undefined) problems.push(`has the -ing form "${ing}"`);
  if (BRITISH.test(text)) problems.push('has a British spelling');
  return problems;
}

/** Every rule break of a table, one line each: the id, the break and the filled text. */
function failuresOf(table: Table): string[] {
  return Object.keys(table).flatMap((id) => problemsOf(filled(table, id)).map((problem) => `${id}: ${problem}: "${filled(table, id)}"`));
}

describe('server messages', () => {
  it('server messages are one short line each', () => {
    expect(Object.keys(MESSAGES).length).toBeGreaterThan(50);
    expect(failuresOf(MESSAGES)).toEqual([]);
  });

  it('the guard fails for a real message that is too long, has a contraction or breaks another rule', () => {
    // A mutation of one real message: the same checker must fail it, or the test above guards nothing.
    const mutate = (id: keyof typeof MESSAGES, text: string): string[] => failuresOf({ ...MESSAGES, [id]: text });
    expect(mutate('ghTimeout', 'Word '.repeat(21).trim())).toEqual([expect.stringMatching(/^ghTimeout: has 21 words \(the limit is 20\)/)]);
    expect(mutate('ghTimeout', 'Word '.repeat(20).trim())).toEqual([]); // 20 words is the limit, and it is allowed
    expect(mutate('ghOffline', "gh can't reach GitHub. Check the internet connection.")).toEqual([expect.stringMatching(/^ghOffline: has a contraction/)]);
    expect(mutate('ghOffline', 'gh cannot reach GitHub.\nCheck the internet connection.')).toEqual([expect.stringMatching(/^ghOffline: has a line break/)]);
    expect(mutate('ghTimeout', 'gh did not answer; try again.')).toEqual([expect.stringMatching(/^ghTimeout: has a semicolon/)]);
    expect(mutate('ghTimeout', 'GitHub may be slow. Try again.')).toEqual([expect.stringMatching(/^ghTimeout: has a modal verb/)]);
    expect(mutate('ghTimeout', 'gh is waiting for GitHub. Try again.')).toEqual([expect.stringMatching(/^ghTimeout: has the -ing form "waiting"/)]);
    expect(mutate('ghTimeout', 'The color is gray, the colour is not. Try again.')).toEqual([expect.stringMatching(/^ghTimeout: has a British spelling/)]);

    // A part that is too long breaks every message that it can be a part of: the whole is checked with the longest part.
    const broken = failuresOf({ ...MESSAGES, ghDetailOutputNotJson: 'the output is not JSON, and it is not a list, and it is not a run, and it is not text' });
    expect(broken.map((line) => line.split(':')[0])).toEqual(expect.arrayContaining(['ghDetailOutputNotJson', 'ghBadOutput']));
  });

  it('the messages made of two messages stay within the limit', () => {
    // The watcher message holds the "first scan is slow" message of watch.ts. It has to fit the cut of `error` (7 words), or say would cut it.
    const slow = say('watcherSlow', { seconds: 10 });
    expect(clipWords(slow, PROGRAM_TEXT_WORDS.error)).toBe(slow);
    expect(wordCount(say('watcherFailed', { error: slow }))).toBeLessThanOrEqual(MAX_WORDS);
  });

  it('say fills every place with its value and leaves no place', () => {
    expect(say('ghFailedCode', { code: 7 })).toBe('gh failed with exit code 7.');
    expect(say('ghNotSignedIn')).toBe('gh is not signed in to GitHub. Run "gh auth login" in a terminal.');
    for (const id of Object.keys(MESSAGES)) expect(filled(MESSAGES, id), id).not.toMatch(/\{\w+\}/);
    // A value that holds "$&" or "$1" is put in as it is, not read as a replacement pattern.
    expect(say('ghFailedSaid', { said: 'cost $& $1' })).toBe('gh failed: cost $& $1');
  });

  it('say cuts the text of a program to its number of words, and leaves a text that fits as it is', () => {
    expect(say('ghFailedSaid', { said: LONG_PROGRAM_TEXT })).toBe(`gh failed: ${LONG_PROGRAM_TEXT.split(' ').slice(0, PROGRAM_TEXT_WORDS.said).join(' ')}...`);
    const fits = Array.from({ length: PROGRAM_TEXT_WORDS.said }, () => 'x').join(' ');
    expect(say('ghFailedSaid', { said: fits })).toBe(`gh failed: ${fits}`);
    // The cut of one name does not touch a place of another name (a number, a path).
    expect(say('gitBadLine', { command: 'git log', line: LONG_PROGRAM_TEXT })).toContain('word60');
  });

  it('real parser and git text stays within 20 words after say()', async () => {
    // The texts of the real YAML library, of JSON.parse and of git (a real "not a git repository" error), put through the real call
    // sites of the five messages that held them, and of the others that hold program text. Each result is one message of the page.
    const shown: string[] = [];

    // frontmatterYaml (the docs index shows it as "<doc id>: <message>"), and engineReadmeUnreadable with the same text.
    const yaml = splitFrontmatter('---\ntype: [unclosed\n---\n# Title\n').error ?? '';
    expect(yaml).toMatch(/^Invalid YAML in the frontmatter: .*\(line 3\)$/); // the line number is kept, the reason is cut
    shown.push(yaml);
    try {
      readmeWaitsForMark('---\nstatus: [unclosed\n---\n# Engine\n');
    } catch (error) {
      expect(error).toBeInstanceOf(PanelError);
      shown.push((error as PanelError).message);
    }

    // navNotJson with the text of JSON.parse in this Node (a trailing comma, and a text that is not JSON at all).
    for (const text of ['{ "sections": [], }', '{ this is not json']) {
      const problem = parseNavFile(text, 'nav.json').problems[0] ?? '';
      expect(problem).toContain('is not valid JSON');
      shown.push(problem);
    }

    // docsGitDates: git, run for real in a folder that is not a repo. The ceiling stops git from looking in the folders above the temp folder.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir());
    const repo = makeDocsRepo({ 'docs/a.md': '# A\n', 'docs/bad.md': '---\ntype: [unclosed\n---\n# Bad\n' });
    try {
      repo.writeNav('{ "sections": [], }');
      const dates = await lastChangedDates(realRunner(repo), repo.dir).catch((error: unknown) => (error as Error).message);
      expect(dates).toContain('not a git repository'); // git's own first line, as lastChangedDates throws it
      const { index } = makeIndex(repo, { runner: realRunner(repo) });
      await index.ready();
      const problems = index.problems();
      expect(problems.some((problem) => problem.startsWith('No git dates (git log exit 128: fatal: not a git repository'))).toBe(true);
      expect(problems.some((problem) => problem.includes('Invalid YAML'))).toBe(true);
      expect(problems.some((problem) => problem.includes('is not valid JSON'))).toBe(true);
      shown.push(...problems);

      // gitFailed: the git module, over the same folder that is not a repo.
      const panel = await createGitSource({ runner: realRunner(repo), hub: createHub() }).get(true);
      expect(panel.ok).toBe(false);
      if (!panel.ok) {
        expect(panel.error.code).toBe('git-failed');
        shown.push(panel.error.message);
      }
    } finally {
      repo.close();
      vi.unstubAllEnvs();
    }

    // ghFailedSaid: lines that gh printed, a rate limit and a long GraphQL error.
    for (const stderr of ['HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/graphql)', "GraphQL: Could not resolve to a Repository with the name 'x/y'. (repository)"]) {
      shown.push(classifyGhError(1, stderr).message);
    }

    expect(shown.length).toBeGreaterThanOrEqual(9);
    expect(shown.filter((text) => wordCount(text) > MAX_WORDS)).toEqual([]);
  });

  it('every message is used by the server', () => {
    // No dead message: each id appears in a file of src/server other than the message file.
    const source = filesUnder(join(PACKAGE_DIR, 'src', 'server'))
      .filter((file) => !file.endsWith('messages.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const unused = Object.keys(MESSAGES).filter((id) => !new RegExp(`['"\`]${id}['"\`]`).test(source));
    expect(unused).toEqual([]);
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : path.endsWith('.ts') ? [path] : [];
  });
}
