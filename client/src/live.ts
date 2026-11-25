import { useEffect, useRef } from "react";

export type LiveArea = "floor" | "menu" | "day" | "settings";

export type LiveEvent = { areas: LiveArea[] };

const SYNC_EVENT = "hotel-sync";

export function watchChanges(onEvent: (event: LiveEvent) => void): () => void {
  const controller = new AbortController();
  void readLive(controller.signal, onEvent);
  return () => controller.abort();
}

export function useSync(onAreas: (areas: ReadonlySet<LiveArea>) => void): void {
  const onAreasRef = useRef(onAreas);
  onAreasRef.current = onAreas;
  useEffect(() => {
    const handler = (event: Event) => {
      const areas = (event as CustomEvent<LiveEvent>).detail?.areas ?? [];
      onAreasRef.current(new Set(areas));
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);
}

async function readLive(signal: AbortSignal, onEvent: (event: LiveEvent) => void): Promise<void> {
  let delay = 400;
  const pending = new Set<LiveArea>();
  const handle = { timer: 0 };
  signal.addEventListener(
    "abort",
    () => {
      window.clearTimeout(handle.timer);
    },
    { once: true },
  );

  const flush = () => {
    handle.timer = 0;
    if (signal.aborted || pending.size === 0) return;
    const areas = [...pending];
    pending.clear();
    onEvent({ areas });
  };

  while (!signal.aborted) {
    try {
      const headers = new Headers();
      const token = sessionStorage.getItem("hotel-token");
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch("/api/live", { headers, signal });
      if (response.status === 401) {
        sessionStorage.removeItem("hotel-token");
        window.dispatchEvent(new Event("hotel-locked"));
        return;
      }
      if (!response.ok || !response.body) throw new Error("live");
      delay = 400;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await readChunk(reader, signal);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((row) => row.startsWith("data:"));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim()) as LiveEvent;
          for (const area of event.areas ?? []) pending.add(area);
          window.clearTimeout(handle.timer);
          handle.timer = window.setTimeout(flush, 80);
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    await wait(delay, signal);
    delay = Math.min(delay * 2, 4000);
  }
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new Error("The live connection stalled."));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reader.cancel().catch(() => undefined);
      reject(new Error("The live connection stalled."));
    }, 12000);
    reader.read().then(
      (result) => {
        window.clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", finish);
      resolve();
    }, ms);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function publishLocal(event: LiveEvent): void {
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: event }));
}
