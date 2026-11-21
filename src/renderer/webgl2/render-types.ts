import type { Module } from '../../module.ts';
import type { EvaluationCache, EvaluationRecord } from '../../model-types.ts';
import type { RendererConfig } from './renderer-config.ts';
export interface Preview { startSec?: number; durationSec?: number }
export type RenderRecord = Partial<EvaluationRecord> & { color?: unknown };
export type EvaluatedScene = EvaluationCache | Record<number, RenderRecord>;
export interface SyncArgs {
  module: Module;
  evaluatedNotes: EvaluatedScene | null;
  xScaleFactor: number;
  yScaleFactor: number;
  selectedNoteId?: number | null;
  incremental?: boolean;
  tempOverrides?: Record<number, Preview> | null;
}
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Marquee extends Rect { additive?: boolean; seedId?: number | null }
export interface SceneHit { type: 'note' | 'measure' | 'base' | 'reference'; id: number }
export interface DragOffset { dxWorld?: number; dwWorld?: number; noteIds?: number[] | Set<number>; anchorId?: number | null }
export interface DragOverlay {
  noteId: number; type?: string; dxSec?: number; ddurSec?: number;
  origStartSec?: number | null; origDurationSec?: number | null; movingIds?: number[];
}
export type Relation = 'frequency' | 'startTime' | 'duration';
export type ByRelation<T> = Record<Relation, T>;
export type ThemeColor = 'accent' | 'noteBorder' | 'measureBar' | 'selectionRing' | 'hoverRing' | 'depFrequency' | 'depStartTime' | 'depDuration' | 'textPrimary';
export type InputTheme = Partial<Record<ThemeColor, string>>;
export type ColorCache = Partial<Record<Exclude<ThemeColor, 'textPrimary'> | 'noteText', number[]> & Record<'accentHex' | 'noteBorderHex' | 'measureBarHex' | 'noteTextHex', string>>;
export interface GlyphRun {
  text: string; noteId?: number; x: number; y: number; fontPx: number;
  color?: number[]; layerZ?: number; scaleX?: number;
  scLeft?: number; scTop?: number; scW?: number; scH?: number;
  rrCx?: number; rrCy?: number; rrHx?: number; rrHy?: number; rrR?: number;
}
export interface Sprite { tex: WebGLTexture; x: number; y: number; w: number; h: number; layerZ: number; scLeft: number; scTop: number; scW: number; scH: number }
export interface TextureEntry { tex: WebGLTexture; wCss: number; hCss: number; ascent?: number; descent?: number; basePx?: number }
export interface Glyph extends TextureEntry { ascent: number; descent: number; basePx: number; inkTopCss: number; inkBottomCss: number }
export interface AtlasGlyph { u0: number; u1: number; v0: number; v1: number; wCss: number; hCss: number; basePx: number; ascent?: number }
export interface Atlas {
  tex: WebGLTexture; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  w: number; h: number; pad: number; nextX: number; nextY: number; rowH: number;
  map: Map<string, AtlasGlyph>;
}
export type AtlasScratch = Partial<Record<'posSize' | 'uvRect' | 'color' | 'zArr' | 'clip' | 'rrCS' | 'rrR' | 'dragFlags', Float32Array<ArrayBuffer>>> & { cap?: number };
export interface LinkWriter {
  a: Float32Array<ArrayBuffer>; n: number; readonly length: number;
  _grow(need: number): void;
  push(v0: number, v1: number, v2?: number, v3?: number): void;
  view(): Float32Array<ArrayBuffer> | null;
}
export interface LinkBasis { sx: number; sy: number; b: number; c: number; config: RendererConfig; tx: number; ty: number; w: number; h: number }
export interface Overview extends Rect { sx: number; sy: number; cutoff: number; pos: number; drag: number; ranges: number[]; crowded: boolean }
export interface CachedRings { buffer: WebGLBuffer; indices?: number[]; epoch?: number; count?: number }
