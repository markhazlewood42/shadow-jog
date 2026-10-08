import { Chip, type Key, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { Check, CircleDot, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Decision, DecisionSource, DecisionStatus, ModuleName } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import { usePanel } from '../usePanel';
import { docPath } from './paths';
import { useDocumentTitle } from './useDocumentTitle';

/** The list reloads when the engine module says that a decision, or its status, changed. */
const ENGINE_MODULES: readonly ModuleName[] = ['engine'];

/** The three places that hold decisions, in the order of the list, and what the page calls each. */
const SOURCES: readonly { source: DecisionSource; title: string; where: string }[] = [
  { source: 'engine', title: 'Engine design', where: 'docs/engine/decisions.md' },
  { source: 'phase-0.2', title: 'Phase 0.2 plan', where: 'docs/PHASE-0.2.md' },
  { source: 'engine-update', title: 'Phase 0 update', where: 'docs/engine/README.md' },
];

/** The statuses in the order that matters to Mark: what waits for him first. */
const STATUS_ORDER: readonly DecisionStatus[] = ['open', 'changed', 'approved'];

type Filter = 'all' | DecisionStatus;

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'changed', label: 'Changed' },
  { id: 'approved', label: 'Approved' },
];

const isFilter = (key: Key): key is Filter => FILTERS.some((filter) => filter.id === key);

/** What the list says when a filter leaves nothing: a label, as the empty states of the other pages are (design 5.8). */
const NOTHING: Record<Filter, string> = {
  all: 'No decisions',
  open: 'No open decisions',
  changed: 'No changed decisions',
  approved: 'No approved decisions',
};

/** The status of a decision as a chip. Each status has an icon and a word, so none of them is told only by its color. Amber is for the open ones: they are the ones that wait for Mark. */
function StatusChip({ decision }: { decision: Decision }) {
  if (decision.status === 'open') {
    return (
      <Chip color="accent" variant="primary" size="sm" className="gap-1">
        <CircleDot aria-hidden className="size-3" />
        <Chip.Label>Open</Chip.Label>
      </Chip>
    );
  }
  if (decision.status === 'changed') {
    return (
      <div className="flex flex-col items-start gap-1">
        <Chip size="sm" className="gap-1 border border-cc-rule-solid">
          <Pencil aria-hidden className="size-3" />
          <Chip.Label>Changed</Chip.Label>
        </Chip>
        <span className="text-xs text-cc-soft">{decision.change === 'added' ? 'added' : 'edited'}</span>
      </div>
    );
  }
  return (
    <Chip variant="tertiary" size="sm" className="gap-1 text-cc-muted">
      <Check aria-hidden className="size-3" />
      <Chip.Label>Approved</Chip.Label>
    </Chip>
  );
}

/** A value that the doc does not have: a dash, and not a blank, so a missing value reads as missing. */
function Missing() {
  return (
    <span aria-label="none" className="text-cc-soft">
      —
    </span>
  );
}

/**
 * The answer of a decision. A table row of the docs has the recommendation, and Mark's own answer when he gave one ("A"), and
 * they are told apart by a label, because the recommendation is not always what he answered. A PHASE-0.2 line has only the
 * words that the doc says after the dash ("decided 2026-10-02: (a)"): that is the answer.
 */
function AnswerCell({ decision }: { decision: Decision }) {
  if (decision.source === 'phase-0.2') return <>{decision.answer}</>;
  return (
    <div className="flex flex-col gap-1">
      <p>
        <span className="text-xs font-medium tracking-wide text-cc-soft uppercase">Recommended </span>
        {decision.answer}
      </p>
      {decision.option !== null && (
        <p>
          <span className="text-xs font-medium tracking-wide text-cc-soft uppercase">Answered </span>
          {decision.option}
        </p>
      )}
    </div>
  );
}

function DecisionRow({ decision }: { decision: Decision }) {
  return (
    <tr className="border-t border-cc-rule align-top">
      <th scope="row" className="py-3 pr-3 text-left font-mono font-medium whitespace-nowrap">
        {decision.number}
      </th>
      <td className="py-3 pr-4">
        {/* The question is the link: it opens the doc at the heading of the decision. */}
        <Link to={docPath(decision.docSlug, decision.anchor ?? undefined)} className="text-cc-link underline-offset-2 hover:underline cc-focus-ring">
          {decision.question}
        </Link>
      </td>
      <td className="py-3 pr-4">
        <AnswerCell decision={decision} />
      </td>
      <td className="py-3 pr-4 whitespace-nowrap">{decision.milestone ?? <Missing />}</td>
      <td className={`py-3 pr-4 whitespace-nowrap ${decision.who.toLowerCase().startsWith('mark') ? '' : 'text-cc-muted'}`}>{decision.who}</td>
      <td className="py-3">
        <StatusChip decision={decision} />
      </td>
    </tr>
  );
}

