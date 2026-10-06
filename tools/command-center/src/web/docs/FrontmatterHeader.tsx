import { Chip } from '@heroui/react';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DocPage, UpdatedFrom } from '../../shared/types';

/** Where the date of a doc came from, when it is not the doc's own `updated` line. */
const SOURCE_NOTE: Record<UpdatedFrom, string> = {
  frontmatter: '',
  git: 'from git',
  file: 'from the file time',
};

/** A value up to this long is shown as a chip. A longer one is a sentence ("approved 2026-10-05 (final). First approval ..."), and a chip would wrap it into a blob. */
const CHIP_MAX_CHARS = 24;
const isLong = (text: string) => text.length > CHIP_MAX_CHARS;

/** The longest address that is shown in full in the list of broken links. The rest is cut, and the whole address is in the tooltip. */
const MAX_SHOWN_CHARS = 60;

/** One entry of the header. A `wide` one takes a row of its own, after the others, so a long sentence does not push the rest down. */
function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? 'order-last basis-full' : ''}`}>
      <dt className="text-xs font-medium tracking-wide text-cc-soft uppercase">{label}</dt>
      <dd className="flex min-h-6 items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

/** A value that the doc does not have. A dash, and not a blank, so a missing frontmatter line reads as missing. */
function Missing() {
  return (
    <span aria-label="none" className="text-cc-soft">
      —
    </span>
  );
}

/** The type or the status of a doc: a chip when it is short, and text that wraps when it is long. */
function Value({ text }: { text: string }) {
  if (text === '') return <Missing />;
  return isLong(text) ? <span className="max-w-2xl">{text}</span> : <Chip size="sm">{text}</Chip>;
}

/** A note about the doc that is not part of its text: it is the site that says it. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-md border border-cc-rule-solid bg-cc-paper px-3 py-2 text-sm text-cc-muted">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-ink" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function shortened(address: string): string {
  return address.length > MAX_SHOWN_CHARS ? `${address.slice(0, MAX_SHOWN_CHARS - 1)}…` : address;
}

/**
 * The small header above a doc: its frontmatter (type and status), the day it last changed and
 * where that day came from, then anything that is wrong with the doc: a frontmatter that could not
 * be read, and links that go nowhere. A doc with no frontmatter shows a dash for its type and status.
 */
export function FrontmatterHeader({ doc }: { doc: DocPage }) {
  const note = SOURCE_NOTE[doc.updatedFrom];
  return (
    <div className="flex flex-col gap-3">
      <dl aria-label="Document details" className="flex flex-wrap gap-x-8 gap-y-3">
        <Field label="Type" wide={isLong(doc.type)}>
          <Value text={doc.type} />
        </Field>
        <Field label="Status" wide={isLong(doc.status)}>
          <Value text={doc.status} />
        </Field>
        <Field label="Updated">
          {/* The day is plain text from the server (YYYY-MM-DD). It is shown as it is: a time zone must not move it. */}
          <time dateTime={doc.updated} className="font-mono">
            {doc.updated}
          </time>
          {note !== '' && <span className="text-xs text-cc-soft">{note}</span>}
        </Field>
      </dl>
      {doc.frontmatterError !== null && <Notice>The frontmatter of this doc could not be read, so its type, status and date may be missing: {doc.frontmatterError}</Notice>}
      {doc.brokenLinks.length > 0 && (
        <Notice>
          {doc.brokenLinks.length} broken {doc.brokenLinks.length === 1 ? 'link' : 'links'} in this doc:{' '}
          {doc.brokenLinks.map((address, i) => (
            <span key={address}>
              {i > 0 && ', '}
              <code title={address} className="font-mono text-xs text-cc-ink">
                {shortened(address)}
              </code>
            </span>
          ))}
        </Notice>
      )}
    </div>
  );
}
