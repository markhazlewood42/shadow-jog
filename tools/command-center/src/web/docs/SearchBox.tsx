import { SearchField } from '@heroui/react';
import { Search, X } from 'lucide-react';
import { type FocusEvent, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ModuleName, Panel, SearchHit } from '../../shared/types';
import { getPanel } from '../api';
import { PanelFrame } from '../PanelFrame';
import { type PanelResult, useLoadedPanel } from '../usePanel';
import { docPath } from './paths';

/** The search results change when a doc is added, edited or removed. */
const SEARCH_MODULES: readonly ModuleName[] = ['docs'];

/** How long the typing must pause before the server is asked. A search for every key would be a request for every letter. */
const PAUSE_MS = 200;

/** The address that answers a search. */
const searchUrl = (query: string) => `/api/search?q=${encodeURIComponent(query)}`;

/** The hits for a query, as a panel (it has the same loading, error and updated-at states as every panel). */
function useSearch(query: string): PanelResult<SearchHit[]> {
  const load = useCallback(async (): Promise<Panel<SearchHit[]>> => {
    // Nothing typed is a search with no hits: the server needs no asking.
    if (query === '') return { ok: true, data: [], updatedAt: new Date().toISOString() };
    return getPanel<SearchHit[]>(searchUrl(query));
  }, [query]);
  return useLoadedPanel(load, SEARCH_MODULES);
}

/** The hits that are on show: the answer, or the last good one under an error (a panel shows both). */
function hitsOf(result: PanelResult<SearchHit[]>): SearchHit[] {
  const panel = result.panel;
  if (panel === null) return [];
  return panel.ok ? panel.data : (panel.lastGood?.data ?? []);
}

type HitListProps = {
  hits: readonly SearchHit[];
  query: string;
  listId: string;
  active: number;
  onActive: (index: number) => void;
  onOpen: () => void;
};

function HitList({ hits, query, listId, active, onActive, onOpen }: HitListProps) {
  if (hits.length === 0) {
    return <p className="text-sm text-cc-muted">{`No docs match "${query}"`}</p>;
  }
  return (
    <div role="listbox" id={listId} aria-label="Search results" className="-mx-2 flex flex-col">
      {hits.map((hit, i) => (
        // The focus stays in the search box and the arrow keys move `active` (the combobox pattern),
        // so an option is not a stop of the Tab key.
        <Link
          key={hit.slug}
          to={docPath(hit.slug)}
          role="option"
          id={`${listId}-${i}`}
          aria-selected={i === active}
          tabIndex={-1}
          onMouseEnter={() => onActive(i)}
          onClick={onOpen}
          className={`flex flex-col gap-0.5 border-l-2 px-2 py-2 ${i === active ? 'border-cc-accent bg-cc-accent-tint' : 'border-transparent'}`}
        >
          <span className="text-sm font-medium text-cc-ink">{hit.title}</span>
          {/* The heading of the part that matched, when it is not the title itself. Plain text, like the snippet. */}
          {hit.heading !== hit.title && <span className="text-xs text-cc-muted">{hit.heading}</span>}
          {hit.snippet !== '' && <span className="line-clamp-2 text-xs text-cc-muted">{hit.snippet}</span>}
        </Link>
      ))}
    </div>
  );
}

/**
 * The search box in the header of every docs page. It looks at the titles, the headings and the
 * text of every doc (the server does the searching). The results open under the box as you type;
 * the arrow keys choose one and Enter opens it: the chosen one, or the best one when Enter comes
 * before the answer does (one Enter is always enough). Esc empties the box and closes the list.
 *
 * It follows the combobox pattern of ARIA: the focus stays in the input, and `aria-activedescendant`
 * says which result is chosen.
 */
export function SearchBox() {
  const navigate = useNavigate();
  const listId = useId();
  // `text` is what is in the box. `query` is what was last searched for: `text` after a pause.
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const result = useSearch(query);
  const hits = hitsOf(result);
  // Makes an Enter that still waits for its answer out of date: more typing, a hit that was opened
  // by another way, or the box going away. Each of them counts one up, and an Enter opens its hit
  // only when the count is still the one it started with.
  const ticket = useRef(0);
  useEffect(
    () => () => {
      ticket.current += 1;
    },
    [],
  );

  useEffect(() => {
    const wanted = text.trim();
    if (wanted === query) return;
    const timer = setTimeout(() => setQuery(wanted), wanted === '' ? 0 : PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  // A new search starts at its first hit.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const showResults = open && query !== '';
  const chosen = showResults ? hits[active] : undefined;

  /** Closes the list. Whatever Enter was still waiting for is dropped. */
  function closeList() {
    ticket.current += 1;
    setOpen(false);
  }

  function openHit(hit: SearchHit) {
    closeList();
    navigate(docPath(hit.slug));
  }

  async function openActive() {
    const wanted = text.trim();
    if (wanted === '') return;

    if (wanted === query && result.panel !== null) {
      // The hits of this text are on show: Enter opens the chosen one.
      if (chosen !== undefined) openHit(chosen);
      return;
    }

    // The hits of this text are not in yet: the typing pause is not over, or the server is still
    // answering. One Enter must be enough, so ask now (the list shows the same search) and open the
    // best hit as soon as it comes.
    ticket.current += 1;
    const mine = ticket.current;
    setQuery(wanted);
    setOpen(true);
    const answer = await getPanel<SearchHit[]>(searchUrl(wanted));
    const best = answer.ok ? answer.data[0] : undefined;
    // Nothing is opened when the text was changed meanwhile, or when nothing matched (the list says so).
    if (mine === ticket.current && best !== undefined) openHit(best);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // The list is closed but the box still holds a search (a hit was opened with Enter): the down arrow opens the list again.
    if (!showResults && event.key === 'ArrowDown' && query !== '') {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!showResults || hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    }
  }

  // The list closes when the focus leaves the box and the list (Tab, or a click elsewhere).
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <div className="relative w-full max-w-md" onBlur={onBlur}>
      <SearchField
        aria-label="Search docs"
        value={text}
        onChange={(value) => {
          ticket.current += 1;
          setText(value);
          setOpen(true);
        }}
        onSubmit={() => void openActive()}
        fullWidth
        variant="secondary"
      >
        <SearchField.Group>
          {/* The icons of the field are Lucide ones, as every icon of the page: HeroUI draws its own when it is given none. */}
          <SearchField.SearchIcon>
            <Search aria-hidden />
          </SearchField.SearchIcon>
          <SearchField.Input
            placeholder="Search docs"
            role="combobox"
            aria-expanded={showResults}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={chosen === undefined ? undefined : `${listId}-${active}`}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          <SearchField.ClearButton aria-label="Clear search">
            <X aria-hidden className="size-4" />
          </SearchField.ClearButton>
        </SearchField.Group>
      </SearchField>
      {showResults && (
        // A press on the list must not take the focus from the box: the list would close before the click arrived.
        // tabIndex -1 keeps the list out of the Tab order: a box that scrolls would otherwise be a stop of its own, in the way.
        <div
          tabIndex={-1}
          className="absolute top-full right-0 z-40 mt-2 max-h-[calc(100vh-5rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto"
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
        >
          <PanelFrame title="Search results" result={result}>
            {(found) => <HitList hits={found} query={query} listId={listId} active={active} onActive={setActive} onOpen={closeList} />}
          </PanelFrame>
        </div>
      )}
    </div>
  );
}
