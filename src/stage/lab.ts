/**
 * The Phaser stage lab's entry point (spike `spike/phaser-stage`; page: `/stagelab.html`, DEV only).
 *
 * It only wires small things together: `boot.ts` starts the Phaser game and the stage scene, `labhook.ts` puts the
 * test hook on `window.__stagelab` (the Playwright specs read it), `controls.ts` mounts the three pickers and
 * `status.ts` shows messages on the page. An editor page would call `bootStage` the same way and skip the hook.
 *
 * The address can choose what to show: `?stage=sewer&set=boss&phase=act` (stage id, enemy group, moment of the turn).
 */
import { bootStage } from './boot';
import { SET_KEYS } from './config';
import { mountControls } from './controls';
import type { Phase } from './demo';
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

const PHASES: readonly string[] = ['choose', 'target', 'act'];

async function main(): Promise<void> {
  status.show('Loading the stage…');
  const query = new URLSearchParams(location.search);
  const set = query.get('set');
  const phase = query.get('phase');
  const booted = await bootStage({
    parent: 'stage',
    stageId: query.get('stage') ?? 'street',
    ...(set && (SET_KEYS as readonly string[]).includes(set) ? { setKey: set } : {}),
    ...(phase && PHASES.includes(phase) ? { phase: phase as Phase } : {}),
    query,
    onError: fail,
  });
  connectHook(hook, booted, () => {
    status.show(booted.standIns ? "Mark's Sprite Fusion sheets are not on this machine: the crew are stand-in blocks." : '');
    // The pickers read the scene's state, so they are mounted once the scene has drawn its first frame.
    const bar = document.getElementById('labbar');
    if (bar && !query.has('clean')) mountControls(bar, booted.scene, booted.init.stages, fail);
  });
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
