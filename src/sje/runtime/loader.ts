/**
 * Loader and CacheManager: how assets get into the game (docs/engine/interfaces.md section 7).
 * Follows: Phaser `Loader` (`scene.load`: `image`, `spritesheet`, `json`, `start`, the `progress` and `complete` events) and
 * `CacheManager`. `bundle` and `unloadBundle` are ours (the Unity Addressables idea: a named group that goes together).
 *
 * `scene.load` fills a GAME-level cache, so any scene reads an asset by key. Images land in the `TextureManager` (as a canvas, the
 * only kind of texture the engine has); JSON lands in `CacheManager.json`. A key that is already there is not loaded again.
 *
 * Failure never rejects. A file that does not load (a 404, a Vite page that answers 200 with `text/html`, a decode error, 10 seconds
 * without an answer) is replaced by a stand-in and `warn` says so once per file: a magenta and black 16x16 chequer for an image,
 * `{}` for JSON. This is the per-asset stand-in path of `src/art/drawn.ts`, moved here. The game then looks wrong in one place instead
 * of not starting.
 *
 * The browser does the fetching (`browserBackend`). A test gives the loader a backend of its own, so the queue, the progress, the
 * stand-ins and the bundles are all checked in Node with no network.
 *
 * Not built yet (on demand): `atlas`, `audio`, `text`, `xml`, retry, and a load screen (`LoadingScene`, proposed). The loader has no glTF
 * type: a 3D scene loads glTF itself inside the lazy 3D chunk.
 */
import { EventEmitter } from '../core/eventemitter';
import type { TextureManager } from '../display/texturemanager';

export interface LoadFile {
  key: string;
  url: string;
}

/** A decoded image, ready to draw on a canvas. */
export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** Where the bytes come from. The browser's is `browserBackend`. */
export interface LoadBackend {
  image(url: string): Promise<LoadedImage>;
  /** Rejects when the answer is not JSON (Vite answers an unknown path with an HTML page and status 200). */
  json(url: string): Promise<unknown>;
}

export const browserBackend: LoadBackend = {
  async image(url) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  },
  async json(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('the answer is not JSON');
    }
  },
};

/** Phaser: `game.cache`. Only the part the engine needs (JSON) and the bundle lists. */
export class CacheManager {
  private readonly jsonData = new Map<string, unknown>();
  readonly bundles = new Map<string, { textures: string[]; json: string[] }>();

  readonly json = {
    get: (key: string): unknown => this.jsonData.get(key),
    exists: (key: string): boolean => this.jsonData.has(key),
  };

  /** @internal The loader stores JSON here. */
  putJson(key: string, value: unknown): void {
    this.jsonData.set(key, value);
  }

  /** @internal */
  removeJson(key: string): boolean {
    return this.jsonData.delete(key);
  }
}

export interface LoaderHost {
  textures: TextureManager;
  cache: CacheManager;
  /** Tell the player something did not load (a notice). */
  warn(message: string): void;
  backend?: LoadBackend;
  /** Milliseconds before a file counts as lost. Default 10,000. */
  timeoutMs?: number;
}

interface Job {
  kind: 'image' | 'spritesheet' | 'json';
  key: string;
  url: string;
  frame?: { frameWidth: number; frameHeight: number };
  bundle?: string;
}

interface LoaderEvents {
  progress(fraction: number): void;
  complete(): void;
  loaderror(key: string, url: string, error: unknown): void;
}

export class Loader {
  private readonly events = new EventEmitter<LoaderEvents>();
  private queue: Job[] = [];
  private total = 0;
  private done = 0;
  private running = false;
  private cancelled = false;

  constructor(private readonly host: LoaderHost) {}

  image(key: string, url: string, bundle?: string): this {
    return this.enqueue({ kind: 'image', key, url, ...(bundle ? { bundle } : {}) });
  }

  /** A grid of equal cells. The frames are named by number, 0 first, left to right then top to bottom. */
  spritesheet(key: string, url: string, cfg: { frameWidth: number; frameHeight: number }, bundle?: string): this {
    return this.enqueue({ kind: 'spritesheet', key, url, frame: cfg, ...(bundle ? { bundle } : {}) });
  }

  json(key: string, url: string, bundle?: string): this {
    return this.enqueue({ kind: 'json', key, url, ...(bundle ? { bundle } : {}) });
  }

  /** A named group of images and JSON files (by the extension `.json`). `unloadBundle(name)` frees all of it. @ours */
  bundle(name: string, files: LoadFile[]): this {
    for (const f of files) {
      if (f.url.split('?')[0]?.endsWith('.json')) this.json(f.key, f.url, name);
      else this.image(f.key, f.url, name);
    }
    return this;
  }

  /** True while there is something queued or loading. The scene manager waits on this. */
  get pending(): boolean {
    return this.queue.length > 0 || this.running;
  }

  on(ev: 'progress', fn: (fraction: number) => void): this;
  on(ev: 'complete', fn: () => void): this;
  on(ev: 'loaderror', fn: (key: string, url: string, error: unknown) => void): this;
  // biome-ignore lint/suspicious/noExplicitAny: one overload set above types the three events; this is the shared implementation.
  on(ev: keyof LoaderEvents, fn: any): this {
    this.events.on(ev, fn);
    return this;
  }

