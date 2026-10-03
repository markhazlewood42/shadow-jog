/**
 * The Phaser stage lab's entry point (spike `spike/phaser-stage`; page: `/stagelab.html`, DEV only).
 *
 * It only wires three small things together: `boot.ts` starts the Phaser game and the stage scene,
 * `labhook.ts` puts the test hook on `window.__stagelab` (the Playwright specs read it), and `status.ts`
 * shows messages on the page. An editor page would call `bootStage` the same way and skip the hook.
 */
import { bootStage } from './boot';
import { connectHook, emptyHook } from './labhook';
import { statusLine } from './status';

const status = statusLine();
const hook = emptyHook();
window.__stagelab = hook;

function fail(message: string): void {
  hook.error = message;
  status.show(message, true);
  console.error(message);
}

async function main(): Promise<void> {
  status.show('Loading the stage…');
  const booted = await bootStage({ parent: 'stage', stageId: 'street', query: new URLSearchParams(location.search), onError: fail });
  connectHook(hook, booted, () => status.show(booted.standIns ? "Mark's Sprite Fusion sheets are not on this machine: the crew are stand-in blocks." : ''));
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
