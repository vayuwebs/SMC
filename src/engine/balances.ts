/**
 * Where the money is - cash and bank - after each cash-book date.
 *
 * SPEC section 5:
 *   bank after d = opening bank + Σ receipts ≤ d − Σ cheques (by cash-book date) ≤ d
 *                                − Σ bank charges ≤ d + Σ returned cheques (by return date) ≤ d
 *
 * A returned cheque still counts as paid out on its cash-book date: the bank
 * balance dips until its money comes back, as the rojmel prints it.
 *   cash after d = opening cash + Σ reimbursement cheques ≤ d
 *                              − Σ their bills paid in cash ≤ d
 *
 * The two cash flows are computed separately rather than assumed to cancel. They
 * do cancel - a reimbursement's bills always sum to the cheque - but computing
 * both is what makes a broken block visible instead of silent. The client's
 * rojmel page 15 is exactly this bug: a miscopied cash line left the block
 * 1,646 short, and a hand-typed 0 in the cash closing hid it (SPEC 9.1).
 */
import { add, paise, sum, type Paise, ZERO } from "../lib/money.js";
import { billNet, billPaidInCash, cashPart, cashbookCheques, chequeAllocation, chequeAmount } from "./allocation.js";
import type { DayBalance, YearBook } from "./types.js";

/** Opening bank across all heads. */
export function openingBank(book: YearBook): Paise {
  return sum([...book.opening.values()].map((opening) => opening.bankPaise));
}

/** Opening cash across all heads. Zero in the sample year (SPEC 11.8 is open). */
export function openingCash(book: YearBook): Paise {
  return sum([...book.opening.values()].map((opening) => opening.cashPaise));
}

/**
 * Every date on which something enters the cash book, in order: receipt dates
 * and cheque cash-book dates, de-duplicated. The rojmel builds one block per
 * date in this list.
 */
export function cashbookDates(book: YearBook): string[] {
  const dates = new Set<string>();
  for (const receipt of book.receipts) dates.add(receipt.date);
  for (const cheque of cashbookCheques(book)) dates.add(cheque.cashbookDate);
  for (const cheque of book.returnedCheques) dates.add(cheque.returnedDate);
  for (const charge of book.bankCharges) dates.add(charge.date);
  return [...dates].sort();
}

/** The cash and bank position at the end of `date`. */
export function balanceOn(book: YearBook, date: string): DayBalance {
  const receiptsIn = sum(
    book.receipts.filter((receipt) => receipt.date <= date).map((receipt) => receipt.amountPaise),
  );

  const chequesOut = sum(
    cashbookCheques(book).filter((cheque) => cheque.cashbookDate <= date).map(chequeAmount),
  );

  // A cheque the bank sent back puts its money back on the day it came back.
  const returnedIn = sum(
    book.returnedCheques.filter((cheque) => cheque.returnedDate <= date).map(chequeAmount),
  );

  // What the bank took itself: no cheque, straight out of the account.
  const chargesOut = sum(
    book.bankCharges.filter((charge) => charge.date <= date).map((charge) => charge.amountPaise),
  );

  // A reimbursement withdraws to the head teacher's hand what it pays in cash,
  // and pays those bills the same day; the bills it pays online never touch cash.
  const reimbursements = cashbookCheques(book).filter((cheque) => cheque.cashbookDate <= date);
  const cashIn = sum(reimbursements.map(cashPart));
  const cashOut = sum(
    reimbursements.flatMap((cheque) => cheque.bills.filter((bill) => billPaidInCash(cheque, bill)).map(billNet)),
  );

  const bankPaise = paise(openingBank(book) + receiptsIn - chequesOut - chargesOut + returnedIn);
  const cashPaise = paise(openingCash(book) + cashIn - cashOut);

  return { date, bankPaise, cashPaise, totalPaise: add(bankPaise, cashPaise) };
}

/** The position after each cash-book date, in date order. */
export function balancesByDate(book: YearBook): DayBalance[] {
  return cashbookDates(book).map((date) => balanceOn(book, date));
}

/** The position on 31 March - the figure Annexure 9 reconciles and the year closes on. */
export function yearEndBalance(book: YearBook): DayBalance {
  return balanceOn(book, book.year.endDate);
}

/**
 * A head's running balance at the end of `date`, used by the validation warning
 * for a head that goes overdrawn. Opening + its receipts − its share of cheques
 * − the bank charges laid on it + its share of cheques the bank sent back.
 */
export function headBalanceOn(book: YearBook, headCode: string, date: string): Paise {
  const opening = book.opening.get(headCode);
  const openingTotal = opening ? add(opening.bankPaise, opening.cashPaise) : ZERO;

  const received = sum(
    book.receipts
      .filter((receipt) => receipt.headCode === headCode && receipt.date <= date)
      .map((receipt) => receipt.amountPaise),
  );

  let out = ZERO;
  for (const cheque of cashbookCheques(book)) {
    if (cheque.cashbookDate > date) continue;
    out = add(out, chequeAllocation(cheque).get(headCode) ?? ZERO);
  }
  for (const cheque of book.returnedCheques) {
    if (cheque.returnedDate > date) continue;
    out = paise(out - (chequeAllocation(cheque).get(headCode) ?? ZERO));
  }
  for (const charge of book.bankCharges) {
    if (charge.headCode === headCode && charge.date <= date) out = add(out, charge.amountPaise);
  }

  return paise(openingTotal + received - out);
}
