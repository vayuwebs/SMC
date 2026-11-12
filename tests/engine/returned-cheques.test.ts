/**
 * A cheque the bank sends back unpaid, and the cheque written in its place.
 *
 * The client's rule: the return shows only in the rojmel and the heads'
 * ledgers - an આવક line "ચેક નં. N રિટર્ન થયાના નાણાં જમા" on the day the
 * bank sent it back. Every other report shows only the replacement, which keeps
 * the returned cheque's voucher number, bills and split. So the expense is
 * counted once and Annexure 10 still agrees with the ledgers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { runMigrations } from "../../electron/migrate.js";
import { SetupService } from "../../src/server/setup-service.js";
import { AccountsService } from "../../src/server/accounts-service.js";
import { DEFAULT_GRANT_HEADS } from "../../src/lib/default-grant-heads.js";
import { rupeesToPaise } from "../../src/lib/money.js";
import {
  annexure10,
  balanceOn,
  billRegister,
  buildRojmel,
  chequeAllocation,
  chequeAmount,
  chequeRegister,
  grantRegister,
  ledger,
  loadYearBook,
  pageResolver,
  patrakD,
  validate,
  vouchers,
  yearEndBalance,
} from "../../src/engine/index.js";
import { cashPart } from "../../src/engine/allocation.js";
import type { YearBook } from "../../src/engine/types.js";
import type { ChequeInput, SetupInput } from "../../src/shared/api.js";
import { sampleBook } from "../fixtures/sample-book.js";

const REPLACEMENT_NO = 999;

/** The sample year with its first reimbursement cheque returned and written again. */
function withReturn(): { book: YearBook; returnedNo: number; returnedOn: string; rewrittenOn: string } {
  const plain = sampleBook();
  const original = plain.cheques.find((cheque) => cheque.type === "REIMBURSEMENT")!;
  const returnedOn = "2025-06-20";
  const rewrittenOn = "2025-06-25";
  const replacement = {
    ...original,
    chequeNo: REPLACEMENT_NO,
    chequeDate: rewrittenOn,
    cashbookDate: rewrittenOn,
    bills: original.bills.map((bill) => ({ ...bill, chequeNo: REPLACEMENT_NO })),
  };
  return {
    book: {
      ...plain,
      cheques: [...plain.cheques.filter((cheque) => cheque !== original), replacement],
      returnedCheques: [{ ...original, returnedDate: returnedOn, replacedByChequeNo: REPLACEMENT_NO }],
      bills: plain.bills.map((bill) =>
        bill.chequeNo === original.chequeNo ? { ...bill, chequeNo: REPLACEMENT_NO } : bill,
      ),
    },
    returnedNo: original.chequeNo,
    returnedOn,
    rewrittenOn,
  };
}

