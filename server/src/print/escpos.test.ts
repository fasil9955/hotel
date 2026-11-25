import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { buildDayReport, buildTestSlip, columnsFor } from "./escpos.js";
import { printerErrorMessage, sendToPrinter } from "./send.js";

describe("test slip", () => {
  it("uses 48 columns for 80 mm paper and 32 for 58 mm", () => {
    assert.equal(columnsFor(80), 48);
    assert.equal(columnsFor(58), 32);
  });

  it("includes the hotel name, the printer, and a cut", () => {
    const slip = buildTestSlip({
      hotelName: "Palm Court",
      printerLabel: "Kitchen",
      paperWidth: 80,
      now: new Date("2026-11-23T11:28:00Z"),
    });
    const text = slip.toString("ascii");
    assert.match(text, /Palm Court/);
    assert.match(text, /Kitchen/);
    assert.match(text, /Printer test/);
    assert.ok(slip.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00])));
  });

  it("prints the day report with the tally", () => {
    const slip = buildDayReport({
      hotelName: "Palm Court",
      paperWidth: 80,
      now: new Date("2026-11-25T10:00:00Z"),
      openingCashPaise: 50000,
      openingUpiPaise: 2000,
      salesPaise: 36000,
      expensePaise: 4000,
      closingCashPaise: 82000,
      closingUpiPaise: 2000,
      cardPaise: 0,
      presentCount: 1,
      staffCount: 2,
    });
    const text = slip.toString("ascii");
    assert.match(text, /DAY REPORT/);
    assert.match(text, /Opening balance/);
    assert.match(text, /Total business/);
    assert.match(text, /Expenses/);
    assert.match(text, /Cash balance/);
    assert.match(text, /TALLIED/);
    assert.match(text, /360\.00/);
    assert.ok(slip.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00])));
  });
});

describe("printer connection", () => {
  it("sends the slip to an open port", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => received.push(chunk));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");

    const slip = buildTestSlip({
      hotelName: "Palm Court",
      printerLabel: "Cashier",
      paperWidth: 80,
      now: new Date("2026-11-23T11:28:00Z"),
    });
    await sendToPrinter("127.0.0.1", address.port, slip);
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

    const body = Buffer.concat(received);
    assert.ok(body.includes(Buffer.from("Palm Court")));
    assert.ok(body.includes(Buffer.from("Cashier")));
  });

  it("explains a refused connection", async () => {
    const port = await closedPort();
    await assert.rejects(sendToPrinter("127.0.0.1", port, Buffer.from("x")));
    const error = await sendToPrinter("127.0.0.1", port, Buffer.from("x")).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.match(printerErrorMessage("127.0.0.1", port, error), /Nothing is accepting prints/);
  });
});

function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
