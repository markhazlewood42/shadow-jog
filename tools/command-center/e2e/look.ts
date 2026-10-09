import { type Locator, type Page, expect } from '@playwright/test';

// The Look (docs/diagrams/profile/NOTES.md), measured in a browser. The Look gives amber to the one or two things on a page that matter most, and keeps every text
// at 4.5 to 1 or more. These helpers read the computed styles of the page, so a test can say it in numbers. The specs of the decision pages and of the Now page use them.

/** The colors of the tokens as the browser writes them (`rgb(...)`), so that a test can compare them with a computed style. A probe element resolves each token. */
export async function tokenColors(page: Page): Promise<{ accent: string; ink: string; muted: string; paper2: string; ruleSolid: string; soft: string }> {
  return page.evaluate(() => {
    const probe = document.createElement('i');
    document.body.append(probe);
    const read = (token: string): string => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const colors = { accent: read('--cc-accent'), ink: read('--cc-ink'), muted: read('--cc-muted'), paper2: read('--cc-paper-2'), ruleSolid: read('--cc-rule-solid'), soft: read('--cc-soft') };
    probe.remove();
    return colors;
  });
}

/**
 * The amber items of the page, each as a short name. An element is amber when it draws the accent color: as its fill, border, outline, stroke (an icon), or as the color
 * of text of its own (the ::before and ::after of an element count for the element). An amber element inside another is part of that item, so a banner with an amber
 * frame and an amber icon is one item. The whole page counts, not only the part in view.
 */
export async function amberItems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--cc-accent)';
    document.body.append(probe);
    const amber = getComputedStyle(probe).color;
    probe.remove();

    const drawsAmber = (element: Element, pseudo: string | null): boolean => {
      const style = getComputedStyle(element, pseudo);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      if (pseudo === null && element.getClientRects().length === 0) return false;
      if (pseudo !== null && (style.content === 'none' || style.content === 'normal')) return false;
      if (style.backgroundColor === amber) return true;
      for (const side of ['top', 'right', 'bottom', 'left']) {
        if (Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 && style.getPropertyValue(`border-${side}-style`) !== 'none' && style.getPropertyValue(`border-${side}-color`) === amber) return true;
      }
      if (Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none' && style.outlineColor === amber) return true;
      if (pseudo !== null) return style.color === amber;
      if (element instanceof SVGSVGElement) return style.stroke === amber || style.fill === amber;
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
      return hasText && style.color === amber;
    };

    const amberElements = [...document.body.querySelectorAll('*')].filter((element) => [null, '::before', '::after'].some((pseudo) => drawsAmber(element, pseudo)));
    const items = amberElements.filter((element) => !amberElements.some((other) => other !== element && other.contains(element)));
    return items.map((element) => `${element.tagName.toLowerCase()}[${element.getAttribute('aria-label') ?? ''}] "${(element.textContent ?? '').trim().slice(0, 24)}"`);
  });
}

/** The page keeps to two amber items, and says which they are when it does not. */
export async function expectAtMostTwoAmberItems(page: Page): Promise<void> {
  const items = await amberItems(page);
  expect(items.length, `amber items: ${items.join(' | ')}`).toBeLessThanOrEqual(2);
}

/**
 * The contrast of the text of an element: the color of its text against the color that it stands on, as the pixels show them. An element that is faded (`opacity`)
 * is drawn as a group and then blended into the page, so its text and its own fill both move toward the page color: that fade is part of the number.
 */
