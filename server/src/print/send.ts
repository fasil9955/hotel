import net from "node:net";

export function sendToPrinter(host: string, port: number, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(4000);
    socket.once("timeout", () => {
      const error = new Error(`The printer at ${host}:${port} did not respond.`);
      (error as NodeJS.ErrnoException).code = "ETIMEDOUT";
      finish(error);
    });
    socket.once("error", (error) => finish(error));
    socket.once("connect", () => {
      socket.end(payload);
    });
    socket.once("close", () => finish());
  });
}

export function printerErrorMessage(host: string, port: number, error: unknown): string {
  const where = `${host}:${port}`;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (code === "ECONNREFUSED") {
    return `Nothing is accepting prints at ${where}. Check the printer is on and the address is right.`;
  }
  if (code === "ETIMEDOUT" || code === "ECONNRESET") {
    return `The printer at ${where} did not respond.`;
  }
  if (code === "ENOTFOUND") {
    return `The address ${host} could not be found.`;
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return `The printer at ${where} could not be reached on the network.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return `Could not print to ${where}.`;
}
