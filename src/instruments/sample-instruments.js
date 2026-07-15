import { MultisampleInstrument } from './multisample-instrument.js';

/**
 * Built-in sampled instruments (ROADMAP.md Phase 5a). Both are multisampled
 * from open, clearly-licensed sources (VSCO2 Community Edition, CC0) and load
 * only their small manifest at registration; zone audio decodes lazily. Names
 * are kept ('piano'/'violin') so saved modules and instrument inheritance keep
 * working. See public/samples/CREDITS.md.
 */

export class PianoInstrument extends MultisampleInstrument {
  constructor(audioContext) {
    super(audioContext, 'piano', '/samples/piano/manifest.json');
  }
}

export class ViolinInstrument extends MultisampleInstrument {
  constructor(audioContext) {
    super(audioContext, 'violin', '/samples/violin/manifest.json');
  }
}

export const SampleInstruments = {
  PianoInstrument,
  ViolinInstrument,
};
