import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { sendToPrinter } from "./print/send.js";
import { registerRoutes } from "./routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function clientDistPath(): string {
  return path.resolve(here, "../../client/dist");
}

export async function buildApp(
  db: DatabaseSync,
  options: { databaseFile?: string; send?: typeof sendToPrinter } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, requestTimeout: 0 });
  registerRoutes(app, db, options);

  const dist = clientDistPath();
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
