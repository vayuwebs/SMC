/**
 * રોજમેળ - the cash book (SPEC 6.1).
 *
 * The rojmel is the one report that can look right and be wrong: its footers
 * are three interlocking sums, and the client's own page 15 is out by 1,646
 * because a cash line was copied from the wrong page and a hand-typed 0 hid it
 * (SPEC 9.1). So the tests check the identities, not the appearance.
 */
import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../../src/lib/money.js";
import {
  balancesByDate,
  buildRojmel,
  ledger,
  pageResolver,
  ROWS_PER_PAGE,
  yearEndBalance,
} from "../../src/engine/index.js";
import { byVoucherOrder } from "../../src/engine/allocation.js";
import { expected, sampleBook } from "../fixtures/sample-book.js";

const book = sampleBook();
const rojmel = buildRojmel(book);

describe("block structure", () => {
  it("covers the whole year without a gap or an overlap", () => {
    expect(rojmel.blocks.length).toBeGreaterThan(0);
    expect(rojmel.blocks[0]!.fromDate).toBe(book.year.startDate);
    expect(rojmel.blocks[rojmel.blocks.length - 1]!.toDate).toBe(book.year.endDate);

    for (let index = 1; index < rojmel.blocks.length; index += 1) {
      const previous = rojmel.blocks[index - 1]!;
      const current = rojmel.blocks[index]!;
      // Two vouchers on one date are two blocks of that same date, one after the other.
      const sameDateVoucher = !current.isNil && !previous.isNil && current.fromDate === previous.toDate;
      expect(
        sameDateVoucher || current.fromDate > previous.toDate,
        `${current.fromDate} after ${previous.toDate}`,
      ).toBe(true);
    }
  });

  it("has one block per voucher on each cash-book date, plus nil blocks for the gaps", () => {
    const active = rojmel.blocks.filter((block) => !block.isNil).map((block) => block.fromDate);
    expect([...new Set(active)]).toEqual(Object.keys(expected.closing_balance_after_each_cashbook_date).sort());
    // 03/03/2026 has two vouchers, so two blocks.
    expect(active.filter((date) => date === "2026-03-03")).toHaveLength(2);
    expect(new Set(rojmel.blocks.map((block) => block.id)).size).toBe(rojmel.blocks.length);
  });

  it("gives each voucher of a date its own block, opening where the last one closed", () => {
    const [first, second] = rojmel.blocks.filter((block) => block.fromDate === "2026-03-03");
    // The voucher number is the first word of the cheque line's reference ("6 26/02/2026").
    const voucherOf = (block: typeof first): string => block!.paymentLines[0]!.referenceText.split(" ")[0]!;
    expect(voucherOf(first)).toBe("6");
    expect(voucherOf(second)).toBe("7");
    expect(second!.id).toBe("2026-03-03#2");
    expect(second!.openingBankPaise).toBe(first!.closingBankPaise);
    expect(second!.openingCashPaise).toBe(first!.closingCashPaise);
  });

  it("prints કોઈ નાણાંકીય ખર્ચ કરેલ નથી in a nil block", () => {
    const nil = rojmel.blocks.find((block) => block.isNil)!;
    expect(nil.paymentLines[0]!.descriptionGu).toBe("કોઈ નાણાંકીય ખર્ચ કરેલ નથી");
    expect(nil.spentTotalPaise).toBe(0);
    expect(nil.closingCashPaise).toBe(nil.openingCashPaise);
    expect(nil.closingBankPaise).toBe(nil.openingBankPaise);
  });

  it("never lets a nil block span two months", () => {
    for (const block of rojmel.blocks.filter((candidate) => candidate.isNil)) {
      expect(block.fromDate.slice(0, 7)).toBe(block.toDate.slice(0, 7));
    }
  });
});

