import { Button } from '@heroui/react';
import { LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PanelResult } from './usePanel';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** A time of day for a person ("14:03:09"). Text that is not a time is shown as it is. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : timeFormat.format(date);
}

/** A time as a <time> element, so the exact moment is in the page for anyone (or any test) who wants it. */
function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatTime(iso)}</time>;
}

/**
 * The inset of a panel, on the left and on the right, for the header and the body alike. The header holds the time of the last update at its right end,
 * and at the 16 pixels that it had, it sat too close to the rounded corner (Mark, on the live tool). It is more than twice the radius of the corner (8 pixels). The
 * body has the same inset, so that the text of the title and the text under it stay on one line. It is padding and not a margin, so that every panel gets it
 * through this file, whatever frame it sits in.
 */
const INSET = 'px-5';

type PanelContentProps<T> = {
  title: string;
  /** What usePanel returned for this panel. */
  result: PanelResult<T>;
  /** Something shown next to the title (for example a count). It is drawn in every state of the panel, also while it loads and when it failed. */
  aside?: ReactNode;
  /** Draws the data. It is called with the new data, or with the last good data under an error. */
  children: (data: T) => ReactNode;
};

/**
 * The inside of a panel: its header (the title, and when it was last updated) and its body. It owns the three things every panel must show and never
 * hide: that it is loading, that it failed (with the reason, a Retry button and the last good data when there is some), and when it was last updated.
 * It draws no frame of its own, so a panel can put it in the frame that suits it: the box of PanelFrame, or a glass surface (see now/GlassPanel).
 */
export function PanelContent<T>({ title, result, aside, children }: PanelContentProps<T>) {
  const { state, panel, reload } = result;

  let status: ReactNode = null;
  let body: ReactNode;
  if (state === 'loading' || panel === null) {
    body = (
      <p role="status" className="flex items-center gap-2 text-cc-muted">
        <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
        Loading…
      </p>
    );
  } else if (panel.ok) {
    status = (
      <>
        Updated <Time iso={panel.updatedAt} />
      </>
    );
    body = children(panel.data);
  } else {
    status = panel.updatedAt ? (
      <>
        Last updated <Time iso={panel.updatedAt} />
      </>
    ) : (
      'Not updated yet'
    );
    body = (
      <>
        <div role="alert" className="flex flex-wrap items-start gap-3">
          {/* Ink, not amber: a page may have one or two amber items (the Look), and a page can hold several panels that fail at once. */}
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-ink" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{panel.error.message}</p>
            <p className="mt-0.5 font-mono text-xs text-cc-muted">{panel.error.code}</p>
          </div>
          <Button size="sm" variant="tertiary" onPress={reload}>
            <RefreshCw aria-hidden className="size-3.5" />
            Retry
          </Button>
        </div>
        {panel.lastGood && (
          <div className="mt-4 border-t border-cc-rule pt-4">
            <p className="mb-3 text-xs text-cc-muted">
              Showing the last good data, from <Time iso={panel.lastGood.updatedAt} />.
            </p>
            {children(panel.lastGood.data)}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <header className={`flex items-baseline justify-between gap-4 border-b border-cc-rule py-3 ${INSET}`}>
        {aside === undefined ? (
          <h2 className="text-base font-semibold">{title}</h2>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="text-base font-semibold">{title}</h2>
            {aside}
          </div>
        )}
        <p className="font-mono text-xs text-cc-muted">{status}</p>
      </header>
      <div className={`py-4 ${INSET}`}>{body}</div>
    </>
  );
}

type PanelFrameProps<T> = {
  title: string;
  /** What usePanel returned for this panel. */
  result: PanelResult<T>;
  /** Marks the panel as one of the one or two things on the page that matter most (amber border). */
  focal?: boolean;
  /** Draws the data. It is called with the new data, or with the last good data under an error. */
  children: (data: T) => ReactNode;
};

/** The frame every data panel sits in, when it is a plain box: the content of the panel (PanelContent) in a section that has its name. */
export function PanelFrame<T>({ title, result, focal = false, children }: PanelFrameProps<T>) {
  // The frame of a panel is the lavender one of the Look (rule-solid). The hairline (rule) is for the lines inside it.
  return (
    <section aria-label={title} className={`rounded-lg border ${focal ? 'border-cc-accent cc-focal' : 'border-cc-rule-solid bg-cc-paper-2'}`}>
      <PanelContent title={title} result={result}>
        {children}
      </PanelContent>
    </section>
  );
}
