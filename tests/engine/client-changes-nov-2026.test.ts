/**
 * The client's November 2026 changes:
 *
 *   1. A cheque written again for a returned one keeps the returned cheque's
 *      voucher date (rojmel pages 13-14: voucher 8 stays 07/10, not 12/10).
 *   4/5. A bank charge carries its own description and is taken from વ્યાજ
 *      first; what વ્યાજ cannot bear goes to a grant the school picks.
 *   6. ચેક વટાવ્યાં તારીખ is no longer typed: it is the rojmel date.
 *   7. Grant receipts travel from one school to another as a file.
 *   9. A shop's name is never cut to its first word.
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
  annexure9,
  buildRojmel,
  chequeRegister,
  headBalanceOn,
  ledger,
  loadYearBook,
  validate,
  vouchers,
} from "../../src/engine/index.js";
import { classifyPayee, rojmelPayeeName } from "../../src/engine/payee.js";
import { formatRojmelBillDescription } from "../../src/engine/rojmel.js";
import { parseGrantShare } from "../../src/shared/grant-share.js";
import type { ChequeInput, SetupInput } from "../../src/shared/api.js";

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

function setupFor(diseCode: string, nameGu: string): SetupInput {
  return {
    school: {
      nameGu,
      smcLabelGu: `SMCE ${nameGu}`,
      diseCode,
      clusterGu: "પરીક્ષા ક્લસ્ટર",
      talukaGu: "કપડવંજ",
      districtGu: "ખેડા",
      programmeGu: "સમગ્ર શિક્ષા ખેડા – SMCE",
      memberSecretaryGu: "પટેલ રમેશભાઈ",
      memberSecretaryShortGu: "સભ્ય સચિવ રમેશ.પટેલ",
      memberSecretaryMobile: "9999999999",
    },
    bank: { bankNameGu: "Bank of Baroda (BOB)", branchGu: "અંતિસર", accountNo: `1159010000${diseCode.slice(-4)}` },
    year: { label: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
    grantHeads: DEFAULT_GRANT_HEADS.map((head) => ({ ...head })),
    openingBalances: [
      { code: "SWACHHATA", bankPaise: rupeesToPaise(20000), cashPaise: 0 },
      { code: "INTEREST", bankPaise: rupeesToPaise(10), cashPaise: 0 },
    ],
  };
}

interface School {
  db: string;
  prisma: PrismaClient;
  accounts: AccountsService;
  yearId: number;
}

const schools: School[] = [];

async function openSchool(name: string, diseCode: string): Promise<School> {
  const db = path.join(process.cwd(), `.client-changes-${diseCode}.db`);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });
  runMigrations(db, MIGRATIONS);
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${db}` }) });
  const result = await new SetupService(prisma).completeSetup(setupFor(diseCode, name));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const yearId = (await prisma.financialYear.findFirstOrThrow()).id;
  const school = { db, prisma, accounts: new AccountsService(prisma, yearId), yearId };
  schools.push(school);
  return school;
}

let a: School;
let b: School;

beforeAll(async () => {
  a = await openSchool("પહેલી પ્રા. શાળા", "24160200001");
  b = await openSchool("બીજી પ્રા. શાળા", "24160200002");
});

afterAll(async () => {
  for (const school of schools) {
    await school.prisma.$disconnect();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(school.db + suffix, { force: true });
  }
});

const headId = async (school: School, code: string): Promise<number> =>
  (await school.accounts.listGrantHeads()).find((head) => head.code === code)!.id;

describe("1 + 6: a returned cheque written again, and the single date", () => {
  it("keeps the returned cheque's voucher date; the encashed date is the rojmel date", async () => {
    const bill = await a.accounts.createBill({
      voucherNo: 8,
      billNo: null,
      billDate: "2026-10-07",
      descriptionGu: "સેનેટરી પેડ",
      vendorGu: "પ્રધાનમંત્રી ભારતીય જનઔષધી કેન્દ્ર",
      grantHeadId: await headId(a, "SWACHHATA"),
      amountPaise: rupeesToPaise(15840),
      deductionPaise: 0,
    });
    expect(bill.ok, JSON.stringify(bill)).toBe(true);
    const input: ChequeInput = {
      chequeNo: 108,
      chequeDate: "2026-10-07",
      cashbookDate: "2026-10-07",
      voucherNo: 8,
      payeeGu: "પ્રધાનમંત્રી ભારતીય જનઔષધી કેન્દ્ર",
      purposeGu: "સેનેટરી પેડ",
      type: "DIRECT",
      billIds: [bill.ok ? bill.data.id : 0],
      // An older screen may still send one; it is not kept.
      cashedDate: "2026-12-31",
    };
    const first = await a.accounts.createCheque(input);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    if (!first.ok) return;
    expect(first.data.cashedDate).toBe("2026-10-07");

    const returned = await a.accounts.updateCheque(first.data.id, { ...input, returnedDate: "2026-10-10" });
    expect(returned.ok, JSON.stringify(returned)).toBe(true);
    const again = await a.accounts.createCheque({
      ...input,
      chequeNo: 110,
      chequeDate: "2026-10-12",
      cashbookDate: "2026-10-12",
      billIds: [],
      replacesChequeId: first.data.id,
    });
    expect(again.ok, JSON.stringify(again)).toBe(true);

    const book = await loadYearBook(a.prisma, a.yearId);
    const cheque = book.cheques.find((each) => each.chequeNo === 110)!;
    expect(cheque.voucherDate).toBe("2026-10-07");
    expect(cheque.cashedDate).toBe("2026-10-12");

    const lines = buildRojmel(book).blocks.flatMap((block) => block.paymentLines);
    const head = lines.find((line) => line.source.kind === "cheque" && line.source.chequeNo === 110 && line.referenceText !== "")!;
    expect(head.referenceText).toBe("8 07/10/2026");
    expect(head.chequeText).toBe("110 12/10/2026");
    // The shop's whole name, not "પ્રધાનમંત્રીને".
    expect(lines.some((line) => line.descriptionGu.startsWith("પ્રધાનમંત્રી ભારતીય જનઔષધી કેન્દ્રને"))).toBe(true);

    expect(vouchers(book).find((voucher) => voucher.voucherNo === 8)!.voucherDate).toBe("2026-10-07");
    const row = chequeRegister(book).find((each) => each.chequeNo === 110)!;
    expect(row.cashedDate).toBe("2026-10-12");
    expect(annexure9(book).suggestedUnencashedPaise).toBe(0);
  });
});

describe("4 + 5: a bank charge taken from વ્યાજ first", () => {
  it("says what વ્યાજ can still bear, and splits what it cannot", async () => {
    const interest = await headId(a, "INTEREST");
    const swachhata = await headId(a, "SWACHHATA");

    const available = await a.accounts.interestAvailable("2026-11-01", null);
    expect(available).toEqual({ grantHeadId: interest, availablePaise: rupeesToPaise(10) });

    const description = "બેંક દ્વારા પાસબુક ઇશ્યૂ ચાર્જ કપાયો";
    const sameHead = await a.accounts.createBankCharge({
      date: "2026-11-01",
      grantHeadId: interest,
      amountPaise: rupeesToPaise(25),
      otherGrantHeadId: interest,
      otherAmountPaise: rupeesToPaise(15),
      descriptionGu: description,
    });
    expect(sameHead.ok).toBe(false);

    const created = await a.accounts.createBankCharge({
      date: "2026-11-01",
      grantHeadId: interest,
      amountPaise: rupeesToPaise(25),
      otherGrantHeadId: swachhata,
      otherAmountPaise: rupeesToPaise(15),
      descriptionGu: description,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    expect(created.data.otherHeadNameGu).not.toBeNull();
    expect(created.data.otherAmountPaise).toBe(rupeesToPaise(15));

    // Editing it, its own charge is left out of what વ્યાજ has.
    expect((await a.accounts.interestAvailable("2026-11-01", created.data.id)).availablePaise).toBe(rupeesToPaise(10));
    expect((await a.accounts.interestAvailable("2026-11-01", null)).availablePaise).toBe(0);

    const book = await loadYearBook(a.prisma, a.yearId);
    expect(headBalanceOn(book, "INTEREST", "2026-11-01")).toBe(0);
    const lines = buildRojmel(book)
      .blocks.flatMap((block) => block.paymentLines)
      .filter((line) => line.source.kind === "charge");
    expect(lines.map((line) => [line.descriptionGu.startsWith(description), line.bankPaise])).toEqual([
      [true, rupeesToPaise(10)],
      [true, rupeesToPaise(15)],
    ]);
    expect(ledger(book, "SWACHHATA").rows.some((row) => row.descriptionGu === description && row.debitPaise === rupeesToPaise(15))).toBe(true);
    expect(validate(book).errors).toEqual([]);

    // A head a charge uses cannot be deleted.
    const refused = await a.accounts.deleteGrantHead(swachhata);
    expect(refused.ok).toBe(false);
  });
});

describe("7: grant receipts shared between schools", () => {
  it("carries every receipt to another school once, matching its heads", async () => {
    const swachhata = await headId(a, "SWACHHATA");
    for (const [date, rupees] of [
      ["2026-06-10", 5000],
      ["2026-09-15", 7500],
    ] as const) {
      const receipt = await a.accounts.createReceipt({
        date,
        grantHeadId: swachhata,
        amountPaise: rupeesToPaise(rupees),
        receivedFromGu: "SSA",
        modeGu: "ઓનલાઈન",
        bankLabelGu: "BOB અંતિસર",
        allotmentOrderNo: "SSA/123",
        allotmentOrderDate: "2026-06-01",
      });
      expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    }
    const created = await a.accounts.createGrantHead({ nameGu: "ખાસ ગ્રાન્ટ" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await a.accounts.createReceipt({
      date: "2026-07-01",
      grantHeadId: created.data.id,
      amountPaise: rupeesToPaise(1000),
      receivedFromGu: "SSA",
      modeGu: "ઓનલાઈન",
      bankLabelGu: "BOB અંતિસર",
    });

    // Through the text of the file, as it travels.
    const file = parseGrantShare(JSON.stringify(await a.accounts.grantShareFile()));
    expect(file).not.toBeNull();
    if (!file) return;
    expect(file.receipts).toHaveLength(3);

    const imported = await b.accounts.applyGrantShare(file);
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    if (!imported.ok) return;
    expect(imported.data).toMatchObject({ added: 3, skipped: 0, headsCreated: ["ખાસ ગ્રાન્ટ"] });

    const received = await b.accounts.listReceipts();
    expect(received.map((each) => [each.date, each.headNameGu, each.amountPaise])).toContainEqual([
      "2026-09-15",
      (await b.accounts.listGrantHeads()).find((head) => head.code === "SWACHHATA")!.nameGu,
      rupeesToPaise(7500),
    ]);
    expect(received.find((each) => each.amountPaise === rupeesToPaise(5000))!.allotmentOrderNo).toBe("SSA/123");

    // The same file twice adds nothing.
    const twice = await b.accounts.applyGrantShare(file);
    expect(twice.ok && twice.data).toMatchObject({ added: 0, skipped: 3 });
    expect(await b.accounts.listReceipts()).toHaveLength(3);
  });

  it("refuses something that is not a shared file, and a file of another year", async () => {
    expect(parseGrantShare("{}")).toBeNull();
    expect(parseGrantShare("not json")).toBeNull();
    const file = await a.accounts.grantShareFile();
    const other = await b.accounts.applyGrantShare({
      ...file,
      receipts: file.receipts.map((receipt) => ({ ...receipt, date: "2024-06-10" })),
    });
    expect(other.ok).toBe(false);
  });
});

describe("9: a person's name or a shop's", () => {
  it.each([
    ["પ્રધાનમંત્રી ભારતીય જનઔષધી કેન્દ્ર", "shop"],
    ["ઓમ ઇલેક્ટ્રિકલ્સ", "shop"],
    ["ઓમ સાયકલ", "shop"],
    ["શ્રીજી ફર્નિચર", "shop"],
    ["શ્રીજી એન્ટરપ્રાઇઝ", "shop"],
    ["શ્રીજી સિમેન્ટ ડેપો", "shop"],
    ["શ્રીજી", "shop"],
    ["શ્રી વિદ્યાર્થી ટ્રેડર્સ", "shop"],
    ["BM સુપર બજાર", "shop"],
    ["હરિ ઓમ જનરલ સ્ટોર્સ", "shop"],
    ["ક્રિષા કટલરી", "shop"],
    ["બાયો મેડિક્સ હેલ્થકેર", "shop"],
    ["તિરૂપતિ ટ્રેડિંગ કંપની", "shop"],
    ["બોમ્બે સાવરણીવાલા", "shop"],
    ["હસમુખભાઈ મંગળભાઈ હરિજન", "person"],
    ["શોભનાબેન દિપસિંહ સોલંકી", "person"],
    ["અજીતસિંહ નટવરસિંહ સોલંકી", "person"],
    ["ઓમ પટેલ", "person"],
    ["શ્રી રમેશભાઈ પટેલ", "person"],
    ["વાલાભાઈ રબારી", "person"],
  ])("%s is a %s", (name, kind) => {
    expect(classifyPayee(name)).toBe(kind);
  });

  it("prints a person by first name and a shop in full", () => {
    expect(rojmelPayeeName("શ્રી રમેશભાઈ પટેલ")).toBe("રમેશભાઈ");
    expect(rojmelPayeeName("શ્રીજી ફર્નિચર")).toBe("શ્રીજી ફર્નિચર");
    expect(formatRojmelBillDescription({ vendorGu: "ઓમ ઝેરોક્ષ", descriptionGu: "ઝેરોક્ષ" })).toBe("ઓમ ઝેરોક્ષને બિલ મુજબ");
    expect(formatRojmelBillDescription({ vendorGu: "હસમુખભાઈ મંગળભાઈ હરિજન", descriptionGu: "સફાઈકામ મજૂરી" })).toBe(
      "સફાઈકામ પેટે હસમુખભાઈને વા.મુજબ",
    );
  });
});

describe("2 + 3: text direction, number-and-date order, heading shapes and themes", () => {
  it("keeps the new settings through the layout schema", async () => {
    const { reportLayoutSchema, emptyLayout, isEmptyLayout } = await import("../../src/shared/report-layout.js");
    const layout = {
      ...emptyLayout(),
      theme: "blue" as const,
      styles: {
        "cell:p.ref@line:cheque:110": { arrange: "stacked" as const, rotate: "up" as const },
        "part:title": { shape: "plaque" as const, fill: "#fff8e7" },
      },
    };
    expect(reportLayoutSchema.parse(layout)).toEqual(layout);
    expect(isEmptyLayout({ ...emptyLayout(), theme: "green" })).toBe(false);
    expect(() => reportLayoutSchema.parse({ ...emptyLayout(), theme: "rainbow" })).toThrow();
  });

  it("turns them into the stylesheet the preview and the PDF print with", async () => {
    const { layoutCss, emptyLayout } = await import("../../src/shared/report-layout.js");
    const css = layoutCss(
      "rojmel",
      {
        ...emptyLayout(),
        theme: "maroon",
        styles: {
          "row:head": { rotate: "up" },
          "cell:p.ref@line:cheque:110": { arrange: "dateFirst" },
          "col:p.cheque": { arrange: "stacked" },
          "part:title": { shape: "plaque" },
          "part:band": { shape: "banner", fill: "#ffeecc" },
        },
      },
      "#r",
    );
    expect(css).toContain("writing-mode: sideways-lr");
    expect(css).toMatch(/data-line="line:cheque:110"\] \.arranged-line \{ flex-direction: column-reverse/);
    expect(css).toMatch(/data-col="p\.cheque"\] \.arranged \{ flex-direction: column;/);
    expect(css).toContain("border-image: url(\"data:image/svg+xml,");
    expect(css).toContain("clip-path: polygon(");
    expect(css).toContain("background: #7b1d1d; color: #fff8e1");
  });

  it("sets a number and its date out side by side, or one above the other", async () => {
    const { applyArrangement } = await import("../../src/shared/report-layout.js");
    const lines = [[{ text: "8", part: "નંબર" }, { text: "07/10/2026", part: "તારીખ" }]];
    expect(applyArrangement(lines, undefined)).toBe(lines);
    expect(applyArrangement(lines, "stacked").map((line) => line.map((s) => s.text))).toEqual([["8"], ["07/10/2026"]]);
    expect(applyArrangement(lines, "dateFirst").map((line) => line.map((s) => s.text))).toEqual([["07/10/2026"], ["8"]]);
    expect(applyArrangement([[lines[0]![0]!], [lines[0]![1]!]], "inline")).toHaveLength(1);
  });
});
