// The text that the server makes and a page shows: the messages of a failed panel, the answers to a bad
// request, the notes of the docs index, and the lines of the "Your move" list. Design 5.8 (revision 2) sets
// the rules, and tests/server-messages.test.ts checks every message here against them:
//
//   - one line of 20 words or fewer, with the substituted values counted;
//   - ASD-STE100: no contraction, no semicolon, no "may" or "could", no verb in "-ing" form, active voice,
//     present tense, one instruction in each sentence, American spelling;
//   - say what failed, then give the one next step (a message that has no step for a person says only what failed).
//
// A message that has a value in it marks the place with {name}. `say` fills the places and the type of
// `say` asks for exactly the names that the message has. The `code` that goes with a message is not here:
// it stays where the error is made, because a page and the tests look for it.
//
// A name that starts with `ghDetail`, `linkReason`, `problem`, `frontmatter` or `reason` is a part of a longer message
// (for example "the output is not JSON" in the middle of "The gh output ... is unreadable: ..."). The guard
// test fills a place for such a part with the longest part there is, so a long part cannot break the whole.
//
// Text that a program wrote (a YAML error, an OS error, what git or gh printed) can be of any length. A place that
// holds it is named in PROGRAM_TEXT_WORDS, and `say` cuts the value to that many words, with "..." after the last one.
// The numbers are set so that the longest message that holds such a place still has 20 words or fewer: the guard
// test fills each of these places with a text of 60 words and checks that.

/**
 * The most words of a program's own text that a place of this name takes. `said`: the first line that git or gh
 * printed. `yaml`: the reason of a YAML error. `error`: the message of an OS error or of a failed scan.
 * `jsonError`: the message of `JSON.parse`. A new place for program text needs a number here and a message that fits it.
 */
export const PROGRAM_TEXT_WORDS = { said: 12, yaml: 10, error: 7, jsonError: 12 } as const;

