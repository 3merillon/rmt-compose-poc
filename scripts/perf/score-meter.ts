// Globals supplied by the AudioWorkletGlobalScope during the PCM transport probe.
declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof Meter): void;

class Meter extends AudioWorkletProcessor {
  private previous: number[] = [];
  private maxStep = 0;
  private block = -1;
  private sum = 0;
  private n = 0;
  private peak = 0;
  private over = 0;
  private observeStep: boolean;

  constructor(options: { processorOptions: { observeStep: boolean } }) {
    super();
    this.observeStep = options.processorOptions.observeStep;
  }

  process(inputs: Float32Array[][]) {
    const channels = inputs[0];
    if (!channels.length) return true;
    const size = Math.round(sampleRate * 0.02);
    for (let i = 0; i < channels[0].length; i++) {
      const block = Math.floor((currentFrame + i) / size);
      if (block !== this.block) {
        if (this.n) this.port.postMessage([this.block * size / sampleRate, Math.sqrt(this.sum / this.n), this.peak, this.over, this.n, this.maxStep]);
        this.block = block;
        this.maxStep = this.sum = this.n = this.peak = this.over = 0;
      }
      for (let c = 0; c < channels.length; c++) {
        const v = channels[c][i], abs = Math.abs(v);
        if (this.observeStep) {
          const previous = this.previous[c] ?? v;
          this.maxStep = Math.max(this.maxStep, Math.abs(v - previous));
          this.previous[c] = v;
        }
        this.sum += v * v;
        this.n++;
        if (abs > this.peak) this.peak = abs;
        if (abs > 1) this.over++;
      }
    }
    return true;
  }
}

registerProcessor('score-meter', Meter);
export {};
