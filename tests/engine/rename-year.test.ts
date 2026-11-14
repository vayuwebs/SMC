/**
 * Renaming a year typed with the wrong label.
 *
 * Tested against a real database, because the point is what the database ends
 * up holding: the year's new label and dates, and every entry's dates moved
 * with it, so the year's books still fall inside the year.
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
import type { SetupInput } from "../../src/shared/api.js";

const DB = path.join(process.cwd(), ".rename-year-test.db");
const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

function cleanUp(): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB + suffix, { force: true });
}

const SETUP: SetupInput = {
  school: {
    nameGu: "પરીક્ષા પ્રા. શાળા",
    smcLabelGu: "SMCE પરીક્ષા પ્રા. શાળા",
    diseCode: "24160299999",
    clusterGu: "પરીક્ષા ક્લસ્ટર",
    talukaGu: "કપડવંજ",
    districtGu: "ખેડા",
    programmeGu: "સમગ્ર શિક્ષા ખેડા – SMCE",
    memberSecretaryGu: "પટેલ રમેશભાઈ",
    memberSecretaryShortGu: "સભ્ય સચિવ રમેશ.પટેલ",
    memberSecretaryMobile: "9999999999",
  },
  bank: { bankNameGu: "Bank of Baroda (BOB)", branchGu: "અંતિસર", accountNo: "11590100009999" },
  // Typed wrong: the books are really 2025-26's.
  year: { label: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31" },
  grantHeads: DEFAULT_GRANT_HEADS.map((head) => ({ ...head })),
  openingBalances: [{ code: "SWACHHATA", bankPaise: rupeesToPaise(5000), cashPaise: 0 }],
};

let prisma: PrismaClient;
let accounts: AccountsService;
let yearId: number;
let olderYearId: number;

beforeAll(async () => {
  cleanUp();
  runMigrations(DB, MIGRATIONS);
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });

  const result = await new SetupService(prisma).completeSetup(SETUP);
  expect(result.ok, JSON.stringify(result)).toBe(true);

  const year = await prisma.financialYear.findFirstOrThrow();
  yearId = year.id;
  accounts = new AccountsService(prisma, yearId);

  const older = await prisma.financialYear.create({
    data: { schoolId: year.schoolId, label: "2020-21", startDate: "2020-04-01", endDate: "2021-03-31", status: "CLOSED" },
  });
  olderYearId = older.id;

  const swachhata = (await accounts.listGrantHeads()).find((head) => head.code === "SWACHHATA")!;
  const receipt = await accounts.createReceipt({
    date: "2027-06-10",
    grantHeadId: swachhata.id,
    amountPaise: rupeesToPaise(1000),
    receivedFromGu: "SSA",
    modeGu: "ઓનલાઈન",
    bankLabelGu: "BOB અંતિસર",
    allotmentOrderDate: "2027-06-01",
    creditedDate: "2027-06-11",
  });
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);

  const bill = await accounts.createBill({
    voucherNo: 1,
    billNo: "1/2",
    billDate: "2027-07-01",
    descriptionGu: "સ્વચ્છતા સામાન",
    vendorGu: "શ્રી રામ સ્ટોર્સ",
    grantHeadId: swachhata.id,
    amountPaise: rupeesToPaise(500),
    deductionPaise: 0,
  });
  expect(bill.ok, JSON.stringify(bill)).toBe(true);

  const cheque = await accounts.createCheque({
    chequeNo: 101,
    chequeDate: "2027-07-02",
    cashbookDate: "2027-07-03",
    cashedDate: "2027-07-05",
    voucherNo: 1,
    payeeGu: "રમેશ",
    purposeGu: "સ્વચ્છતા સામાન",
    type: "REIMBURSEMENT",
    billIds: bill.ok ? [bill.data.id] : [],
  });
  expect(cheque.ok, JSON.stringify(cheque)).toBe(true);

  // 29 February 2028: the year it moves to has no 29th.
  const charge = await accounts.createBankCharge({
    date: "2028-02-29",
    grantHeadId: swachhata.id,
    amountPaise: 1770,
    descriptionGu: "બેન્ક ચાર્જ",
  });
  expect(charge.ok, JSON.stringify(charge)).toBe(true);
});

afterAll(async () => {
  await prisma.$disconnect();
  cleanUp();
});

describe("renaming a year", () => {
  it("refuses a label that is not a financial year", async () => {
    for (const label of ["2025", "25-26", "2025-27", "2025/26"]) {
      const result = await accounts.renameYear(label);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.issues[0]!.code).toBe("bad_year_label");
    }
  });

  it("refuses a label another year already has", async () => {
    const result = await accounts.renameYear("2020-21");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe("year_exists");
  });

  it("refuses to rename a closed year", async () => {
    const result = await new AccountsService(prisma, olderYearId).renameYear("2019-20");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe("year_closed");
  });

  it("changes the label and 1 April / 31 March, and moves every date entered in the year", async () => {
    const before = await accounts.getAnnexure10();

    const result = await accounts.renameYear(" 2025-26 ");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ id: yearId, label: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" });

    const [receipt] = await accounts.listReceipts();
    expect(receipt).toMatchObject({ date: "2025-06-10", allotmentOrderDate: "2025-06-01", creditedDate: "2025-06-11" });

    const [bill] = await accounts.listBills();
    expect(bill).toMatchObject({ billDate: "2025-07-01", billNo: "1/2" });

    const [cheque] = await accounts.listCheques();
    // ચેક વટાવ્યાં તારીખ is the rojmel date, whatever was sent.
    expect(cheque).toMatchObject({ chequeDate: "2025-07-02", cashbookDate: "2025-07-03", cashedDate: "2025-07-03" });

    const [charge] = await accounts.listBankCharges();
    expect(charge!.date).toBe("2026-02-28");

    // Same books, same figures - only the year they are dated in moved.
    expect(await accounts.getAnnexure10()).toEqual(before);
    expect((await accounts.getValidation()).filter((issue) => issue.severity === "error")).toEqual([]);

    // The other year is untouched.
    const older = await prisma.financialYear.findUniqueOrThrow({ where: { id: olderYearId } });
    expect(older.label).toBe("2020-21");
  });

  it("accepts its own label as no change", async () => {
    const result = await accounts.renameYear("2025-26");
    expect(result.ok && result.data.label).toBe("2025-26");
    expect((await accounts.listBankCharges())[0]!.date).toBe("2026-02-28");
  });
});
