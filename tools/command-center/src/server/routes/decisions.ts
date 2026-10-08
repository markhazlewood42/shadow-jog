import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { type AnswerErrorBody, type DecisionDetail, type DecisionIssue, type DecisionsInfo, MAX_NOTE_CHARS, type Panel } from '../../shared/types';
import type { Config } from '../config';
import { answerDecision, checkAnswer } from '../decisions/answer';
import { readDecision } from '../decisions/module';
import type { DocIndex } from '../docs/index';
import { apiError, createWriteGuard } from '../guard';
import { say } from '../messages';
import type { Runner } from '../runner';
import { PanelError, type PanelSource } from '../source';
import { createRefreshGate, registerPanelRoute } from './panel';

// The routes of the decisions module:
//
//   GET  /api/decisions            the Panel of the open decisions and the recent answers
//   GET  /api/decisions/<n>        one decision, with the doc sections it links to, as the docs have them now
//   POST /api/decisions/<n>/answer Mark's answer. The one write route of the command center.
//
// The two reads take only a number from the request, never a path: the sections are looked up in the doc index by the
// doc id and the heading id that the issue gave, and a lookup in a map of the index cannot reach a file.

/** The most a request to the answer route may carry. A note is at most 2000 characters, which is under 8 KB at four bytes each. */
const MAX_BODY_BYTES = 16 * 1024;

/** The longest option id that is read. The ids of the template are one letter; this leaves room, and keeps an error message short. */
const MAX_OPTION_CHARS = 64;

/** Control characters that a note may not have: all of them but the tab and the two line breaks. They have no use in a note, and a null character cannot be sent as an argument. */
const BAD_NOTE_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** The largest number that gh and GitHub take for an issue. A bigger one cannot be an issue, and must not reach gh. */
const MAX_ISSUE_NUMBER = 2_147_483_647;

export type DecisionsRoutesDeps = {
  config: Config;
  /** The only way to run gh. The answer goes through it. */
  runner: Runner;
  docs: DocIndex;
  decisions: PanelSource<DecisionsInfo>;
  /** The secret of this run: the answer route accepts only a request that carries it (see guard.ts). */
  token: string;
  /** The least time between two forced refreshes of the decisions, for the list and the page of one decision together. 10 s when this is not set. */
  minGapMs?: number;
};

/** The issue number in an address, or null when it is not a plain positive number that an issue can have (no sign, no zeros in front, no dot). */
function issueNumber(text: string | undefined): number | null {
  if (text === undefined || !/^[1-9]\d{0,9}$/.test(text)) return null;
  const number = Number(text);
  return number <= MAX_ISSUE_NUMBER ? number : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What the request asks for, or the answer to send back when it is not a request this route can take. */
async function readRequest(c: Context): Promise<{ option: string; note: string | null } | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(apiError('bad-json', say('requestNotJson')), 400);
  }
  if (!isRecord(body) || typeof body.option !== 'string' || body.option === '' || body.option.length > MAX_OPTION_CHARS) {
    return c.json(apiError('bad-request', say('requestNoOption')), 400);
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return c.json(apiError('bad-request', say('requestNoteNotText')), 400);
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_NOTE_CHARS) return c.json(apiError('note-too-long', say('noteTooLong', { max: MAX_NOTE_CHARS })), 422);
  if (BAD_NOTE_CHARACTERS.test(note)) return c.json(apiError('bad-note', say('noteBadCharacter')), 422);
  return { option: body.option, note: note === '' ? null : note };
}

/** The decision in a Panel of the decisions, or null: from the data of a good panel, or from the last good data of a failed one. */
function findDecision(panel: Panel<DecisionsInfo>, number: number): DecisionIssue | null {
  const data = panel.ok ? panel.data : panel.lastGood?.data;
  return data?.open.find((issue) => issue.number === number) ?? data?.recent.find((issue) => issue.number === number) ?? null;
}

/** The decision with the doc sections it links to, as the doc index has them now. `sections` is in the order of `docs`. */
function detailOf(docs: DocIndex, issue: DecisionIssue): DecisionDetail {
  return {
    ...issue,
    sections: issue.docs.map((link) => {
      const section = docs.section(link.docId, link.anchor);
      return { docId: link.docId, anchor: link.anchor, heading: section?.heading ?? null, html: section?.html ?? null };
    }),
  };
}

