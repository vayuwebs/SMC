/**
 * SMC mode: PFMS payments in place of cheques, as the client's SMC workbook
 * (SMC/KHADOL/ALAMPURA.xlsx) books them.
 *
 * Each PFMS payment draws its own grant: on the day it is paid the grant comes in
 * (`<head> જમા`) and goes straight out to the vendor, so no balance moves. The
 * rojmel prints only the date range that is needed: the 1 April block, one nil
 * range up to the first payment, the payments, and the 31 March block.
 */
import { describe, expect, it } from "vitest";
import {
  annexure10,
  balanceOn,
  buildRojmel,
  chequeRegister,
  grantRegister,
  ledger,
  pageResolver,
  pfmsRegister,
  validate,
  yearEndBalance,
} from "../../src/engine/index.js";
import { paise } from "../../src/lib/money.js";
import type { BookBill, BookCheque, YearBook } from "../../src/engine/types.js";
import { sampleBook } from "../fixtures/sample-book.js";

function pfmsBook(): { book: YearBook; headA: string; headB: string } {
  const sample = sampleBook();
  const [first, second] = sample.heads;
  const headA = first!.code;
  const headB = second!.code;

  const bill = (id: string, voucherNo: number, billNo: string, billDate: string, headCode: string, rupees: number, chequeNo: number): BookBill => ({
    id,
    voucherNo,
    billNo,
    billDate,
    descriptionGu: voucherNo === 1 ? "પેવર બ્લોક" : "સ્ટેશનરી",
    vendorGu: "શ્રી ક્રિષ્ના સિમેન્ટ પ્રોડકટ્સ",
    headCode,
    amountPaise: paise(rupees * 100),
    deductionPaise: paise(0),
    quantityGu: null,
    remarksGu: null,
    chequeNo,
  });

  const payment = (chequeNo: number, ppaNo: string, ppaDate: string, paidDate: string, bills: BookBill[]): BookCheque => ({
    chequeNo,
    chequeDate: ppaDate,
    cashbookDate: paidDate,
    cashedDate: paidDate,
    voucherNo: chequeNo,
    payeeGu: "શ્રી ક્રિષ્ના સિમેન્ટ પ્રોડકટ્સ",
    purposeGu: chequeNo === 1 ? "પેવર બ્લોક" : "સ્ટેશનરી",
    type: "PFMS",
    remarksGu: null,
    ppaNo,
    bills,
    typedAllocation: [],
  });

  const bills1 = [bill("b1", 1, "1", "2025-07-20", headA, 20000, 1)];
  const bills2 = [
    bill("b2", 2, "2/1", "2025-09-01", headB, 1000, 2),
    bill("b3", 2, "2/2", "2025-09-02", headB, 500, 2),
  ];
  const cheques = [
    payment(1, "C072548358355", "2025-07-25", "2025-07-25", bills1),
    payment(2, "C102502768801", "2025-09-05", "2025-10-10", bills2),
  ];

  return {
    headA,
    headB,
    book: {
      ...sample,
      opening: new Map(),
      receipts: [],
      bills: [...bills1, ...bills2],
      cheques,
      returnedCheques: [],
      bankCharges: [],
      reconciliation: null,
    },
  };
}

