/**
 * What a rojmel cell's own wrap is attached to: the line, by the record it
 * prints. It has to outlast a new entry above it and a new page break; and how
 * cells wrap must never move an entry, because the ledger prints page numbers.
 */
import { describe, expect, it } from "vitest";
import { buildRojmel, type RojmelBlock } from "../../src/engine/rojmel.js";
import { isLineKey } from "../../src/shared/report-layout.js";
import { rojmelBlockRows } from "../../src/shared/rojmel-rows.js";
import { sampleBook } from "../fixtures/sample-book.js";

const rojmel = buildRojmel(sampleBook());

function billBlock(): RojmelBlock {
  const block = rojmel.blocks.find(
    (each) => each.paymentLines.filter((line) => line.source.kind === "bill").length >= 2,
  );
  if (!block) throw new Error("the sample book has a voucher of several bills");
  return block;
}

describe("rojmel line keys", () => {
  it("names every printed line, once in its block", () => {
    for (const block of rojmel.blocks) {
      const rows = rojmelBlockRows(block);
      const keys = rows.flatMap((row) => [row.leftKey, row.rightKey]).filter((key) => key !== null);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.every(isLineKey)).toBe(true);
      for (const row of rows) {
        expect(row.leftKey !== null).toBe(row.left !== null);
        expect(row.rightKey !== null).toBe(row.right !== null);
      }
    }
  });

  it("keeps a bill's key when a line is added above it, though its row key moves", () => {
    const block = billBlock();
    const firstBill = block.paymentLines.findIndex((line) => line.source.kind === "bill");
    const line = block.paymentLines[firstBill]!;
    const before = rojmelBlockRows(block).find((row) => row.right === line)!;

    const added = { ...block.paymentLines[firstBill + 1]!, source: { kind: "bill" as const, id: "new-bill" } };
    const lines = [...block.paymentLines];
    lines.splice(firstBill, 0, added);
    const after = rojmelBlockRows({ ...block, paymentLines: lines }).find((row) => row.right === line)!;

    expect(after.key).not.toBe(before.key);
    expect(after.rightKey).toBe(before.rightKey);
  });

  it("leaves the pages as the engine set them: they take no layout at all", () => {
    expect(buildRojmel.length).toBe(1);
    expect(buildRojmel(sampleBook()).pages.map((page) => page.blocks.map((block) => block.id))).toEqual(
      rojmel.pages.map((page) => page.blocks.map((block) => block.id)),
    );
  });
});