describe("a returned cheque, in the engine", () => {
  const plain = sampleBook();
  const { book, returnedNo, returnedOn, rewrittenOn } = withReturn();
  const returned = book.returnedCheques[0]!;
  const amount = chequeAmount(returned);
  const text = `ચેક નં. ${returnedNo} રિટર્ન થયાના નાણાં જમા`;
  const ledgerText = text;

  it("prints its money coming back as an આવક line on the return date", () => {
    const rojmel = buildRojmel(book);
    const block = rojmel.blocks.find((each) => each.fromDate === returnedOn && !each.isNil)!;
    const line = block.receiptLines.find((each) => each.descriptionGu === text)!;
    expect(line.bankPaise).toBe(amount);
    expect(line.cashPaise).toBe(0);
    expect(line.chequeText).toBe(String(returnedNo));
    // Nowhere in the jāvak side, and only once.
    const all = rojmel.blocks.flatMap((each) => [...each.receiptLines, ...each.paymentLines]);
    expect(all.filter((each) => each.descriptionGu === text)).toHaveLength(1);
  });

  it("still prints the returned cheque, and the replacement under the same voucher number", () => {
    const rojmel = buildRojmel(book);
    const voucherOf = (chequeNo: number): string =>
      rojmel.blocks
        .flatMap((each) => each.paymentLines)
        .find((line) => line.source.kind === "cheque" && line.source.chequeNo === chequeNo && line.referenceText !== "")!
        .referenceText.split(" ")[0]!;
    expect(voucherOf(REPLACEMENT_NO)).toBe(voucherOf(returnedNo));
    expect(voucherOf(REPLACEMENT_NO)).toBe(String(returned.voucherNo));
  });

  it("credits each head its share back in the ledger, on the return page", () => {
    const pages = pageResolver(buildRojmel(book));
    for (const [headCode, share] of chequeAllocation(returned)) {
      const account = ledger(book, headCode, { pages });
      const row = account.rows.find((each) => each.descriptionGu === ledgerText)!;
      expect(row.creditPaise).toBe(share);
      expect(row.date).toBe(returnedOn);
      expect(row.rojmelPage).toBe(pages.chequeReturnPage(returnedNo));
      // Paid twice, refunded once: the head ends where it did with one cheque.
      expect(account.closingPaise).toBe(ledger(plain, headCode).closingPaise);
    }
  });

  it("is back in the bank on the return date, out again with the replacement", () => {
    // The original went out on its own date in both books; here it came back
    // on returnedOn and the replacement has not been written yet.
    expect(returned.cashbookDate < returnedOn).toBe(true);
    expect(balanceOn(book, returned.cashbookDate).bankPaise).toBe(balanceOn(plain, returned.cashbookDate).bankPaise);
    expect(balanceOn(book, returnedOn).bankPaise).toBe(balanceOn(plain, returnedOn).bankPaise + amount);
    expect(balanceOn(book, rewrittenOn).bankPaise).toBe(balanceOn(plain, rewrittenOn).bankPaise);
    expect(yearEndBalance(book)).toEqual(yearEndBalance(plain));
  });

  it("leaves every other report as if only the replacement had been written", () => {
    expect(annexure10(book)).toEqual(annexure10(plain));
    expect(grantRegister(book)).toEqual(grantRegister(plain));
    // પત્રક-D lists the replacement in its own cheque-number place.
    const total = (rows: { amountPaise: number }[]): number => rows.reduce((sum, row) => sum + row.amountPaise, 0);
    expect(total(patrakD(book))).toBe(total(patrakD(plain)));
    expect(patrakD(book).some((row) => row.chequeNo === returnedNo)).toBe(false);
    expect(patrakD(book).some((row) => row.chequeNo === REPLACEMENT_NO)).toBe(true);

    const register = chequeRegister(book);
    expect(register.some((row) => row.chequeNo === returnedNo)).toBe(false);
    const row = register.find((each) => each.chequeNo === REPLACEMENT_NO)!;
    expect(row.voucherNo).toBe(returned.voucherNo);
    expect(row.amountPaise).toBe(amount);

    expect(billRegister(book).length).toBe(billRegister(plain).length);
    expect(vouchers(book).length).toBe(vouchers(plain).length);
  });

  it("raises no error, and keeps the returned number in the cheque sequence", () => {
    const result = validate(book);
    expect(result.errors).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).not.toContain("replacement_before_return");
    // The replacement shares its voucher number with the returned cheque by design.
    expect(result.issues.map((issue) => issue.code)).not.toContain("duplicate_voucher_no");
    expect(validate(plain).issues.map((issue) => issue.code)).not.toContain("duplicate_voucher_no");
  });

  it("warns when a bounced cheque is entered again without being marked returned", () => {
    // What the customer's book holds: both cheques standing under one voucher.
    const twice: YearBook = { ...book, cheques: [...book.cheques, returned], returnedCheques: [] };
    const warning = validate(twice).warnings.find((issue) => issue.code === "duplicate_voucher_no")!;
    expect(warning.messageGu).toContain(`વાઉચર નંબર ${returned.voucherNo}`);
    expect(warning.messageGu).toContain(`${returnedNo}, ${REPLACEMENT_NO}`);
  });

  it("warns when the replacement is entered before the cheque came back", () => {
    const early = withReturn().book;
    early.returnedCheques[0] = { ...early.returnedCheques[0]!, returnedDate: "2025-06-30" };
    expect(validate(early).issues.map((issue) => issue.code)).toContain("replacement_before_return");
  });
});

