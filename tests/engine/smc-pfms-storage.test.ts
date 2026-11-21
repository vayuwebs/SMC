/**
 * SMC mode, through the database: PFMS payments saved as cheques of type PFMS,
 * the grant limits, and the reports SMC prints.
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
import { reportsForMode, type ChequeInput, type SetupInput } from "../../src/shared/api.js";
import { buildWorkbook } from "../../src/server/excel.js";

const DB = path.join(process.cwd(), "tests", ".smc-pfms-storage.db");
const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

function cleanUp(): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB + suffix, { force: true });
}

const SETUP: SetupInput = {
  school: {
    nameGu: "આલમપુરા પ્રા. શાળા",
    smcLabelGu: "SMC આલમપુરા પ્રા. શાળા",
    diseCode: "24160200301",
    clusterGu: "ગરોડ",
    talukaGu: "કપડવંજ",
    districtGu: "ખેડા",
    programmeGu: "સમગ્ર શિક્ષા ખેડા – SMC",
    memberSecretaryGu: "જયંતિભાઈ મંગળભાઈ પટેલ",
    memberSecretaryShortGu: "સભ્ય સચિવ જયંતિભાઈ",
    memberSecretaryMobile: null,
  },
  bank: { bankNameGu: "ICICI", branchGu: "કપડવંજ", accountNo: "250001001958" },
  year: { label: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" },
  grantHeads: DEFAULT_GRANT_HEADS.map((head) => ({ ...head })),
  openingBalances: [],
};

let prisma: PrismaClient;
let smc: AccountsService;
let smcE: AccountsService;
let headId = 0;
let headCode = "";
let billIds: number[] = [];

const pfms = (overrides: Partial<ChequeInput> = {}): ChequeInput => ({
  chequeNo: 1,
  chequeDate: "2025-07-25",
  cashbookDate: "2025-07-25",
  voucherNo: 1,
  payeeGu: "શ્રી ક્રિષ્ના સિમેન્ટ પ્રોડકટ્સ",
  purposeGu: "પેવર બ્લોક",
  type: "PFMS",
  ppaNo: "C072548358355",
  billIds,
  ...overrides,
});

beforeAll(async () => {
  cleanUp();
  runMigrations(DB, MIGRATIONS);
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  const result = await new SetupService(prisma).completeSetup(SETUP);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const yearId = (await prisma.financialYear.findFirstOrThrow()).id;
  smc = new AccountsService(prisma, yearId, () => "smc");
  smcE = new AccountsService(prisma, yearId, () => "smc-e");

  const head = (await smc.listGrantHeads())[0]!;
  headId = head.id;
  headCode = head.code;
  const bill = await smc.createBill({
    voucherNo: 1,
    billNo: "1",
    billDate: "2025-07-20",
    descriptionGu: "પેવર બ્લોક",
    vendorGu: "શ્રી ક્રિષ્ના સિમેન્ટ પ્રોડકટ્સ",
    grantHeadId: head.id,
    amountPaise: rupeesToPaise(20000),
    deductionPaise: 0,
  });
  expect(bill.ok, JSON.stringify(bill)).toBe(true);
  billIds = bill.ok ? [bill.data.id] : [];
});

afterAll(async () => {
  await prisma.$disconnect();
  cleanUp();
});

describe("SMC: a PFMS payment, saved", () => {
  it("is refused without a PPA number, or paid before its PPA was made", async () => {
    const noPpa = await smc.createCheque(pfms({ ppaNo: " " }));
    expect(noPpa.ok).toBe(false);
    const early = await smc.createCheque(pfms({ chequeDate: "2025-07-26" }));
    expect(!early.ok && early.issues[0]?.code).toBe("pfms_paid_before_ppa");
  });

  it("is refused outside SMC, and SMC refuses a cheque", async () => {
    const elsewhere = await smcE.createCheque(pfms());
    expect(!elsewhere.ok && elsewhere.issues[0]?.code).toBe("pfms_outside_smc");
    const cheque = await smc.createCheque(pfms({ type: "DIRECT" }));
    expect(!cheque.ok && cheque.issues[0]?.code).toBe("cheque_in_smc");
  });

  it("keeps its PPA number and its two dates, and takes its amount from its bills", async () => {
    const created = await smc.createCheque(pfms());
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    expect(created.data).toMatchObject({
      type: "PFMS",
      ppaNo: "C072548358355",
      chequeDate: "2025-07-25",
      cashbookDate: "2025-07-25",
      amountPaise: rupeesToPaise(20000),
    });

    const again = await smc.createCheque(pfms({ ppaNo: "C1", billIds: [] }));
    expect(!again.ok && again.issues[0]?.code).toBe("duplicate_pfms_serial");
  });

  it("prints in the PFMS register, the rojmel, the grant register and Annexure 10", async () => {
    expect(await smc.getPfmsRegister()).toEqual([
      expect.objectContaining({ serial: 1, ppaNo: "C072548358355", amountPaise: rupeesToPaise(20000) }),
    ]);
    expect(await smc.getChequeRegister()).toEqual([]);

    const rojmel = await smc.getRojmel();
    expect(rojmel.blocks.map((block) => [block.fromDate, block.toDate])).toEqual([
      ["2025-04-01", "2025-04-01"],
      ["2025-04-02", "2025-07-24"],
      ["2025-07-25", "2025-07-25"],
      ["2026-03-31", "2026-03-31"],
    ]);
    expect(rojmel.closingSentenceGu).toContain("SMC ની બંધ સિલક");

    const grants = await smc.getGrantRegister();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ spentPaise: rupeesToPaise(20000), savingPaise: 0 });
    expect(grants[0]!.receipt).toMatchObject({ receivedFromGu: "SSA", grantHeadId: headId, date: "2025-07-25" });
    expect(grants[0]!.receipt.id).toBeLessThan(0);

    const row = (await smc.getAnnexure10()).rows.find((candidate) => candidate.headCode === headCode)!;
    expect([row.receivedPaise, row.spentPaise, row.closingPaise]).toEqual([
      rupeesToPaise(20000),
      rupeesToPaise(20000),
      0,
    ]);
    expect((await smc.getDashboard()).appMode).toBe("smc");
  });

  it("exports an SMC workbook with the PFMS register and without the cheque register or પત્રક-D", async () => {
    const workbook = await buildWorkbook(smc, "all");
    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(names).toContain("PFMS રજીસ્ટર");
    expect(names).not.toContain("ચેક રજીસ્ટર");
    expect(names.some((name) => name.includes("પત્રક"))).toBe(false);
    expect(reportsForMode("smc")).not.toContain("chequeRegister");
    expect(reportsForMode("smc-e")).not.toContain("pfmsRegister");
  });
});

describe("SMC: grant limits", () => {
  it("starts with no limits, and shows what the PFMS payments used", async () => {
    const row = (await smc.listGrantLimits()).find((candidate) => candidate.grantHeadId === headId)!;
    expect(row).toMatchObject({ limitPaise: null, usedPaise: rupeesToPaise(20000), remainingPaise: null });
  });

  it("saves a limit per head and works out what is left", async () => {
    const saved = await smc.saveGrantLimits([{ grantHeadId: headId, limitPaise: rupeesToPaise(25000) }]);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const row = (await smc.listGrantLimits()).find((candidate) => candidate.grantHeadId === headId)!;
    expect(row).toMatchObject({ limitPaise: rupeesToPaise(25000), remainingPaise: rupeesToPaise(5000) });
  });

  it("refuses a negative limit, and clears a limit set to null", async () => {
    expect((await smc.saveGrantLimits([{ grantHeadId: headId, limitPaise: -1 }])).ok).toBe(false);
    await smc.saveGrantLimits([{ grantHeadId: headId, limitPaise: null }]);
    const row = (await smc.listGrantLimits()).find((candidate) => candidate.grantHeadId === headId)!;
    expect(row.limitPaise).toBeNull();
  });

  it("copies limits in by head code, leaving heads not named alone", async () => {
    const [first, second] = await smc.listGrantLimits();
    await smc.saveGrantLimits([{ grantHeadId: second!.grantHeadId, limitPaise: rupeesToPaise(700) }]);
    const merged = await smc.mergeGrantLimitsByCode(new Map([[first!.headCode, rupeesToPaise(1000)]]));
    expect(merged.ok).toBe(true);
    const rows = await smc.listGrantLimits();
    expect(rows[0]!.limitPaise).toBe(rupeesToPaise(1000));
    expect(rows[1]!.limitPaise).toBe(rupeesToPaise(700));
  });

  it("is never printed: no report carries a limit", async () => {
    const register = JSON.stringify(await smc.getPfmsRegister());
    expect(register).not.toMatch(/limit/i);
  });
});
