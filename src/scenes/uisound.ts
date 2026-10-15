/** The UI kit's `onSound` callback, mapped to the game's sound effects. The kit holds no audio; every UI scene passes this to its `ListMenu`. */
import { sfx } from '../audio/sfx';
import type { UiSound } from '../sje';

const NAMES: Record<UiSound, 'cursor' | 'confirm' | 'cancel' | 'buzz'> = { cursor: 'cursor', confirm: 'confirm', cancel: 'cancel', buzz: 'buzz' };

export function uiSound(s: UiSound): void {
  sfx(NAMES[s]);
}
