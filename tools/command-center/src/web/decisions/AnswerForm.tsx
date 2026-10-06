import { Button, Label, Radio, RadioGroup, TextArea, TextField } from '@heroui/react';
import { LoaderCircle, Send, TriangleAlert } from 'lucide-react';
import { type FormEvent, useCallback, useState } from 'react';
import type { AnswerStep, DecisionIssue } from '../../shared/types';
import { ApiError, postJson } from '../api';
import { OptionBadge, RecommendedChip, SectionLabel } from './DecisionCard';

// How Mark answers a decision: he picks an option, adds a note if he wants, and sends it. The server then posts a
// comment on the GitHub issue, swaps its label and closes it (three calls, one after the other, and any of them can fail).
// When one fails the form shows the error and keeps his choice and his note, and a retry carries on where the answer stopped.

/** The longest note that the server takes. The same number as the server's, so the text box stops where the server would refuse. */
const MAX_NOTE_CHARS = 2000;

/** Why an answer did not go through. `step` is the write that failed (the ones before it are done), or null when nothing was written (a refusal, a lost connection). */
export type AnswerFailure = { step: AnswerStep | null; code: string; message: string };

/**
 * What Mark has done in the form, and what has come of sending it. `choice` and `note` are null until he touches them (the form then shows
 * the answer that is already on the issue, if an earlier answer stopped half way). The state is kept by the page and not by the form, so it
 * survives the form being drawn again: the page draws its data in another place of the tree when a reload fails, and the form must not forget.
 */
export type AnswerDraft = {
  choice: string | null;
  note: string | null;
  status: 'idle' | 'sending' | 'failed' | 'sent';
  failure: AnswerFailure | null;
  setChoice(id: string): void;
  setNote(text: string): void;
  send(option: string, note: string): Promise<void>;
};

const isStep = (value: unknown): value is AnswerStep => value === 'comment' || value === 'label' || value === 'close';

/** What an error of the server (or of the connection) says about a failed answer. */
function failureOf(error: unknown): AnswerFailure {
  if (error instanceof ApiError) {
    const body = error.body;
    const step = typeof body === 'object' && body !== null && 'step' in body && isStep(body.step) ? body.step : null;
    return { step, code: error.code, message: error.message };
  }
  return { step: null, code: 'unknown', message: error instanceof Error ? error.message : String(error) };
}

/**
 * The draft of the answer to decision `number`. `onWritten` is called after every try, whatever came of it, because GitHub may
 * have changed (a step that worked before another failed), and the page must read the decision again.
 */
export function useAnswerDraft(number: number, onWritten: () => void): AnswerDraft {
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<AnswerDraft['status']>('idle');
  const [failure, setFailure] = useState<AnswerFailure | null>(null);

  const send = useCallback(
    async (option: string, text: string) => {
      setStatus('sending');
      setFailure(null);
      try {
        // The token of this run goes with it (postJson reads it from the page). A note that is empty is left out.
        await postJson(`/api/decisions/${number}/answer`, text.trim() === '' ? { option } : { option, note: text });
        setStatus('sent');
      } catch (error) {
        setStatus('failed');
        setFailure(failureOf(error));
      }
      onWritten();
    },
    [number, onWritten],
  );

  return { choice, note, status, failure, setChoice, setNote, send };
}

/** What a failed step means for the answer, in words. */
const STEP_TEXT: Record<AnswerStep, string> = {
  comment: 'Your answer was not posted on GitHub.',
  label: 'Your answer is posted on GitHub as a comment, but the labels of the issue were not changed.',
  close: 'Your answer is posted and the labels are changed, but the issue is not closed.',
};

function FailureBox({ failure }: { failure: AnswerFailure }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-cc-rule-solid bg-cc-paper px-4 py-3">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{failure.step === null ? 'Your answer was not sent.' : STEP_TEXT[failure.step]}</p>
        <p className="mt-1 break-words">{failure.message}</p>
        <p className="mt-1 font-mono text-xs text-cc-muted">{failure.code}</p>
        <p className="mt-2 text-cc-muted">
          Your choice and your note are still in the form.{' '}
          {failure.step === null ? 'Press Retry to send them again.' : 'Press Retry: it carries on where the answer stopped, and it does not post the comment a second time.'}
        </p>
      </div>
    </div>
  );
}

/**
 * The answer form of an open decision: the options to pick from (with the recommended one marked), a note, and the Send button.
 * It is drawn only for a decision that is open and has options. An answer that stopped half way is shown as chosen (and its note is
 * in the text box), so that Retry finishes that answer; Mark can pick another option before he presses it.
 */
export function AnswerForm({ issue, draft }: { issue: DecisionIssue; draft: AnswerDraft }) {
  // An answer that is on the issue but not finished: the form starts from it, until Mark changes something.
  const half = issue.answer !== null && !issue.answer.complete && issue.options.some((option) => option.id === issue.answer?.option) ? issue.answer : null;
  const choice = draft.choice ?? half?.option ?? null;
  const note = draft.note ?? half?.note ?? '';
  const sending = draft.status === 'sending';
  const retrying = draft.status === 'failed';

  function submit(event: FormEvent<HTMLFormElement>) {
    // The page sends the answer itself (the content policy of the server forbids a form to go anywhere).
    event.preventDefault();
    if (choice === null || sending) return;
    void draft.send(choice, note);
  }

  return (
    <form onSubmit={submit} aria-label="Answer this decision" className="flex flex-col gap-5">
      <RadioGroup name="option" value={choice} onChange={draft.setChoice} isDisabled={sending} className="gap-3">
        <Label>
          <SectionLabel>Your answer</SectionLabel>
        </Label>
        {issue.options.map((option) => (
          <Radio key={option.id} value={option.id} className="rounded-md border border-cc-rule bg-cc-paper px-4 py-3 data-[selected=true]:border-cc-rule-solid">
            <Radio.Content className="items-start">
              <Radio.Control className="mt-1">
                <Radio.Indicator />
              </Radio.Control>
              <OptionBadge id={option.id} />
              <span className="min-w-0 flex-1 text-base font-normal break-words whitespace-pre-line">{option.text}</span>
              {issue.recommended === option.id && <RecommendedChip />}
            </Radio.Content>
          </Radio>
        ))}
      </RadioGroup>

      <TextField value={note} onChange={draft.setNote} isDisabled={sending}>
        <Label>Note (optional)</Label>
        <TextArea rows={3} maxLength={MAX_NOTE_CHARS} placeholder="Why, or what to do next. It is posted with your answer." />
      </TextField>

      {draft.failure !== null && <FailureBox failure={draft.failure} />}
      {draft.status === 'sent' && (
        <p role="status" className="text-sm text-cc-muted">
          Answer sent. Waiting for GitHub to show it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" variant="primary" isDisabled={choice === null || sending}>
          {sending ? <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /> : <Send aria-hidden className="size-4" />}
          {sending ? 'Sending…' : retrying ? 'Retry' : 'Send answer'}
        </Button>
        <p className="text-sm text-cc-muted">This posts a comment on the GitHub issue, swaps its label from "decision" to "decided", and closes it.</p>
      </div>
    </form>
  );
}
