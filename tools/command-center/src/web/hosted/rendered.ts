import { parseDocPath } from '../../hosted/doc-path';
import type { Snapshot } from '../../github-api/types';
import { slugOf } from '../../shared/doc-slug';
import type { Decision, DecisionDetail, DocDecision, DocPageData, DocsListing, DocSummary, NavItem, NavSection, Panel, StatusInfo } from '../../shared/types';
import { type KnownTargets, resolveHref } from '../../server/docs/links';
import { parseNavFile } from '../../server/docs/nav';
import { renderDoc } from '../../server/docs/render';
import { ENGINE_DOCS, classifyDecisions, classifyUpdateChoices, parseEngineDecisions, parseUpdateChoices, readmeWaitsForMark } from '../../server/engine/decisions';
import { parsePhaseDecisions } from '../../server/engine/phase';
import { say } from '../../server/messages';
import { PanelError } from '../../server/source';
import { MIGRATION_DOC_PATH, ROADMAP_PATH, STATUS_DOC_PATH, parseMilestoneKey, parseMilestones, parseRoadmapDone, parseStatus } from '../../server/status/status';
import navFile from '../../../nav.json';
import { type HostedError, fetchHostedText } from './fetch';
import { HOSTED_REPO } from './mode';
import { errorPanel, failedPanel } from './panels';

// The parts of the hosted page that need the markdown renderer (markdown-it, a YAML reader): the docs, the Status panel (it reads status.md and the milestone
// table) and the engine decision table. They reuse the renderer and the parsers of the local server unchanged, so a doc looks the same on both pages. The page
// loads this file only when one of those panels asks for it, so the Workstreams view and the polling do not pay for it (see resolve.ts).

const BLOB_BASE = `https://github.com/${HOSTED_REPO}/blob/main`;

// ---- what links point at ----

/**
 * The hosted page has no list of the files of the repo, so it cannot check a link against one. It answers by the allow-list of `/api/docs` (the same rule the function
 * applies): a markdown file under `docs/` or in the root is a doc of this site, a PNG or SVG under `docs/` is a picture the function serves, and any other path opens on GitHub.
 * A link to a doc that does not exist shows the "Doc not found" page when it is opened. The local page marks such a link as broken at render time.
 */
class HostedDocLinks extends Map<string, string> {
  override get(path: string): string | undefined {
    const parsed = parseDocPath(`/api/docs/${path}`);
    return parsed.ok && parsed.type === 'markdown' ? slugOf(path) : undefined;
  }
}

class HostedAssetLinks extends Map<string, string> {
  override get(path: string): string | undefined {
    const parsed = parseDocPath(`/api/docs/${path}`);
    return parsed.ok && (parsed.type === 'png' || parsed.type === 'svg') ? `/api/docs/${path}` : undefined;
  }
}

const KNOWN: KnownTargets = { docs: new HostedDocLinks(), assets: new HostedAssetLinks(), exists: () => true };

function contextFor(docId: string) {
  return { docId, resolve: (href: string) => resolveHref(href, docId, KNOWN, BLOB_BASE) };
}

// ---- the navigation ----

/** A title for a doc that has not been read: its file name, and for a README the name of its folder. */
export function titleOfPath(path: string): string {
  const parts = path.replace(/\.md$/i, '').split('/');
  const name = parts[parts.length - 1] ?? path;
  if (name.toLowerCase() === 'readme' && parts.length > 1) {
    const folder = parts[parts.length - 2] ?? name;
    return folder.charAt(0).toUpperCase() + folder.slice(1);
  }
  return name;
}

/** nav.json as the hosted page can show it: the files it names, the pages of the site, and a note for each folder (the page has no file list to expand it). */
export function hostedListing(): DocsListing {
  const definition = parseNavFile(JSON.stringify(navFile), 'nav.json');
  const problems = [...definition.problems];
  const docs = new Map<string, DocSummary>();
  const nav: NavSection[] = [];

  for (const section of definition.sections) {
    const items: NavItem[] = [];
    for (const item of section.items) {
      if (item.kind === 'page') {
        items.push({ kind: 'page', path: item.path, title: item.title });
      } else if (item.kind === 'folder') {
        problems.push(`The hosted page cannot list the folder ${item.path}. Open a doc of it by address.`);
      } else {
        const slug = slugOf(item.path);
        // A doc that the allow-list of /api/docs refuses (for example tools/command-center/README.md) cannot be read here: it is left out, with a note.
        if (!parseDocPath(`/api/docs/${item.path}`).ok) {
          problems.push(`The hosted page cannot read ${item.path}. Open it on GitHub.`);
          continue;
        }
        const title = titleOfPath(item.path);
        if (!docs.has(slug)) docs.set(slug, { id: item.path, slug, title, type: '', status: '', updated: '', updatedFrom: 'frontmatter' });
        items.push({ kind: 'doc', slug, title, updated: '' });
      }
    }
    if (items.length > 0) nav.push({ id: section.id, title: section.title, items });
  }
  return { docs: [...docs.values()], nav, problems };
}

