import { Chip } from '@heroui/react';
import { CircleAlert, CircleCheck, ExternalLink, FileText, Gavel, GitPullRequest, Info, ListChecks, type LucideIcon, MessageSquare, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { ModuleName, YourMoveInfo, YourMoveItem, YourMoveSource } from '../../shared/types';
import { PanelContent } from '../PanelFrame';
import { usePanel } from '../usePanel';
import { GlassPanel, type PanelPlacement } from './GlassPanel';
import { Age, useNow } from './time';

// "Your move": every open action for Mark in one list, the most blocking first (the order is made by the server: src/server/now/yourMove.ts). This is the
// panel that the page is for, so it is the one that carries the one amber item of the page: the count of what waits.

/** The list is made from five sources, so the panel loads again when any of them says that something changed. */
const YOUR_MOVE_MODULES: readonly ModuleName[] = ['decisions', 'sessions', 'status', 'github', 'engine'];

/** What each source is called in the list: next to an item (small) and in the notice for a source that could not be read. */
const SOURCE_LABELS: Record<YourMoveSource, string> = {
  'decision-issue': 'Decision',
  session: 'Session',
  pr: 'Pull request',
  'doc-decision': 'Engine decision',
  status: 'Status',
};

const SOURCE_ICONS: Record<YourMoveSource, LucideIcon> = {
  'decision-issue': Gavel,
  session: MessageSquare,
  pr: GitPullRequest,
  'doc-decision': FileText,
  status: ListChecks,
};

/**
 * The status light of a session's reply, as a word and a shape. The Look has no red, yellow or green: amber is for the one or two focal items of a page, and a list can
 * have any number of lights. So a light is told by its word and by the shape of its icon, as a traffic sign is, and never by a color.
 */
const LIGHTS = {
  red: { label: 'Red', Icon: TriangleAlert },
  yellow: { label: 'Yellow', Icon: CircleAlert },
  green: { label: 'Green', Icon: CircleCheck },
} as const;

/** The words of an item: a link when the item has a place to go, plain text when it has none. Every word comes from a file or from GitHub, and is shown as text. */
function ItemText({ item }: { item: YourMoveItem }) {
  const { href, text } = item;
  if (href === null) return <span className="break-words">{text}</span>;
  const linkClass = 'break-words text-cc-link underline underline-offset-2 cc-focus-ring';
  // A link inside this site moves the router and loads no new page. A link to GitHub opens another tab, and says so with its icon.
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={linkClass}>
        {text}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {text}
      <ExternalLink aria-hidden className="mb-0.5 ml-1 inline size-3.5" />
    </a>
  );
}

function ItemRow({ item, now }: { item: YourMoveItem; now: number }) {
  const Icon = SOURCE_ICONS[item.source];
  const light = item.light === null ? null : LIGHTS[item.light];
  return (
    <li className="flex items-start gap-3 py-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />
      {/* The words, and after them in small type what kind of thing it is, the light of its reply and how old it is. They wrap as one line of text, so a short item takes one line. */}
      <p className="min-w-0 flex-1 text-sm">
        <ItemText item={item} />
        <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 align-baseline text-xs text-cc-soft">
          <span>{SOURCE_LABELS[item.source]}</span>
          {light !== null && (
            <span className="inline-flex items-center gap-1">
              <light.Icon aria-hidden className="size-3" />
              {light.label} light
            </span>
          )}
          {item.at !== null && <Age iso={item.at} now={now} />}
        </span>
      </p>
    </li>
  );
}

/** The sources that could not be read in full. It is a notice and not an error: the list was made, and it says what may be missing from it. */
function MissingNotice({ missing }: { missing: YourMoveInfo['missing'] }) {
  if (missing.length === 0) return null;
  return (
    <div role="note" aria-label="Sources that could not be read" className="flex items-start gap-2 rounded-md border border-cc-rule-solid px-3 py-2 text-xs text-cc-muted">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-cc-ink" />
      <div className="min-w-0">
        <p className="font-medium text-cc-ink">The list may be incomplete: these sources could not be read in full.</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {missing.map(({ source, message }) => (
            <li key={source} className="break-words">
              <span className="font-medium">{SOURCE_LABELS[source]}:</span> {message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function YourMoveList({ info, now }: { info: YourMoveInfo; now: number }) {
  return (
    <div className="flex flex-col gap-3">
      {info.items.length === 0 ? (
        <p className="flex items-center gap-2 text-cc-muted">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-cc-ink" />
          Nothing waits for you right now.
        </p>
      ) : (
        <ol aria-label="What waits for Mark" className="divide-y divide-cc-rule">
          {info.items.map((item, index) => (
            // The list has no id of its own for an item, and a list is made again as a whole, so the place in it is the key.
            <ItemRow key={`${index}:${item.source}:${item.text}`} item={item} now={now} />
          ))}
        </ol>
      )}
      <MissingNotice missing={info.missing} />
    </div>
  );
}

/** The amber chip with the number of items. It is the one focal item of the page (the Look), and the words after the number are for a screen reader. */
function CountChip({ count }: { count: number }) {
  return (
    <Chip color="accent" variant="primary" size="sm">
      <Chip.Label>
        {count}
        <span className="sr-only"> {count === 1 ? 'item waits' : 'items wait'} for you</span>
      </Chip.Label>
    </Chip>
  );
}

export function YourMovePanel(placement: PanelPlacement) {
  const result = usePanel<YourMoveInfo>('/api/now/your-move', YOUR_MOVE_MODULES);
  const now = useNow();
  // The data of a good panel, or the last good data under an error: the count follows what the list shows.
  const shown = result.panel === null ? null : result.panel.ok ? result.panel.data : (result.panel.lastGood?.data ?? null);
  return (
    <GlassPanel id="your-move" title="Your move" {...placement}>
      <PanelContent title="Your move" result={result} aside={shown !== null && shown.items.length > 0 ? <CountChip count={shown.items.length} /> : undefined}>
        {(info) => <YourMoveList info={info} now={now} />}
      </PanelContent>
    </GlassPanel>
  );
}
