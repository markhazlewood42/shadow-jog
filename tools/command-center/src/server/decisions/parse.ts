import { posix } from 'node:path';
import { slug as headingId } from 'github-slugger';
import type { DecisionAnswer, DecisionDocLink, DecisionIssue, DecisionOption } from '../../shared/types';
import { decodeOrKeep } from '../docs/links';
import { httpUrl, isMarkLogin } from '../github/github';
import { slugOf } from '../docs/index';
import { PanelError } from '../source';

// The parser of the decisions module: it reads what gh printed for an issue (`gh issue view` or `gh issue list`
// with the fields of DECISION_FIELDS) and for the events of the issue, and makes a DecisionIssue.
//
// The repo is public, so anyone can open an issue, write a comment and (with the right to triage) set a label. The
// "Trust" rule of the project is that only what Mark's account did counts. The parser applies it in four places:
//
//   1. The issue must be Mark's. The label `decision` proves nothing: GitHub puts the label of an issue template on
//      the issue of a stranger too, so the author is checked even when the label is there.
//   2. An answer is a comment of Mark's that starts with `Decision:`. A comment of another account (a look-alike
//      login such as `markhazlewood-42` included) is ignored, also when it is newer and says that it replaces his.
//   3. An issue is answered only when it is closed, has the label `decided`, and the event that put that label on
//      names Mark. Closing it and labelling it are not enough on their own.
//   4. Every word of the issue is text. The parser returns plain strings and builds no html. The page shows them as
//      text, so a script tag in an issue shows as the characters `<script>`.
//
// The module that calls the parser (module.ts) decides which gh calls to make. The parser is a pure function of what
// gh printed, so a test can feed it any issue, and so can the one write route when it reads an issue again.

/** The names of the two labels. An open decision has `decision`; the answer swaps it for `decided`. */
export const LABEL_DECISION = 'decision';
export const LABEL_DECIDED = 'decided';

/** The fields that gh is asked for: the ones that the parser reads. `gh issue view` and `gh issue list` both print them. */
export const DECISION_FIELDS = 'number,title,url,state,labels,author,body,comments,createdAt';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** An ISO time as milliseconds, or 0 when it is not one (so that a sort never meets NaN). */
function millisOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

// ---- the comment that holds the answer ----

/**
 * `Decision: <option id>. <note>`, with the dot and the note left out when there is no note. The option id is
 * letters and digits. After it comes a dot (what this server writes), or one of a few other marks that a person
 * might type, or just a space. The note is the rest, over any number of lines.
 *
 * The word `Decision:` must be the first thing in the comment and have this case: the rule that the agents read
 * the answer by says "starts with `Decision:`", and the page must find an answer exactly where they do.
 */
const ANSWER_COMMENT = /^Decision:[ \t]*([A-Za-z0-9]+)(?:[ \t]*[.:)-]|(?=\s|$))[ \t]*([\s\S]*)$/;

/** The text of the comment that answers a decision: `Decision: B. The note`, or `Decision: B` when there is no note. */
export function answerComment(option: string, note: string | null): string {
  return note === null || note === '' ? `Decision: ${option}` : `Decision: ${option}. ${note}`;
}

/** What a comment says as an answer, or null when it is not an answer (it does not start with `Decision:` and an option id). */
function readAnswerComment(body: string): { option: string; note: string | null } | null {
  const match = ANSWER_COMMENT.exec(body);
  if (match === null) return null;
  // A comment that was typed on the web has Windows line ends (CR LF), and a retry sends a note with plain ones (LF). The retry compares the two, so they are made alike here.
  const note = (match[2] ?? '').replace(/\r\n/g, '\n').trim();
  return { option: match[1] as string, note: note === '' ? null : note };
}