export function contrastOf(target: Locator): Promise<{ ratio: number; text: string; fill: string }> {
  return target.evaluate((element) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgba => {
      const parts = (/\(([^)]+)\)/.exec(value)?.[1] ?? '0,0,0,0').split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const a = top.a + bottom.a * (1 - top.a);
      const mix = (t: number, b: number) => (a === 0 ? 0 : (t * top.a + b * bottom.a * (1 - top.a)) / a);
      return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
    };
    const luminance = ({ r, g, b }: Rgba): number => {
      const channel = (value: number) => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    // What is behind the element: the backgrounds of its ancestors, from the page down.
    let behind: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    let fade = 1;
    for (let node: Element | null = element; node !== null; node = node.parentElement) fade *= Number(getComputedStyle(node).opacity);
    const ancestors: Element[] = [];
    for (let node = element.parentElement; node !== null; node = node.parentElement) ancestors.unshift(node);
    for (const node of ancestors) behind = over(parse(getComputedStyle(node).backgroundColor), behind);

    const style = getComputedStyle(element);
    const text = over({ ...parse(style.color), a: fade }, behind);
    const own = parse(style.backgroundColor);
    const fill = over({ ...own, a: own.a * fade }, behind);
    const [high, low] = [luminance(text), luminance(fill)].sort((x, y) => y - x);
    return { ratio: ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05), text: style.color, fill: style.backgroundColor };
  });
}

/** What `worstTextContrast` found: the text that stands on the least contrast, and how much it is. */
export type WorstText = { ratio: number; text: string; color: string; x: number; y: number };

/**
 * The text of the part of the page that is in view that has the least contrast with what is behind it, measured on the pixels that a person sees. The contrast of
 * a text on the glass cannot be read from a style (the glass is drawn by WebGL, behind the page, and shows through the panel), so this looks at the picture:
 * it lists the text of the page (each line of each text node, with its color), hides all of it, takes a picture of what is left, and for each line finds the brightest
 * pixel in its box. The ratio is that of the text's color to the brightest pixel behind it, the strictest reading for light text on a dark ground. Text that a screen
 * reader reads and no one sees (`sr-only`) is left out. Nothing is changed on the page when this returns.
 */
export async function worstTextContrast(page: Page): Promise<WorstText> {
  type Box = { x: number; y: number; w: number; h: number; color: string; text: string };
  const boxes = await page.evaluate((): Box[] => {
    const found: Box[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const element = node.parentElement;
      if (element === null || (node.textContent ?? '').trim() === '' || element.closest('.sr-only, script, style, noscript') !== null) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 2 || rect.height < 2 || rect.bottom <= 0 || rect.top >= innerHeight) continue;
        found.push({ x: rect.left, y: rect.top, w: rect.width, h: rect.height, color: style.color, text: (node.textContent ?? '').trim().slice(0, 40) });
      }
    }
    return found;
  });

  const hide = await page.addStyleTag({ content: '* { color: transparent !important; text-decoration-color: transparent !important; } svg { visibility: hidden !important; }' });
  let picture: Buffer;
  try {
    picture = await page.screenshot({ type: 'png' });
  } finally {
    await hide.evaluate((element) => (element as HTMLElement).remove());
  }

  return page.evaluate(
    async ({ base64, boxes: lines }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('No 2D context to read the picture with.');
      context.drawImage(image, 0, 0);

      const channel = (value: number) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      // The picture is in device pixels, and the boxes are in CSS pixels.
      const scale = image.width / innerWidth;

      let worst = { ratio: Number.POSITIVE_INFINITY, text: '', color: '', x: 0, y: 0 };
      for (const line of lines) {
        const left = Math.max(0, Math.floor(line.x * scale));
        const top = Math.max(0, Math.floor(line.y * scale));
        const right = Math.min(image.width, Math.ceil((line.x + line.w) * scale));
        const bottom = Math.min(image.height, Math.ceil((line.y + line.h) * scale));
        if (right <= left || bottom <= top) continue;
        const pixels = context.getImageData(left, top, right - left, bottom - top).data;
        let brightest = 0;
        for (let i = 0; i < pixels.length; i += 4) brightest = Math.max(brightest, luminance(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0));

        const [r = 0, g = 0, b = 0] = (/\(([^)]+)\)/.exec(line.color)?.[1] ?? '0,0,0').split(/[ ,/]+/).map(Number);
        const text = luminance(r, g, b);
        const ratio = (Math.max(text, brightest) + 0.05) / (Math.min(text, brightest) + 0.05);
        if (ratio < worst.ratio) worst = { ratio, text: line.text, color: line.color, x: Math.round(line.x), y: Math.round(line.y) };
      }
      return worst;
    },
    { base64: picture.toString('base64'), boxes },
  );
}
