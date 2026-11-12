/**
 * The checks of SPEC section 7, as a pure function over a YearBook.
 *
 * Errors block; warnings print but let the book stand. Nothing here throws: an
 * auditor needs to see the broken register, not an empty page.
 *
 * Four of the spec's error rules are absent on purpose, because the data model
 * makes them unrepresentable rather than merely forbidden:
 *
 *   - "cheque allocation total != cheque amount" - the amount IS the allocation
 *     total; no separate figure is stored to disagree with it.
 *   - "reimbursement/direct allocation != its bills by head" - that allocation is
 *     computed from the bills, so it cannot differ.
 *   - "a bill linked to more than one cheque" - Bill.chequeId holds one cheque.
 *   - "duplicate cheque number" - a unique index on (year, chequeNo).
 *
 * The duplicate-cheque check is kept anyway, cheaply, because a YearBook can also
 * be built from an imported spreadsheet that never went through those indexes.
 */
import { formatAmount } from "../lib/money.js";
import { formatDate, isWithin } from "../lib/dates.js";
import { billNet } from "./allocation.js";
import { balancesByDate, headBalanceOn } from "./balances.js";
import { annexure9 } from "./annexure9.js";
import type { YearBook } from "./types.js";

export type IssueSeverity = "error" | "warning";

export interface Issue {
  severity: IssueSeverity;
  /** Stable machine-readable key, for tests and for grouping in the UI. */
  code: string;
  /** What a Gujarati-speaking user reads. */
  messageGu: string;
  /**
   * What an English-speaking user reads when the interface language is English.
   *
   * It defaults to `detail`, which is already written as a readable English
   * sentence rather than a stack trace, so every issue has an English form
   * without a second catalogue to keep in step with the Gujarati one.
   */
  messageEn: string;
  /** English detail, also used for the logs. */
  detail: string;
}

export interface ValidationResult {
  issues: Issue[];
  errors: Issue[];
  warnings: Issue[];
  ok: boolean;
}

