import { Button, ButtonGroup, Dropdown, Label } from '@heroui/react';
import { AlertCircle, Check, ChevronDown, Copy, Download } from 'lucide-react';
import type { DocPage, Health } from '../../shared/types';
import { getJson } from '../api';
import { useResultFlash } from '../useResultFlash';
import { buildCopyText, downloadName } from './copyText';
import { HOSTED_REPO } from '../hosted/mode';
import { docSourcePath } from './paths';

// Copy and Download for one doc page (design 5.7, revision 2): a split button as on the markedup-consulting
// site. The main button copies the doc for an LLM. The small arrow opens a menu with the two actions.
//
// The text of the doc is not in the page data. It is fetched from the source route when a button is pressed,
// so a page that nobody copies never pays for it.

// The hosted build (VITE_HOSTED=1) reads the doc file from /api/docs/<repo path>. Vite writes the flag into the code, so the local build has none of this.
const HOSTED = import.meta.env.VITE_HOSTED === '1';

/** How long a Blob URL lives after a download starts, in milliseconds. */
const REVOKE_MS = 10_000;

/** What the main button shows. `idle` is the button as it rests. The other three last for 2 seconds. */
type Shown = 'idle' | 'copied' | 'copy-failed' | 'download-failed';

const LABELS: Record<Shown, string> = {
  idle: 'Copy for LLM',
  copied: 'Copied',
  'copy-failed': 'Copy failed',
  'download-failed': 'Download failed',
};

const ICONS = { idle: Copy, copied: Check, 'copy-failed': AlertCircle, 'download-failed': AlertCircle } as const;

/**
 * The text of the doc file as the server has it. Throws when the server cannot be reached or does not have the doc.
 * The hosted page reads the file itself from /api/docs/<repo path>, which is the one place that serves a doc file there.
 */
export async function fetchSource(doc: Pick<DocPage, 'id' | 'slug'>): Promise<string> {
  if (HOSTED) {
    // The hosted fetch sorts the answers: a lost login (a redirect, a 401, or the login page as HTML) is an error and never the text of the doc. A page of HTML must not be copied or saved as a doc.
    const { fetchHostedText } = await import('../hosted/fetch');
    const result = await fetchHostedText(`/api/docs/${doc.id.split('/').map(encodeURIComponent).join('/')}`);
    if (!result.ok) throw new Error(result.error.message);
    return result.text;
  }
  const res = await fetch(docSourcePath(doc.slug), { cache: 'no-store' });
  if (!res.ok) throw new Error(`The source of the doc answered ${res.status}.`);
  return res.text();
}

/** Saves `text` as a file that has this name. The browser has no "save this text" call, so the page makes a link to a Blob and clicks it. */
export function saveAsFile(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Firefox and Safari start the download after click() returns, so the URL must live a little longer.
  // The delay is long enough for the download to start. After it, the URL would only keep the Blob in memory until the page closes.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

/**
 * Puts the doc on the clipboard for an LLM. Throws when the doc text cannot be fetched or the clipboard says no.
 * The repo name for the address in the header comes from the health answer, as for the other links of the site. The copy does not need it:
 * when that answer fails, the header has the path of the file and no address.
 */
export async function copyForLlm(doc: Pick<DocPage, 'id' | 'slug' | 'title'>): Promise<void> {
  // The hosted page has one repo and no /api/health.
  const health = HOSTED
    ? Promise.resolve(HOSTED_REPO)
    : getJson<Health>('/api/health').then(
        (answer) => answer.githubRepo,
        () => null,
      );
  const [source, githubRepo] = await Promise.all([fetchSource(doc), health]);
  // The clipboard belongs to the browser. It says no by rejecting the call, or by having no `navigator.clipboard`, which throws here too.
  await navigator.clipboard.writeText(buildCopyText({ title: doc.title, id: doc.id, githubRepo, source }));
}

/**
 * The buttons under the header of a doc. A failed copy or a failed download shows its words on the main
 * button for 2 seconds, and never fails silently. The words are also in a status region that is on the
 * page from the start, so a screen reader says them (a region that is added together with its words is often not read).
 */
export function DocToolbar({ doc }: { doc: Pick<DocPage, 'id' | 'slug' | 'title'> }) {
  // A result shows for 2 seconds and then the button goes back to "Copy for LLM". A second result starts the 2 seconds again, and the timer stops when the page goes to another doc.
  const [shown, show] = useResultFlash<Shown>('idle');

  async function copy(): Promise<void> {
    try {
      await copyForLlm(doc);
      show('copied');
    } catch {
      show('copy-failed');
    }
  }

  async function download(): Promise<void> {
    try {
      saveAsFile(await fetchSource(doc), downloadName(doc.id));
    } catch {
      show('download-failed');
    }
  }

  const Icon = ICONS[shown];
  return (
    <div className="flex items-center gap-2">
      <ButtonGroup variant="tertiary" size="sm">
        <Button className="min-w-36 justify-center" onPress={() => void copy()}>
          <Icon aria-hidden className="size-3.5" />
          {LABELS[shown]}
        </Button>
        {/* The menu button is inside the Dropdown, not a direct child of the group, so it is given the look of the group by hand. */}
        <Dropdown>
          <Button isIconOnly variant="tertiary" size="sm" aria-label="More">
            <ButtonGroup.Separator />
            <ChevronDown aria-hidden className="size-3.5" />
          </Button>
          <Dropdown.Popover placement="bottom start" className="border border-cc-rule-solid">
            <Dropdown.Menu onAction={(key) => void (key === 'download' ? download() : copy())}>
              <Dropdown.Item id="copy" textValue="Copy for LLM">
                <Copy aria-hidden className="size-4 shrink-0 text-cc-muted" />
                <Label>Copy for LLM</Label>
              </Dropdown.Item>
              <Dropdown.Item id="download" textValue="Download as markdown">
                <Download aria-hidden className="size-4 shrink-0 text-cc-muted" />
                <Label>Download as markdown</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </ButtonGroup>
      <span role="status" aria-live="polite" className="sr-only">
        {shown === 'idle' ? '' : LABELS[shown]}
      </span>
    </div>
  );
}
