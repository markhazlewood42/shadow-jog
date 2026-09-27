/** Dialogue speakers: display name, name color, voice pitch for text blips, portrait key. */
export interface Speaker {
  name: string;
  color: string;
  /** Blip pitch multiplier. */
  voice: number;
  portrait?: string;
}

export const SPEAKERS: Record<string, Speaker> = {
  kit: { name: 'Kit', color: '#ff8a6a', voice: 1.25, portrait: 'kit' },
  rook: { name: 'Rook', color: '#d8c08a', voice: 0.72, portrait: 'rook' },
  hex: { name: 'Hex', color: '#c3a0ff', voice: 1.45, portrait: 'hex' },
  sable: { name: 'Sable', color: '#efe6cf', voice: 0.9, portrait: 'sable' },
  dutch: { name: 'Dutch', color: '#e8c85a', voice: 0.6, portrait: 'dutch' },
  pale: { name: 'Mr. Pale', color: '#ff6a7a', voice: 0.85, portrait: 'pale' },
  mags: { name: 'Old Mags', color: '#86f08c', voice: 1.05, portrait: 'mags' },
  yun: { name: 'Doc Yun', color: '#6ff3ff', voice: 1.1, portrait: 'yun' },
};

export function speaker(who: string | null): Speaker | null {
  if (!who) return null;
  return SPEAKERS[who] ?? { name: who, color: '#9fd8ff', voice: 1 };
}
