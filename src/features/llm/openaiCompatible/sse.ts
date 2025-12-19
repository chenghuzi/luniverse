type SseEvent = {
  data: string;
};

export async function* parseSse(response: Response): AsyncGenerator<SseEvent> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = rawEvent.split("\n");
      const dataLines: string[] = [];
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice("data:".length).trimStart());
      }

      if (dataLines.length === 0) continue;
      yield { data: dataLines.join("\n") };
    }
  }
}

