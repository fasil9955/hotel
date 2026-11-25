import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

describe("live updates", () => {
  it("pushes a menu change to an open screen", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-live-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const app = await buildApp(db);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("The live server did not bind a port.");

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/live`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The live stream has no body.");
    const decoder = new TextDecoder();
    let buffer = "";

    async function nextData(): Promise<string> {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const mark = buffer.indexOf("\n\n");
        if (mark >= 0) {
          const chunk = buffer.slice(0, mark);
          buffer = buffer.slice(mark + 2);
          const data = chunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (data) return data;
          continue;
        }
        const read = await reader.read();
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
      }
      throw new Error(`No live event arrived. Pending: ${buffer}`);
    }

    const hello = JSON.parse(await nextData()) as { areas: string[] };
    assert.ok(hello.areas.includes("floor"));

    const created = await app.inject({ method: "POST", url: "/api/categories", payload: { name: "Drinks" } });
    assert.equal(created.statusCode, 200);
    const update = JSON.parse(await nextData()) as { areas: string[] };
    assert.ok(update.areas.includes("menu"));

    controller.abort();
    await reader.cancel().catch(() => undefined);
    await app.close();
    db.close();
  });
});
