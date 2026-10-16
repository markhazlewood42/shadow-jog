import { MARK_LOGIN } from '../server/github/github';

// The GraphQL queries of the GitHub API adapter and the builders of their variables (design.md section 6, "Vercel functions").
//
// The rules that make these queries safe, because the repo is public and anyone can create a branch name or write a comment:
//   - Every query string below is a constant. Nothing that came from GitHub is put into a query string.
//   - The one query that varies in its text is the file call. It has one alias for each branch, and the alias is `b0`, `b1`, ... (a counter, never a branch name).
//   - Each `object(expression:)` takes its expression from a GraphQL variable (`$e0`, ...). The branch name is part of the value of a variable, never part of the query text.

/** The repo that the adapter reads. */
export const OWNER = 'markhazlewood42';
export const REPO = 'shadow-jog';

/** The branch whose files (`status.md`, the roadmap, the migration plan) and CI result the page shows. */
export const DEFAULT_BRANCH = 'main';

/** The name of the workflow in `.github/workflows/ci.yml` (its `name:` line). GraphQL has no filter for a workflow file, so the adapter compares names. */
export const CI_WORKFLOW_NAME = 'CI';

/** The files of the default branch that the snapshot reads, with the alias and the variable of each. */
export const MAIN_FILES = [
  { key: 'status', alias: 'mainStatus', variable: 'mainStatus', path: 'status.md' },
  { key: 'roadmap', alias: 'mainRoadmap', variable: 'mainRoadmap', path: 'docs/roadmap/roadmap.json' },
  { key: 'migration', alias: 'mainMigration', variable: 'mainMigration', path: 'docs/engine/migration.md' },
] as const;

/** The page sizes. GitHub allows 100 for a connection. */
export const REFS_PAGE = 100;
export const OPEN_PRS = 50;
export const RECENT_PRS = 30;
export const DECISIONS_WAITING = 50;
export const DECISIONS_DECIDED = 30;
export const COMMENTS_PAGE = 100;
/** How many commits of `main` the CI search looks at (the newest commit that has a run of the CI workflow wins). */
export const CI_HISTORY = 10;

// ---- call 1: the branches, the pull requests, the CI result and the decisions ----

const REFS_FRAGMENT = `
fragment RefsPage on RefConnection {
  totalCount
  pageInfo { hasNextPage endCursor }
  nodes {
    name
    target { __typename oid ... on Commit { committedDate messageHeadline } }
  }
}`;

const PR_FRAGMENT = `
fragment PrFields on PullRequest {
  number title url state isDraft headRefName headRefOid isCrossRepository updatedAt mergedAt reviewDecision
  author { login }
  mergeCommit { oid }
  latestReviews(first: 20) { totalCount nodes { author { login } state submittedAt } }
  files(first: 50) { totalCount nodes { path } }
  statusCheckRollup {
    contexts(first: 100) {
      totalCount
      nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      }
    }
  }
}`;

const ISSUE_FRAGMENT = `
fragment DecisionFields on Issue {
  number title url state body createdAt
  author { login }
  labels(first: 20) { nodes { name } }
  comments(first: ${COMMENTS_PAGE}) {
    pageInfo { hasNextPage endCursor }
    nodes { author { login } body createdAt }
  }
  timelineItems(itemTypes: [LABELED_EVENT], last: 100) {
    nodes { __typename ... on LabeledEvent { createdAt label { name } actor { login } } }
  }
}`;

/**
 * Call 1. It reads everything except the workstream files:
 *   - `refs`: the first page of the branches (the later pages use REFS_PAGE_QUERY),
 *   - `open` and `recent`: the open pull requests, and the newest merged or closed ones, with checks (`statusCheckRollup`) and the state of the reviews,
 *   - `ci`: the newest commits of the default branch with their check suites (the CI result),
 *   - `waiting` and `decided`: the decision issues of Mark's account, with the author of each comment and the actor of each `decided` label event.
 */
export const SNAPSHOT_QUERY = `
query Snapshot($owner: String!, $name: String!, $refsFirst: Int!, $openFirst: Int!, $recentFirst: Int!, $waitingFirst: Int!, $decidedFirst: Int!, $historyFirst: Int!, $author: String!, $mainRef: String!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: $refsFirst, orderBy: {field: ALPHABETICAL, direction: ASC}) { ...RefsPage }
    open: pullRequests(first: $openFirst, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage }
      nodes { ...PrFields }
    }
    recent: pullRequests(first: $recentFirst, states: [MERGED, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage }
      nodes { ...PrFields }
    }
    ci: ref(qualifiedName: $mainRef) {
      target {
        ... on Commit {
          history(first: $historyFirst) {
            nodes {
              oid
              checkSuites(first: 20) {
                nodes { status conclusion workflowRun { createdAt url workflow { name } } }
              }
            }
          }
        }
      }
    }
    waiting: issues(first: $waitingFirst, labels: ["decision"], states: [OPEN], filterBy: {createdBy: $author}, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      nodes { ...DecisionFields }
    }
    decided: issues(first: $decidedFirst, labels: ["decided"], states: [OPEN, CLOSED], filterBy: {createdBy: $author}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { ...DecisionFields }
    }
  }
}
${REFS_FRAGMENT}
${PR_FRAGMENT}
${ISSUE_FRAGMENT}`;