/** The newest answer that Mark's account wrote, or null. A comment of another account is never looked at. */
function newestAnswer(comments: unknown): { option: string; note: string | null; at: string } | null {
  if (!Array.isArray(comments)) return null;
  let newest: { option: string; note: string | null; at: string; ms: number } | null = null;
  // A plain loop and not forEach: TypeScript does not see an assignment made inside a callback, so it would take `newest` for null after the loop.
  for (const comment of comments) {
    if (!isRecord(comment) || !isRecord(comment.author) || !isMarkLogin(comment.author.login)) continue;
    const answer = readAnswerComment(text(comment.body));
    if (answer === null) continue;
    const at = text(comment.createdAt);
    const ms = millisOf(at);
    // The newest one wins. Two with the same time (or no time) are told apart by their place in gh's list, which is in the order of writing: the later one wins (>=).
    if (newest === null || ms >= newest.ms) newest = { ...answer, at, ms };
  }
  return newest === null ? null : { option: newest.option, note: newest.note, at: newest.at };
}

// ---- the labels ----

/** The names of the labels on the issue, in lower case: GitHub does not tell two labels apart by case. */
function labelNamesOf(raw: Json): string[] {
  if (!Array.isArray(raw.labels)) return [];
  return raw.labels.flatMap((label) => (isRecord(label) && typeof label.name === 'string' ? [label.name.toLowerCase()] : []));
}

/**
 * Whether the newest event that put the label `decided` on the issue names Mark. The newest one, because the label
 * that is on the issue now is the one that the last such event put there: if Mark labelled it and another account
 * took the label off and put it on again, the label is that account's. An event with no actor (a deleted account)
 * is nobody's.
 */
function decidedLabelIsMarks(events: unknown): boolean {
  if (!Array.isArray(events)) return false;
  let newest: { ms: number; login: unknown } | null = null;
  for (const event of events) {
    if (!isRecord(event) || event.event !== 'labeled' || !isRecord(event.label) || text(event.label.name).toLowerCase() !== LABEL_DECIDED) continue;
    const ms = millisOf(text(event.created_at));
    // As with the comments: the newest wins, and of two with the same time the later one in the list.
    if (newest === null || ms >= newest.ms) newest = { ms, login: isRecord(event.actor) ? event.actor.login : undefined };
  }
  return newest !== null && isMarkLogin(newest.login);
}

/**
 * The events of `gh api repos/<repo>/issues/<n>/events --paginate --slurp`: a list of pages, each a list of events.
 * This puts them into one list (a plain list of events, with no pages, is taken as it is). It throws a PanelError
 * for anything else, for example the `{"message":"Not Found"}` that the API answers for an issue that is not there:
 * with no events the parser would say that nothing was labelled, and that must not look like an answer.
 */
export function flattenEventPages(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new PanelError('gh-bad-output', 'gh printed the events of an issue in a form that this page cannot read: it is not a list of events.');
  return value.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}

// ---- the body ----

/** The sections of the template (.github/ISSUE_TEMPLATE/decision.md), by the name of their heading in lower case. */
const SECTION_OF_HEADING: Record<string, 'question' | 'context' | 'options' | 'recommendation' | 'docs' | 'raisedBy' | 'waitsOn'> = {
  question: 'question',
  context: 'context',
  options: 'options',
  recommendation: 'recommendation',
  docs: 'docs',
  'raised by': 'raisedBy',
  'waits on this': 'waitsOn',
  'waits on': 'waitsOn',
};
type SectionName = (typeof SECTION_OF_HEADING)[string];

/**
 * The words that the template puts under its headings. An issue made from the template and sent as it is has
 * them, and they say nothing: a section that holds only these is empty. A test reads the real template, so a change of the
 * template that is not made here fails it.
 */
const TEMPLATE_QUESTION = 'the question that mark answers by picking an option.';
const TEMPLATE_CONTEXT = 'two or three lines: what is true now, and why it needs an answer.';
const TEMPLATE_OPTION = 'what it is and what it changes';
const TEMPLATE_RAISED_BY = 'the session, the branch or the pr.';
const TEMPLATE_WAITS_ON = 'what stops until mark answers.';

const squash = (words: string): string => words.replace(/\s+/g, ' ').trim().toLowerCase();

