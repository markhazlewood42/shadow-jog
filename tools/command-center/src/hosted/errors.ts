import type { AdapterError } from '../github-api/types';
import { errorResponse } from './http';

// Maps a typed error of the GitHub adapter (or of a raw GitHub reply) to an HTTP answer. The sentences are fixed on purpose: text from GitHub, and
// anything about the request (the token above all), never goes into an answer.

export type ErrorMap = { status: number; kind: string; error: string; retryAfter?: number };

const DEFAULT_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 3600;

export function mapAdapterError(error: Pick<AdapterError, 'code'> & { retryAfter?: number | undefined }): ErrorMap {
  switch (error.code) {
    case 'rate-limited': {
      const wanted = error.retryAfter ?? DEFAULT_RETRY_SECONDS;
      return { status: 503, kind: 'rate-limited', error: 'GitHub rate limit is used up', retryAfter: Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.ceil(wanted))) };
    }
    case 'unauthorized':
      return { status: 502, kind: 'unauthorized', error: 'GitHub does not accept the server token' };
    case 'network':
      return { status: 504, kind: 'network', error: 'GitHub could not be reached' };
    case 'http-error':
      return { status: 502, kind: 'http-error', error: 'GitHub refused the request' };
    case 'bad-response':
      return { status: 502, kind: 'bad-response', error: 'GitHub sent a reply that this server does not know' };
    case 'graphql-error':
      return { status: 502, kind: 'graphql-error', error: 'GitHub reported an error' };
    case 'graphql-incomplete':
      return { status: 503, kind: 'graphql-incomplete', error: 'GitHub answered in part, try again', retryAfter: 5 };
  }
}

export function responseOf(map: ErrorMap): Response {
  return errorResponse(map.status, map.error, map.kind, map.retryAfter === undefined ? {} : { 'Retry-After': String(map.retryAfter) });
}
