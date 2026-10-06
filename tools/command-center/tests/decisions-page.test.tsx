import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Decision } from '../src/shared/types';
import { DecisionList } from '../src/web/docs/Decisions';
import { PrevNext } from '../src/web/docs/PrevNext';

// The pieces of the engine review pages that can be checked without a browser: what the decision
// list and the Previous and Next buttons write for a given answer of the server. A server-side render
// runs no effect and no click, so the filter and the link to a heading are the job of
// e2e/engine.spec.ts. What these tests pin down is the content: the groups, the counts, the words of
// each status, the address of each link, and that text from a doc is shown as text.

const render = (element: ReactElement) => renderToStaticMarkup(<MemoryRouter initialEntries={['/docs/decisions']}>{element}</MemoryRouter>);

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'E1',
    number: 'E1',
    source: 'engine',
    question: 'How behavior is written',
    answer: 'Phaser style',
    milestone: 'Phase 0',
    who: 'Mark',
    option: 'A',
    status: 'approved',
    change: null,
    docSlug: 'engine/decisions',
    anchor: 'e1-how-behavior-is-written',
    ...over,
  };
}

const SAMPLE: Decision[] = [
  decision(),
  decision({ id: 'E2', number: 'E2', question: 'Name of the hook', answer: 'fixedUpdate(tick)', status: 'changed', change: 'edited', anchor: 'e2-name' }),
  decision({ id: 'E3', number: 'E3', question: 'A new decision', answer: 'Do it', option: null, milestone: null, who: 'Agent (FYI)', status: 'changed', change: 'added', anchor: null }),
  decision({
    id: 'D5',
    number: 'D5',
    source: 'phase-0.2',
    question: 'What happens to PixelLab?',
    answer: 'OPEN (2026-10-04).',
    option: null,
    milestone: null,
    status: 'open',
    docSlug: 'PHASE-0.2',
    anchor: 'decisions-for-mark',
  }),
  decision({
    id: 'C1',
    number: 'C1',
    source: 'engine-update',
    question: 'roundPixels off',
    answer: 'Accept.',
    option: 'Accepted 2026-10-05',
    milestone: null,
    status: 'approved',
    docSlug: 'engine/README',
    anchor: null,
  }),
];

