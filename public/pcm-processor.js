class PcmProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      this.port.postMessage({ pcm: channelData, sampleRate: sampleRate });
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
