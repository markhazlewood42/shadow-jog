import type { AnswerStep, DecisionAnswer } from '../../shared/types';
import { type HostedError, postHostedJson } from './fetch';

// How the hosted page sends Mark's answer, and his question (Ask for more info): one POST to `/api/answer` (functions/answer.ts), and the words for each way it can fail. The page sits behind Vercel Authentication, so
// the request goes with Mark's login cookie and the browser sets `Origin` and `Sec-Fetch-Site` itself; the function refuses a request that lacks either.
// The local page does not use this file: it posts to the local server (AnswerForm.tsx), and the build drops this file when VITE_HOSTED is not set.

/** The address of the answer function. */
export const ANSWER_URL = '/api/answer';

/** Why an answer did not go through, in the shape that the answer form shows (the same as `AnswerFailure` in AnswerForm.tsx). */
export type HostedAnswerFailure = { step: AnswerStep | null; code: string; message: string };

/** What the function sends when the answer is written: the answer as it is on the issue now. */
export type HostedAnswerReply = { ok: true; answer: { option: string; note: string | null; at: string } };

const isStep = (value: unknown): value is AnswerStep => value === 'unflag' || value === 'comment' || value === 'label' || value === 'close';

/** 503 `protection-unproven` and `bypass-on` (only these two): the function could not prove that the page is private, so it wrote nothing. */
export const PROTECTION_MESSAGE = 'Not answered: the page could not prove that it is private. Nothing was written.';
/** Any other 503 (a platform error): the function may not have run, so the page says only that the server is unavailable. */
export const UNAVAILABLE_MESSAGE = 'Not answered: the server is unavailable. Nothing was written.';
/** 500 `misconfigured`: the Vercel settings are missing or wrong, so the function wrote nothing. */
export const SETUP_MESSAGE = 'Not answered: the hosted setup is incomplete.';

/** The failure to show for an error of the request. The sentences of the function are fixed; the page uses its own words for the cases that the brief names. */
export function answerFailureOf(error: HostedError): HostedAnswerFailure {
  const step = isStep(error.step) ? error.step : null;
  if (error.status === 503) return { step: null, code: error.code, message: error.serverCode === 'protection-unproven' || error.serverCode === 'bypass-on' ? PROTECTION_MESSAGE : UNAVAILABLE_MESSAGE };
  if (error.status === 500 && error.serverCode === 'misconfigured') return { step: null, code: error.code, message: SETUP_MESSAGE };
  // 403 `wrong-host` carries its own sentence: "Answer from <the hosted address>." A failed step (502) names the step through STEP_LABEL in the form, and keeps the sentence.
  return { step, code: error.code, message: error.message };
}

/** Sends the answer. `note` is left out when it is empty. Resolves with the answer on success, or the failure to show. Never throws. */
export async function sendHostedAnswer(number: number, option: string, note: string): Promise<{ ok: true; answer: HostedAnswerReply['answer'] } | { ok: false; failure: HostedAnswerFailure }> {
  const result = await postHostedJson<HostedAnswerReply>(ANSWER_URL, note.trim() === '' ? { number, option } : { number, option, note });
  if (!result.ok) return { ok: false, failure: answerFailureOf(result.error) };
  const reply = result.data;
  if (reply?.ok !== true || typeof reply.answer?.option !== 'string' || typeof reply.answer.at !== 'string') {
    return { ok: false, failure: { step: null, code: 'bad-response', message: 'The server answered with something that this page does not know. Check the issue on GitHub.' } };
  }
  return { ok: true, answer: reply.answer };
}

/** What the function sends when the question is written: the text as it is on the issue now. */
export type HostedAskReply = { ok: true; ask: { text: string; at: string } };

/** Sends the question (an Ask for more info: the same function, `action: "ask"`, the question in `note`). Resolves with the question as written, or the failure to show. Never throws. */
export async function sendHostedAsk(number: number, text: string): Promise<{ ok: true; ask: HostedAskReply['ask'] } | { ok: false; failure: HostedAnswerFailure }> {
  const result = await postHostedJson<HostedAskReply>(ANSWER_URL, { number, action: 'ask', note: text });
  if (!result.ok) return { ok: false, failure: answerFailureOf(result.error) };
  const reply = result.data;
  if (reply?.ok !== true || typeof reply.ask?.text !== 'string' || typeof reply.ask.at !== 'string') {
    return { ok: false, failure: { step: null, code: 'bad-response', message: 'The server answered with something that this page does not know. Check the issue on GitHub.' } };
  }
  return { ok: true, ask: reply.ask };
}

/** The answer in the shape of the decision page, so that the page can show the decision as answered at once (the snapshot can be 15 s old). */
export const answerOf = (reply: HostedAnswerReply['answer']): DecisionAnswer => ({ option: reply.option, note: reply.note, at: reply.at, complete: true });
