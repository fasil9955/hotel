import { buildApp } from "./app.js";
import { databasePath, openDatabase } from "./db.js";
import { lanAddresses } from "./network.js";

const port = Number(process.env.PORT ?? 3780);
const host = "0.0.0.0";
const file = databasePath();
const db = openDatabase(file);
const app = await buildApp(db, { databaseFile: file });

try {
  await app.listen({ port, host });
  const addresses = lanAddresses();
  app.log.info({ database: databasePath(), addresses }, "hotel billing is listening");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
