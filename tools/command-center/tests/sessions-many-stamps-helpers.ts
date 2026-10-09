import { join } from 'node:path';
import { copyClaudeFixtures, NOW, sessionsConfig } from './sessions-helpers';
import type { Config } from '../src/server/config';

export { NOW };
/** The session of the fixtures that works in the repo. */
export const S1_PLACEHOLDER = '11111111-1111-4111-8111-111111111111';

/** A config over a copy of the fixtures made inside `parent`. */
export function sessionsConfigFor(parent: string): Config {
  return sessionsConfig(copyClaudeFixtures(join(parent, 'projects'), {}));
}
