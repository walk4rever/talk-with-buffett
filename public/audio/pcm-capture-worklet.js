class PcmCaptureWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input && input.length > 0) {
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.port.postMessage(copy);
    }
    return true;
  }
}

registerProcessor("pcm-capture-worklet", PcmCaptureWorklet);
