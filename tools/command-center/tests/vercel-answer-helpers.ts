// A fake GitHub, a fake protection probe and a request builder for the tests of POST /api/answer. This file has no tests of its own.
// Nothing here reaches the network: the handler gets `fetchImpl` from the world, which answers the probe, `GET /user`, the GraphQL read of the issue and the REST writes.
import type { HttpFetch } from '../src/hosted/github-rest';

/** A made-up token (not a credential). Every test of the answer checks that it never leaves in an answer or a log line. */
export const SENTINEL = 'github_pat_SENTINEL_DO_NOT_LEAK';
export const ORIGIN = 'https://cc.example.vercel.app';
export const HOST = 'cc.example.vercel.app';
export const MARK = 'markhazlewood42';
export const MARK_ID = 79615015;

export const BODY = '## Question\nWhich one?\n\n## Options\n- A: first option\n- B: second option\n- C: third option\n\n## Recommendation\nA: it is first.\n';

export type FakeComment = { author: string; body: string; createdAt: string };
export type FakeEvent = { label: string; actor: string; createdAt: string };
export type FakeIssue = { number: number; state: 'OPEN' | 'CLOSED'; author: string; labels: string[]; comments: FakeComment[]; events: FakeEvent[]; body: string };

/** One call that the handler made through the fake fetch. */
export type Call = { method: string; url: string; headers: Record<string, string>; body: unknown; redirect?: string; hasSignal: boolean };

export type ProbeReply = { status: number; location?: string; contentType?: string } | 'throw' | 'timeout';

/** The repo address that the REST writes must go to. */
export const REPO_PATH = '/repos/markhazlewood42/shadow-jog';

const at = (n: number): string => new Date(Date.UTC(2026, 9, 10, 0, 0, 0) + n * 1000).toISOString();

/** A decision issue of Mark's that waits for an answer. */
export function openDecision(number: number, extra: Partial<FakeIssue> = {}): FakeIssue {
  return { number, state: 'OPEN', author: MARK, labels: ['decision'], comments: [], events: [{ label: 'decision', actor: MARK, createdAt: at(1) }], body: BODY, ...extra };
}

export class FakeWorld {
  issues = new Map<number, FakeIssue>();
  /** Numbers that are pull requests: `issue(number:)` is null for them. */
  pullRequests = new Set<number>();
  viewer: { login: string; id: number } = { login: MARK, id: MARK_ID };
  /** What `GET /user` does: a reply, or a failure. */
  userMode: 'ok' | 'status-500' | 'throw' | 'timeout' | 'not-json' = 'ok';
  probe: ProbeReply = { status: 302, location: 'https://vercel.com/sso-api?url=x&nonce=1' };
  /** Makes the next REST write with this method and path suffix answer with a status (once). */
  failWrite: { method: string; suffix: string; status: number; times: number } | null = null;
  /** A write that throws (a network error) instead of answering. */
  throwWrite: { method: string; suffix: string } | null = null;
  calls: Call[] = [];
  private clock = 100;

  add(issue: FakeIssue): FakeIssue {
    this.issues.set(issue.number, issue);
    return issue;
  }

  tick(): string {
    this.clock += 1;
    return at(this.clock);
  }

  /** The calls to api.github.com (everything except the probe). */
  get githubCalls(): Call[] {
    return this.calls.filter((call) => call.url.startsWith('https://api.github.com'));
  }
  get probeCalls(): Call[] {
    return this.calls.filter((call) => call.url.startsWith(ORIGIN));
  }
  /** The REST writes, as `METHOD path`. */
  get writes(): string[] {
    return this.githubCalls.filter((call) => call.method !== 'GET' && !call.url.endsWith('/graphql')).map((call) => `${call.method} ${call.url.slice('https://api.github.com'.length)}`);
  }
  get graphqlQueries(): string[] {
    return this.githubCalls.filter((call) => call.url.endsWith('/graphql')).map((call) => String((call.body as { query: string }).query.match(/query (\w+)/)?.[1]));
  }