// ------------------------------------------------------------------ database

const DB = path.join(process.cwd(), ".returned-cheques-test.db");
const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

function cleanUp(): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB + suffix, { force: true });
}

const SETUP: SetupInput = {
  school: {
    nameGu: "પરીક્ષા પ્રા. શાળા",
    smcLabelGu: "SMCE પરીક્ષા પ્રા. શાળા",
    diseCode: "24160299998",
    clusterGu: "પરીક્ષા ક્લસ્ટર",
    talukaGu: "કપડવંજ",
    districtGu: "ખેડા",
    programmeGu: "સમગ્ર શિક્ષા ખેડા – SMCE",
    memberSecretaryGu: "પટેલ રમેશભાઈ",
    memberSecretaryShortGu: "સભ્ય સચિવ રમેશ.પટેલ",
    memberSecretaryMobile: "9999999999",
  },
  bank: { bankNameGu: "Bank of Baroda (BOB)", branchGu: "અંતિસર", accountNo: "11590100009998" },
  year: { label: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
  grantHeads: DEFAULT_GRANT_HEADS.map((head) => ({ ...head })),
  openingBalances: [{ code: "SWACHHATA", bankPaise: rupeesToPaise(2000), cashPaise: 0 }],
};

let prisma: PrismaClient;
let accounts: AccountsService;
let yearId: number;

beforeAll(async () => {
  cleanUp();
  runMigrations(DB, MIGRATIONS);
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  const result = await new SetupService(prisma).completeSetup(SETUP);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  yearId = (await prisma.financialYear.findFirstOrThrow()).id;
  accounts = new AccountsService(prisma, yearId);
});

afterAll(async () => {
  await prisma.$disconnect();
  cleanUp();
});

describe("a returned cheque, saved and written again", () => {
  let originalId = 0;
  let billId = 0;

  const chequeInput = (overrides: Partial<ChequeInput> = {}): ChequeInput => ({
    chequeNo: 101,
    chequeDate: "2026-05-02",
    cashbookDate: "2026-05-02",
    voucherNo: 1,
    payeeGu: "રમેશ",
    purposeGu: "સ્વચ્છતા સામાન",
    type: "REIMBURSEMENT",
    billIds: [billId],
    ...overrides,
  });

  it("is a cheque with its bills, then marked returned", async () => {
    const heads = await accounts.listGrantHeads();
    const swachhata = heads.find((head) => head.code === "SWACHHATA")!;
    const bill = await accounts.createBill({
      voucherNo: 1,
      billNo: "1/1",
      billDate: "2026-05-01",
      descriptionGu: "સ્વચ્છતા સામાન",
      vendorGu: "શ્રી રામ સ્ટોર્સ",
      grantHeadId: swachhata.id,
      amountPaise: rupeesToPaise(500),
      deductionPaise: 0,
    });
    expect(bill.ok, JSON.stringify(bill)).toBe(true);
    billId = bill.ok ? bill.data.id : 0;

    const created = await accounts.createCheque(chequeInput());
    expect(created.ok, JSON.stringify(created)).toBe(true);
    originalId = created.ok ? created.data.id : 0;

    const early = await accounts.updateCheque(originalId, chequeInput({ returnedDate: "2026-05-01" }));
    expect(early.ok).toBe(false);

    const returned = await accounts.updateCheque(originalId, chequeInput({ returnedDate: "2026-05-10" }));
    expect(returned.ok, JSON.stringify(returned)).toBe(true);
  });

  it("is replaced by a new cheque that keeps its voucher number, bills and amount", async () => {
    // What the screen sends: its own number and dates; anything else is the returned cheque's.
    const created = await accounts.createCheque(
      chequeInput({
        chequeNo: 102,
        chequeDate: "2026-05-12",
        cashbookDate: "2026-05-12",
        voucherNo: 7,
        type: "DIRECT",
        billIds: [],
        replacesChequeId: originalId,
      }),
    );
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    expect(created.data.voucherNo).toBe(1);
    expect(created.data.type).toBe("REIMBURSEMENT");
    expect(created.data.amountPaise).toBe(rupeesToPaise(500));
    expect(created.data.replacesChequeNo).toBe(101);

    const list = await accounts.listCheques();
    expect(list.find((cheque) => cheque.chequeNo === 101)!.replacedByChequeNo).toBe(102);
    // The bill is still stored once, against the cheque first written for it,
    // and shows the cheque that now pays it.
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).chequeId).toBe(originalId);
    expect((await accounts.listBills()).find((bill) => bill.id === billId)!.chequeNo).toBe(102);
  });

  it("reaches the reports through the database as the engine test expects", async () => {
    const book = await loadYearBook(prisma, yearId);
    expect(book.cheques.map((cheque) => cheque.chequeNo)).toEqual([102]);
    expect(book.returnedCheques.map((cheque) => cheque.chequeNo)).toEqual([101]);
    expect(book.cheques[0]!.voucherNo).toBe(1);
    expect(book.bills[0]!.chequeNo).toBe(102);

    const swachhata = ledger(book, "SWACHHATA");
    expect(swachhata.rows.map((row) => [row.descriptionGu, row.creditPaise, row.debitPaise])).toContainEqual([
      "ચેક નં. 101 રિટર્ન થયાના નાણાં જમા",
      rupeesToPaise(500),
      0,
    ]);
    expect(swachhata.closingPaise).toBe(rupeesToPaise(1500));
    expect(annexure10(book).totals.spentPaise).toBe(rupeesToPaise(500));
    expect(validate(book).errors).toEqual([]);
  });

  it("refuses a second replacement, un-returning a replaced cheque, and deleting it", async () => {
    const second = await accounts.createCheque(
      chequeInput({ chequeNo: 103, chequeDate: "2026-05-13", cashbookDate: "2026-05-13", replacesChequeId: originalId }),
    );
    expect(second.ok).toBe(false);

    const unreturned = await accounts.updateCheque(originalId, chequeInput({ returnedDate: null }));
    expect(unreturned.ok).toBe(false);

    const deleted = await accounts.deleteCheque(originalId);
    expect(deleted.ok).toBe(false);
  });

  it("refuses to replace a cheque that was not returned", async () => {
    const plainCheque = await prisma.cheque.findFirstOrThrow({ where: { chequeNo: 102 } });
    const result = await accounts.createCheque(
      chequeInput({ chequeNo: 104, chequeDate: "2026-05-14", cashbookDate: "2026-05-14", replacesChequeId: plainCheque.id }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("a grant return takes no bill", () => {
  const returnInput = (overrides: Partial<ChequeInput> = {}): ChequeInput => ({
    chequeNo: 120,
    chequeDate: "2026-06-01",
    cashbookDate: "2026-06-01",
    voucherNo: 9,
    payeeGu: "સી.આર.સી કો.ઓર્ડિનેટર",
    purposeGu: "બચત ગ્રાન્ટ પરત",
    type: "GRANT_RETURN",
    billIds: [],
    typedAllocation: [],
    ...overrides,
  });

  it("refuses a bill under a grant return's voucher, and a grant return on a voucher with bills", async () => {
    const heads = await accounts.listGrantHeads();
    const swachhata = heads.find((head) => head.code === "SWACHHATA")!;
    const created = await accounts.createCheque(
      returnInput({ typedAllocation: [{ grantHeadId: swachhata.id, amountPaise: rupeesToPaise(100) }] }),
    );
    expect(created.ok, JSON.stringify(created)).toBe(true);

    const bill = await accounts.createBill({
      voucherNo: 9,
      billNo: null,
      billDate: "2026-06-01",
      descriptionGu: "બચત ગ્રાન્ટ પરત",
      vendorGu: "સી.આર.સી કો.ઓર્ડિનેટર",
      grantHeadId: swachhata.id,
      amountPaise: rupeesToPaise(100),
      deductionPaise: 0,
    });
    expect(bill.ok).toBe(false);
    if (!bill.ok) expect(bill.issues[0]!.code).toBe("bill_on_grant_return_voucher");

    // Voucher 1 already has a bill (the returned cheque's above).
    const onBills = await accounts.createCheque(
      returnInput({
        chequeNo: 121,
        voucherNo: 1,
        typedAllocation: [{ grantHeadId: swachhata.id, amountPaise: rupeesToPaise(100) }],
      }),
    );
    expect(onBills.ok).toBe(false);
    if (!onBills.ok) expect(onBills.issues[0]!.code).toBe("grant_return_on_bill_voucher");
  });

  it("flags a bill already sitting under a grant return's voucher", () => {
    const base = sampleBook();
    const grantReturn = base.cheques.find((cheque) => cheque.type === "GRANT_RETURN")!;
    const book = {
      ...base,
      bills: [
        ...base.bills,
        { ...base.bills[0]!, id: "X", voucherNo: grantReturn.voucherNo!, billNo: null, chequeNo: null },
      ],
    };
    const codes = validate(book).errors.map((issue) => issue.code);
    expect(codes).toContain("bill_on_grant_return_voucher");
    expect(validate(base).errors.map((issue) => issue.code)).not.toContain("bill_on_grant_return_voucher");
  });
});

describe("a reimbursement that paid some bills in cash and some online", () => {
  it("keeps how each bill was paid, and lets the cheque's type decide when it is not said", async () => {
    const heads = await accounts.listGrantHeads();
    const swachhata = heads.find((head) => head.code === "SWACHHATA")!;
    const bill = async (billNo: string, rupees: number): Promise<number> => {
      const created = await accounts.createBill({
        voucherNo: 20,
        billNo,
        billDate: "2026-07-01",
        descriptionGu: "સ્વચ્છતા સામાન",
        vendorGu: "શ્રી રામ સ્ટોર્સ",
        grantHeadId: swachhata.id,
        amountPaise: rupeesToPaise(rupees),
        deductionPaise: 0,
      });
      expect(created.ok, JSON.stringify(created)).toBe(true);
      return created.ok ? created.data.id : 0;
    };
    const cash = await bill("20/1", 300);
    const online = await bill("20/2", 200);

    const input: ChequeInput = {
      chequeNo: 130,
      chequeDate: "2026-07-02",
      cashbookDate: "2026-07-02",
      voucherNo: 20,
      payeeGu: "સભ્ય સચિવ",
      purposeGu: "પદર ખર્ચ પરત",
      type: "REIMBURSEMENT",
      billIds: [cash, online],
      bankBillIds: [online],
    };
    const created = await accounts.createCheque(input);
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;

    const modes = new Map((await accounts.listBills()).map((each) => [each.id, each.payMode]));
    expect(modes.get(cash)).toBe("CASH");
    expect(modes.get(online)).toBe("BANK");

    const cheque = (await loadYearBook(prisma, yearId)).cheques.find((each) => each.chequeNo === 130)!;
    expect(cashPart(cheque)).toBe(rupeesToPaise(300));

    // Saved without saying (an older screen, the import): each bill follows the type.
    const plain = await accounts.updateCheque(created.data.id, { ...input, type: "REIMBURSEMENT_BANK", bankBillIds: undefined });
    expect(plain.ok, JSON.stringify(plain)).toBe(true);
    const again = (await loadYearBook(prisma, yearId)).cheques.find((each) => each.chequeNo === 130)!;
    expect(again.bills.every((each) => each.payMode === null)).toBe(true);
    expect(cashPart(again)).toBe(0);
  });
});
