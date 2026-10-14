import { type ReactNode, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

// The title of a docs page (its h1) stands on the same row as the search box (Mark, 2026-10-14: "The page title can be aligned with the search bar"). DocsRoutes draws the row and
// the search box. A page does not know about the row: it wraps its h1 in <DocTitle>, and the h1 is drawn in the row. Without a row (a page drawn on its own, as the tests do), the h1
// stays where the page put it.

/** The element of the row that holds the title, or null while there is none. DocsRoutes provides it. */
const TitleSlot = createContext<HTMLElement | null>(null);
export const TitleSlotProvider = TitleSlot.Provider;

/** Draws its children in the title row of the docs site, or in place when the page has no row. */
export function DocTitle({ children }: { children: ReactNode }) {
  const slot = useContext(TitleSlot);
  return slot === null ? <>{children}</> : createPortal(children, slot);
}
