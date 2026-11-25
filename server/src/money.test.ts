import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addGst, rupeesToPaise } from "./money.js";

describe("money", () => {
  it("converts rupees to paise", () => {
    assert.equal(rupeesToPaise("120"), 12000);
    assert.equal(rupeesToPaise("120.5"), 12050);
    assert.equal(rupeesToPaise("0.50"), 50);
    assert.equal(typeof rupeesToPaise("12.345"), "object");
  });

  it("adds CGST and SGST on top of the item total", () => {
    const tax = addGst(33000, 5);
    assert.deepEqual(tax, { taxablePaise: 33000, cgstPaise: 825, sgstPaise: 825, totalPaise: 34650 });
  });
});