export function validate(book: YearBook): ValidationResult {
  const issues: Issue[] = [];

  const error = (code: string, messageGu: string, detail: string): void => {
    issues.push({ severity: "error", code, messageGu, messageEn: detail, detail });
  };
  const warn = (code: string, messageGu: string, detail: string): void => {
    issues.push({ severity: "warning", code, messageGu, messageEn: detail, detail });
  };

  // ------------------------------------------------------------- errors

  // A grant return has no bill: the bill register prints its own row for it, so
  // a bill under its voucher prints the same money twice - and can never be
  // paid, because a grant return takes no bills.
  const grantReturnVouchers = new Map<number, number>();
  for (const cheque of [...book.cheques, ...book.returnedCheques]) {
    if (cheque.type === "GRANT_RETURN" && cheque.voucherNo !== null) {
      grantReturnVouchers.set(cheque.voucherNo, cheque.chequeNo);
    }
  }
  for (const bill of book.bills) {
    const chequeNo = grantReturnVouchers.get(bill.voucherNo);
    if (chequeNo === undefined) continue;
    error(
      "bill_on_grant_return_voucher",
      `વાઉચર ${bill.voucherNo} બચત ગ્રાન્ટ પરતનો છે (ચેક નં. ${chequeNo}). ગ્રાન્ટ પરતનું બિલ હોતું નથી – બિલ રજીસ્ટરમાં તે આપોઆપ આવે છે. બિલ "${bill.descriptionGu}" કાઢી નાખો.`,
      `voucher ${bill.voucherNo} is the grant return of cheque ${chequeNo}, which needs no bill - the bill register lists it by itself; delete bill "${bill.descriptionGu}"`,
    );
  }

  for (const bill of book.bills) {
    if (bill.deductionPaise > bill.amountPaise) {
      error(
        "deduction_exceeds_amount",
        `બિલ ${bill.billNo ?? bill.voucherNo}: કપાત બિલની રકમ કરતાં વધારે છે`,
        `bill ${bill.billNo ?? `(voucher ${bill.voucherNo})`}: deduction ${formatAmount(bill.deductionPaise)} > amount ${formatAmount(bill.amountPaise)}`,
      );
    }
  }

  const seenCheques = new Set<number>();
  for (const cheque of book.cheques) {
    if (seenCheques.has(cheque.chequeNo)) {
      error(
        "duplicate_cheque_no",
        `ચેક નંબર ${cheque.chequeNo} એક કરતાં વધુ વાર છે`,
        `cheque number ${cheque.chequeNo} appears more than once`,
      );
    }
    seenCheques.add(cheque.chequeNo);
  }

  const seenBills = new Set<string>();
  for (const bill of book.bills) {
    if (bill.billNo === null) continue; // a direct-payment bill has no number
    const key = `${bill.voucherNo}::${bill.billNo}`;
    if (seenBills.has(key)) {
      error(
        "duplicate_bill_no",
        `વાઉચર ${bill.voucherNo} માં બિલ નંબર ${bill.billNo} એક કરતાં વધુ વાર છે`,
        `bill number ${bill.billNo} appears twice in voucher ${bill.voucherNo}`,
      );
    }
    seenBills.add(key);
  }

  for (const balance of balancesByDate(book)) {
    if (balance.bankPaise < 0) {
      error(
        "bank_overdrawn",
        `તા. ${formatDate(balance.date)} ના રોજ બેન્ક સિલક ઋણ થાય છે`,
        `bank balance is ${formatAmount(balance.bankPaise)} after ${balance.date}`,
      );
    }
  }

  // ----------------------------------------------------------- warnings

  for (const balance of balancesByDate(book)) {
    if (balance.cashPaise < 0) {
      warn(
        "cash_negative",
        `તા. ${formatDate(balance.date)} ના રોજ રોકડ સિલક ઋણ થાય છે`,
        `cash balance is ${formatAmount(balance.cashPaise)} after ${balance.date}`,
      );
    }
  }

  // A head spending more than it holds. Checked on each date that head moves.
  for (const head of book.heads) {
    const dates = new Set<string>();
    for (const receipt of book.receipts) {
      if (receipt.headCode === head.code) dates.add(receipt.date);
    }
    for (const cheque of book.cheques) dates.add(cheque.cashbookDate);
    for (const cheque of book.returnedCheques) {
      dates.add(cheque.cashbookDate);
      dates.add(cheque.returnedDate);
    }
    for (const charge of book.bankCharges) {
      if (charge.headCode === head.code) dates.add(charge.date);
    }

    for (const date of [...dates].sort()) {
      const balance = headBalanceOn(book, head.code, date);
      if (balance < 0) {
        warn(
          "head_overdrawn",
          `${head.nameGu}: તા. ${formatDate(date)} ના રોજ સિલક ઋણ થાય છે`,
          `${head.code} balance is ${formatAmount(balance)} after ${date}`,
        );
        break; // one warning per head is enough to send the user looking
      }
    }
  }

  // A returned cheque still used up its number.
  gapsIn(
    [...book.cheques, ...book.returnedCheques].map((cheque) => cheque.chequeNo),
    (from, to) =>
      warn(
        "cheque_no_gap",
        `ચેક નંબર ${from} અને ${to} વચ્ચે ખૂટે છે`,
        `cheque numbers jump from ${from} to ${to}`,
      ),
  );

  gapsIn(
    book.cheques.map((cheque) => cheque.voucherNo).filter((no): no is number => no !== null),
    (from, to) =>
      warn(
        "voucher_no_gap",
        `વાઉચર નંબર ${from} અને ${to} વચ્ચે ખૂટે છે`,
        `voucher numbers jump from ${from} to ${to}`,
      ),
  );

  // One voucher, one standing cheque. A cheque written for a returned one shares
  // its voucher number by design - the returned cheque is not in book.cheques -
  // so two here means the same payment entered twice, or a bounced cheque
  // entered again without being marked returned: both count it twice.
  const chequesByVoucher = new Map<number, number[]>();
  for (const cheque of book.cheques) {
    if (cheque.voucherNo === null) continue;
    chequesByVoucher.set(cheque.voucherNo, [...(chequesByVoucher.get(cheque.voucherNo) ?? []), cheque.chequeNo]);
  }
  for (const [voucherNo, chequeNos] of chequesByVoucher) {
    if (chequeNos.length < 2) continue;
    const list = [...chequeNos].sort((a, b) => a - b).join(", ");
    warn(
      "duplicate_voucher_no",
      `વાઉચર નંબર ${voucherNo} બે ચેકમાં છે (ચેક નં. ${list}). એક જ ચુકવણી બે વાર નોંધાઈ હોય તો એક ચેક કાઢો; ચેક રિટર્ન થયો હોય તો જૂના ચેકમાં રિટર્ન તારીખ ભરો અને નવા ચેકમાં તે પસંદ કરો.`,
      `voucher ${voucherNo} is used by cheques ${list}; delete the duplicate, or mark the bounced one returned and link the new one to it`,
    );
  }

  for (const bill of book.bills) {
    if (!isWithin(bill.billDate, book.year.startDate, book.year.endDate)) {
      warn(
        "bill_date_outside_year",
        `બિલ ${bill.billNo ?? bill.voucherNo} ની તારીખ ${formatDate(bill.billDate)} આ વર્ષની બહાર છે`,
        `bill ${bill.billNo ?? `(voucher ${bill.voucherNo})`} dated ${bill.billDate} is outside ${book.year.label}`,
      );
    }
  }

  for (const cheque of book.cheques) {
    if (cheque.cashbookDate < cheque.chequeDate) {
      warn(
        "cashbook_before_cheque_date",
        `ચેક ${cheque.chequeNo}: રોજમેળ તારીખ ચેકની તારીખ પહેલાંની છે`,
        `cheque ${cheque.chequeNo}: cash-book date ${cheque.cashbookDate} precedes cheque date ${cheque.chequeDate}`,
      );
    }
    if (cheque.cashedDate !== null && cheque.cashedDate < cheque.chequeDate) {
      warn(
        "cashed_before_cheque_date",
        `ચેક ${cheque.chequeNo}: વટાવ્યાં તારીખ ચેકની તારીખ પહેલાંની છે`,
        `cheque ${cheque.chequeNo}: encashed ${cheque.cashedDate} precedes cheque date ${cheque.chequeDate}`,
      );
    }
  }

  for (const cheque of book.returnedCheques) {
    if (cheque.returnedDate < cheque.cashbookDate) {
      warn(
        "returned_before_cashbook_date",
        `ચેક ${cheque.chequeNo}: રિટર્ન તારીખ રોજમેળ તારીખ પહેલાંની છે`,
        `cheque ${cheque.chequeNo}: returned ${cheque.returnedDate} before its cash-book date ${cheque.cashbookDate}`,
      );
    }
    if (!isWithin(cheque.returnedDate, book.year.startDate, book.year.endDate)) {
      warn(
        "returned_outside_year",
        `ચેક ${cheque.chequeNo} ની રિટર્ન તારીખ ${formatDate(cheque.returnedDate)} આ વર્ષની બહાર છે`,
        `cheque ${cheque.chequeNo} returned on ${cheque.returnedDate}, outside ${book.year.label}`,
      );
    }
    const replacement = [...book.cheques, ...book.returnedCheques].find(
      (candidate) => candidate.chequeNo === cheque.replacedByChequeNo,
    );
    if (replacement && replacement.cashbookDate < cheque.returnedDate) {
      warn(
        "replacement_before_return",
        `ચેક ${replacement.chequeNo}: ચેક ${cheque.chequeNo} રિટર્ન થયા પહેલાંની તારીખે લખેલ છે`,
        `cheque ${replacement.chequeNo} replaces cheque ${cheque.chequeNo} but is entered on ${replacement.cashbookDate}, before the return on ${cheque.returnedDate}`,
      );
    }
  }

  for (const charge of book.bankCharges) {
    if (!isWithin(charge.date, book.year.startDate, book.year.endDate)) {
      warn(
        "bank_charge_outside_year",
        `બેન્ક ચાર્જ ${formatAmount(charge.amountPaise)} ની તારીખ ${formatDate(charge.date)} આ વર્ષની બહાર છે`,
        `bank charge ${charge.id} dated ${charge.date} is outside ${book.year.label}`,
      );
    }
  }

  const unpaid = book.bills.filter((bill) => bill.chequeNo === null);
  if (unpaid.length > 0) {
    warn(
      "bills_without_cheque",
      `${unpaid.length} બિલ કોઈ ચેક સાથે જોડાયેલ નથી`,
      `${unpaid.length} bill(s) are not linked to any cheque`,
    );
  }

  if (book.reconciliation !== null) {
    const reconciliation = annexure9(book);
    if (!reconciliation.matches) {
      warn(
        "reconciliation_mismatch",
        `પાસબુક સિલક મેળ ખાતી નથી: ગણતરી ${formatAmount(reconciliation.computedPassbookPaise)}, દાખલ કરેલ ${formatAmount(reconciliation.enteredPassbookPaise)}`,
        `reconciliation computes ${formatAmount(reconciliation.computedPassbookPaise)} but the passbook figure entered is ${formatAmount(reconciliation.enteredPassbookPaise)}`,
      );
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { issues, errors, warnings, ok: errors.length === 0 };
}

/** Report each gap in an otherwise consecutive run of numbers. */
function gapsIn(numbers: number[], report: (from: number, to: number) => void): void {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous === undefined || current === undefined) continue;
    if (current !== previous + 1) report(previous, current);
  }
}

/** Bills that are paid but whose net is zero - usually a half-entered row. */
export function zeroValueBills(book: YearBook): typeof book.bills {
  return book.bills.filter((bill) => billNet(bill) === 0);
}
