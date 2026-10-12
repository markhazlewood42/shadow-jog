import type { ReporterSettings } from './env-file';
import { type HttpClient, fetchClient } from './http';
import { createLiveStore } from './upstash';

// `main.ts --clear-live`: removes the `live` key and ends. The launcher runs it after `--stop`, because a stop that ends the server with a hard kill
// (Windows has no SIGTERM handler that runs) gives the server no time to remove its own key. The launcher never reads the settings file with the token;
// this process does, as the server does. Best effort: a failure is logged, the key expires by itself within 10 minutes, and the exit is never blocked.

/** The most time that the removal may take. */
export const CLEAR_TIMEOUT_MS = 8000;

/** Removes the key. Gives true when the store confirmed it. It never throws. `http` is for tests. */
export async function clearLive(settings: ReporterSettings, log: (message: string) => void, http: HttpClient = fetchClient, timeoutMs: number = CLEAR_TIMEOUT_MS): Promise<boolean> {
  const store = createLiveStore({ url: settings.upstashUrl, token: settings.token, http });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      store.deleteLive(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
      }),
    ]);
    log('the live key was removed');
    return true;
  } catch (error) {
    log(`the live key could not be removed (${error instanceof Error ? error.message : 'unknown error'}). It expires by itself within 10 minutes.`);
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
