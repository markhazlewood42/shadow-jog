import { Button, ToggleButton } from '@heroui/react';
import { Layers, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { APP_NAME } from '../../shared/types';
import { type ConnectionState, subscribeEvents } from '../api';
import { GlassProvider, useGlass } from './GlassProvider';
import type { PanelPlacement } from './GlassPanel';
import { LinksPanel } from './LinksPanel';
import { PullRequestsPanel } from './PullRequestsPanel';
import { RunningPanel } from './RunningPanel';
import { StatusPanel } from './StatusPanel';
import { YourMovePanel } from './YourMovePanel';
import { type PanelId, loadLayout, saveLayout } from './layout';

// The Now page (/): what is going on now and what needs Mark, in five panels. The panels are glass (PlasmaUI) that Mark can drag, or plain boxes when the
// glass is off or the browser cannot draw it. This is the one page that loads PlasmaUI: the router loads this file when the page is first asked for (see App.tsx).

/** The state of the event stream as one word, for the label "Live: <word>" (design 5.8: a label, not a sentence). */
const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connecting: 'connecting',
  live: 'on',
  offline: 'off',
};

/** Whether the page is hearing the server's change events. Without them the panels would go stale, so it is never hidden. */
export function LiveStatus() {
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
      Live: {CONNECTION_TEXT[state]}
    </p>
  );
}

/**
 * The switch of the glass, and the button that puts the panels back where the page lays them out. Where the browser cannot draw the glass (no WebGL2) there is nothing to
 * switch, so the page says why its panels are plain, in a label. The switch is a toggle button, not a HeroUI Switch: a selected toggle button is drawn lavender (theme.css),
 * and a selected Switch would be amber, which the Look keeps for the one or two focal items of a page. The reset button is always there: a saved arrangement is kept
 * also while the glass is off (the panels keep their places), so a person must always have a way to clear it.
 */
function GlassControls({ onReset }: { onReset: () => void }) {
  const { glass, webgl2, setGlass } = useGlass();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {webgl2 ? (
        <ToggleButton size="sm" isSelected={glass} onChange={setGlass}>
          <Layers aria-hidden className="size-4" />
          Glass panels
        </ToggleButton>
      ) : (
        <p role="note" className="text-sm text-cc-muted">No WebGL2: plain panels</p>
      )}
      <Button size="sm" variant="tertiary" onPress={onReset}>
        <RotateCcw aria-hidden className="size-3.5" />
        Reset layout
      </Button>
    </div>
  );
}

function NowContent() {
  // The arrangement is read once, when the page opens. The panels keep it up to date in the browser's storage as they are dragged (see GlassPanel).
  const [layout, setLayout] = useState(loadLayout);
  // Counting a reset makes the panels start over, so they take the arrangement that is now saved (none): a panel only reads where it starts when it is made.
  const [resets, setResets] = useState(0);
  const area = useRef<HTMLDivElement>(null);

  function resetLayout() {
    saveLayout({});
    setLayout({});
    setResets((count) => count + 1);
  }

  /** What a panel takes from the page: where the panels are dragged, where this one was left, and the columns it takes. */
  function placement(id: PanelId, className?: string): PanelPlacement {
    const offset = layout[id];
    return { bounds: area, ...(offset === undefined ? {} : { defaultOffset: offset }), ...(className === undefined ? {} : { className }) };
  }

  return (
    <main className="mx-auto flex max-w-[96rem] flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <Link to="/" aria-current="page" className="text-cc-ink cc-focus-ring">
              Now
            </Link>
            <Link to="/docs" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
              Docs
            </Link>
            <Link to="/agents" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
              Agents
            </Link>
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <LiveStatus />
          <GlassControls onReset={resetLayout} />
        </div>
      </header>

      {/* The five panels, the most important first: what waits for Mark, what runs, the pull requests, the status, the links. Your move takes the whole width. */}
      <div key={resets} ref={area} className="grid items-start gap-6 lg:grid-cols-2">
        <YourMovePanel {...placement('your-move', 'lg:col-span-2')} />
        <RunningPanel {...placement('running')} />
        <PullRequestsPanel {...placement('pull-requests')} />
        <StatusPanel {...placement('status')} />
        <LinksPanel {...placement('links')} />
      </div>
    </main>
  );
}

export function NowPage() {
  return (
    <GlassProvider>
      <NowContent />
    </GlassProvider>
  );
}