/** The text, or null when it is empty or only the words of the template. */
const filled = (words: string, placeholder: string): string | null => (words === '' || squash(words) === placeholder ? null : words);

/**
 * A heading of the template: two hash marks, a space or a tab, and the words. The pattern takes the rest of the line as it is, and `headingWords` takes the closing
 * marks off it. A pattern that asked for the closing marks itself (a lazy group, then an optional run of spaces and hash marks) took cubic time for a line of many spaces
 * and a letter: 3,000 spaces took 2.7 seconds, so a body of 65 KB could stop the server for hours. This one reads each character once.
 */
const HEADING_LINE = /^ {0,3}##(?!#)[ \t]+([^\n]*)$/;
const FENCE_LINE = /^ {0,3}(?:```|~~~)/;

/** The words of a heading without the closing hash marks of markdown (`## Options ##`) and the spaces and tabs around them. A loop from the end, so the time is linear. */
function headingWords(rest: string): string {
  let end = rest.length;
  while (end > 0 && (rest[end - 1] === ' ' || rest[end - 1] === '\t' || rest[end - 1] === '#')) end -= 1;
  return rest.slice(0, end);
}

/** The lines under each `##` heading that the template has. A heading inside a fenced code block is code, not a heading. */
function sectionsOf(body: string): Partial<Record<SectionName, string[]>> {
  const sections: Partial<Record<SectionName, string[]>> = {};
  let current: SectionName | null = null;
  let inFence = false;
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING_LINE.exec(line);
    if (heading !== null) {
      const name = SECTION_OF_HEADING[headingWords(heading[1] ?? '').replace(/:$/, '').trim().toLowerCase()];
      // A heading that the template does not have ends the section before it, and its own lines are nobody's.
      current = name ?? null;
      if (name !== undefined) sections[name] ??= [];
      continue;
    }
    if (current !== null) sections[current]?.push(line);
  }
  return sections;
}

const joined = (lines: string[] | undefined): string => (lines ?? []).join('\n').trim();

/**
 * An option line: a list mark, the id (letters and digits), a dot, a colon or a bracket, and the words. The id and the
 * colon may be in bold (`- **A:** words`, `- **A**: words`). The template writes `- A: words`.
 */
const OPTION_LINE = /^\s*[-*+]\s+(?:\*\*)?([A-Za-z0-9]{1,8})(?:\*\*)?\s*[:.)]\s*(?:\*\*)?\s*(.*)$/;

/** The options of the Options section, in order. A line that goes on under an option (indented, or not a new option) is part of it. An option with no words is not one. */
function optionsOf(lines: string[] | undefined): { options: DecisionOption[]; repeated: string | null } {
  const found: { id: string; text: string }[] = [];
  for (const line of lines ?? []) {
    const match = OPTION_LINE.exec(line);
    if (match !== null) {
      found.push({ id: match[1] as string, text: (match[2] ?? '').trim() });
    } else if (line.trim() !== '' && found.length > 0) {
      const last = found[found.length - 1] as { id: string; text: string };
      last.text = `${last.text} ${line.trim()}`.trim();
    }
  }
  const options: DecisionOption[] = [];
  let repeated: string | null = null;
  for (const option of found) {
    if (option.text === '' || squash(option.text) === TEMPLATE_OPTION) continue;
    // The form needs one radio button for each id, so an id that comes twice keeps its first words.
    if (options.some((kept) => kept.id === option.id)) repeated ??= option.id;
    else options.push(option);
  }
  return { options, repeated };
}

/**
 * The id of the option that the Recommendation section starts with (`A: why`, `Option B.`, `**C** because`), or null. An id in bold is
 * enough on its own. A plain id needs a mark or the end of the line after it, so that "A reasonable choice is B" does not recommend A.
 */
