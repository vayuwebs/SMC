/**
 * The SMC mode's forms and screens in an ordinary browser, from a small demo
 * school (the client's SMC workbook's first PFMS rows).
 *
 *   npx tsx scripts/smc-preview.mjs        # builds, then serves on :8802
 *
 * Like scripts/print-preview.mjs, but it never touches prisma/dev.db and
 * never switches better-sqlite3's build: it makes its own throwaway database in
 * .scratch/smc-preview, builds the renderer there, and serves that copy. The
 * stub API is read-only; nothing typed in the page is saved.
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { runMigrations } from "../electron/migrate.js";
import { SetupService } from "../src/server/setup-service.js";
import { AccountsService } from "../src/server/accounts-service.js";
import { DEFAULT_GRANT_HEADS } from "../src/lib/default-grant-heads.js";
import { rupeesToPaise } from "../src/lib/money.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK = path.join(ROOT, ".scratch", "smc-preview");
const BUILD = path.join(WORK, "out");
const PREVIEW = path.join(WORK, "site");
const DB = path.join(WORK, "smc-demo.db");
const PORT = Number(process.env["PREVIEW_PORT"] ?? 8802);
const isWin = process.platform === "win32";

mkdirSync(WORK, { recursive: true });
console.log("building the renderer…");
execFileSync(isWin ? "npx.cmd" : "npx", ["electron-vite", "build", "--outDir", BUILD], {
  cwd: ROOT,
  stdio: "ignore",
  shell: isWin,
});

console.log("making the demo SMC school…");
for (const suffix of ["", "-wal", "-shm"]) rmSync(DB + suffix, { force: true });
runMigrations(DB, path.join(ROOT, "prisma", "migrations"));
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
const setup = await new SetupService(prisma).completeSetup({
  school: {
    nameGu: "આલમપુરા પ્રા. શાળા",
    smcLabelGu: "SMC આલમપુરા પ્રા. શાળા",
    diseCode: "24160200301",
    clusterGu: "ગરોડ",
    talukaGu: "કપડવંજ",
    districtGu: "ખેડા",
    programmeGu: "સમગ્ર શિક્ષા ખેડા – SMC / સર્વ શિક્ષા અભિયાન – ખેડા",
    memberSecretaryGu: "જયંતિભાઈ મંગળભાઈ પટેલ",
    memberSecretaryShortGu: "સભ્ય સચિવ જયંતિભાઈ",
    memberSecretaryMobile: null,
  },
  bank: { bankNameGu: "Bank of Baroda (BOB)", branchGu: "અંતિસર", accountNo: "02950100020206" },
  year: { label: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" },
  grantHeads: DEFAULT_GRANT_HEADS.map((head) => ({ ...head })),
  openingBalances: [],
});
if (!setup.ok) throw new Error(JSON.stringify(setup.issues));
const year = await prisma.financialYear.findFirstOrThrow();
const service = new AccountsService(prisma, year.id, () => "smc");
const heads = await service.listGrantHeads();

// The client's first PFMS rows, one bill each.
const rows = [
  [1, "2025-07-25", "C072548358355", 0, "શ્રી ક્રિષ્ના સિમેન્ટ પ્રોડકટ્સ", "પેવર બ્લોક", 20000, "2025-07-25"],
  [2, "2025-07-16", "C072540764452", 0, "રૂદ્ર એન્ટરપ્રાઈઝ", "સી.ઓ.ટુ ફાયર બોટલ", 4550, "2025-07-25"],
  [3, "2025-10-05", "C102502768801", 1, "ઉમા પેપર પ્રોડકટ્સ", "ગણિત વિજ્ઞાન મટીરીયલ્સ", 3000, "2025-10-10"],
  [4, "2025-10-05", "C102502769109", 2, "ચિરાગકુમાર મહેન્દ્રભાઈ પટેલ", "સરભરા ખર્ચ", 1000, "2025-10-10"],
];
for (const [serial, ppaDate, ppaNo, headIndex, vendor, purpose, rupees, paidDate] of rows) {
  const head = heads[headIndex];
  const bill = await service.createBill({
    voucherNo: serial,
    billNo: String(serial),
    billDate: ppaDate,
    descriptionGu: purpose,
    vendorGu: vendor,
    grantHeadId: head.id,
    amountPaise: rupeesToPaise(rupees),
    deductionPaise: 0,
  });
  if (!bill.ok) throw new Error(JSON.stringify(bill.issues));
  const paid = await service.createCheque({
    chequeNo: serial,
    chequeDate: ppaDate,
    cashbookDate: paidDate,
    voucherNo: serial,
    payeeGu: vendor,
    purposeGu: purpose,
    type: "PFMS",
    ppaNo,
    billIds: [bill.data.id],
  });
  if (!paid.ok) throw new Error(JSON.stringify(paid.issues));
}
await service.saveGrantLimits([
  { grantHeadId: heads[0].id, limitPaise: rupeesToPaise(25000) },
  { grantHeadId: heads[1].id, limitPaise: rupeesToPaise(3000) },
]);

const reports = [
  "rojmel", "khatavahi", "grantRegister", "chequeRegister", "pfmsRegister", "billRegister",
  "vouchers", "patrakD", "annexure9", "annexure10",
];
const data = {
  getDashboard: await service.getDashboard(),
  getRojmel: await service.getRojmel(),
  getGrantRegister: await service.getGrantRegister(),
  getChequeRegister: await service.getChequeRegister(),
  getPfmsRegister: await service.getPfmsRegister(),
  getBillRegister: await service.getBillRegister(),
  getVouchers: await service.getVouchers(),
  getPatrakD: await service.getPatrakD(),
  getLedgers: await service.getLedgers(),
  getAnnexure9: await service.getAnnexure9(),
  getAnnexure10: await service.getAnnexure10(),
  getBalances: await service.getBalances(),
  getSchool: await service.getSchool(),
  listCheques: await service.listCheques(),
  listBills: await service.listBills(),
  listGrantHeads: heads,
  listGrantLimits: await service.listGrantLimits(),
  listReceipts: await service.listReceipts(),
  listOpeningBalances: await service.listOpeningBalances(),
  listFinancialYears: await service.listFinancialYears(),
  getValidation: await service.getValidation(),
  getReconciliation: await service.getReconciliation(),
};
const layouts = Object.fromEntries(
  await Promise.all(reports.map(async (report) => [report, await service.getReportLayout(report)])),
);
await prisma.$disconnect();

const school = data.getSchool;
const openState = {
  phase: "open",
  cloud: { kind: "fake", note: "SMC preview" },
  user: { id: "preview", email: "preview@localhost" },
  school: { profileId: "preview", schoolNameGu: school.nameGu, diseCode: school.diseCode, folder: "(preview)" },
  needsSetup: false,
  mode: { active: "smc", remember: false, savedMode: null },
};

rmSync(PREVIEW, { recursive: true, force: true });
cpSync(path.join(BUILD, "renderer"), PREVIEW, { recursive: true });
const indexPath = path.join(PREVIEW, "index.html");
let html = readFileSync(indexPath, "utf8");
html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "");
const answers = Object.entries(data)
  .map(([name, value]) => `${name}:()=>Promise.resolve(${JSON.stringify(value)}),`)
  .join("");
html = html.replace(
  "</head>",
  `<script>const layouts=${JSON.stringify(layouts)};window.accounts={${answers}` +
    `getAppState:()=>Promise.resolve(${JSON.stringify(openState)}),` +
    `getSetupState:()=>Promise.resolve({needsSetup:false,schoolNameGu:null,yearLabel:null}),` +
    `getBackupStatus:()=>Promise.resolve({state:"upToDate",pendingSince:null,lastBackupAt:null,lastBackupDevice:null,lastError:null}),` +
    `getReportLayout:(r)=>Promise.resolve(structuredClone(layouts[r])),` +
    `saveReportLayout:(r,l)=>{layouts[r]=structuredClone(l);return Promise.resolve({ok:true,data:structuredClone(l)})},` +
    `saveGrantLimits:()=>Promise.resolve({ok:true,data:${JSON.stringify(data.listGrantLimits)}}),` +
    `applyLimitsToAllSchools:()=>Promise.resolve({ok:true,data:{applied:[],skipped:[]}}),` +
    `listBankCharges:()=>Promise.resolve([]),` +
    `syncSuggestions:(rows)=>Promise.resolve(rows),` +
    `exportPdf:()=>Promise.resolve({ok:true,data:null}),` +
    `printReport:()=>Promise.resolve({ok:true,data:false}),` +
    `exportExcel:()=>Promise.resolve({ok:true,data:null})` +
    `};</script></head>`,
);
writeFileSync(indexPath, html);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" };
createServer((request, response) => {
  const name = (request.url ?? "/").split("?")[0].split("#")[0];
  const file = path.join(PREVIEW, name === "/" ? "index.html" : name);
  if (!file.startsWith(PREVIEW) || !existsSync(file)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
}).listen(PORT, () => {
  console.log(`\n  http://localhost:${PORT}/#print:pfmsRegister\n`);
});
