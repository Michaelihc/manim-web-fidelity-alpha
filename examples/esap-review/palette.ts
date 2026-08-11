/**
 * ESAP's semantic color system.
 *
 * Scene code should ask for a semantic role instead of importing arbitrary
 * colors. This keeps the sustained dark-to-paper inversions coherent.
 */
export const DARK_PALETTE = {
  background: '#05070D',
  ink: '#E8ECF4',
  dim: '#8B94A8',
  input: '#58C4DD',
  loss: '#FC6255',
  parameter: '#E8C547',
  valid: '#83C167',
  latent: '#B085F5',
  output: '#5CD0B3',
} as const;

export const LIGHT_PALETTE = {
  background: '#EEF1F6',
  ink: '#1A2233',
  dim: '#5A6478',
  input: '#0E7490',
  loss: '#B4232F',
  parameter: '#A16207',
  valid: '#3F6212',
  latent: '#6D28D9',
  output: '#0F766E',
} as const;

export type EsapPalette = {
  readonly [Role in keyof typeof DARK_PALETTE]: string;
};

export type PaletteMode = 'dark' | 'light';

export function paletteFor(mode: PaletteMode): EsapPalette {
  return mode === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}