function recommendedOf(lines: string[] | undefined, options: readonly DecisionOption[]): string | null {
  const first = joined(lines).split('\n')[0] ?? '';
  const match = /^\s*\*\*([A-Za-z0-9]{1,8})\*\*/.exec(first) ?? /^\s*(?:option\s+)?([A-Za-z0-9]{1,8})\s*(?:[:.)-]|$)/i.exec(first);
  const wanted = match?.[1]?.toLowerCase();
  return options.find((option) => option.id.toLowerCase() === wanted)?.id ?? null;
}

/** The mark that starts an item of a list: `-`, `*`, `+`, `1.` or `1)`. */
const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])(?:\s+|$)/;

/**
 * Turns the words of an issue's link line into the doc and the heading it names, or null when it names no doc of the repo.
 * The template puts a sentence above its list ("One line for each doc section that this concerns..."), so a line that is not a
 * list item counts only when it is one word that looks like a path: the sentence is not a link.
 */
function docLinkOf(line: string): DecisionDocLink | null {
  const item = line.replace(LIST_MARK, '').trim();
  if (!LIST_MARK.test(line) && !(/^\S+$/.test(item) && /[/#]|\.md$/i.test(item))) return null;
  // The address of a markdown link, or what is between backticks, or the whole line: an agent writes any of them.
  const target = (/\[[^\]]*\]\(([^)\s]+)[^)]*\)/.exec(item)?.[1] ?? /`([^`]+)`/.exec(item)?.[1] ?? item).trim().replace(/^<|>$/g, '');
  if (target === '' || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null; // an address on the web, or a path of Windows with a drive: not a doc of this repo

  const hashAt = target.indexOf('#');
  const rawPath = hashAt === -1 ? target : target.slice(0, hashAt);
  const rawHeading = hashAt === -1 ? '' : target.slice(hashAt + 1).trim();
  if (rawPath === 'path' && rawHeading === 'heading') return null; // the words of the template

  const docId = posix.normalize(decodeOrKeep(rawPath).replace(/\\/g, '/')).replace(/^\/+/, '');
  if (docId === '' || docId === '.' || docId === '..' || docId.startsWith('../')) return null;
  // The anchor goes through the slugger that makes the ids of the headings (the docs renderer uses the same one). The template says "lower case, with
  // a hyphen between words", but an agent also writes the words of the heading, or a number with a dot (`5.5`): the slugger drops the dot, as it does in the doc.
  const anchor = rawHeading === '' ? '' : headingId(decodeOrKeep(rawHeading));
  return { docId, slug: slugOf(docId), anchor, heading: null };
}

function docLinksOf(lines: string[] | undefined): DecisionDocLink[] {
  const links: DecisionDocLink[] = [];
  for (const line of lines ?? []) {
    const link = docLinkOf(line);
    if (link !== null && !links.some((kept) => kept.docId === link.docId && kept.anchor === link.anchor)) links.push(link);
  }
  return links;
}

/** What the body gives. `problem` is why the issue is not a decision that the page can show, or null. */
type Body = Pick<DecisionIssue, 'question' | 'context' | 'options' | 'recommended' | 'docs' | 'raisedBy' | 'waitsOn' | 'problem'>;

function readBody(rawBody: unknown): Body {
  const sections = sectionsOf(text(rawBody));
  const emptyBody = { question: '', context: null, options: [], recommended: null, docs: [], raisedBy: null, waitsOn: null };

  // None of the two sections that make a decision: this is not the template (an agent may write its own body file).
  if (sections.question === undefined && sections.options === undefined) {
    return {
      ...emptyBody,
      problem:
        'The body of this issue does not follow the decision template (it has no Question and Options sections), so this page cannot show its question or its options. Open the issue on GitHub to read it.',
    };
  }

  const questionText = joined(sections.question);
  const unedited = squash(questionText) === TEMPLATE_QUESTION;
  const question = unedited ? '' : questionText;
  const { options, repeated } = optionsOf(sections.options);

  let problem: string | null = null;
  if (unedited) problem = 'The body of this issue is still the unedited decision template: nothing in it says what the question is or what the options are. Open the issue on GitHub to fill it in.';
  else if (question === '') problem = 'The body of this issue has no question (its Question section is empty), so this page cannot say what is asked. Open the issue on GitHub to read it.';
  else if (options.length === 0) problem = 'The body of this issue lists no options, so there is nothing to pick on this page. Open the issue on GitHub to read it.';
  else if (repeated !== null) problem = `The body of this issue lists the option ${repeated} twice. This page shows the first one.`;

  return {
    question,
    context: filled(joined(sections.context), TEMPLATE_CONTEXT),
    options,
    recommended: recommendedOf(sections.recommendation, options),
    docs: docLinksOf(sections.docs),
    raisedBy: filled(joined(sections.raisedBy), TEMPLATE_RAISED_BY),
    waitsOn: filled(joined(sections.waitsOn), TEMPLATE_WAITS_ON),
    problem,
  };
}

// ---- the issue ----

/**
 * Whether the address of a thing on GitHub is the address of a pull request: `https://github.com/<owner>/<repo>/pull/<n>`. The kind is the third part of the path, so a
 * repository that is called "pull", or an owner who is, does not make an issue look like a pull request. An address that is missing or is not one tells nothing.
 */