  once(ev: 'complete', fn: () => void): this;
  once(ev: 'loaderror', fn: (key: string, url: string, error: unknown) => void): this;
  // biome-ignore lint/suspicious/noExplicitAny: same as `on`.
  once(ev: 'complete' | 'loaderror', fn: any): this {
    this.events.once(ev, fn);
    return this;
  }

  /** Begin loading what is queued. Calling it again while it runs does nothing. `complete` fires after the last file. */
  start(): void {
    if (this.running || this.cancelled) return;
    if (this.queue.length === 0) {
      this.events.emit('complete');
      return;
    }
    this.running = true;
    void this.run();
  }

  /** Free the textures and JSON of a bundle. Keys that are not there are skipped. */
  async unloadBundle(name: string): Promise<void> {
    const b = this.host.cache.bundles.get(name);
    if (!b) return;
    for (const k of b.textures) this.host.textures.remove(k);
    for (const k of b.json) this.host.cache.removeJson(k);
    this.host.cache.bundles.delete(name);
  }

  /** Scene shutdown: stop loading. Files in flight finish but their results are dropped. */
  shutdown(): void {
    this.cancelled = true;
    this.queue = [];
    this.events.removeAllListeners();
  }

  private enqueue(job: Job): this {
    if (this.cancelled) return this;
    const { textures, cache } = this.host;
    // Already loaded (by this scene or any other): the cache wins, nothing to fetch.
    if (job.kind === 'json' ? cache.json.exists(job.key) : textures.exists(job.key)) {
      this.note(job);
      return this;
    }
    this.queue.push(job);
    this.total++;
    return this;
  }

  /** Remember which bundle a key belongs to, even when it was already loaded. */
  private note(job: Job): void {
    if (!job.bundle) return;
    const cache = this.host.cache;
    let b = cache.bundles.get(job.bundle);
    if (!b) {
      b = { textures: [], json: [] };
      cache.bundles.set(job.bundle, b);
    }
    const list = job.kind === 'json' ? b.json : b.textures;
    if (!list.includes(job.key)) list.push(job.key);
  }

  private async run(): Promise<void> {
    while (this.queue.length > 0 && !this.cancelled) {
      const job = this.queue.shift();
      if (!job) break;
      try {
        await this.load(job);
      } catch (e) {
        if (this.cancelled) break;
        this.standIn(job, e);
      }
      this.done++;
      if (!this.cancelled) this.events.emit('progress', this.total === 0 ? 1 : this.done / this.total);
    }
    this.running = false;
    this.total = 0;
    this.done = 0;
    if (!this.cancelled) this.events.emit('complete');
  }

  private async load(job: Job): Promise<void> {
    const backend = this.host.backend ?? browserBackend;
    const timeoutMs = this.host.timeoutMs ?? 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('it took too long')), timeoutMs);
    });
    try {
      if (job.kind === 'json') {
        const data = await Promise.race([backend.json(job.url), timeout]);
        if (this.cancelled) return;
        this.host.cache.putJson(job.key, data);
      } else {
        const img = await Promise.race([backend.image(job.url), timeout]);
        if (this.cancelled) return;
        // Another loader may have stored the same key while this file was on its way: the first one stays.
        if (this.host.textures.exists(job.key)) {
          this.note(job);
          return;
        }
        const made = this.host.textures.createCanvas(job.key, img.width, img.height);
        made.ctx.drawImage(img.source, 0, 0);
        made.refresh();
        if (job.frame) this.addGrid(job.key, img.width, img.height, job.frame);
      }
      this.note(job);
    } finally {
      clearTimeout(timer);
    }
  }

  private addGrid(key: string, w: number, h: number, cell: { frameWidth: number; frameHeight: number }): void {
    const frames: Record<number, [number, number, number, number]> = {};
    const cols = Math.floor(w / cell.frameWidth);
    const rows = Math.floor(h / cell.frameHeight);
    for (let i = 0; i < cols * rows; i++) frames[i] = [(i % cols) * cell.frameWidth, Math.floor(i / cols) * cell.frameHeight, cell.frameWidth, cell.frameHeight];
    this.host.textures.addFrames(key, frames);
  }

  /** A file did not load: put a stand-in under its key, say so, and carry on. */
  private standIn(job: Job, error: unknown): void {
    const why = error instanceof Error ? error.message : String(error);
    this.events.emit('loaderror', job.key, job.url, error);
    this.host.warn(`${job.url} did not load (${why}), so a stand-in shows for "${job.key}".`);
    if (job.kind === 'json') {
      if (!this.host.cache.json.exists(job.key)) this.host.cache.putJson(job.key, {});
    } else if (!this.host.textures.exists(job.key)) {
      const made = this.host.textures.createCanvas(job.key, 16, 16);
      const g = made.ctx;
      g.fillStyle = '#ff00ff';
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#000000';
      g.fillRect(0, 0, 8, 8);
      g.fillRect(8, 8, 8, 8);
      made.refresh();
      if (job.frame) this.addGrid(job.key, 16, 16, { frameWidth: Math.min(16, job.frame.frameWidth), frameHeight: Math.min(16, job.frame.frameHeight) });
    }
    this.note(job);
  }
}
