import { Button, Modal } from '@heroui/react';
import { ExternalLink, Maximize2, Minimize2, X } from 'lucide-react';
import { useState } from 'react';

/** The picture that is zoomed, and what the zoom view needs to know about it. */
export type ZoomTarget = {
  /** The address of the picture: a file that the site serves (/files/<id>/<name>). */
  src: string;
  alt: string;
  /** The file name, shown as the title. */
  name: string;
  /** The address of the editable source of the diagram (its HTML file), when the doc links to it. */
  sourceHref: string | null;
};

/**
 * The picture and its tools. It is a component of its own so that its state (actual size or fit) starts
 * again for each picture: the parent gives it a key.
 */
function ZoomContent({ target }: { target: ZoomTarget }) {
  const [actualSize, setActualSize] = useState(false);
  // Whether the picture is larger than the window shows it. A small picture has nothing to expand.
  const [canExpand, setCanExpand] = useState(false);

  return (
    <>
      {/* The right padding leaves room for the dialog's own close button, which sits in the corner. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cc-rule py-3 pr-16 pl-4">
        <Modal.Heading className="min-w-0 flex-1 truncate font-mono text-sm">{target.name}</Modal.Heading>
        {canExpand && (
          <Button size="sm" variant="tertiary" aria-pressed={actualSize} onPress={() => setActualSize(!actualSize)}>
            {actualSize ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
            {actualSize ? 'Fit to window' : 'Actual size'}
          </Button>
        )}
        {target.sourceHref !== null && (
          <a
            href={target.sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-cc-link underline underline-offset-2 cc-focus-ring"
          >
            <ExternalLink aria-hidden className="size-4" />
            Editable source
          </a>
        )}
      </div>
      <Modal.Body className="overflow-x-auto bg-cc-paper p-4">
        <img
          src={target.src}
          alt={target.alt}
          onLoad={(event) => {
            // Measured once, while the picture is still fitted to the window.
            const image = event.currentTarget;
            setCanExpand(image.naturalWidth > image.clientWidth + 1);
          }}
          className={actualSize ? 'max-w-none' : 'mx-auto h-auto max-w-full'}
        />
      </Modal.Body>
    </>
  );
}

/**
 * The zoom view of a diagram: the picture as large as the window allows, with a way to see it at its
 * own size and a link to its editable source. The dialog comes from HeroUI (React Aria under it), so
 * Esc and a click outside close it, Tab stays inside it, and the focus returns to the picture that
 * opened it. `target` is null while it is closed.
 */
export function DiagramZoom({ target, onClose }: { target: ZoomTarget | null; onClose: () => void }) {
  // The last picture stays on show while the dialog fades out, so its content does not vanish first.
  const [lastTarget, setLastTarget] = useState<ZoomTarget | null>(target);
  if (target !== null && target !== lastTarget) setLastTarget(target);
  const shown = target ?? lastTarget;

  return (
    <Modal.Backdrop
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Container size="cover" className="sm:w-full sm:p-6">
        <Modal.Dialog aria-label="Diagram" className="gap-0 rounded-lg border border-cc-rule-solid p-0">
          <Modal.CloseTrigger>
            <X aria-hidden className="size-4" />
          </Modal.CloseTrigger>
          {shown !== null && <ZoomContent key={shown.src} target={shown} />}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