function isPullRequest(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    const [, , kind] = new URL(url).pathname.split('/').filter((part) => part !== '');
    return kind === 'pull';
  } catch {
    return false;
  }
}

/** What has been done of an answer, from what GitHub holds now. A retry starts at the first part that is not done (see answer.ts). */
export type AnswerProgress = {
  /** The newest `Decision:` comment of Mark's, or null. */
  comment: { option: string; note: string | null } | null;
  /** The label `decided` is on, Mark's account put it on, and the label `decision` is off. */
  labelsSwapped: boolean;
  closed: boolean;
};

/**
 * Reads an issue as a decision, with how far its answer has got. Null when the issue is not a trusted decision: it is not
 * an issue (no number), its author is not Mark, or it has neither the label `decision` nor the label `decided`
 * (an answered issue has swapped the first for the second).
 *
 * `events` is the list of events of the issue (see flattenEventPages). Without them an issue is never answered,
 * because nothing then shows who put the label `decided` on it.
 */
export function readDecisionIssue(rawIssue: unknown, events: unknown): { issue: DecisionIssue; progress: AnswerProgress } | null {
  if (!isRecord(rawIssue)) return null;
  const { number } = rawIssue;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null;
  // `gh issue view <n>` opens a pull request as well as an issue. A pull request of Mark's that carried the label would otherwise be a decision, and the answer route would comment on it, relabel it and close it.
  if (isPullRequest(rawIssue.url)) return null;
  if (!isRecord(rawIssue.author) || !isMarkLogin(rawIssue.author.login)) return null;
  const labels = labelNamesOf(rawIssue);
  const hasDecided = labels.includes(LABEL_DECIDED);
  if (!hasDecided && !labels.includes(LABEL_DECISION)) return null;

  const closed = text(rawIssue.state).toUpperCase() === 'CLOSED';
  const decidedByMark = hasDecided && decidedLabelIsMarks(events);
  const written = newestAnswer(rawIssue.comments);
  const answer: DecisionAnswer | null = written === null ? null : { ...written, complete: closed && decidedByMark };

  const issue: DecisionIssue = {
    number,
    title: text(rawIssue.title),
    url: httpUrl(rawIssue.url) ?? '',
    state: answer?.complete ? 'answered' : closed ? 'closed' : 'open',
    ...readBody(rawIssue.body),
    createdAt: text(rawIssue.createdAt),
    answer,
  };
  return {
    issue,
    progress: {
      comment: written === null ? null : { option: written.option, note: written.note },
      labelsSwapped: decidedByMark && !labels.includes(LABEL_DECISION),
      closed,
    },
  };
}

/** The decision that an issue is, or null when it is not a trusted one (see readDecisionIssue). */
export function parseDecisionIssue(rawIssue: unknown, events: unknown): DecisionIssue | null {
  return readDecisionIssue(rawIssue, events)?.issue ?? null;
}
