type ChunkHandler = (payload: { pcm16: ArrayBuffer; durationMs: number; rms: number }) => void;

function resampleLinear(input: Float32Array, fromSampleRate: number, toSampleRate: number) {
  if (fromSampleRate === toSampleRate) return input;
  const ratio = fromSampleRate / toSampleRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

function floatTo16BitPCM(input: Float32Array) {
  const output = new Int16Array(input.length);
  let sumSquares = 0;
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    sumSquares += sample * sample;
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
  return { pcm: output, rms };
}

export class BrowserPcmStreamer {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private readonly targetSampleRate = 16000;
  private readonly minChunkSamples = 1600;
  private pendingSamples = new Float32Array(0);
  private emitNormalizedChunk(normalized: Float32Array) {
    const onChunk = this.onChunkRef;
    if (!onChunk) return;
    const { pcm, rms } = floatTo16BitPCM(normalized);
    onChunk({
      pcm16: pcm.buffer.slice(0),
      durationMs: Math.round((pcm.length / this.targetSampleRate) * 1000),
      rms,
    });
  }
  private appendPending(input: Float32Array) {
    if (this.pendingSamples.length === 0) {
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.pendingSamples = copy;
      return;
    }
    const merged = new Float32Array(this.pendingSamples.length + input.length);
    merged.set(this.pendingSamples, 0);
    merged.set(input, this.pendingSamples.length);
    this.pendingSamples = merged;
  }
  private flushPendingIfNeeded() {
    while (this.pendingSamples.length >= this.minChunkSamples) {
      const current = this.pendingSamples.subarray(0, this.minChunkSamples);
      this.emitNormalizedChunk(current);
      const rest = this.pendingSamples.subarray(this.minChunkSamples);
      const restCopy = new Float32Array(rest.length);
      restCopy.set(rest);
      this.pendingSamples = restCopy;
    }
  }
  private readonly handleWorkletMessage = (event: MessageEvent) => {
    const input = event.data as Float32Array;
    const fromSampleRate = this.audioContext?.sampleRate || this.targetSampleRate;
    const normalized = resampleLinear(input, fromSampleRate, this.targetSampleRate);
    this.appendPending(normalized);
    this.flushPendingIfNeeded();
  };
  private onChunkRef: ChunkHandler | null = null;

  async start(onChunk: ChunkHandler) {
    this.onChunkRef = onChunk;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: this.targetSampleRate,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: this.targetSampleRate });
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    if (this.audioContext.audioWorklet) {
      await this.audioContext.audioWorklet.addModule("/audio/pcm-capture-worklet.js");
      this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-capture-worklet", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      this.workletNode.port.onmessage = this.handleWorkletMessage;
      this.source.connect(this.workletNode);
      return;
    }

    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      const fromSampleRate = event.inputBuffer.sampleRate || this.audioContext?.sampleRate || this.targetSampleRate;
      const normalized = resampleLinear(copy, fromSampleRate, this.targetSampleRate);
      const { pcm, rms } = floatTo16BitPCM(normalized);
      onChunk({
        pcm16: pcm.buffer.slice(0),
        durationMs: Math.round((pcm.length / this.targetSampleRate) * 1000),
        rms,
      });
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  async stop() {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
    }
    this.workletNode?.disconnect();
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.processor) {
      this.processor.onaudioprocess = null;
    }
    this.workletNode = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.pendingSamples = new Float32Array(0);
    this.onChunkRef = null;
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}
