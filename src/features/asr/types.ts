export type AsrStatus = "idle" | "connecting" | "ready" | "recognizing" | "stopping" | "error";

export type AsrCallbacks = {
  onPartialText?: (text: string) => void;
  onFinalText?: (text: string) => void;
  onError?: (message: string) => void;
};

export type AsrStartContext = {
  targetName: string;
};

export type AsrStopResult = {
  finalText: string;
};

export type AsrEngineState = {
  status: AsrStatus;
  error: string | null;
};

export type Unsubscribe = () => void;

export type AsrEngine = {
  readonly status: AsrStatus;
  readonly error: string | null;

  subscribe: (listener: (state: AsrEngineState) => void) => Unsubscribe;
  start: (context: AsrStartContext, callbacks: AsrCallbacks) => Promise<boolean>;
  pushAudio: (chunk: Float32Array, sampleRate: number) => void;
  stop: () => Promise<AsrStopResult>;
  dispose: () => void;
};