/** The decisions that pass the filter, in groups: one group for each place that holds decisions, in its own order. A group with no row left is not drawn. */
function DecisionTable({ decisions, filter }: { decisions: readonly Decision[]; filter: Filter }) {
  const shown = decisions.filter((decision) => filter === 'all' || decision.status === filter);
  if (shown.length === 0) return <p className="py-4 text-cc-muted">{NOTHING[filter]}</p>;

  return (
    <div className="overflow-x-auto">
      <table aria-label="Decisions" className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-cc-soft uppercase">
            <th scope="col" className="w-[4.5rem] pr-3 pb-2 font-medium">
              Number
            </th>
            <th scope="col" className="pr-4 pb-2 font-medium">
              Question
            </th>
            <th scope="col" className="pr-4 pb-2 font-medium">
              Answer
            </th>
            <th scope="col" className="w-28 pr-4 pb-2 font-medium">
              Milestone
            </th>
            <th scope="col" className="w-28 pr-4 pb-2 font-medium">
              Who decides
            </th>
            <th scope="col" className="w-24 pb-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        {SOURCES.map(({ source, title, where }) => {
          const rows = shown.filter((decision) => decision.source === source);
          const slug = rows[0]?.docSlug;
          if (slug === undefined) return null;
          return (
            <tbody key={source}>
              <tr>
                <th scope="rowgroup" colSpan={6} className="border-t border-cc-rule-solid bg-cc-paper py-2 pl-2 text-left font-medium">
                  {title}
                  <span className="ml-2 font-normal text-cc-muted">
                    {rows.length} {rows.length === 1 ? 'decision' : 'decisions'} ·{' '}
                    <Link to={docPath(slug)} className="font-mono text-xs text-cc-link underline-offset-2 hover:underline cc-focus-ring">
                      {where}
                    </Link>
                  </span>
                </th>
              </tr>
              {rows.map((decision) => (
                <DecisionRow key={decision.id} decision={decision} />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/** What the three docs hold, at a glance: how many decisions each has, and how many of them are in each status. */
function SourceSummary({ decisions }: { decisions: readonly Decision[] }) {
  return (
    <ul aria-label="Decisions by source" className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
      {SOURCES.map(({ source, title }) => {
        const rows = decisions.filter((decision) => decision.source === source);
        const first = rows[0];
        const last = rows[rows.length - 1];
        if (first === undefined || last === undefined) return null;
        const counts = STATUS_ORDER.map((status) => ({ status, count: rows.filter((decision) => decision.status === status).length }))
          .filter(({ count }) => count > 0)
          .map(({ status, count }) => `${count} ${status}`);
        return (
          <li key={source}>
            <p className="font-medium">
              {title}{' '}
              <span className="font-mono text-xs font-normal text-cc-soft">{first.number === last.number ? first.number : `${first.number} to ${last.number}`}</span>
            </p>
            <p className="text-sm text-cc-muted">
              {rows.length} {rows.length === 1 ? 'decision' : 'decisions'}: {counts.join(', ')}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** The decisions with the filter above them. The filter is a choice of one status, or all of them, and each button says how many decisions it holds. */
export function DecisionList({ decisions }: { decisions: readonly Decision[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const countOf = (id: Filter) => (id === 'all' ? decisions.length : decisions.filter((decision) => decision.status === id).length);

  return (
    <div className="flex flex-col gap-4">
      <SourceSummary decisions={decisions} />
      <ToggleButtonGroup
        aria-label="Filter by status"
        size="sm"
        selectionMode="single"
        // One button is always chosen: a click on the chosen one does not leave the list with no filter at all.
        disallowEmptySelection
        selectedKeys={[filter]}
        onSelectionChange={(keys) => {
          const [next] = keys;
          if (next !== undefined && isFilter(next)) setFilter(next);
        }}
      >
        {FILTERS.map(({ id, label }, i) => (
          <ToggleButton key={id} id={id}>
            {i > 0 && <ToggleButtonGroup.Separator />}
            {label}{' '}
            <span className="font-mono text-xs">{countOf(id)}</span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <DecisionTable decisions={decisions} filter={filter} />
    </div>
  );
}

/**
 * The page at /docs/decisions: every decision of the engine design in one table, from the three docs
 * that hold them, with the status of each (open for Mark, changed since the approval, or approved).
 * The list is a panel of its own: when the engine module fails (a table lost a column, the approval
 * commit is not found) the panel says so, and shows the decisions it could read beside the error.
 */
export function Decisions() {
  useDocumentTitle('Decisions');
  const result = usePanel<Decision[]>('/api/engine/decisions', ENGINE_MODULES);
  return (
    <div className="flex flex-col gap-6">
      {/* The heading stands alone (design 5.8): the page does not explain the three statuses. The design doc does, and the status chips say them in a word. */}
      <h1 className="text-3xl font-semibold tracking-tight">Decisions</h1>
      <PanelFrame title="Decisions" result={result}>
        {(decisions) => <DecisionList decisions={decisions} />}
      </PanelFrame>
    </div>
  );
}
