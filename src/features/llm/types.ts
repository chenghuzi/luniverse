export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmStreamCallbacks = {
  onDeltaText?: (delta: string) => void;
  onDone?: (finalText: string) => void;
  onError?: (error: Error) => void;
};

export type LlmStreamHandle = {
  abort: () => void;
};

export type LlmClient = {
  streamChat: (params: { model: string; messages: LlmMessage[] }, callbacks: LlmStreamCallbacks) => LlmStreamHandle;
};

