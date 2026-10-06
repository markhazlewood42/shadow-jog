import { useEffect, useState } from 'react';
import { APP_NAME, type Health, type ModuleName } from '../shared/types';
import { type ConnectionState, loadHealthPanel, subscribeEvents } from './api';
import { PanelFrame, formatTime } from './PanelFrame';
import { useLoadedPanel } from './usePanel';

/** The health panel never reloads on a "changed" event: nothing in it changes while the server runs. */
const NO_MODULES: readonly ModuleName[] = [];

/** What the server says about itself: its version, when it started, and the links the config names. */
function ServerInfo({ info }: { info: Health }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-cc-muted">Version</dt>
        <dd className="font-mono">{info.version}</dd>
        <dt className="text-cc-muted">Started</dt>
        <dd className="font-mono">
          <time dateTime={info.startedAt}>{formatTime(info.startedAt)}</time>
        </dd>
      </dl>
      <nav aria-label="Links">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {info.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer" className="text-cc-link underline underline-offset-2">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connecting: 'connecting…',
  live: 'on',
  offline: 'off, trying to reconnect',
};

/** Whether the page is hearing the server's change events. Without them the panels would go stale, so it is never hidden. */
function LiveStatus() {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(
    () =>
      subscribeEvents((event) => {
        if (event.type === 'connection') setState(event.state);
      }),
    [],
  );
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-cc-muted">
      <span aria-hidden className={`size-2 rounded-full ${state === 'live' ? 'bg-cc-ink' : 'bg-cc-accent'}`} />
      Live updates: {CONNECTION_TEXT[state]}
    </p>
  );
}

/** The shell: the header, the server panel, and the live status. The pages of the later tasks go in here. */
export function App() {
  const server = useLoadedPanel(loadHealthPanel, NO_MODULES);
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-2 text-cc-muted">The status, the docs and the open decisions of Shadow Jog will be here. The server is running.</p>
      </header>
      <PanelFrame title="Server" result={server} focal>
        {(info) => <ServerInfo info={info} />}
      </PanelFrame>
      <LiveStatus />
    </div>
  );
}
