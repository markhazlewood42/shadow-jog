import { Button, Label, TextArea, TextField } from '@heroui/react';
import { CircleQuestionMark, LoaderCircle, Send } from 'lucide-react';
import { type FormEvent } from 'react';
import { type DecisionIssue, MAX_NOTE_CHARS } from '../../shared/types';
import { ASK_STEP_LABEL, type AnswerDraft, FailureBox, askRetryLine } from './AnswerForm';
import { Notice } from './DecisionCard';

// How Mark asks for more info on a decision (docs/command-center/needs-info-brief.md). It is a second box, apart from the answer form: its text box is never the note of an answer,
// so a click on the wrong button cannot close the issue. The button "Ask for more info" opens the box "Your question"; "Send question" posts it. The issue stays open: a session
// answers on the issue, and the page then shows "More info posted". The state of the box lives in the draft of the page (useAnswerDraft), like the answer form's.

/** The text of the newest question in the thread, or null. The retry of a question whose label step failed sends this text again (the server then adds the label only). */
function newestQuestion(issue: DecisionIssue): string | null {
  const questions = (issue.thread ?? []).filter((entry) => entry.kind === 'question');
  return questions.at(-1)?.text ?? null;
}

/**
 * The ask section of an open decision. After a question whose comment landed and whose label did not (phase `ask-unfinished`) it shows a notice and a "Flag again" button.
 * Otherwise it shows the button, and the box when the button was pressed (or a failed question is waiting for a retry).
 * The same phase also follows an answer that stopped half way: its first step took the `needs-info` label off, and its comment step failed. While the answer has a failure,
 * the notice and its button stay away, because "Flag again" would put the label back under an answer in progress. The answer's own failure box and Retry are then the only way on.
 */
export function AskForm({ issue, draft }: { issue: DecisionIssue; draft: AnswerDraft }) {
  const sending = draft.askStatus === 'sending';
  // The answer and the question are one write at a time: while the answer is on its way, both send buttons wait.
  const busy = sending || draft.status === 'sending';
  const open = draft.askOpen;
  const text = draft.askText;
  const empty = text.trim() === '';
  const showUnfinished = issue.phase === 'ask-unfinished' && draft.failure === null;
  const unfinished = showUnfinished ? newestQuestion(issue) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    // The page sends the question itself (the content policy of the server forbids a form to go anywhere).
    event.preventDefault();
    if (empty || busy) return;
    void draft.sendAsk(text);
  }

  return (
    <section aria-label="Ask for more info" className="flex flex-col gap-3">
      {showUnfinished && (
        <div className="flex flex-col gap-2">
          <Notice>Your question is posted, but it is not flagged for a session. Flag it again, or send your answer.</Notice>
          {unfinished !== null && (
            <div>
              <Button type="button" variant="secondary" isDisabled={busy} onPress={() => void draft.sendAsk(unfinished)}>
                {sending ? <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /> : <Send aria-hidden className="size-4" />}
                {sending ? 'Sending…' : 'Flag again'}
              </Button>
            </div>
          )}
        </div>
      )}

      {draft.askFailure !== null && <FailureBox failure={draft.askFailure} labels={ASK_STEP_LABEL} retry={askRetryLine} noStep="Question not sent" />}
      {draft.askStatus === 'sent' && !open && (
        <p role="status" className="text-sm text-cc-muted">
          Question sent. Wait for GitHub.
        </p>
      )}

      {!open && (
        <div>
          <Button type="button" variant="secondary" isDisabled={busy} onPress={() => draft.setAskOpen(true)}>
            <CircleQuestionMark aria-hidden className="size-4" />
            Ask for more info
          </Button>
        </div>
      )}

      {open && (
        <form onSubmit={submit} aria-label="Ask for more info on this decision" className="flex flex-col gap-4">
          <TextField value={text} onChange={draft.setAskText} isDisabled={sending}>
            <Label>Your question</Label>
            <TextArea rows={4} maxLength={MAX_NOTE_CHARS} placeholder="What do you need to know?" className="border border-cc-rule-solid" />
          </TextField>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" variant="secondary" isDisabled={empty || busy}>
              {sending ? <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /> : <Send aria-hidden className="size-4" />}
              {sending ? 'Sending…' : 'Send question'}
            </Button>
            <Button type="button" variant="ghost" isDisabled={busy} onPress={() => draft.setAskOpen(false)}>
              Cancel
            </Button>
            <p className="text-sm text-cc-muted">Posts your question to GitHub. The issue stays open.</p>
          </div>
        </form>
      )}
    </section>
  );
}