  fetch: HttpFetch = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]));
    const parsed = init.body === undefined ? undefined : (JSON.parse(init.body) as unknown);
    this.calls.push({ method: init.method, url, headers, body: parsed, ...(init.redirect === undefined ? {} : { redirect: init.redirect }), hasSignal: init.signal !== undefined });

    if (url === `${ORIGIN}/api/snapshot`) return this.answerProbe();
    if (url === 'https://api.github.com/user') return this.answerUser();
    if (url === 'https://api.github.com/graphql') return this.answerGraphql(parsed as { query: string; variables: Record<string, unknown> });
    if (url.startsWith('https://api.github.com/repos/')) return this.answerWrite(init.method, url.slice('https://api.github.com'.length), parsed);
    throw new Error(`unexpected request ${init.method} ${url}`);
  };

  private reply(status: number, body: unknown, headers: Record<string, string> = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => text };
  }

  private answerProbe() {
    const probe = this.probe;
    if (probe === 'throw') throw new TypeError('fetch failed');
    if (probe === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    return this.reply(probe.status, '', { ...(probe.location === undefined ? {} : { location: probe.location }), 'content-type': probe.contentType ?? 'text/html' });
  }

  private answerUser() {
    if (this.userMode === 'throw') throw new TypeError('fetch failed');
    if (this.userMode === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    if (this.userMode === 'status-500') return this.reply(500, { message: `server error, token was ${SENTINEL}` });
    if (this.userMode === 'not-json') return this.reply(200, 'not json');
    return this.reply(200, { login: this.viewer.login, id: this.viewer.id });
  }

  private answerGraphql({ query, variables }: { query: string; variables: Record<string, unknown> }) {
    const number = Number(variables.number);
    const issue = this.issues.get(number);
    const name = query.match(/query (\w+)/)?.[1];
    const rate = { cost: 1, remaining: 4000 };
    if (issue === undefined || this.pullRequests.has(number)) {
      return this.reply(200, { data: { rateLimit: rate, repository: { issue: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'issue'], message: 'Could not resolve to an Issue' }] });
    }
    const commentNode = (comment: FakeComment) => ({ author: { login: comment.author }, body: comment.body, createdAt: comment.createdAt });
    const eventNode = (event: FakeEvent) => ({ __typename: 'LabeledEvent', createdAt: event.createdAt, label: { name: event.label }, actor: { login: event.actor } });
    const eventsPage = (end: number) => {
      const start = Math.max(0, end - 100);
      return { pageInfo: { hasPreviousPage: start > 0, startCursor: `e${start}` }, nodes: issue.events.slice(start, end).map(eventNode) };
    };
    if (name === 'AnswerIssue') {
      return this.reply(200, {
        data: {
          rateLimit: rate,
          repository: {
            issue: {
              number: issue.number,
              title: `Decision: fixture ${issue.number}`,
              url: `https://github.com/markhazlewood42/shadow-jog/issues/${issue.number}`,
              state: issue.state,
              body: issue.body,
              createdAt: at(0),
              author: { login: issue.author },
              labels: { pageInfo: { hasNextPage: false }, nodes: issue.labels.map((label) => ({ name: label })) },
              comments: { pageInfo: { hasNextPage: issue.comments.length > 100, endCursor: 'c100' }, nodes: issue.comments.slice(0, 100).map(commentNode) },
              timelineItems: eventsPage(issue.events.length),
            },
          },
        },
      });
    }
    if (name === 'MoreComments') {
      const start = Number(String(variables.after).slice(1));
      const end = start + 100;
      return this.reply(200, { data: { rateLimit: rate, repository: { issue: { comments: { pageInfo: { hasNextPage: end < issue.comments.length, endCursor: `c${end}` }, nodes: issue.comments.slice(start, end).map(commentNode) } } } } });
    }
    if (name === 'AnswerEvents') {
      const end = Number(String(variables.before).slice(1));
      return this.reply(200, { data: { rateLimit: rate, repository: { issue: { timelineItems: eventsPage(end) } } } });
    }
    throw new Error(`unknown query ${String(name)}`);
  }

  private answerWrite(method: string, path: string, body: unknown) {
    if (this.throwWrite !== null && method === this.throwWrite.method && path.endsWith(this.throwWrite.suffix)) throw new TypeError('fetch failed');
    const fail = this.failWrite;
    if (fail !== null && fail.times > 0 && method === fail.method && path.endsWith(fail.suffix)) {
      fail.times -= 1;
      return this.reply(fail.status, { message: `GitHub says no to ${SENTINEL}` });
    }
    const match = /^\/repos\/markhazlewood42\/shadow-jog\/issues\/(\d+)(\/.*)?$/.exec(path);
    const issue = match === null ? undefined : this.issues.get(Number(match[1]));
    if (match === null || issue === undefined) return this.reply(404, { message: 'Not Found' });
    const rest = match[2] ?? '';
    if (method === 'POST' && rest === '/comments') {
      issue.comments.push({ author: this.viewer.login, body: (body as { body: string }).body, createdAt: this.tick() });
      return this.reply(201, { id: 1 });
    }
    if (method === 'POST' && rest === '/labels') {
      for (const label of (body as { labels: string[] }).labels) {
        if (!issue.labels.includes(label)) {
          issue.labels.push(label);
          issue.events.push({ label, actor: this.viewer.login, createdAt: this.tick() });
        }
      }
      return this.reply(200, []);
    }
    if (method === 'DELETE' && rest.startsWith('/labels/')) {
      const label = rest.slice('/labels/'.length);
      if (!issue.labels.includes(label)) return this.reply(404, { message: 'Label does not exist' });
      issue.labels = issue.labels.filter((kept) => kept !== label);
      return this.reply(200, []);
    }
    if (method === 'PATCH' && rest === '') {
      issue.state = (body as { state: string }).state === 'closed' ? 'CLOSED' : 'OPEN';
      return this.reply(200, { number: issue.number });
    }
    return this.reply(404, { message: 'Not Found' });
  }
}

export const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({ GITHUB_TOKEN: SENTINEL, CC_ORIGIN: ORIGIN, ...extra });

/** A request as the hosted page sends it. `headers` replaces or (with `undefined`) removes a header. */
export function answerRequest(body: unknown, headers: Record<string, string | undefined> = {}, init: { method?: string; rawBody?: string } = {}): Request {
  const all: Record<string, string | undefined> = { host: HOST, 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...headers };
  const kept = Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const method = init.method ?? 'POST';
  return new Request(`${ORIGIN}/api/answer`, { method, headers: kept, ...(method === 'GET' ? {} : { body: init.rawBody ?? JSON.stringify(body) }) });
}