describe("the three footer rows", () => {
  it("balances every block: ખર્ચખાતે + બંધ સિલક = the receipt totals", () => {
    for (const block of rojmel.blocks) {
      const label = `block ${block.fromDate}`;
      expect(block.spentCashPaise + block.closingCashPaise, `${label} cash`).toBe(
        block.receiptTotalCashPaise,
      );
      expect(block.spentBankPaise + block.closingBankPaise, `${label} bank`).toBe(
        block.receiptTotalBankPaise,
      );
    }
  });

  it("carries each block's closing into the next block's opening", () => {
    for (let index = 1; index < rojmel.blocks.length; index += 1) {
      const previous = rojmel.blocks[index - 1]!;
      const current = rojmel.blocks[index]!;
      expect(current.openingCashPaise, `${current.fromDate} cash`).toBe(previous.closingCashPaise);
      expect(current.openingBankPaise, `${current.fromDate} bank`).toBe(previous.closingBankPaise);
    }
  });

  it("counts a reimbursement on both sides of ખર્ચખાતે, and still balances", () => {
    // Cheque 106 on 20/12/2025: 1,700 out of the bank, 1,700 paid in cash to
    // the shopkeepers. The client's page 9 prints ખર્ચખાતે 1700 / 1700 / 3400.
    const block = rojmel.blocks.find((candidate) => candidate.fromDate === "2025-12-20")!;
    expect(block.spentBankPaise).toBe(rupeesToPaise(1700));
    expect(block.spentCashPaise).toBe(rupeesToPaise(1700));
    expect(block.spentTotalPaise).toBe(rupeesToPaise(3400));
    // Cash still returns to zero, which is the point of the round trip.
    expect(block.closingCashPaise).toBe(0);
  });
});