/** The repo paths a slug can mean, best first. A path that nav.json names wins. Others: `docs/<slug>.md`, and for a slug with no folder also `<slug>.md` in the root. */
export function slugCandidates(slug: string): string[] {
  const named = hostedListing().docs.find((doc) => doc.slug === slug);
  const candidates = [...(named === undefined ? [] : [named.id]), `docs/${slug}.md`, ...(slug.includes('/') ? [] : [`${slug}.md`])];
  return [...new Set(candidates)].filter((path) => parseDocPath(`/api/docs/${path}`).ok);
}

// ---- reading docs ----

const DOC_TTL_MS = 60_000;
const docCache = new Map<string, { at: number; text: string }>();

/** Empties the cache of doc texts. A test uses it. */
export function clearDocCache(): void {
  docCache.clear();
}

export type DocText = { ok: true; text: string } | { ok: false; notFound: boolean; error: HostedError };

/** The text of one repo file through `/api/docs/<path>`, kept for 60 seconds (the function's own cache lasts as long). */
export async function readDocText(path: string, nowMs: number = Date.now()): Promise<DocText> {
  const cached = docCache.get(path);
  if (cached !== undefined && nowMs - cached.at < DOC_TTL_MS) return { ok: true, text: cached.text };
  const result = await fetchHostedText(`/api/docs/${path}`);
  if (result.ok) docCache.set(path, { at: nowMs, text: result.text });
  return result;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The open decisions that link to a heading of this doc, one entry for each link. */
function decisionsFor(path: string, snapshot: Snapshot | null): DocDecision[] | null {
  if (snapshot === null) return null;
  return snapshot.decisions.open.flatMap((issue) => issue.docs.filter((link) => link.docId === path).map((link) => ({ number: issue.number, title: issue.title, anchor: link.anchor })));
}

/** The page of one doc. `snapshot` is null when the snapshot could not be read: the banners are then missing, and the page says so. */
export async function docPanel(slug: string, snapshot: Snapshot | null, nowMs: number = Date.now()): Promise<Panel<DocPageData>> {
  let lastError: HostedError | null = null;
  for (const path of slugCandidates(slug)) {
    const read = await readDocText(path, nowMs);
    if (!read.ok) {
      if (read.notFound) continue;
      lastError = read.error;
      break;
    }
    const rendered = renderDoc(read.text, contextFor(path));
    const data: DocPageData = {
      id: path,
      slug,
      title: rendered.title,
      type: textOf(rendered.frontmatter.type),
      status: textOf(rendered.frontmatter.status),
      updated: textOf(rendered.frontmatter.updated),
      updatedFrom: 'frontmatter',
      html: rendered.html,
      headings: rendered.headings,
      backlinks: [],
      brokenLinks: [],
      frontmatterError: rendered.frontmatterError,
      readingOrder: null,
      decisions: decisionsFor(path, snapshot),
    };
    return { ok: true, data, updatedAt: new Date(nowMs).toISOString() };
  }
  if (lastError !== null) return errorPanel<DocPageData>(lastError, null);
  // No path has the doc: the same answer as the local server's "no doc has this address". The page shows its "Doc not found" page.
  return { ok: false, error: { code: 'doc-not-found', message: `No doc has the address ${slug}.` }, updatedAt: null, lastGood: null, suggestions: [] } as Panel<DocPageData>;
}

/** The heading text that a decision's link names, or null when the doc or the heading cannot be read. */
export async function headingOf(docId: string, anchor: string): Promise<string | null> {
  const read = await readDocText(docId);
  if (!read.ok) return null;
  return renderDoc(read.text, contextFor(docId)).headings.find((heading) => heading.id === anchor)?.text ?? null;
}

/** A decision with the headings of the docs it links to. A section whose doc or heading cannot be read has no heading, and the page says "Section not found". */
export async function withSections(detail: DecisionDetail): Promise<DecisionDetail> {
  const sections = await Promise.all(
    detail.docs.map(async (link) => ({ docId: link.docId, anchor: link.anchor, heading: await headingOf(link.docId, link.anchor), html: null })),
  );
  return { ...detail, docs: detail.docs.map((link, index) => ({ ...link, heading: sections[index]?.heading ?? null })), sections };
}

// ---- the Status panel ----

export function statusPanelOf(snapshot: Snapshot): Panel<StatusInfo> {
  const updatedAt = snapshot.at;
  const statusMd = snapshot.main.status;
  if (statusMd === null) return failedPanel({ code: 'status-missing', message: say('statusDocMissing', { path: STATUS_DOC_PATH }) }, null, null);

  let status: ReturnType<typeof parseStatus>;
  try {
    status = parseStatus(statusMd, (markdown) => renderDoc(markdown, contextFor(STATUS_DOC_PATH)).html);
  } catch (error) {
    if (error instanceof PanelError) return failedPanel(error, null, null);
    throw error;
  }

  let milestones: StatusInfo['milestones'] = [];
  let problem: { code: string; message: string } | null = null;
  const migrationMd = snapshot.main.migration;
  const roadmapJson = snapshot.main.roadmap;
  if (migrationMd === null) {
    problem = { code: 'milestones-doc-missing', message: say('milestonesDocMissing', { path: MIGRATION_DOC_PATH }) };
  } else if (roadmapJson === null) {
    problem = { code: 'milestones-roadmap-missing', message: say('roadmapDocMissing', { path: ROADMAP_PATH }) };
  } else {
    try {
      milestones = parseMilestones(migrationMd, renderDoc(migrationMd, contextFor(MIGRATION_DOC_PATH)).headings, parseRoadmapDone(roadmapJson));
    } catch (error) {
      if (!(error instanceof PanelError)) throw error;
      problem = { code: error.code, message: error.message };
    }
  }
  const info: StatusInfo = {
    ...status,
    milestone: parseMilestoneKey(
      statusMd,
      milestones.map((milestone) => milestone.id),
    ),
    milestones,
  };
  return problem === null ? { ok: true, data: info, updatedAt } : failedPanel(problem, updatedAt, { data: info, updatedAt });
}

// ---- the engine decision table ----

/** The three docs that hold the engine decisions, read through `/api/docs`. The "changed since approval" flag needs git, so the panel says it is missing. */
export async function engineDecisionsPanel(nowMs: number = Date.now()): Promise<Panel<Decision[]>> {
  const paths = [ENGINE_DOCS.decisions.path, ENGINE_DOCS.readme.path, ENGINE_DOCS.phase.path] as const;
  const reads = await Promise.all(paths.map((path) => readDocText(path, nowMs)));
  const texts: string[] = [];
  for (const read of reads) {
    if (!read.ok) return errorPanel<Decision[]>(read.error, null);
    texts.push(read.text);
  }
  const [decisionsText = '', readmeText = '', phaseText = ''] = texts;

  try {
    const headings = (path: string, text: string) => renderDoc(text, contextFor(path)).headings;
    const engine = parseEngineDecisions(decisionsText, headings(ENGINE_DOCS.decisions.path, decisionsText));
    const phaseRaws = parsePhaseDecisions(phaseText, headings(ENGINE_DOCS.phase.path, phaseText));
    const choices = parseUpdateChoices(readmeText, headings(ENGINE_DOCS.readme.path, readmeText));
    const waiting = choices.length > 0 && readmeWaitsForMark(readmeText);
    const list = [...classifyDecisions(engine, null), ...classifyDecisions(phaseRaws, null), ...classifyUpdateChoices(choices, waiting)];
    const updatedAt = new Date(nowMs).toISOString();
    return failedPanel({ code: 'approval-check-unavailable', message: 'The check for changes since approval needs the local server. The table has no change flags.' }, updatedAt, { data: list, updatedAt });
  } catch (error) {
    if (error instanceof PanelError) return failedPanel(error, null, null);
    throw error;
  }
}
