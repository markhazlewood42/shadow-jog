import { ExternalLink } from 'lucide-react';
import type { Health, ModuleName } from '../../shared/types';
import { loadHealthPanel } from '../api';
import { PanelContent } from '../PanelFrame';
import { useLoadedPanel } from '../usePanel';
import { GlassPanel, type PanelPlacement } from './GlassPanel';

// "Links": the game and its tools, and the GitHub repo (design 5.1). They come from the config file by way of /api/health, so a link is added or changed
// in command-center.config.json and not in the page. A browser page cannot open a file:// address, so every link is a web address.

/** Nothing in the health reply changes while the server runs, so the panel never loads again for a "changed" event. */
const NO_MODULES: readonly ModuleName[] = [];

/** The links to show: the game first, then the others. The config's own list usually has the game in it too, and then its label is used and the game is not listed twice. */
function linksOf(health: Health): { label: string; url: string }[] {
  const game = health.links.find((link) => link.url === health.gameUrl);
  return [{ label: game?.label ?? 'Game', url: health.gameUrl }, ...health.links.filter((link) => link.url !== health.gameUrl)];
}

/**
 * A link is its label and the icon of a link that leaves the site (design 5.1): the address is the link's, and is not written out. The label under the list is for a config
 * that has the game and nothing else.
 */
function LinkList({ health }: { health: Health }) {
  const links = linksOf(health);
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Links" className="flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.url}>
            <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm text-cc-link underline underline-offset-2 cc-focus-ring">
              {link.label}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
      {links.length === 1 && <p className="text-xs text-cc-muted">No other links</p>}
    </div>
  );
}

export function LinksPanel(placement: PanelPlacement) {
  const result = useLoadedPanel(loadHealthPanel, NO_MODULES);
  return (
    <GlassPanel id="links" title="Links" {...placement}>
      <PanelContent title="Links" result={result}>
        {(health) => <LinkList health={health} />}
      </PanelContent>
    </GlassPanel>
  );
}