describe("agreement with the rest of the engine", () => {
  it("closes each transaction date exactly as balancesByDate does", () => {
    const byDate = new Map(balancesByDate(book).map((balance) => [balance.date, balance]));
    // The last block of each date closes the day.
    const lastOfDate = new Map(rojmel.blocks.filter((candidate) => !candidate.isNil).map((block) => [block.fromDate, block]));
    for (const block of lastOfDate.values()) {
      const balance = byDate.get(block.fromDate);
      expect(balance, `no balance for ${block.fromDate}`).toBeDefined();
      expect(block.closingBankPaise, `${block.fromDate} bank`).toBe(balance!.bankPaise);
      expect(block.closingCashPaise, `${block.fromDate} cash`).toBe(balance!.cashPaise);
    }
  });

  it("ends the year at the same 154.00", () => {
    const last = rojmel.blocks[rojmel.blocks.length - 1]!;
    expect(last.closingBankPaise).toBe(rupeesToPaise(expected.year_end.bank));
    expect(last.closingCashPaise).toBe(rupeesToPaise(expected.year_end.cash));
    expect(last.closingBankPaise).toBe(yearEndBalance(book).bankPaise);
  });

  it("never prints a negative closing, the way the client's page 15 does", () => {
    for (const block of rojmel.blocks) {
      expect(block.closingBankPaise, `block ${block.fromDate}`).toBeGreaterThanOrEqual(0);
      expect(block.closingCashPaise, `block ${block.fromDate}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("pagination", () => {
  it("never splits a block across pages", () => {
    const paged = rojmel.pages.flatMap((page) => page.blocks);
    expect(paged).toHaveLength(rojmel.blocks.length);
    expect(paged.map((block) => block.fromDate)).toEqual(
      rojmel.blocks.map((block) => block.fromDate),
    );
  });

  it("keeps each page within its row capacity", () => {
    for (const page of rojmel.pages) {
      const rows = page.blocks.reduce((total, block) => total + block.rowCount, 0);
      // A single block larger than a page is allowed to exceed it; two are not.
      if (page.blocks.length > 1) expect(rows, `page ${page.pageNo}`).toBeLessThanOrEqual(ROWS_PER_PAGE);
    }
  });

  it("numbers pages from 1 without a gap", () => {
    expect(rojmel.pages.map((page) => page.pageNo)).toEqual(
      rojmel.pages.map((_, index) => index + 1),
    );
  });

  it("is deterministic - the same book gives the same pages", () => {
    const again = buildRojmel(sampleBook());
    expect(again.pages.map((page) => page.blocks.map((block) => block.fromDate))).toEqual(
      rojmel.pages.map((page) => page.blocks.map((block) => block.fromDate)),
    );
  });

  it("dedicates page 1 strictly to the opening block with a single date", () => {
    const page1 = rojmel.pages[0]!;
    expect(page1.blocks).toHaveLength(1);
    expect(page1.blocks[0]!.isNil).toBe(true);
    expect(page1.blocks[0]!.fromDate).toBe(book.year.startDate);
    expect(page1.blocks[0]!.toDate).toBe(book.year.startDate);
    const dateText = page1.blocks[0]!.receiptLines[0]!.dateText;
    expect(dateText).toBe("01/04/2025");
    expect(dateText).not.toContain(" થી ");
  });

  it("dedicates the last page strictly to the year-end closing block with a single date", () => {
    const lastPage = rojmel.pages[rojmel.pages.length - 1]!;
    expect(lastPage.blocks).toHaveLength(1);
    expect(lastPage.blocks[0]!.isNil).toBe(true);
    expect(lastPage.blocks[0]!.fromDate).toBe(book.year.endDate);
    expect(lastPage.blocks[0]!.toDate).toBe(book.year.endDate);
    const dateText = lastPage.blocks[0]!.receiptLines[0]!.dateText;
    expect(dateText).toBe("31/03/2026");
    expect(dateText).not.toContain(" થી ");
  });
});

describe("page numbers for the ખાતાવહી", () => {
  const pages = pageResolver(rojmel);

  it("gives every receipt and cheque a page", () => {
    for (const receipt of book.receipts) {
      expect(pages.receiptPage(receipt.id), `receipt ${receipt.id}`).not.toBeNull();
    }
    for (const cheque of book.cheques) {
      expect(pages.chequePage(cheque.chequeNo), `cheque ${cheque.chequeNo}`).not.toBeNull();
    }
  });

  it("fills in the ledger's રોજમેળ પાનું column", () => {
    // Without a resolver the column is blank; with one, every row has a page.
    const withoutPages = ledger(book, "SWACHHATA");
    expect(withoutPages.rows.every((row) => row.rojmelPage === null)).toBe(true);

    const withPages = ledger(book, "SWACHHATA", { pages });
    expect(withPages.rows.every((row) => row.rojmelPage !== null)).toBe(true);
  });

  it("puts a later entry on a page at or after an earlier one", () => {
    const withPages = ledger(book, "SWACHHATA", { pages });
    const numbers = withPages.rows.map((row) => row.rojmelPage!);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
  });

  it("closes every head on the rojmel's last page, not on its own last entry's", () => {
    const last = rojmel.pages[rojmel.pages.length - 1]!.pageNo;
    for (const head of book.heads) {
      const account = ledger(book, head.code, { pages });
      expect(account.closingRojmelPage, head.code).toBe(last);
    }
    // Without a resolver there is no page to print.
    expect(ledger(book, "SWACHHATA").closingRojmelPage).toBeNull();
  });

  it("opens on page 1", () => {
    expect(pages.openingPage()).toBe(1);
    expect(pages.chequePage(103)).toBeGreaterThan(1);
  });
});

describe("the closing sentence", () => {
  it("states the year-end balance", () => {
    expect(rojmel.closingSentenceGu).toContain("31/03/2026");
    // Latin digits throughout, the paise too - never a Gujarati ".૦૦".
    expect(rojmel.closingSentenceGu).toContain("રૂપિયા 154.00 રહે છે.");
    expect(rojmel.closingSentenceGu).not.toMatch(/[૦-૯]/);
    expect(rojmel.closingSentenceGu).toContain(book.school.nameGu);
  });
});

describe("the nil-block rule is a setting, because SPEC 11.4 is open", () => {
  it("can be switched off, leaving only dates with transactions", () => {
    const bare = buildRojmel(book, { nilBlocks: "none" });
    expect(bare.blocks.every((block) => !block.isNil)).toBe(true);
    expect(new Set(bare.blocks.map((block) => block.fromDate)).size).toBe(
      Object.keys(expected.closing_balance_after_each_cashbook_date).length,
    );
    // The year still ends in the same place.
    expect(bare.blocks[bare.blocks.length - 1]!.closingBankPaise).toBe(rupeesToPaise(154));
  });

  it("omits intermediate gaps < 15 days, keeps month-end gaps, empty months, and month-starts >= 15 days", () => {
    const blockKeys = rojmel.blocks.map((b) => `${b.fromDate}->${b.toDate}`);

    // Intermediate gaps < 15 days MUST be omitted:
    expect(blockKeys).not.toContain("2025-06-10->2025-06-23"); // 14 days
    expect(blockKeys).not.toContain("2025-07-03->2025-07-15"); // 13 days
    expect(blockKeys).not.toContain("2025-07-17->2025-07-23"); // 7 days
    expect(blockKeys).not.toContain("2025-07-25->2025-07-28"); // 4 days
    expect(blockKeys).not.toContain("2025-08-06->2025-08-12"); // 7 days
    expect(blockKeys).not.toContain("2026-03-04->2026-03-17"); // 14 days
    expect(blockKeys).not.toContain("2026-03-19->2026-03-22"); // 4 days

    // Month-end gaps MUST be kept (even if < 15 days):
    expect(blockKeys).toContain("2025-06-25->2025-06-30"); // 6 days
    expect(blockKeys).toContain("2025-07-30->2025-07-31"); // 2 days
    expect(blockKeys).toContain("2025-08-14->2025-08-31"); // 18 days
    expect(blockKeys).toContain("2025-11-03->2025-11-30"); // 28 days
    expect(blockKeys).toContain("2025-12-21->2025-12-31"); // 11 days
    expect(blockKeys).toContain("2026-01-31->2026-01-31"); // 1 day
    expect(blockKeys).toContain("2026-02-27->2026-02-28"); // 2 days

    // Full empty months MUST be kept:
    expect(blockKeys).toContain("2025-09-01->2025-09-30");
    expect(blockKeys).toContain("2025-10-01->2025-10-31");

    // Month-starts >= 15 days MUST be kept:
    expect(blockKeys).toContain("2025-12-01->2025-12-19"); // 19 days
    expect(blockKeys).toContain("2026-01-01->2026-01-29"); // 29 days

    // Intermediate gaps >= 15 days MUST be kept:
    expect(blockKeys).toContain("2026-02-07->2026-02-25"); // 19 days

    // Month-starts < 15 days MUST NOT be present:
    expect(blockKeys).not.toContain("2025-05-01->2025-05-03"); // 3 days
    expect(blockKeys).not.toContain("2025-06-01->2025-06-08"); // 8 days
    expect(blockKeys).not.toContain("2025-07-01->2025-07-01"); // 1 day
  });

  it("supports SMC E old continuous-old nil-block rule with 01/04 & 31/03 blocks and 4+ day continuous gaps", () => {
    const sampleOld = buildRojmel(book, { nilBlocks: "continuous-old" });
    expect(sampleOld.blocks[0]!.fromDate).toBe(book.year.startDate);
    expect(sampleOld.blocks[0]!.toDate).toBe(book.year.startDate);
    expect(sampleOld.blocks[0]!.isNil).toBe(true);
    expect(sampleOld.blocks[sampleOld.blocks.length - 1]!.fromDate).toBe(book.year.endDate);
    expect(sampleOld.blocks[sampleOld.blocks.length - 1]!.toDate).toBe(book.year.endDate);
    expect(sampleOld.blocks[sampleOld.blocks.length - 1]!.isNil).toBe(true);
    expect(sampleOld.blocks[sampleOld.blocks.length - 1]!.closingBankPaise).toBe(
      rupeesToPaise(154),
    );
    // Khatavahi resolves pages cleanly against SMC E old rojmel too.
    const oldPages = pageResolver(sampleOld);
    const oldLastPage = sampleOld.pages[sampleOld.pages.length - 1]!.pageNo;
    const oldLedger = ledger(book, "SWACHHATA", { pages: oldPages });
    expect(oldLedger.rows.every((row) => row.rojmelPage !== null)).toBe(true);
    expect(oldLedger.closingRojmelPage).toBe(oldLastPage);

    // Synthetic book verifying every gap boundary for continuous-old:
    // - 01/04 dedicated opening nil block (01/04 -> 01/04)
    // - 02/04..07/04 is 6 days (>= 4) -> emitted as 2025-04-02->2025-04-07
    // - 08/04 and 09/04 consecutive days -> two active blocks, no nil block between them
    // - 10/04..11/04 is 2 days (<= 3) -> ignored
    // - 12/04 active, then 13/04..15/04 is 3 days (<= 3) -> ignored
    // - 16/04 active, then 17/04..20/04 is 4 days (>= 4) -> emitted as 2025-04-17->2025-04-20
    // - 21/04 active, then 22/04..2026-03-30 spans months continuously -> single nil block
    // - 31/03 dedicated closing nil block (31/03 -> 31/03)
    const templateReceipt = book.receipts[0]!;
    const makeReceipt = (id: string, date: string) => ({
      ...templateReceipt,
      id,
      date,
    });
    const synthetic = {
      ...book,
      receipts: [
        makeReceipt("r1", "2025-04-08"),
        makeReceipt("r2", "2025-04-09"),
        makeReceipt("r3", "2025-04-12"),
        makeReceipt("r4", "2025-04-16"),
        makeReceipt("r5", "2025-04-21"),
      ],
      bills: [],
      cheques: [],
      returnedCheques: [],
      bankCharges: [],
    };
    const syntheticRojmel = buildRojmel(synthetic, { nilBlocks: "continuous-old" });
    expect(
      syntheticRojmel.blocks.map((b) => `${b.fromDate}->${b.toDate}:${b.isNil ? "nil" : "act"}`),
    ).toEqual([
      "2025-04-01->2025-04-01:nil",
      "2025-04-02->2025-04-07:nil",
      "2025-04-08->2025-04-08:act",
      "2025-04-09->2025-04-09:act",
      "2025-04-12->2025-04-12:act",
      "2025-04-16->2025-04-16:act",
      "2025-04-17->2025-04-20:nil",
      "2025-04-21->2025-04-21:act",
      "2025-04-22->2026-03-30:nil",
      "2026-03-31->2026-03-31:nil",
    ]);

    // Empty year emits dedicated 01/04, continuous middle gap, and dedicated 31/03.
    const emptyRojmel = buildRojmel(
      { ...synthetic, receipts: [] },
      { nilBlocks: "continuous-old" },
    );
    expect(
      emptyRojmel.blocks.map((b) => `${b.fromDate}->${b.toDate}:${b.isNil ? "nil" : "act"}`),
    ).toEqual([
      "2025-04-01->2025-04-01:nil",
      "2025-04-02->2026-03-30:nil",
      "2026-03-31->2026-03-31:nil",
    ]);
  });
});

describe("the આવક side", () => {
  it("leaves a blank row after the opening balance and after the receipts", async () => {
    const { rojmelBlockRows } = await import("../../src/shared/rojmel-rows.js");
    const block = rojmel.blocks.find((candidate) => candidate.receiptLines.some((line) => line.source.kind === "receipt"))!;
    const left = rojmelBlockRows(block).map((row) => row.left?.descriptionGu ?? null);
    expect(left[0]).toBe("શ્રી ઉઘડતી સિલક");
    expect(left[1]).toBeNull();
    const receipts = block.receiptLines.filter((line) => line.source.kind === "receipt").length;
    for (let index = 2; index < 2 + receipts; index += 1) expect(left[index]).not.toBeNull();
    expect(left[2 + receipts]).toBeNull();
  });
});

describe("one block per cheque", () => {
  it("keeps a cheque's sub-vouchers (1/1, 1/2 ...) together in its one block", () => {
    const blocks = rojmel.blocks.filter((block) => block.paymentLines.some((line) => line.chequeText.startsWith("103")));
    expect(blocks).toHaveLength(1);
    const subVouchers = blocks[0]!.paymentLines.filter((line) => /^1\/\d+ /.test(line.referenceText));
    expect(subVouchers.length).toBe(21);
  });

  it("splits two cheques of the same date into two blocks, even under one voucher number", () => {
    const book2 = sampleBook();
    const second = book2.cheques.find((cheque) => cheque.chequeNo === 109)!;
    const first = book2.cheques.find((cheque) => cheque.chequeNo === 108)!;
    second.voucherNo = first.voucherNo;
    const blocks = buildRojmel(book2).blocks.filter((block) => block.fromDate === second.cashbookDate);
    expect(blocks.map((block) => block.paymentLines[0]!.chequeText.split(" ")[0])).toEqual(["108", "109"]);
  });

  it("always prints the cheque and voucher date beside their numbers", () => {
    const block = rojmel.blocks.find((candidate) => candidate.paymentLines.some((line) => line.chequeText.startsWith("103")))!;
    const chequeLine = block.paymentLines[0]!;
    expect(chequeLine.chequeText).toBe("103 09/06/2025");
    expect(chequeLine.referenceText).toBe("1 09/06/2025");
    const later = rojmel.blocks.find((candidate) => candidate.id === "2026-03-03")!;
    expect(later.paymentLines[0]!.chequeText).toBe("108 26/02/2026");
  });
});

describe("order of the cheques", () => {
  /** Each cheque number, in the order the cash book first prints it. */
  const printedOrder = (rojmel: ReturnType<typeof buildRojmel>): number[] => {
    const seen: number[] = [];
    for (const block of rojmel.blocks) {
      for (const line of block.paymentLines) {
        if (line.source.kind === "cheque" && !seen.includes(line.source.chequeNo)) {
          seen.push(line.source.chequeNo);
        }
      }
    }
    return seen;
  };

  it("follows the dates, not the cheque numbers", () => {
    const base = sampleBook();
    const [first, second] = base.cheques;
    // Cheque `second` is written on an earlier day than `first`.
    const cheques = [
      { ...first!, chequeDate: "2025-06-20", cashbookDate: "2025-06-20" },
      { ...second!, chequeDate: "2025-06-10", cashbookDate: "2025-06-10" },
      ...base.cheques.slice(2),
    ];
    const order = printedOrder(buildRojmel({ ...base, cheques }));
    expect(order.indexOf(second!.chequeNo)).toBeLessThan(order.indexOf(first!.chequeNo));
  });

  it("on one cash-book date, follows the voucher numbers, not the cheque dates or numbers", () => {
    const base = sampleBook();
    const [first, second] = base.cheques;
    // `second` has the earlier cheque date, but `first` has the lower voucher.
    const cheques = [
      { ...first!, chequeDate: "2025-06-20", cashbookDate: "2025-06-20", voucherNo: 1 },
      { ...second!, chequeDate: "2025-06-18", cashbookDate: "2025-06-20", voucherNo: 2 },
      ...base.cheques.slice(2),
    ];
    const order = printedOrder(buildRojmel({ ...base, cheques }));
    expect(order.indexOf(first!.chequeNo)).toBeLessThan(order.indexOf(second!.chequeNo));

    // Swap the vouchers and the order swaps, whatever the cheque numbers are.
    const swapped = [
      { ...cheques[0]!, voucherNo: 2 },
      { ...cheques[1]!, voucherNo: 1 },
      ...base.cheques.slice(2),
    ];
    const swappedOrder = printedOrder(buildRojmel({ ...base, cheques: swapped }));
    expect(swappedOrder.indexOf(second!.chequeNo)).toBeLessThan(swappedOrder.indexOf(first!.chequeNo));
  });
});

describe("voucher order", () => {
  const cheque = (voucherNo: number | null, chequeNo: number, ...billNos: string[]) => ({
    voucherNo,
    chequeNo,
    bills: billNos.map((billNo) => ({ billNo })),
  });

  it("sorts by voucher, then sub-voucher, then cheque number - with no voucher last", () => {
    const list = [
      cheque(null, 101),
      cheque(2, 102, "2/1"),
      cheque(1, 110, "1/10"),
      cheque(1, 105, "1/2"),
      cheque(1, 103, "1/2"),
    ];
    expect([...list].sort(byVoucherOrder).map((each) => each.chequeNo)).toEqual([103, 105, 110, 102, 101]);
  });
});

describe("description formatting for persons and shops", () => {
  it("uses first name with work description for individuals", () => {
    const block = rojmel.blocks.find((b) => b.paymentLines.some((l) => l.chequeText.startsWith("103")))!;
    // Bill B2 in sample is "હસમુખભાઈ મંગળભાઈ હરિજન" with description "સફાઈકામ મજૂરી"
    const hasmukhLine = block.paymentLines.find((l) => l.source.kind === "bill" && l.source.id === "B2")!;
    expect(hasmukhLine.descriptionGu).toBe("સફાઈકામ પેટે હસમુખભાઈને વા.મુજબ");
  });

  it("keeps full shop name for shops and includes specific material when present", () => {
    const block = rojmel.blocks.find((b) => b.paymentLines.some((l) => l.chequeText.startsWith("103")))!;
    // Bill B1 is "શ્રી વિદ્યાર્થી ટ્રેડર્સ" with description "પ્રવેશોત્સવ કીટ"
    const b1Line = block.paymentLines.find((l) => l.source.kind === "bill" && l.source.id === "B1")!;
    expect(b1Line.descriptionGu).toBe("શ્રી વિદ્યાર્થી ટ્રેડર્સને પ્રવેશોત્સવ કીટના બિલ મુજબ");

    // Bill B3 is "BM સુપર બજાર" with description "સ્વચ્છતા સામાન"
    const b3Line = block.paymentLines.find((l) => l.source.kind === "bill" && l.source.id === "B3")!;
    expect(b3Line.descriptionGu).toBe("BM સુપર બજારને બિલ મુજબ");
  });
});

describe("a reimbursement paid into the member secretary's bank (બેન્ક)", () => {
  const base = sampleBook();
  const reimbursement = base.cheques.find((cheque) => cheque.type === "REIMBURSEMENT")!;
  const book = {
    ...base,
    cheques: base.cheques.map((cheque) =>
      cheque.chequeNo === reimbursement.chequeNo ? { ...cheque, type: "REIMBURSEMENT_BANK" as const } : cheque,
    ),
  };
  const blockOf = (rojmel: ReturnType<typeof buildRojmel>) =>
    rojmel.blocks.find((block) =>
      block.paymentLines.some((line) => line.source.kind === "cheque" && line.source.chequeNo === reimbursement.chequeNo),
    )!;

  it("takes nothing into hand: no હાથ પર લીધા line, its bills in the bank column, no amount on the withdrawal", () => {
    const block = blockOf(buildRojmel(book));
    expect(block.receiptLines.some((line) => line.descriptionGu.includes("હાથ પર લીધા"))).toBe(false);
    const bills = block.paymentLines.filter((line) => line.source.kind === "bill");
    expect(bills.length).toBe(reimbursement.bills.length);
    expect(bills.every((line) => line.cashPaise === 0 && line.bankPaise > 0 && !line.headingOnly)).toBe(true);
    const withdrawal = block.paymentLines.find((line) => line.descriptionGu.includes("ઉપાડ્યા"))!;
    expect(withdrawal.headingOnly).toBe(true);
    expect(withdrawal.bankPaise).toBe(0);
    expect(block.spentCashPaise).toBe(0);
  });

  it("still pays the same amount out of the bank, so the year closes on the same balances", () => {
    const cashBlock = blockOf(buildRojmel(base));
    const bankBlock = blockOf(buildRojmel(book));
    expect(bankBlock.spentBankPaise).toBe(cashBlock.spentBankPaise);
    expect(yearEndBalance(book)).toEqual(yearEndBalance(base));
  });

  it("the cash version keeps its હાથ પર લીધા line", () => {
    const block = blockOf(buildRojmel(base));
    expect(block.receiptLines.some((line) => line.descriptionGu.includes("હાથ પર લીધા"))).toBe(true);
  });
});

describe("a reimbursement paying some bills in cash and some online", () => {
  const base = sampleBook();
  const reimbursement = base.cheques.find((cheque) => cheque.type === "REIMBURSEMENT" && cheque.bills.length >= 2)!;
  const [online, ...inCash] = reimbursement.bills;
  const mixed = {
    ...reimbursement,
    bills: reimbursement.bills.map((bill) => (bill.id === online!.id ? { ...bill, payMode: "BANK" as const } : bill)),
  };
  const book = {
    ...base,
    cheques: base.cheques.map((cheque) => (cheque.chequeNo === reimbursement.chequeNo ? mixed : cheque)),
  };
  const net = (bill: (typeof inCash)[number]) => bill.amountPaise - bill.deductionPaise;
  const cashTotal = inCash.reduce((total, bill) => total + net(bill), 0);
  const block = buildRojmel(book).blocks.find((each) =>
    each.paymentLines.some((line) => line.source.kind === "cheque" && line.source.chequeNo === reimbursement.chequeNo),
  )!;

  it("withdraws only the cash part, takes that in hand, and puts each bill in its own column", () => {
    const withdrawal = block.paymentLines.find((line) => line.descriptionGu.includes("ઉપાડ્યા"))!;
    expect(withdrawal.bankPaise).toBe(cashTotal);
    const inHand = block.receiptLines.find((line) => line.descriptionGu.includes("હાથ પર લીધા"))!;
    expect(inHand.cashPaise).toBe(cashTotal);

    const lineOf = (id: string) => block.paymentLines.find((line) => line.source.kind === "bill" && line.source.id === id)!;
    expect(lineOf(online!.id).bankPaise).toBe(net(online!));
    expect(lineOf(online!.id).cashPaise).toBe(0);
    for (const bill of inCash) {
      expect(lineOf(bill.id).cashPaise).toBe(net(bill));
      expect(lineOf(bill.id).bankPaise).toBe(0);
    }
  });

  it("still takes the whole cheque out of the bank, and leaves no cash behind", () => {
    expect(yearEndBalance(book)).toEqual(yearEndBalance(base));
    expect(balancesByDate(book).every((day) => day.cashPaise >= 0)).toBe(true);
  });
});