describe('the decision list', () => {
  it('has a group for each doc, with its decisions, its link and its counts', () => {
    const markup = render(<DecisionList decisions={SAMPLE} />);

    // The three groups, in the order of the list, each with how many decisions it shows and a link to its doc.
    const groups = markup.split('<tbody').slice(1);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toContain('Engine design');
    expect(groups[0]).toContain('3 decisions from');
    expect(groups[0]).toContain('href="/docs/engine/decisions"');
    expect(groups[1]).toContain('Phase 0.2 plan');
    expect(groups[1]).toContain('1 decision from');
    expect(groups[1]).toContain('href="/docs/PHASE-0.2"');
    expect(groups[2]).toContain('Phase 0 update');
    expect(groups[2]).toContain('href="/docs/engine/README"');

    // The columns of the design: number, question, answer, milestone, who decides and status.
    for (const heading of ['Number', 'Question', 'Answer', 'Milestone', 'Who decides', 'Status']) expect(markup).toContain(`>${heading}</th>`);
    // Each decision is in the group of its doc.
    expect(groups[0]).toContain('>E1</th>');
    expect(groups[0]).toContain('>E3</th>');
    expect(groups[1]).toContain('>D5</th>');
    expect(groups[2]).toContain('>C1</th>');
  });

  it('says at a glance how many decisions each doc has and how many are in each status', () => {
    const markup = render(<DecisionList decisions={SAMPLE} />);
    const summary = markup.slice(markup.indexOf('aria-label="Decisions by source"'), markup.indexOf('aria-label="Filter by status"'));
    expect(summary).toContain('Engine design');
    expect(summary).toContain('E1 to E3');
    expect(summary).toContain('3 decisions: 2 changed, 1 approved');
    expect(summary).toContain('Phase 0.2 plan');
    expect(summary).toContain('1 decision: 1 open');
    // A doc with one decision shows its number once, not "C1 to C1".
    expect(summary).toContain('Phase 0 update');
    expect(summary).toContain('>C1<');
    expect(summary).not.toContain('C1 to C1');
    expect(summary).toContain('1 decision: 1 approved');
  });

  it('has a filter button for each status, with the number of decisions in it, and starts on All', () => {
    const markup = render(<DecisionList decisions={SAMPLE} />);
    expect(markup).toContain('aria-label="Filter by status"');
    for (const [label, count] of [['All', 5], ['Open', 1], ['Changed', 2], ['Approved', 2]] as const) {
      expect(markup, label).toMatch(new RegExp(`${label} <span class="font-mono text-xs">${count}</span>`));
    }
    // All is chosen: every decision is in the table.
    expect(markup.match(/<th scope="row"/g)).toHaveLength(5);
  });

  it('says each status in words and an icon, and tells an edit from an addition', () => {
    const markup = render(<DecisionList decisions={SAMPLE} />);
    expect(markup.match(/>Open</g)).toHaveLength(1); // the chip of D5 (the filter button has the count after its label)
    expect(markup).toContain('chip--accent'); // the open one is the amber one
    expect(markup).toContain('>Changed<');
    expect(markup).toContain('>Approved<');
    expect(markup).toContain('>edited</span>');
    expect(markup).toContain('>added</span>');
    // The icons are drawn by the icon library, and are not read out.
    expect(markup).toContain('aria-hidden="true"');
  });

  it('links each question to its doc at the heading, and to the top of the doc when there is no heading', () => {
    const markup = render(<DecisionList decisions={SAMPLE} />);
    expect(markup).toContain('href="/docs/engine/decisions#e1-how-behavior-is-written"');
    expect(markup).toContain('href="/docs/engine/decisions#e2-name"');
    expect(markup).toContain('href="/docs/PHASE-0.2#decisions-for-mark"');
    // No anchor: the address of the doc alone (the same link as the group's own, with no hash).
    expect(markup).toMatch(/href="\/docs\/engine\/decisions"[^>]*>A new decision</);
    expect(markup).toMatch(/href="\/docs\/engine\/README"[^>]*>roundPixels off</);
  });

  it('shows the recommendation and the answer of a table row with a label each, and the verdict of a PHASE-0.2 line as it is', () => {
    const markup = render(<DecisionList decisions={SAMPLE} />);
    expect(markup).toContain('Recommended </span>Phaser style');
    expect(markup).toContain('Answered </span>A');
    expect(markup).toContain('Answered </span>Accepted 2026-10-05');
    // A decision with no answer of Mark's has no "Answered" line: E3's row has an empty cell.
    const e3 = markup.slice(markup.indexOf('>E3</th>'), markup.indexOf('>D5</th>'));
    expect(e3).toContain('Recommended </span>Do it');
    expect(e3).not.toContain('Answered');
    // The line of the phase doc has no recommendation: the words after its dash are the answer.
    const d5 = markup.slice(markup.indexOf('>D5</th>'), markup.indexOf('>C1</th>'));
    expect(d5).toContain('OPEN (2026-10-04).');
    expect(d5).not.toContain('Recommended');
    // A decision with no milestone shows a dash, and one that is not Mark's is quieter than one that is.
    expect(e3).toContain('aria-label="none"');
    expect(e3).toContain('text-cc-muted">Agent (FYI)');
  });

  it('shows words from a doc as text, never as html', () => {
    const markup = render(<DecisionList decisions={[decision({ question: '<img src=x onerror=alert(1)> and <b>bold</b>', answer: '<script>window.x=1</script>', option: '"><svg onload=1>' })]} />);
    expect(markup).not.toContain('<img src=x');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<svg onload');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).toContain('&lt;script&gt;window.x=1&lt;/script&gt;');
  });

  it('has no table, only the filter and a sentence, when the list is empty', () => {
    const markup = render(<DecisionList decisions={[]} />);
    expect(markup).not.toContain('<table');
    expect(markup).toContain('No decisions were found in the three docs.');
  });
});

describe('the Previous and Next buttons', () => {
  const prev = { slug: 'engine/scene-graph', title: 'Scene graph' };
  const next = { slug: 'engine/interfaces', title: 'Interfaces & <types>' };

  it('link to the docs on each side, with the direction and the title of each', () => {
    const markup = render(<PrevNext order={{ prev, next }} />);
    expect(markup).toContain('aria-label="Reading order"');
    expect(markup).toMatch(/<a rel="prev"[^>]*href="\/docs\/engine\/scene-graph"/);
    expect(markup).toMatch(/<a rel="next"[^>]*href="\/docs\/engine\/interfaces"/);
    expect(markup).toContain('>Previous<');
    expect(markup).toContain('>Next<');
    expect(markup).toContain('>Scene graph<');
    // The title of a doc is text from a doc: shown as text.
    expect(markup).toContain('Interfaces &amp; &lt;types&gt;');
    // Previous first, then Next.
    expect(markup.indexOf('>Previous<')).toBeLessThan(markup.indexOf('>Next<'));
  });

  it('the first doc has no Previous and the last no Next', () => {
    const first = render(<PrevNext order={{ prev: null, next }} />);
    expect(first).not.toContain('Previous');
    expect(first).toContain('>Next<');
    // The Next button stays at the right when it is alone.
    expect(first).toContain('ml-auto');

    const last = render(<PrevNext order={{ prev, next: null }} />);
    expect(last).toContain('>Previous<');
    expect(last).not.toContain('>Next<');
    expect(last).not.toContain('ml-auto');
  });
});
