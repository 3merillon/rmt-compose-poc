import { MultisampleInstrument } from './multisample-instrument.ts';
import { byPitch } from './instrument-manager.ts';

/** F#6: the highest strings of a piano have no damper. */
const PIANO_UNDAMPED_HZ = 1480;
/** How long an undamped top string rings on after its key is up (its own decay is in the recording). */
const PIANO_UNDAMPED_RING = 1.5;

/**
 * Built-in sampled instruments (ROADMAP.md Phase 5a). Both are multisampled
 * from open, clearly-licensed sources (VSCO2 Community Edition, CC0) and load
 * only their small manifest at registration; zone audio decodes lazily. Names
 * are kept ('piano'/'violin') so saved modules and instrument inheritance keep
 * working. See public/samples/CREDITS.md.
 */

export class PianoInstrument extends MultisampleInstrument {
  constructor(audioContext: BaseAudioContext) {
    super(audioContext, 'piano', '/samples/piano/manifest.json');
    this.articulation = 'struck';   // one string (set of strings) per pitch
  }

  /**
   * The hammer's attack is in the recording (2 ms keeps it unclicked). At the
   * note-off the damper falls on the string: slower on the long bass strings
   * (0.30 s at C1) than in the treble (0.10 s at C6). A piano's top strings have
   * no damper, so above F#6 a note rings its natural decay after the key is up.
   */
  getEnvelopeSettings(duration: number, frequency?: number | null) {
    const release = frequency != null && frequency > PIANO_UNDAMPED_HZ
      ? PIANO_UNDAMPED_RING
      : byPitch(frequency, [32.703, 0.3], [1046.5, 0.1]);
    const drawT60 = super.getEnvelopeSettings(duration, frequency).drawT60;
    return drawT60 ? { attack: 0.002, release, drawT60 } : { attack: 0.002, release };
  }
}

export class ViolinInstrument extends MultisampleInstrument {
  constructor(audioContext: BaseAudioContext) {
    super(audioContext, 'violin', '/samples/violin/manifest.json');
    this.articulation = 'bowed';    // slurred within a line
  }
}

export const SampleInstruments = {
  PianoInstrument,
  ViolinInstrument,
};
