export interface BoundedTextReadResult {
  text: string;
  bytesRead: number;
  truncated: boolean;
  unavailable: boolean;
}

interface BoundedTextReader {
  read(): Promise<{
    value?: Uint8Array;
    done: boolean;
  }>;
  cancel(reason?: unknown): Promise<unknown>;
  releaseLock?(): void;
}

interface BoundedTextResponse {
  body?: {
    getReader?(): BoundedTextReader;
  } | null;
}

export async function readResponseTextBounded(
  response: BoundedTextResponse,
  maxBytes: number,
  cancelReason: string
): Promise<BoundedTextReadResult> {
  const reader = response?.body?.getReader?.();

  if (!reader) {
    return {
      text: '',
      bytesRead: 0,
      truncated: false,
      unavailable: true
    };
  }

  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;
  let truncated = false;

  try {
    while (bytesRead < maxBytes) {
      const { value, done } =
        await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      const remaining =
        maxBytes - bytesRead;

      if (value.byteLength > remaining) {
        text += decoder.decode(
          value.subarray(0, remaining),
          { stream: true }
        );

        bytesRead += remaining;
        truncated = true;

        await reader
          .cancel(cancelReason)
          .catch(() => {});

        break;
      }

      text += decoder.decode(
        value,
        { stream: true }
      );

      bytesRead += value.byteLength;
    }

    text += decoder.decode();

    if (
      bytesRead >= maxBytes &&
      !truncated
    ) {
      truncated = true;

      await reader
        .cancel(cancelReason)
        .catch(() => {});
    }

    return {
      text,
      bytesRead,
      truncated,
      unavailable: false
    };
  } finally {
    try {
      reader.releaseLock?.();
    } catch {}
  }
}
