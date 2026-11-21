# SMC module (PFMS) – design

Date: 2026-11-21 · Source: client's `SMC/KHADOL/ALAMPURA.xlsx` + developer's instructions

## What SMC is

A third software mode next to **SMC E** and **SMC E old**: `smc`. Its schools are completely separate books
(a school created in SMC is its own account, never linked to an SMC E school, even with the same DISE code).

SMC works like SMC E. Only these things change:

1. **PFMS register instead of the cheque register.** Payments are PFMS entries, not cheques.
2. **Nil blocks ("date range only what is required").** See *Rojmel*.
3. **Grant limits** per grant head, entered in the software only (never printed), copyable to every SMC school.

Everything else (bank accounts, receipts screen, bill register, vouchers, ledgers, Annexure 9 / 10, headers,
page layout system) stays exactly as in SMC E. પત્રક-D is not part of SMC (not in the client's SMC workbook).
The bank name is not added to headers.

## Data model

A PFMS entry is stored as a `Cheque` row with `type = "PFMS"`, so bills, allocation, vouchers, the bill
register and the ledgers keep working unchanged:

| PFMS register column | Stored in |
|---|---|
| અ.નં | `chequeNo` (serial, 1, 2, 3 …) |
| PPA બનાવ્યા તારીખ | `chequeDate` |
| PPA નંબર | new `ppaNo` (text, e.g. `C072548358355`) |
| વિગત (grant head) | computed from the linked bills |
| વેન્ડરની વિગત | `payeeGu` |
| ખર્ચની વિગત | `purposeGu` |
| રૂપિયા | computed: Σ linked bills' net |
| ખરેખર ચુકવ્યા તારીખ | `cashbookDate` (the rojmel date); `cashedDate` = same |

New table `GrantLimit (financialYearId, grantHeadId, limitPaise)`. Not printed anywhere. The PFMS screen
shows per head: limit, used (Σ PFMS), remaining; warns when a payment goes over the limit. A button copies
this school's limits to every other SMC school of the account that this PC can reach (same pattern as
"apply layout to all schools"): matched by grant head code, into the year with the same label.

## The PFMS money flow (from the Excel's formulas)

In the Excel every PFMS payment is booked twice on the paid date: `<grant head> જમા` (receipt, bank) and the
payment for the same amount, so balances do not move. The engine does the same, derived – nothing extra
is stored:

- **Rojmel**: one block per PFMS entry (as SMC E does per cheque). Receipt side: `<head> જમા`, bank = amount.
  Payment side, four rows as in the Excel's merged cells:
  `<head>માંથી` / `PFMS P.A.NO <PPA નંબર> થી` (amount, cheque column `PFMS`, voucher column = bill no +
  bill date) / `<vendor>ને` / `<expense>ના નાણાં ચુકવ્યા.વા.મુ`.
- **Khatavahi**: `શ્રી ગ્રાન્ટ જમા` (credit) then `<expense>ના નાણાં ચુકવ્યાં.વા.મુ` (debit).
- **Grant register**: one row per PFMS entry (`SSA`, paid date, amount, head, `ઓનલાઈન`, school bank,
  paid date, SMC label, spent = amount, saving = 0), merged with typed receipts in date order.
- **Annexure 10**: the PFMS amount counts as received and as spent for its head.
- Typed receipts (Receipts screen) still work exactly as in SMC E.

## Rojmel nil blocks (SMC)

- 01/04 opening block (when nothing happened that day).
- One nil range from 02/04 to the day before the first entry (`02/04/2025 TO 24/07/2025`).
- No nil blocks between entries.
- A 31/03 closing block, always.

## Reports in SMC mode

rojmel · khatavahi · grant register · **PFMS register** (new report id `pfmsRegister`) · bill register ·
vouchers · Annexure 9 · Annexure 10. The cheque register and પત્રક-D are hidden. `SMCE` in fixed texts
(closing sentence, Annexure 10 certificate) reads `SMC` / `એસ.એમ.સી`.

## Cloud

`profiles.app_mode` gets a third value: migration `0005_smc_mode.sql` (run once in Supabase).
