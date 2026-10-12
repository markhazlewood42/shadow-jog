import { LIVE_KEY } from '../../hosted/live';
import type { HttpClient } from './http';
import type { Secret } from './secret';

// The writer for the `live` key. It talks to the Upstash REST API with the read-write token (design.md section 11.1).
// A command is a JSON array in the body of a POST, so the value never has to fit in an address.
// An error carries a status code or an error name and nothing else: the answer of the store is not copied, and the token is never in a message.

/** How long a value lives without a new write (design.md section 11.1). The offline threshold of the page is 150 s, so it can show "offline since". */
export const LIVE_TTL_SECONDS = 600;
const TIMEOUT_MS = 10_000;

/** A write or a delete that did not work. The message is safe to log. */
export class UpstashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstashError';
  }
}

export type LiveStore = {
  /** Stores the JSON text under the key `live` with the 600 s expiry. */
  setLive(json: string): Promise<void>;
  /** Removes the key. */
  deleteLive(): Promise<void>;
};

export function createLiveStore(options: { url: string; token: Secret; http: HttpClient }): LiveStore {
  const { url, token, http } = options;

  async function command(parts: string[]): Promise<unknown> {
    let reply: Awaited<ReturnType<HttpClient>>;
    try {
      reply = await http(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.reveal()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parts),
        timeoutMs: TIMEOUT_MS,
      });
    } catch (error) {
      // The name only ("TimeoutError", "TypeError"): the text of a network error can hold the address.
      throw new UpstashError(`the store could not be reached (${error instanceof Error ? error.name : 'unknown error'})`);
    }
    if (reply.status < 200 || reply.status > 299) throw new UpstashError(`the store answered with status ${reply.status}`);
    let body: unknown;
    try {
      body = JSON.parse(await reply.text());
    } catch {
      throw new UpstashError('the store answer is not JSON');
    }
    if (typeof body !== 'object' || body === null || !('result' in body)) throw new UpstashError('the store answer has no result');
    return (body as { result: unknown }).result;
  }

  return {
    async setLive(json) {
      const result = await command(['SET', LIVE_KEY, json, 'EX', String(LIVE_TTL_SECONDS)]);
      if (result !== 'OK') throw new UpstashError('the store did not confirm the write');
    },
    async deleteLive() {
      await command(['DEL', LIVE_KEY]);
    },
  };
}
