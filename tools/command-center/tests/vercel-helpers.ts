// Shared helpers for the tests of the Vercel functions (api/). This file has no tests of its own.
import { expect } from 'vitest';

/** A made-up token. It is not a real credential. Every test asserts that it never leaves in an answer. */
export const TOKEN = 'ghp_SENTINEL_not_a_real_token_0123456789';
export const RO_TOKEN = 'ro_SENTINEL_not_a_real_token_abcdef';
export const RW_TOKEN = 'rw_SENTINEL_not_a_real_token_ABCDEF';
export const UPSTASH_URL = 'https://example-store.upstash.io';

export const request = (path: string, init: RequestInit = {}): Request => new Request(`https://cc.example.vercel.app${path}`, init);

/** The whole answer as text: the status line, every header and the body. */
export async function everything(response: Response): Promise<string> {
  const headers = [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).join('\n');
  return `${response.status}\n${headers}\n${await response.clone().text()}`;
}

/** Fails when one of the secrets is anywhere in the answer (a header or the body). */
export async function expectNoSecrets(response: Response, ...secrets: string[]): Promise<void> {
  const text = await everything(response);
  for (const secret of [TOKEN, RO_TOKEN, RW_TOKEN, ...secrets]) expect(text).not.toContain(secret);
}

export const jsonOf = async (response: Response): Promise<Record<string, unknown>> => (await response.clone().json()) as Record<string, unknown>;