describe("SMC: a PFMS payment in the rojmel", () => {
  const { book } = pfmsBook();
  const rojmel = buildRojmel(book, { nilBlocks: "smc", bodyLabel: "SMC" });

  it("prints only the date range that is needed", () => {
    const ranges = rojmel.blocks.map((block) => [block.fromDate, block.toDate, block.isNil]);
    expect(ranges).toEqual([
      ["2025-04-01", "2025-04-01", true],
      ["2025-04-02", "2025-07-24", true],
      ["2025-07-25", "2025-07-25", false],
      ["2025-10-10", "2025-10-10", false],
      ["2026-03-31", "2026-03-31", true],
    ]);
  });

  it("brings the grant in and pays it out in one block, so every balance stays at zero", () => {
    const block = rojmel.blocks[2]!;
    expect(block.receiptLines.map((line) => line.descriptionGu)).toEqual([
      "શ્રી ઉઘડતી સિલક",
      `${book.heads[0]!.nameGu} જમા`,
    ]);
    expect(block.receiptTotalBankPaise).toBe(2_000_000);
    expect(block.spentBankPaise).toBe(2_000_000);
    expect(block.closingBankPaise).toBe(0);
    expect(rojmel.blocks.every((each) => each.closingTotalPaise === 0)).toBe(true);
  });

  it("lays the payment over four rows, as the client's workbook does", () => {
    const lines = rojmel.blocks[2]!.paymentLines;
    expect(lines.map((line) => line.descriptionGu)).toEqual([
      `${book.heads[0]!.nameGu} માંથી`,
      "PFMS P.A.NO C072548358355 થી",
      "શ્રી ક્રિષ્ના સિમેન્ટ પ્રોડકટ્સ ને",
      "પેવર બ્લોક ના નાણાં ચુકવ્યા.વા.મુ",
    ]);
    expect(lines[0]!.dateText).toBe("25/07/2025");
    expect(lines[1]!.chequeText).toBe("PFMS");
    expect(lines[1]!.referenceText).toBe("1 20/07/25");
    expect(lines[1]!.bankPaise).toBe(2_000_000);
    expect(lines.filter((line) => !line.headingOnly)).toHaveLength(1);
  });

  it("prints the first and last bill of a payment that pays several", () => {
    expect(rojmel.blocks[3]!.paymentLines[1]!.referenceText).toBe("2/1 થી 2/2");
  });

  it("closes the year as SMC, not SMCE", () => {
    expect(rojmel.closingSentenceGu).toContain(" SMC ની બંધ સિલક રૂપિયા 0.00");
  });

  it("a year with no payment still opens, runs one range and closes", () => {
    const empty = buildRojmel({ ...book, cheques: [], bills: [] }, { nilBlocks: "smc" });
    expect(empty.blocks.map((block) => [block.fromDate, block.toDate])).toEqual([
      ["2025-04-01", "2025-04-01"],
      ["2025-04-02", "2026-03-30"],
      ["2026-03-31", "2026-03-31"],
    ]);
  });

  it("a payment on 31 March still gets its own closing block after it", () => {
    const { book: last } = pfmsBook();
    last.cheques[1] = { ...last.cheques[1]!, cashbookDate: "2026-03-31", cashedDate: "2026-03-31" };
    const blocks = buildRojmel(last, { nilBlocks: "smc" }).blocks;
    expect(blocks.slice(-2).map((block) => [block.fromDate, block.isNil])).toEqual([
      ["2026-03-31", false],
      ["2026-03-31", true],
    ]);
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  });
});

describe("SMC: a PFMS payment in the other reports", () => {
  const { book, headA, headB } = pfmsBook();

  it("credits the grant and debits the payment in the head's ledger", () => {
    const pages = pageResolver(buildRojmel(book, { nilBlocks: "smc" }));
    const rows = ledger(book, headB, { pages }).rows;
    expect(rows.map((row) => [row.descriptionGu, row.creditPaise, row.debitPaise, row.creditBalancePaise])).toEqual([
      ["શ્રી ઉઘડતી સિલક", 0, 0, 0],
      ["શ્રી ગ્રાન્ટ જમા", 150_000, 0, 150_000],
      ["સ્ટેશનરી ના નાણાં ચુકવ્યાં.વા.મુ", 0, 150_000, 0],
    ]);
    expect(rows[1]!.rojmelPage).toBe(rows[2]!.rojmelPage);
  });

  it("counts the payment as received and as spent in Annexure 10", () => {
    const row = annexure10(book).rows.find((candidate) => candidate.headCode === headA)!;
    expect([row.receivedPaise, row.spentPaise, row.closingPaise]).toEqual([2_000_000, 2_000_000, 0]);
  });

  it("lists each payment's grant in the grant register, fully spent", () => {
    const rows = grantRegister(book);
    expect(rows.map((row) => [row.receipt.date, row.receipt.receivedFromGu, row.receipt.amountPaise, row.spentPaise, row.savingPaise])).toEqual([
      ["2025-07-25", "SSA", 2_000_000, 2_000_000, 0],
      ["2025-10-10", "SSA", 150_000, 150_000, 0],
    ]);
    expect(rows[0]!.receipt.modeGu).toBe("ઓનલાઈન");
  });

  it("prints the PFMS register in place of the cheque register", () => {
    expect(chequeRegister(book)).toEqual([]);
    expect(pfmsRegister(book)).toEqual([
      {
        serial: 1,
        ppaDate: "2025-07-25",
        ppaNo: "C072548358355",
        headNamesGu: book.heads[0]!.nameGu,
        vendorGu: "શ્રી ક્રિષ્ના સિમેન્ટ પ્રોડકટ્સ",
        purposeGu: "પેવર બ્લોક",
        amountPaise: 2_000_000,
        paidDate: "2025-07-25",
      },
      expect.objectContaining({ serial: 2, ppaDate: "2025-09-05", paidDate: "2025-10-10", amountPaise: 150_000 }),
    ]);
  });

  it("never moves the bank balance and raises no warning", () => {
    expect(balanceOn(book, "2025-07-25").bankPaise).toBe(0);
    expect(yearEndBalance(book).totalPaise).toBe(0);
    expect(validate(book).issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
