// Shared fakes for the reporter tests (src/server/publish). This file has no tests of its own.
import type { LiveSessionRow } from '../src/shared/live';
import type { HttpClient, HttpRequest, HttpResponse } from '../src/server/publish/http';
import type { LiveBody } from '../src/server/publish/map';
import type { LiveStore } from '../src/server/publish/upstash';

/** A token that no log line, error message or stored value may ever contain. */
export const TOKEN = 'sekret-token-DO-NOT-LEAK-1234567890';

export function response(status: number, body = '', location: string | null = null): HttpResponse {
  return { status, location, text: async () => body };
}

/** A fake HTTP client that answers from a queue (the last answer repeats) and records every request. */
export function fakeHttp(...answers: (HttpResponse | Error)[]): { http: HttpClient; calls: { url: string; request: HttpRequest }[] } {
  const calls: { url: string; request: HttpRequest }[] = [];
  let index = 0;
  const http: HttpClient = async (url, request) => {
    calls.push({ url, request });
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer === undefined) throw new Error('fakeHttp has no answer');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { http, calls };
}

/** A fake store. `failNext` makes the next writes fail. */
export function fakeStore(): LiveStore & { sets: string[]; deletes: number; failWrites: boolean } {
  const store = {
    sets: [] as string[],
    deletes: 0,
    failWrites: false,
    async setLive(json: string) {
      if (store.failWrites) throw new Error('the store could not be reached (TypeError)');
      store.sets.push(json);
    },
    async deleteLive() {
      store.deletes += 1;
    },
  };
  return store;
}

export function row(overrides: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return { id: 's1', title: 'A session', branch: 'reporter', folder: 'shadow-jog', state: 'working', startedAt: '2026-10-12T08:00:00.000Z', agents: { running: 0, done: 0, names: [] }, yourMove: null, ...overrides };
}

export const body = (sessions: LiveSessionRow[] = [row()]): LiveBody => ({ sessions, worktrees: [{ path: 'C:/work/shadow-jog', branch: 'main', dirty: 0 }] });