export function registerDecisionsRoutes(app: Hono, deps: DecisionsRoutesDeps): void {
  const { config, runner, docs, decisions, token } = deps;
  // One gate for the list and for the page of a decision: both make the same source load again, and the rule is one forced load in 10 s for the source.
  const mayForce = createRefreshGate(deps.minGapMs);

  registerPanelRoute(app, '/api/decisions', decisions, { gate: mayForce });

  // One decision. It is looked up in the list that the source has. A number that the list does not have may be a decision that an agent
  // raised a moment ago (the list is up to a minute old), so the source is asked to load again, within the same limit as every panel.
  app.get('/api/decisions/:number', async (c) => {
    const number = issueNumber(c.req.param('number'));
    if (number === null) return c.json(apiError('not-found', say('noSuchDecision')), 404);
    await docs.ready();

    let panel = await decisions.get(false);
    let found = findDecision(panel, number);
    if ((found === null || !panel.ok) && mayForce()) {
      panel = await decisions.get(true);
      found = findDecision(panel, number);
    }

    if (panel.ok) {
      if (found === null) {
        const missing: Panel<DecisionDetail> = {
          ok: false,
          error: { code: 'decision-not-found', message: say('decisionNotListed', { number }) },
          updatedAt: null,
          lastGood: null,
        };
        return c.json(missing, 404);
      }
      return c.json<Panel<DecisionDetail>>({ ok: true, data: detailOf(docs, found), updatedAt: panel.updatedAt });
    }
    // gh failed. The page keeps the decision it has (the last good data), and shows the error beside it. A decision that was never in the list cannot be said to be missing: gh could not be asked.
    return c.json<Panel<DecisionDetail>>({
      ok: false,
      error: panel.error,
      updatedAt: panel.updatedAt,
      lastGood: found !== null && panel.lastGood !== null ? { data: detailOf(docs, found), updatedAt: panel.lastGood.updatedAt } : null,
    });
  });

  // The path of the answer takes POST and nothing else. The method gate of the app refuses every other method but GET (405); this
  // refuses the GET, so that the answer path says "405, use POST" for every other method.
  app.get('/api/decisions/:number/answer', (c) => c.json(apiError('method-not-allowed', say('answerNeedsPost')), 405, { Allow: 'POST' }));

  // The numbers of the issues that an answer is writing to now. See the answer route.
  const writing = new Set<number>();

  // Mark's answer. Everything that can make a write wrong is checked before the first write, in this order:
  //
  //   1. The write guard: the token of this run, a request from this site, a JSON body. (403, 415)
  //   2. A body of reasonable size and shape. (413, 400, 422) No call to GitHub is made for a body that is wrong.
  //   3. One answer at a time for an issue. A double click, or a second tab, sends two requests, and without this both would
  //      post a comment. The second gets 409. (The set is in memory: the server is one process.)
  //   4. The issue is read again from GitHub, not taken from the list that the page has, which can be a minute old. It must be
  //      a decision of Mark's (404), it must be open (409), and it must have the option (422).
  //
  // Then the three writes, from the first step that is not done, and a look at GitHub again right away (see answerDecision).
  app.post(
    '/api/decisions/:number/answer',
    createWriteGuard(token),
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(apiError('too-large', say('requestTooLarge', { max: MAX_BODY_BYTES })), 413) }),
    async (c) => {
      const number = issueNumber(c.req.param('number'));
      if (number === null) return c.json(apiError('not-found', say('noSuchDecision')), 404);
      const request = await readRequest(c);
      if (request instanceof Response) return request;

      // The check and the take are one step with no await between them, so two requests cannot both pass.
      if (writing.has(number)) return c.json(apiError('answer-in-progress', say('answerInProgress', { number })), 409);
      writing.add(number);
      try {
        let read: Awaited<ReturnType<typeof readDecision>>;
        try {
          read = await readDecision(config, runner, number);
        } catch (error) {
          // gh could not be asked (not signed in, offline, too slow): nothing was written, and there is no step to name.
          if (error instanceof PanelError) return c.json(apiError(error.code, error.message), 502);
          throw error;
        }
        const checked = checkAnswer(read, request.option, request.note);
        if (!checked.ok) return c.json(apiError(checked.code, checked.message), checked.status);

        const result = await answerDecision({ config, runner, number, option: request.option, note: request.note, from: checked.from, ...(checked.clearDecided === true ? { clearDecided: true } : {}) });
        // A write was tried, so GitHub may have changed, also when a step failed: the earlier steps are on the issue. Look again now, so
        // that every page sees the answer (or the half answer) at once and does not wait for the next load a minute away.
        await decisions.get(true);

        if (result.ok) return c.json({ ok: true });
        const failed: AnswerErrorBody = { ok: false, step: result.step, error: result.error };
        return c.json(failed, 502);
      } finally {
        writing.delete(number);
      }
    },
  );
}
