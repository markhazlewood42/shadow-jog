import { PlasmaCanvas, PlasmaProvider, usePlasmaRuntime } from '@cruxgarden/plasma-ui';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { moodFromTokens, readPageToken } from './moodFromTokens';
import { supportsWebGL2 } from './webgl';

// The glass of the Now page. PlasmaUI draws every panel as liquid glass on one WebGL canvas that sits behind the page. The canvas costs the GPU, which
// the game may need (for example while it runs), so the glass has a switch, and it also stays off where the browser has no WebGL2. This file holds the
// provider that PlasmaUI needs, the state of the switch, and `useGlass`, which the page reads. The panels themselves are in GlassPanel.tsx.

/** What the page may ask about the glass. */
export type GlassState = {
  /** The glass is on: the switch is on, and the browser can draw it. (The panels turn to glass a moment after the page opens, once the renderer is up: see GlassPanel.) When this is false, the panels are plain. */
  glass: boolean;
  /** The browser can draw the glass: it has WebGL2, and PlasmaUI could start its renderer. When this is false the switch has nothing to switch. */
  webgl2: boolean;
  /** Turns the glass on or off, and keeps the choice in the browser. It does nothing visible while `webgl2` is false (the choice is still kept). */
  setGlass(on: boolean): void;
};

const GlassContext = createContext<GlassState | null>(null);

/** The state of the glass. It must be used under a `GlassProvider`. */
export function useGlass(): GlassState {
  const state = useContext(GlassContext);
  if (state === null) throw new Error('useGlass was used outside a GlassProvider, so there is no glass state to read.');
  return state;
}

// ---- the choice is kept in localStorage ----

/** The key of the switch in localStorage. */
const GLASS_KEY = 'cc.now.glass';

/** localStorage, or null when the browser has none or blocks it (reading the property itself can throw). */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The saved choice. The glass is on unless the person turned it off: that is what the page is for, and a storage that cannot be read gives the default. */
function loadGlassChoice(): boolean {
  try {
    return storage()?.getItem(GLASS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveGlassChoice(on: boolean): void {
  try {
    storage()?.setItem(GLASS_KEY, on ? 'on' : 'off');
  } catch {
    // The choice then lasts until the page is closed, and nothing else is lost.
  }
}

/**
 * Whether the page has been painted once. The glass starts after that, and not with the first render: PlasmaUI makes its renderer by compiling its shaders, and
 * the page waits for the GPU to do that. On a real GPU it is quick, but a software renderer (a browser with no GPU, or one under test) takes seconds, and a person
 * would see a blank page for all of them. Started after the first paint, the panels are on the screen as plain boxes meanwhile, and become glass when the renderer is up.
 */
function useAfterFirstPaint(): boolean {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    // Two frames: the first runs before the page is painted, the second after.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPainted(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  return painted;
}

/**
 * Tells the provider when PlasmaUI could not start. The browser may say yes to WebGL2 and PlasmaUI may still fail (a missing extension, a shader that the GPU
 * refuses), and then it would draw its own frosted CSS panels, which have their own colors and shadows. The page would rather show its plain panels, and say that
 * the glass is not available. This must sit under the `PlasmaProvider`: only there can the renderer's state be read.
 */
function RendererWatch({ onFailed }: { onFailed: () => void }) {
  const { supported } = usePlasmaRuntime();
  useEffect(() => {
    if (!supported) onFailed();
  }, [supported, onFailed]);
  return null;
}

/**
 * How much of a panel is its tint (the navy of a panel, `paper-2`) and how much is the glass showing what is behind it. The glass is meant to read as a navy
 * panel with a lavender edge, and the text on it must keep the contrast of the Look (docs/diagrams/profile/NOTES.md: at least 4.5 to 1 for every text color on
 * `paper` and `paper-2`). The field behind a panel has lighter clouds in it. With no tint, and with the lift that the material gives what is behind it left on (see `wash`
 * below), the smallest text measured 4.3 to 1 on the pixels of the page. With this tint and no lift it measures 5.5 to 1 at its worst, and the glass still shows
 * the field a little and bends it at the edges. (e2e/now.spec.ts measures it on the pixels, so a change here that breaks the floor fails there.)
 */
const PANEL_TINT_STRENGTH = 0.75;

/**
 * The provider of the glass, for the Now page. It always renders PlasmaUI's provider, so the panels under it keep their place in the tree when the glass is
 * switched: only the canvas (and with it the WebGL context and the work of the GPU) comes and goes. With the glass off no canvas exists, so nothing is drawn.
 *
 * The look is the Look of the site (docs/diagrams/profile), and each prop below that is not a default says how:
 * - the colors are the tokens (the mood, the tint of a panel and the rim), and `theme` is dark whatever the system says, because the site has one skin;
 * - the glass casts no light on the page around it (`glow` 0) and the panels are flat (`elevation` 0, which is also no shadow);
 * - the effects that are decoration and not material are off: the rainbow of the rim and of the sheen (`rimColor` is the lavender frame, `shimmer` 0, `dispersion` 0),
 *   the film grain, the highlight that follows the pointer, the drop that follows it, and the lift that the material gives what is behind it (`wash` 0);
 * - panels fuse into one body only when they touch (`blend` 16): the page leaves 24 pixels between panels, and a wider fuse distance would draw liquid bridges between them.
 */
export function GlassProvider({ children }: { children: ReactNode }) {
  const [canStart] = useState(supportsWebGL2);
  const [failed, setFailed] = useState(false);
  const [wanted, setWanted] = useState(loadGlassChoice);
  const painted = useAfterFirstPaint();
  // The colors are read once, when the page starts: the tokens are in the stylesheet that the page loaded before this code ran.
  const mood = useMemo(() => moodFromTokens(readPageToken), []);

  const webgl2 = canStart && !failed;
  const glass = wanted && webgl2;

  const setGlass = useCallback((on: boolean) => {
    setWanted(on);
    saveGlassChoice(on);
  }, []);
  const markFailed = useCallback(() => setFailed(true), []);

  const state = useMemo<GlassState>(() => ({ glass, webgl2, setGlass }), [glass, webgl2, setGlass]);

  return (
    <GlassContext.Provider value={state}>
      <PlasmaProvider
        mood={mood}
        theme="dark"
        grid={24}
        glow={0}
        elevation={0}
        tint={mood.colors[1]}
        opacity={PANEL_TINT_STRENGTH}
        frost={0.3}
        wash={0}
        rimColor={mood.colors[2]}
        shimmer={0}
        dispersion={0}
        grain={0}
        highlight={0}
        pointerDrop={false}
        blend={16}
        canvas={false}
      >
        {/*
          The canvas is drawn here, and not by the provider, for its size. PlasmaUI 0.7.0 draws on a region of the window size (`innerWidth` by `innerHeight`), but its own
          canvas is `width: 100%` and `height: 100%`, which is the width of the page without the vertical scrollbar (15 to 17 pixels narrower). The browser then squeezes
          the picture toward the left, and the frames of the panels stop matching the panels (the "Updated" time touches the right rim). `100vw` and `100vh` include the
          scrollbar, so the canvas is as wide as the region that PlasmaUI draws. (e2e/now.spec.ts: "glass canvas spans the window width, scrollbar included".)
        */}
        {glass && painted && <PlasmaCanvas style={{ width: '100vw', height: '100vh' }} />}
        {glass && painted && <RendererWatch onFailed={markFailed} />}
        {children}
      </PlasmaProvider>
    </GlassContext.Provider>
  );
}