/** The first `maxWords` words of a text, with "..." after the last one when words were cut. A text that fits is returned as it is. */
export function clipWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(' ')}...`;
}

export const MESSAGES = {
  // ---- gh: github/errors.ts, and every module that calls gh ----
  ghMissing: 'gh is not installed. Install the GitHub CLI from https://cli.github.com.',
  ghTimeout: 'gh did not answer in time. Try again.',
  ghNotSignedIn: 'gh is not signed in to GitHub. Run "gh auth login" in a terminal.',
  ghOffline: 'gh cannot reach GitHub. Check the internet connection.',
  ghFailedCode: 'gh failed with exit code {code}.',
  ghFailedSaid: 'gh failed: {said}',
  ghBadOutput: 'The gh output for {subject} is unreadable: {ghDetail}.',
  ghDetailOutputNotJson: 'the output is not JSON',
  ghDetailOutputNotList: 'the output is not a list',
  ghDetailFirstEntryNotRun: 'the first entry is not a run',
  ghDetailEntryNotPr: 'entry {position} is not a pull request',
  ghDetailEntryNoPrNumber: 'entry {position} has no pull request number',
  ghDetailPrState: 'pull request #{number} has the unknown state {state}',
  ghDetailListNotJson: 'the list of issues is not JSON',
  ghDetailListNotList: 'the list of issues is not a list',
  ghDetailEntryNotIssue: 'entry {position} is not an issue',
  ghDetailEntryNoIssueNumber: 'entry {position} has no issue number',
  ghDetailIssueNoAuthor: 'issue {number} has no author field',
  ghDetailIssueNoLabels: 'issue {number} has no list of labels',
  ghDetailCommentsNotJson: 'the comments of issue {number} are not JSON',
  ghDetailCommentsNotList: 'the comments of issue {number} are not a list',
  ghDetailEventsNotJson: 'the events of issue {number} are not JSON',
  ghDetailEventsNotList: 'the events are not a list',

  // ---- git ----
  gitMissing: 'git is not installed or not on the PATH. Install git.',
  gitFailed: 'git cannot {doing}: {said}',
  gitBadLine: 'The page cannot read this line of {command} output: "{line}".',
  exitCode: 'exit code {code}',

  // ---- sessions and agents ----
  sessionFolderUnreadable: 'The server cannot read the session folder "{folder}" ({code}).',
  sessionsNoneReadable: 'The server cannot read any of the {count} recent session files ({code}).',
  sessionsUnknownFormat: 'The {count} recent session files have an unknown file format.',
  sessionsFailed: 'The server cannot read the session files ({code}).',
  agentsFailed: 'The server cannot read the live sessions ({code}).',

  // ---- status ----
  statusDocMissing: '{path} is not in the repo. Restore the file to show the project status.',
  milestonesDocMissing: '{path} is not in the repo. Restore the file to show the milestones.',
  statusNoSection: '{path} has no current "Right now" heading. Add one.',
  milestonesNoTable: '{path} has no table with the columns "Milestone" and "One-line scope". Add one.',

  // ---- the engine decisions ----
  engineDocMissing: '{path} is not in the repo. Restore the file to list its decisions.',
  engineBadId: '{path} has the decision id "{id}". Use an id like E1 or C1.',
  engineNoTable: '{path} has no decision table. It needs the columns {columns}.',
  engineMissingColumns: 'The decision table in {path} lacks these columns: {names}.',
  engineMissingChoiceColumns: 'The table of real choices in {path} lacks these columns: {names}.',
  engineReadmeUnreadable: '{path} has no readable status. {frontmatterError}',
  engineUnknownVerdict: 'Decision {number} in {path} has the unknown verdict "{verdict}". Start it with decided, answered or OPEN.',
  approvalNotCommit: 'approvalRef "{ref}" is not a commit of this repo. Set it in command-center.config.json.',
  approvalCheckFailed: 'git cannot check approvalRef "{ref}": {said}',
  approvalDocUnreadable: 'git cannot read {path} at {ref}: {said}',
  approvalDocBad: 'The copy of {path} at {ref} is not a list of decisions ({code}).',

  // ---- the docs index: the notes that the Docs page folds under "doc problems" ----
  docsFolderUnreadable: 'The server cannot read the folder {path} ({error}).',
  docsRepoUnreadable: 'The server cannot read the repo folder ({error}).',
  docTooLarge: '{id} is larger than {size} MB. The site skips it.',
  docBrokenLink: '{id}: broken link "{href}" ({linkReason}).',
  docRenderFailed: 'The server cannot render {id} ({error}). The site skips it.',
  docNameClash: '{owner} and {id} have the same address "{slug}". The site skips {id}.',
  docsGitDates: 'No git dates ({said}). The page uses file times.',
  gitLogFailed: 'git log exit {code}: {said}',
  docsRescanFailed: 'The server cannot read the docs again ({error}). The site keeps the old docs.',
  watcherFailed: 'The file watcher failed ({error}). The site can miss edits.',
  watcherNoStart: 'The file watcher cannot start ({error}). Restart the server.',
  watcherSlow: 'The first scan took over {seconds} seconds.',
  frontmatterUnclosed: 'The frontmatter does not end with a --- line. Add one.',
  frontmatterYaml: 'Invalid YAML in the frontmatter: {yaml}',
  frontmatterNotMap: 'The frontmatter must hold key: value lines only.',

  // ---- the reasons that a link does not work (the docs notes, and the tooltip of a broken link) ----
  linkReasonEmpty: 'the link is empty',
  linkReasonScheme: 'the link scheme "{scheme}" is not allowed',
  linkReasonNotWeb: 'the link is not a valid web address',
  linkReasonNoPath: 'the link has no path',
  linkReasonEscape: 'the link has a malformed percent-escape',
  linkReasonBadChars: 'the link has characters that a file name cannot hold',
  linkReasonOutside: 'the link points outside the repo',
  linkReasonRoot: 'the link points at the repo root, not at a file',
  linkReasonNoFile: 'the file does not exist in the repo',
  linkReasonUnsafe: 'the link has an address that is not safe to open',
  linkReasonUnchecked: 'the link cannot be checked',
  linkReasonImageNotPicture: 'the image must be a picture file',

  // ---- nav.json: the notes of a mistake in the navigation file ----
  navMissing: '{name} is missing. The page lists every doc under Other.',
  navUnreadable: 'The server cannot read {name} ({error}). The page lists every doc under Other.',
  navNotJson: '{file} is not valid JSON ({jsonError}). Fix the file.',
  navNotObject: '{file} must be an object with a "sections" list.',
  navNoSections: '{file} has no "sections" list.',
  navSectionNotObject: '{section} is not an object.',
  navSectionId: '{section} needs an "id" of lowercase letters, digits and hyphens.',
  navIdReserved: '{section}: the id "{id}" is reserved for the Other section.',
  navIdTwice: '{section}: the id "{id}" is used twice.',
  navNoTitle: '{section} ("{id}") needs a "title".',
  navNoItems: '{section} ("{title}") needs an "items" list.',
  navBadPath: '{where}: "{item}" is not a path in the repo. Use forward slashes only.',
  navNotMarkdown: '{where}: "{item}" is not a markdown file or a folder. End a folder with a slash.',
  navBadReadingOrder: '{where}: the readingOrder {item} is not a path to a markdown file.',
  navBadPage: '{where}: the page {item} needs a title and a path that starts with a slash.',
  navNestedSection: '{where}: the item {item} is a section inside a section. Use two levels only.',
  navBadItem: '{where}: the item {item} is not a file, a folder, a readingOrder or a page.',
  navNotDoc: '{where}: {path} is not a doc of the repo.',
  navDocTwice: 'nav.json lists {path} in "{first}" and again in "{second}". It stays in "{first}".',
  navEmptyFolder: '{where}: the folder {path} has no docs.',
  navPageTwice: 'nav.json lists the page {path} in "{first}" and again in "{second}". It stays in "{first}".',
  navReadingOrderNotDoc: '{where}: {path} is not a doc of the repo. The site skips its reading order.',
  navNoReadingOrder: '{where}: {path} has no "Reading order" list.',
  navReadingOrderItem: '{path}: the reading order item "{label}" does not link to a doc of the repo.',
  navReadingOrderName: '{path}: the reading order names "{label}" ({docPath}), which is not a doc of the repo.',

  // ---- the decisions: a body that is not the template, the answer route, the "Your move" lines ----
  problemNotTemplate: 'The issue body does not follow the decision template. Edit it on GitHub.',
  problemBlankTemplate: 'The issue body is still the blank decision template. Edit it on GitHub.',
  problemNoQuestion: 'The issue has no question. Add one on GitHub.',
  problemNoOptions: 'The issue lists no options. Add them on GitHub.',
  problemRepeatedOption: 'The issue lists the option {option} twice. The page shows the first one.',
  yourMoveUnreadable: 'Decision #{number} is unreadable: {problem}',
  yourMovePrMerge: 'PR #{number} is ready to merge: {title}',
  yourMovePrFix: 'PR #{number} needs a fix: {title}',
  labelMissing: 'The label "{name}" does not exist in {repo}. Create it on GitHub.',
  decisionNotFound: 'No decision of Mark has this number.',
  decisionAnswered: 'Decision #{number} is already answered. Reload the page to see the answer.',
  decisionAnsweredWith: 'Decision #{number} is already answered: {option}. Reload the page to see the answer.',
  decisionClosed: 'Decision #{number} is closed with no answer. Reopen it on GitHub.',
  decisionNoOptions: 'Decision #{number} has no options that the page can read. Open it on GitHub.',
  decisionUnknownOption: '"{option}" is not an option of decision #{number}: {listed}.',
  decisionNotListed: 'No open or recent decision has the number {number}.',
  noSuchDecision: 'No such decision.',
  answerInProgress: 'Decision #{number} has an answer in progress. Wait for it to end.',
  answerNeedsPost: 'This route takes POST only.',
  requestNotJson: 'The request body is not JSON.',
  requestNoOption: 'The request must be a JSON object with an "option" text.',
  requestNoteNotText: 'The "note" of the request must be text.',
  requestTooLarge: 'The request is larger than {max} bytes.',
  noteTooLong: 'The note is longer than {max} characters. Shorten it.',
  noteBadCharacter: 'The note has a control character that cannot be sent.',

  // ---- the server itself: guards, missing routes and files ----
  hostNotAllowed: 'This server only answers to localhost and 127.0.0.1 on its own port.',
  readOnlyServer: 'This server only reads. The one write is the answer to a decision.',
  writeNeedsToken: 'A write needs the token of this run. Reload the page.',
  writeCrossSite: 'A write must come from this site.',
  writeNeedsJson: 'A write must be JSON (Content-Type: application/json).',
  noSuchFile: 'No such file.',
  noSuchRoute: 'No such route.',
  serverProblem: 'The server failed. Read its console for the cause.',
  pageNotBuilt: 'The page app is not built. Restart with "npm run cc".',
  docNotFound: 'No doc has the address "{address}".',

  // ---- the runner: why a call is refused (a bug in the caller), and what a program that failed to start says ----
  runnerRefusal: '{call} refused: {reason}',
  reasonNoCommand: 'no command given',
  reasonGitOption: '{arg} before the command can change how git runs',
  reasonGitNotRead: 'git {command} is not one of the read commands on the list',
  reasonGitOutput: '--output writes a file',
  reasonNeedsValue: '{arg} needs a value',
  reasonOpensBrowser: '{arg} opens a browser',
  reasonShortFlags: '{arg} is a flag group with R (repo) or w (web)',
  reasonRepoPinned: '--repo must be {repo}',
  reasonViewNumber: 'gh {group} view takes a plain number first',
  reasonListOptions: 'gh {group} list takes only options',
  reasonRunList: 'a run list is exactly: run list {flags}',
  reasonApiPath: 'gh api reads only {path}<number>/events',
  reasonApiOption: 'the gh api option {name} is not on the list of read-only options',
  reasonComment: 'a comment is exactly: issue comment <number> --body <text>',
  reasonCommentText: 'a comment needs text',
  reasonCommentLong: 'a comment is at most {max} characters',
  reasonEdit: 'an edit must swap the label decision for decided, or remove decided',
  reasonClose: 'a close is exactly: issue close <number>',
  reasonAuth: 'gh auth status takes no options',
  reasonNotOnList: 'gh {command} is not on the list',
  reasonOnlyGitGh: 'only git and gh can run',
  reasonNullChar: 'every argument must be text without a null character',
  reasonOutsideRoots: 'the folder to run in is outside the allowed roots',
  reasonTimeLimit: 'the time limit must be a whole number of milliseconds from 1 to {max}',
  runnerNoFolder: '{file}: the folder to run in does not exist ({folder})',
  // The words "command not found" are also what github/errors.ts looks for, so they stay.
  runnerNotFound: '{file}: command not found',
  runnerOutputLarge: '{file}: its output was larger than {max} bytes',
  runnerTimedOut: '{file}: timed out after {ms} ms',
} as const satisfies Record<string, string>;

export type MessageId = keyof typeof MESSAGES;

/** The names of the places in a message: `'a {x} and {y}'` gives `'x' | 'y'`. */
type PlaceNames<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceNames<Rest> : never;

/** The values a message asks for, by name. */
type MessageValues<Id extends MessageId> = { [Name in PlaceNames<(typeof MESSAGES)[Id]>]: string | number };

/**
 * Puts values into the places of a text. A value is put in as it is (no `$` in it is read as a pattern), except the text of a
 * program (a name in PROGRAM_TEXT_WORDS), which is cut to its number of words. `say` uses this; the guard test calls it too, so
 * that it checks the real cut.
 */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (place, name: string) => {
    const value = String(values[name] ?? place);
    const limit = (PROGRAM_TEXT_WORDS as Record<string, number | undefined>)[name];
    return limit === undefined ? value : clipWords(value, limit);
  });
}

/**
 * The text of a message with its values in. The call fails to compile when a value is missing or has a name
 * that the message does not have.
 */
export function say<Id extends MessageId>(id: Id, ...values: [PlaceNames<(typeof MESSAGES)[Id]>] extends [never] ? [] : [MessageValues<Id>]): string {
  return fill(MESSAGES[id], (values[0] ?? {}) as Record<string, string | number>);
}