/** The variables of SNAPSHOT_QUERY. */
export function snapshotVariables(owner = OWNER, name = REPO): Record<string, unknown> {
  return {
    owner,
    name,
    refsFirst: REFS_PAGE,
    openFirst: OPEN_PRS,
    recentFirst: RECENT_PRS,
    waitingFirst: DECISIONS_WAITING,
    decidedFirst: DECISIONS_DECIDED,
    historyFirst: CI_HISTORY,
    author: MARK_LOGIN,
    mainRef: `refs/heads/${DEFAULT_BRANCH}`,
  };
}

/** Pages 2 and on of the branches. It is used only when the repo has more than REFS_PAGE branches. */
export const REFS_PAGE_QUERY = `
query RefsPage($owner: String!, $name: String!, $first: Int!, $after: String!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: $first, after: $after, orderBy: {field: ALPHABETICAL, direction: ASC}) { ...RefsPage }
  }
}
${REFS_FRAGMENT}`;

export function refsPageVariables(after: string, owner = OWNER, name = REPO): Record<string, unknown> {
  return { owner, name, first: REFS_PAGE, after };
}

/** The next comments of one decision issue, when the first call did not get them all. The newest comment holds the answer, so none may be missed. */
export const COMMENTS_PAGE_QUERY = `
query MoreComments($owner: String!, $name: String!, $number: Int!, $after: String!, $first: Int!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      comments(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } body createdAt }
      }
    }
  }
}`;

export function commentsPageVariables(number: number, after: string, owner = OWNER, name = REPO): Record<string, unknown> {
  return { owner, name, number, after, first: COMMENTS_PAGE };
}

// ---- the read of one decision issue, for the hosted answer ----

/** The most pages of comments, and the most pages of label events (100 each), that the hosted answer reads before it gives up. At the cap it writes nothing. */
export const ANSWER_MAX_PAGES = 10;

/**
 * The first read of one issue for the hosted answer (`POST /api/answer`). It has the same fields as the decision fragment of the snapshot, plus the
 * page info that the answer needs: whether more comments follow the first 100, whether more label events come before the last 100, and whether the issue has
 * more labels than were read. `issue(number:)` is null for a pull request or a number that is no issue, so the answer treats both as "not found".
 * The later pages of the comments use COMMENTS_PAGE_QUERY, and the earlier pages of the events use ANSWER_EVENTS_PAGE_QUERY.
 */
export const ANSWER_ISSUE_QUERY = `
query AnswerIssue($owner: String!, $name: String!, $number: Int!, $first: Int!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title url state body createdAt
      author { login }
      labels(first: $first) { pageInfo { hasNextPage } nodes { name } }
      comments(first: $first) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } body createdAt }
      }
      timelineItems(itemTypes: [LABELED_EVENT], last: $first) {
        pageInfo { hasPreviousPage startCursor }
        nodes { __typename ... on LabeledEvent { createdAt label { name } actor { login } } }
      }
    }
  }
}`;

export function answerIssueVariables(number: number, owner = OWNER, name = REPO): Record<string, unknown> {
  return { owner, name, number, first: COMMENTS_PAGE };
}

/** The label events that come before the ones already read (the events are read from the newest back). */
export const ANSWER_EVENTS_PAGE_QUERY = `
query AnswerEvents($owner: String!, $name: String!, $number: Int!, $before: String!, $first: Int!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      timelineItems(itemTypes: [LABELED_EVENT], last: $first, before: $before) {
        pageInfo { hasPreviousPage startCursor }
        nodes { __typename ... on LabeledEvent { createdAt label { name } actor { login } } }
      }
    }
  }
}`;

export function answerEventsVariables(number: number, before: string, owner = OWNER, name = REPO): Record<string, unknown> {
  return { owner, name, number, before, first: COMMENTS_PAGE };
}

// ---- call 2: the files ----

/** The alias of the file of the branch at the place `index` of the list. A counter, so a branch name never reaches the query text. */
export const aliasFor = (index: number): string => `b${index}`;

/** The name of the variable that holds the expression of the file at the place `index`. */
export const variableFor = (index: number): string => `e${index}`;

/** What is read from a file: the text, and the facts that say whether the text is whole. */
const BLOB = '... on Blob { text byteSize isBinary isTruncated }';

/**
 * Call 2. One aliased `object(expression: $eN)` for each expression (the workstream file of a branch at one commit), then the files of the default
 * branch. The expressions are returned as variables; the query text holds only the counter in the alias and in the variable name.
 */
export function buildFilesQuery(expressions: readonly string[], owner = OWNER, name = REPO): { query: string; variables: Record<string, unknown> } {
  const variables: Record<string, unknown> = { owner, name };
  const declarations = ['$owner: String!', '$name: String!'];
  const selections: string[] = [];

  expressions.forEach((expression, index) => {
    variables[variableFor(index)] = expression;
    declarations.push(`$${variableFor(index)}: String!`);
    selections.push(`    ${aliasFor(index)}: object(expression: $${variableFor(index)}) { ${BLOB} }`);
  });
  for (const file of MAIN_FILES) {
    variables[file.variable] = `${DEFAULT_BRANCH}:${file.path}`;
    declarations.push(`$${file.variable}: String!`);
    selections.push(`    ${file.alias}: object(expression: $${file.variable}) { ${BLOB} }`);
  }

  const query = `query Files(${declarations.join(', ')}) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
${selections.join('\n')}
  }
}`;
  return { query, variables };
}
