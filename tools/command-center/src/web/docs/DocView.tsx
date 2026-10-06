import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { DocPage } from '../../shared/types';
import { Backlinks } from './Backlinks';
import { DiagramZoom, type ZoomTarget } from './DiagramZoom';
import { FrontmatterHeader } from './FrontmatterHeader';
import { type Banner, hasHeadingLevel1, placeBanners } from './html';
import { Outline } from './Outline';
import { useDocumentTitle } from './useDocumentTitle';

/** Something to show in front of the heading with the id `anchor` (for example "a decision is open on this section"). */
export type DocBanner = Banner<ReactNode>;

export type DocViewProps = {
  doc: DocPage;
  /** Shown at the end of the doc, under its text. A later page puts the Previous and Next buttons here. */
  footer?: ReactNode;
  /**
   * Each banner is shown in front of the heading of the doc that has the id `anchor`. A banner whose
   * heading is not in the doc is shown above the whole doc, so it never disappears.
   */
  banners?: readonly DocBanner[];
};

const NO_BANNERS: readonly DocBanner[] = [];

function decodeOrKeep(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The element of the doc that has this id. The search stays inside the doc on purpose: a heading
 * gets its id from its words, so a heading "Root" is `#root`, and the page has an element with that
 * id too. `document.getElementById` would find the page's, and a link to the heading would scroll
 * to the top of the page.
 */
function findInDoc(body: HTMLElement, id: string): HTMLElement | null {
  for (const element of body.querySelectorAll<HTMLElement>('[id]')) {
    if (element.id === id) return element;
  }
  return null;
}

/** The address of the editable source of a diagram: the doc's own link to the HTML file that has the picture's name. */
function editableSourceOf(body: HTMLElement, pictureSrc: string): string | null {
  const fileName = pictureSrc.split('?')[0]?.split('/').pop() ?? '';
  const baseName = fileName.replace(/\.[^.]+$/, '');
  if (baseName === '') return null;
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    // A file that the site serves is /files/<id>/<name>, and a diagram's picture and source share a name.
    if (href.startsWith('/files/') && href.endsWith(`/${baseName}.html`)) return href;
  }
  return null;
}

/** What the zoom view needs to know about the picture that was clicked. */
function zoomTargetOf(image: HTMLImageElement, body: HTMLElement): ZoomTarget {
  const wanted = image.dataset.zoom ?? '';
  // The server wrote data-zoom, and it only ever names a file of this site. Checked again, because the address is put in an <img>.
  const src = wanted.startsWith('/files/') ? wanted : image.currentSrc || image.src;
  const fileName = src.split('?')[0]?.split('/').pop() ?? '';
  return { src, alt: image.alt, name: decodeOrKeep(fileName) || 'diagram', sourceHref: editableSourceOf(body, src) };
}

/** The picture of a doc that can be zoomed, when the event came from one. */
function zoomableImage(target: EventTarget | null, body: HTMLElement): HTMLImageElement | null {
  if (!(target instanceof Element)) return null;
  const image = target.closest('img[data-zoom]');
  return image instanceof HTMLImageElement && body.contains(image) ? image : null;
}

/**
 * One doc: its header, its text, and on the right its outline and the docs that link here.
 *
 * The text is html that the server made from the markdown (src/server/docs/render.ts). The server
 * escapes every tag of the doc's own text, so this is the one place where html goes into the page,
 * and a doc can never run script. This component then does the things a page needs from that html:
 *
 * - a link to another doc, or to a heading, moves inside the app and does not load a new page;
 * - a link opens at its heading (the doc scrolls there), and a doc opens at its top;
 * - a diagram opens in a zoom view when it is clicked or when Enter is pressed on it;
 * - a banner is shown in front of the heading that it names (see `banners`).
 */
export function DocView({ doc, footer, banners = NO_BANNERS }: DocViewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);

  useDocumentTitle(doc.title);

  const parts = useMemo(() => placeBanners(doc.html, banners), [doc.html, banners]);
  // A doc with no heading of its own still needs a title on the page.
  const needsTitle = !hasHeadingLevel1(doc.html);

  // A picture that can be zoomed is a button for the keyboard and for a screen reader: it can be
  // reached with Tab and opened with Enter. The html comes from the server, so this is done here.
  useLayoutEffect(() => {
    for (const image of bodyRef.current?.querySelectorAll<HTMLImageElement>('img[data-zoom]') ?? []) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-haspopup', 'dialog');
    }
  }, [doc.html]);

  // Scroll to the heading that the address names, or to the top. This runs when the address changes:
  // a new doc, a new hash, or the same hash clicked again (every navigation has its own `location.key`).
  // It must not run when the doc's text changes under a person who is reading it, so the effect
  // depends on the key alone and not on `doc.html`.
  useEffect(() => {
    const body = bodyRef.current;
    const id = location.hash === '' ? '' : decodeOrKeep(location.hash.slice(1));
    const heading = body !== null && id !== '' ? findInDoc(body, id) : null;
    if (heading !== null) heading.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [location.key]);

  function onBodyClick(event: MouseEvent<HTMLDivElement>) {
    const body = bodyRef.current;
    // A click with a modifier key, or with another button, is the browser's own (open in a new tab, and so on).
    if (body === null || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const image = zoomableImage(event.target, body);
    if (image !== null) {
      event.preventDefault();
      setZoom(zoomTargetOf(image, body));
      return;
    }

    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href') ?? '';
    // A link inside the app moves the router. A heading link must stay inside the doc (see findInDoc), so it goes through the router too.
    if (href.startsWith('#')) {
      event.preventDefault();
      navigate({ hash: href });
    } else if (href === '/docs' || href.startsWith('/docs/')) {
      event.preventDefault();
      navigate(href);
    }
  }

  function onBodyKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const body = bodyRef.current;
    if (body === null || (event.key !== 'Enter' && event.key !== ' ')) return;
    const image = zoomableImage(event.target, body);
    if (image === null) return;
    event.preventDefault();
    setZoom(zoomTargetOf(image, body));
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <article className="min-w-0">
        <FrontmatterHeader doc={doc} />
        {/* The handlers sit on the container and read where the event came from: the html is one string, with no React element in it to hang a handler on. */}
        <div ref={bodyRef} className="doc-html mt-6" onClick={onBodyClick} onKeyDown={onBodyKeyDown}>
          {needsTitle && <h1>{doc.title}</h1>}
          {parts.map((part, i) =>
            part.kind === 'html' ? (
              // The html is the server's own output for this doc (see the comment above this component),
              // and every tag of the doc's own text is escaped there, so it is not sanitized again here.
              <div key={`html:${i}`} dangerouslySetInnerHTML={{ __html: part.html }} />
            ) : (
              <Fragment key={`banner:${i}`}>{part.banner.node}</Fragment>
            ),
          )}
        </div>
        {footer !== undefined && footer !== null && <div className="mt-10 border-t border-cc-rule pt-6">{footer}</div>}
      </article>
      <aside aria-label="About this doc" className="flex flex-col gap-8 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
        <Outline slug={doc.slug} headings={doc.headings} />
        <Backlinks refs={doc.backlinks} />
      </aside>
      <DiagramZoom target={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}
