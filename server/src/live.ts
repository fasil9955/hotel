import type { FastifyReply, FastifyRequest } from "fastify";

export type LiveArea = "floor" | "menu" | "day" | "settings";

export type LiveEvent = { areas: LiveArea[] };

const listeners = new Set<(event: LiveEvent) => void>();

export function publish(area: LiveArea | LiveArea[]): void {
  const areas = (Array.isArray(area) ? area : [area]).filter((item, index, list) => list.indexOf(item) === index);
  if (areas.length === 0) return;
  const event = { areas };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // One closed screen must not stop the others.
    }
  }
}

export function subscribe(listener: (event: LiveEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function attachLive(request: FastifyRequest, reply: FastifyReply): void {
  reply.hijack();
  const raw = reply.raw;
  request.raw.setTimeout(0);
  raw.setTimeout(0);
  raw.socket?.setNoDelay(true);
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const push = (chunk: string) => {
    if (raw.destroyed || raw.writableEnded) return;
    raw.write(chunk);
  };

  push(": ok\n\n");
  push(`data: ${JSON.stringify({ areas: ["floor", "menu", "day", "settings"] })}\n\n`);

  const unsubscribe = subscribe((event) => {
    push(`data: ${JSON.stringify(event)}\n\n`);
  });
  const ping = setInterval(() => push(": ping\n\n"), 5000);
  ping.unref();

  const close = () => {
    clearInterval(ping);
    unsubscribe();
  };
  request.raw.on("close", close);
  raw.on("error", close);
}
