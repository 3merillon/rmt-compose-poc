import type {} from '../../src/dev/perf-harness.ts';
import type { SyncArgs } from '../../src/renderer/webgl2/render-types.ts';
import type { AudioEngine } from '../../src/player/audio-engine.ts';

declare global {
  interface Window {
    __frames: number[];
    __syncArgs: () => SyncArgs;
    __syncIter: number;
    engine: AudioEngine;
    ringUploads: number;
    gpu: string | null;
    starts: { id: number; lead: number }[];
    pointerProbe: { events: number[]; frames: number[]; hits: number; stop: AbortController };
    marqueeFrames: number[];
    measureMarquee: boolean;
  }
}
