/** End-of-chapter results card. Native sje scene (M8b). */
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { getPortrait } from '../art/portraits';
import { chapterCombos, COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { MEMBERS } from '../data/party';
import { autoClose } from '../game/debug';
import { formatPlayTime } from '../game/save';
import { state } from '../game/state';
import { Container, Graphics, measure, NineSlice, TextObject, UI } from '../sje';
import { H, W } from '../sje/core/size';
import { PAGE_DY, PAGE_PROMPT_FROM_BOTTOM, RESULTS_CARD_FACE, RESULTS_CARD_STEP, RESULTS_W, RESULTS_X } from '../ui/layout';
import { UiScene } from './uiscene';

/** Frame at which "Rook: missing" starts to fade in on the results page. */
const MISSING_AT = 110;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class EndingScene extends UiScene<void> {
  /** 0: the run so far (and who is missing). 1: next-chapter card and thanks. */
  private page = 0;

  // Page 0: everything that fades in together, the "missing" line that arrives later, and the prompt.
  private pageA!: Container;
  private missing!: Container;
  private promptA!: TextObject;
  private crewCards: { id: string; items: Container }[] = [];
  // Page 1.
  private pageB!: Container;
  private fades: { obj: TextObject; from: number }[] = [];
  private promptB!: TextObject;

  constructor(private playFrames: number) {
    super();
  }

  override create(): void {
    music('sable', 60);
    this.dim(1);
    this.buildResults();
    this.buildNext();
    this.pageB.setVisible(false);
    this.refreshView();
  }

  /** Page 0: the run so far. */
  private buildResults(): void {
    const ui = this.sys.ui;
    this.pageA = new Container(this, 0, 0, 'results');
    ui.add(this.pageA);
    const put = (o: TextObject | NineSlice | Graphics | Container): void => void this.pageA.add(o);
    put(new TextObject(this, W / 2, 16 + PAGE_DY, 'CHAPTER ONE · MILK RUN', { align: 'center', color: UI.pink }));
    put(new TextObject(this, W / 2, 28 + PAGE_DY, 'complete', { align: 'center', color: UI.dim }));
    put(new NineSlice(this, RESULTS_X, 46 + PAGE_DY, RESULTS_W, 150, { title: 'THE RUN SO FAR' }));
    const found = COMBOS.filter((c) => state.combos.includes(c.id)).length;
    const species = Object.keys(state.bestiary).filter((k) => ENEMIES[k]).length;
    const rows: [string, string][] = [
      ['Play time', formatPlayTime(this.playFrames, true)],
      ['Battles won', String(state.battles)],
      ['Combos discovered', `${found} / ${chapterCombos().length}`],
      ['Bestiary', `${species} / ${Object.keys(ENEMIES).length - 1} species`],
      ['Cred (carries over)', `${state.cred.toLocaleString('en-US')}¢`],
      ['Side jobs', `${['job_cat_done', 'job_case_done', 'job_bounty_done'].filter((f) => state.flags[f]).length} / 3`],
    ];
    rows.forEach(([k, v], i) => {
      put(new TextObject(this, RESULTS_X + 16, 58 + PAGE_DY + i * 12, k, { color: UI.dim }));
      put(new TextObject(this, W / 2 + 10, 58 + PAGE_DY + i * 12, v));
    });
    // The divider: two plain lines, one of the three kinds of Graphics the kit allows.
    put(new Graphics(this, RESULTS_X + 10, 134 + PAGE_DY).fillStyle(0x2c2a58).fillRect(0, 0, RESULTS_W - 20, 1).fillStyle(0x0a0918).fillRect(0, 1, RESULTS_W - 20, 1));
    // The crew row is centered on the screen, whatever its width or the number of members: its width is the steps between the cards plus the last card
    // (the portrait, then the widest name or level).
    const crew = state.party;
    const textW = Math.max(0, ...crew.flatMap((id) => [measure(MEMBERS[id].name), measure(`Lv ${state.members[id]?.level ?? 1}`)]));
    const rowX = Math.round((W - ((crew.length - 1) * RESULTS_CARD_STEP + RESULTS_CARD_FACE + textW)) / 2);
    crew.forEach((id, i) => {
      const x = rowX + i * RESULTS_CARD_STEP;
      const card = new Container(this, 0, 0, `crew-${id}`);
      const p = getPortrait(id, 'neutral');
      if (p) {
        // A portrait is art: a canvas picture, moved into the card.
        const pic = this.picture(x, 142 + PAGE_DY, 32, 32, (c) => c.drawImage(p, 0, 0, 32, 32));
        card.add(pic);
      }
      card.add(new TextObject(this, x + 36, 146 + PAGE_DY, MEMBERS[id].name, { color: MEMBERS[id].color }));
      card.add(new TextObject(this, x + 36, 158 + PAGE_DY, `Lv ${state.members[id]?.level ?? 1}`, { color: UI.dim }));
      put(card);
      this.crewCards.push({ id, items: card });
    });
    // The one line that matters arrives on its own, after the numbers have had their moment.
    this.missing = new Container(this, 0, 0, 'missing');
    const mw = measure('Rook: missing') + 28;
    this.missing.add(new NineSlice(this, (W - mw) / 2, 208 + PAGE_DY, mw, 19, { plain: true, accent: UI.red }));
    this.missing.add(new TextObject(this, W / 2, 213 + PAGE_DY, 'Rook: {r}missing{/}', { align: 'center' }));
    ui.add(this.missing);
    // Same words as the page after it: a bare arrow read as decoration, not as "press something".
    this.promptA = new TextObject(this, W / 2, H - PAGE_PROMPT_FROM_BOTTOM, '', { align: 'center', color: UI.cyan });
    ui.add(this.promptA);
  }

  /** Page 1: the next-chapter card and thanks. Each line fades in at its own frame. */
  private buildNext(): void {
    const ui = this.sys.ui;
    this.pageB = new Container(this, 0, 0, 'next');
    ui.add(this.pageB);
    const line = (text: string, y: number, color: string, from: number, big = false): void => {
      let obj: TextObject;
      if (big) {
        // The bitmap font at 2x (the old drawBig drew the text into a buffer and scaled it). The text is centered by hand, because a scaled text
        // object grows from its corner: the glyphs start 1 px in, and 2x makes that 2.
        const w = measure(text);
        obj = new TextObject(this, Math.round(W / 2 - w - 1) + 2, y + 2, text, { color, shadow: '#1a1020' }).setScale(2);
      } else obj = new TextObject(this, W / 2, y, text, { align: 'center', color });
      this.pageB.add(obj);
      this.fades.push({ obj, from });
    };
    line('CHAPTER TWO', 96 + PAGE_DY, UI.dim, 20);
    line('DENIABLE ASSETS', 110 + PAGE_DY, UI.cyan, 50, true);
    line('coming soon', 138 + PAGE_DY, UI.dim, 80);
    line('Thank you for playing Chapter One.', 206 + PAGE_DY, '#8a87a8', 130);
    this.promptB = new TextObject(this, W / 2, H - PAGE_PROMPT_FROM_BOTTOM, '', { align: 'center', color: UI.cyan });
    ui.add(this.promptB);
  }

  protected tick(): void {
    if (autoClose(this.t, 200)) {
      if (this.page === 0) this.turn();
      else this.close();
    } else {
      const ready = this.page === 0 ? MISSING_AT + 60 : 150;
      const keys = this.input.actions;
      if (this.t > ready && (keys.justPressed('confirm') || keys.justPressed('cancel'))) {
        sfx('confirm');
        if (this.page === 0) this.turn();
        else this.close();
      }
    }
    // A closed scene has had its objects destroyed.
    if (!this.closed) this.refreshView();
  }

  private turn(): void {
    this.page = 1;
    this.t = 0;
    music('title', 90);
    this.pageA.setVisible(false);
    this.missing.setVisible(false);
    this.promptA.setVisible(false);
    this.pageB.setVisible(true);
  }

  /** Set the fades and the blinking prompt for this tick. */
  private refreshView(): void {
    const blink = Math.floor(this.t / 25) % 2 === 0;
    const key = this.input.actions.keyName('confirm');
    if (this.page === 0) {
      this.pageA.setAlpha(Math.min(1, this.t / 40));
      // Rook's card fades out as the reveal lands.
      const gone = clamp01((this.t - MISSING_AT) / 50);
      for (const c of this.crewCards) c.items.setAlpha(c.id === 'rook' ? 1 - gone * 0.75 : 1);
      this.missing.setAlpha(clamp01((this.t - MISSING_AT) / 50));
      this.promptA.setText(`Press ${key} to continue`).setVisible(this.t > MISSING_AT + 60 && blink);
      return;
    }
    for (const f of this.fades) f.obj.setAlpha(clamp01((this.t - f.from) / 40));
    this.promptB.setText(`Press ${key} to return to the title`).setVisible(this.t > 150 && blink);
  }
}
