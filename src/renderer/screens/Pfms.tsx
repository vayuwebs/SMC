import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api } from "../api.js";
import type {
  ApplyLimitsResultDto,
  BillDto,
  ChequeDto,
  ChequeInput,
  GrantHeadDto,
  GrantLimitDto,
} from "../../shared/api.js";
import type { Issue } from "../../engine/validation.js";
import { Money } from "../components/Money.js";
import { DateInput } from "../components/DateInput.js";
import { IssueList } from "../components/IssueList.js";
import { amountToInput, formatAmount, formatDate, tryParseAmount } from "../format.js";
import { useStrings, type Strings } from "../i18n/index.js";
import { Icon } from "../components/Icon.js";
import { askConfirm } from "../components/ConfirmDialog.js";

/**
 * PFMS - the SMC mode's payments, in place of cheques.
 *
 * A PFMS entry is stored as a cheque of type PFMS, so it works like a direct
 * cheque: the user picks the BILLS it pays and its amount and grant head are
 * computed from them. What it adds is the PPA number and its two dates - the
 * day the PPA was made and the day it was actually paid (the rojmel date).
 *
 * The grant limits sit on the same screen: one limit per grant head for the
 * year, what the PFMS payments have used of it and what is left. They are not
 * printed anywhere. They can be copied to every other SMC school.
 */
export function Pfms({ onChanged }: { onChanged: () => void }): JSX.Element {
  const t = useStrings();
  const [payments, setPayments] = useState<ChequeDto[]>([]);
  const [bills, setBills] = useState<BillDto[]>([]);
  const [heads, setHeads] = useState<GrantHeadDto[]>([]);
  const [limits, setLimits] = useState<GrantLimitDto[]>([]);
  const [editing, setEditing] = useState<ChequeDto | "new" | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  async function reload(): Promise<void> {
    const [nextPayments, nextBills, nextHeads, nextLimits] = await Promise.all([
      api.listCheques(),
      api.listBills(),
      api.listGrantHeads(),
      api.listGrantLimits(),
    ]);
    setPayments(nextPayments.filter((payment) => payment.type === "PFMS").sort((a, b) => a.chequeNo - b.chequeNo));
    setBills(nextBills);
    setHeads(nextHeads);
    setLimits(nextLimits);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function save(input: ChequeInput, id: number | null): Promise<void> {
    const result = id === null ? await api.createCheque(input) : await api.updateCheque(id, input);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    setEditing(null);
    await reload();
    onChanged();
  }

  async function remove(payment: ChequeDto): Promise<void> {
    if (!(await askConfirm(t.confirmDeletePfms(payment.chequeNo)))) return;
    const result = await api.deleteCheque(payment.id);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    await reload();
    onChanged();
  }

  if (loading) return <div className="state">{t.loading}</div>;

  const q = query.toLowerCase().trim();
  const shown = payments.filter(
    (payment) =>
      q === "" ||
      String(payment.chequeNo).includes(q) ||
      (payment.ppaNo ?? "").toLowerCase().includes(q) ||
      payment.payeeGu.toLowerCase().includes(q) ||
      payment.purposeGu.toLowerCase().includes(q) ||
      payment.allocation.some((row) => row.headNameGu.toLowerCase().includes(q)),
  );
  const total = shown.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const startNew = (): void => {
    setEditing("new");
    setIssues([]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>
            {t.pfmsTitle}
            <span className="page-head-badge">{payments.length}</span>
          </h2>
          <p>{t.pfmsSubtitle}</p>
        </div>
        <button className="primary" onClick={startNew}>
          {t.newPfms}
        </button>
      </div>

      {issues.length > 0 && (
        <div className="card">
          <IssueList issues={issues} />
        </div>
      )}

      {editing !== null && (
        <PfmsForm
          key={editing === "new" ? "new" : editing.id}
          t={t}
          heads={heads}
          bills={bills}
          limits={limits}
          payment={editing === "new" ? null : editing}
          nextSerial={Math.max(0, ...payments.map((payment) => payment.chequeNo)) + 1}
          onCancel={() => {
            setEditing(null);
            setIssues([]);
          }}
          onSave={save}
        />
      )}

      {payments.length > 0 && (
        <div className="search-filter-bar">
          <div className="search-input-wrap">
            <span className="search-icon">
              <Icon name="search" />
            </span>
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="search-clear-btn" onClick={() => setQuery("")} title="Clear">
                ✕
              </button>
            )}
          </div>
          <div className="filter-count-badge">
            <span>
              {t.total}: <Money paise={total} />
            </span>
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <div className="card">
          <div className="table-wrap" style={{ margin: 0, border: "none", boxShadow: "none" }}>
            <table>
              <thead>
                <tr>
                  <th className="num">{t.pfmsSerial}</th>
                  <th>{t.ppaDate}</th>
                  <th>{t.ppaNo}</th>
                  <th>{t.pfmsHead}</th>
                  <th>{t.pfmsVendor}</th>
                  <th>{t.pfmsPurpose}</th>
                  <th className="num">{t.pfmsAmount}</th>
                  <th>{t.paidDate}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((payment) => (
                  <tr key={payment.id}>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {payment.chequeNo}
                    </td>
                    <td className="num">{formatDate(payment.chequeDate)}</td>
                    <td className="num">{payment.ppaNo ?? ""}</td>
                    <td>{payment.allocation.map((row) => row.headNameGu).join(", ")}</td>
                    <td>{payment.payeeGu}</td>
                    <td>{payment.purposeGu}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      <Money paise={payment.amountPaise} />
                    </td>
                    <td className="num">{formatDate(payment.cashbookDate)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="ghost"
                          onClick={() => {
                            setEditing(payment);
                            setIssues([]);
                          }}
                        >
                          {t.edit}
                        </button>
                        <button className="danger" onClick={() => void remove(payment)}>
                          {t.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={6}>{t.total}</td>
                  <td className="num">
                    <Money paise={total} />
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payments.length === 0 && editing === null && (
        <div className="card empty-state">
          <div className="empty-state-icon">
            <Icon name="cheque" size={30} />
          </div>
          <h4>{t.noPfms}</h4>
          <p>{t.pfmsSubtitle}</p>
          <button className="primary" onClick={startNew}>
            {t.newPfms}
          </button>
        </div>
      )}

      {payments.length > 0 && shown.length === 0 && (
        <div className="card empty-state">
          <h4>{t.noMatchingRecords}</h4>
          <button className="ghost" onClick={() => setQuery("")}>
            {t.clearFilters}
          </button>
        </div>
      )}

      <LimitsCard t={t} limits={limits} onSaved={setLimits} />
    </>
  );
}

function PfmsForm({
  t,
  heads,
  bills,
  limits,
  payment,
  nextSerial,
  onCancel,
  onSave,
}: {
  t: Strings;
  heads: GrantHeadDto[];
  bills: BillDto[];
  limits: GrantLimitDto[];
  payment: ChequeDto | null;
  nextSerial: number;
  onCancel: () => void;
  onSave: (input: ChequeInput, id: number | null) => Promise<void>;
}): JSX.Element {
  const [serial, setSerial] = useState(String(payment?.chequeNo ?? nextSerial));
  const [ppaDate, setPpaDate] = useState(payment?.chequeDate ?? "");
  const [ppaNo, setPpaNo] = useState(payment?.ppaNo ?? "");
  const [paidDate, setPaidDate] = useState(payment?.cashbookDate ?? "");
  // Empty until a bill is ticked: the payment takes its bills' voucher number.
  const [voucherNo, setVoucherNo] = useState(payment?.voucherNo?.toString() ?? "");
  const [vendor, setVendor] = useState(payment?.payeeGu ?? "");
  const [purpose, setPurpose] = useState(payment?.purposeGu ?? "");
  const [billIds, setBillIds] = useState<number[]>(
    payment === null ? [] : bills.filter((bill) => bill.chequeId === payment.id).map((bill) => bill.id),
  );

  // Bills this payment may claim: unpaid ones, plus the ones it already holds.
  const available = bills.filter(
    (bill) => bill.chequeId === null || (payment !== null && bill.chequeId === payment.id),
  );
  const selected = bills.filter((bill) => billIds.includes(bill.id));

  // The split, computed exactly as the engine computes it.
  const allocation = new Map<number, number>();
  for (const bill of selected) {
    allocation.set(bill.grantHeadId, (allocation.get(bill.grantHeadId) ?? 0) + bill.netPaise);
  }
  const amountPaise = [...allocation.values()].reduce((sum, value) => sum + value, 0);

  // Each head's limit against what the other payments already use, plus this one.
  const overLimit = [...allocation.entries()].flatMap(([headId, share]) => {
    const limit = limits.find((row) => row.grantHeadId === headId);
    if (!limit || limit.limitPaise === null) return [];
    const ownBefore = payment?.allocation.find((row) => row.grantHeadId === headId)?.amountPaise ?? 0;
    const over = limit.usedPaise - ownBefore + share - limit.limitPaise;
    return over > 0 ? [t.overLimit(limit.headNameGu, formatAmount(over))] : [];
  });

  const valid =
    Number(serial) > 0 &&
    ppaDate !== "" &&
    paidDate !== "" &&
    ppaNo.trim() !== "" &&
    vendor.trim() !== "" &&
    purpose.trim() !== "" &&
    selected.length > 0;

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!valid) return;
    void onSave(
      {
        chequeNo: Number(serial),
        chequeDate: ppaDate,
        cashbookDate: paidDate,
        voucherNo: voucherNo === "" ? null : Number(voucherNo),
        payeeGu: vendor,
        purposeGu: purpose,
        type: "PFMS",
        ppaNo: ppaNo.trim(),
        billIds,
        typedAllocation: [],
      },
      payment?.id ?? null,
    );
  }

  return (
    <form className="card form-card" onSubmit={submit}>
      <div className="form-card-header">
        <h3 className="form-card-title">
          <span>{payment ? t.editPfms(payment.chequeNo) : t.newPfms}</span>
        </h3>
        {amountPaise > 0 && (
          <div className="calc-chip">
            <span>{t.pfmsAmount}:</span>
            <Money paise={amountPaise} />
          </div>
        )}
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="pfms-serial">{t.pfmsSerial}</label>
          <input
            id="pfms-serial"
            data-no-suggest
            className="num-input"
            inputMode="numeric"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pfms-ppadate">{t.ppaDate}</label>
          <DateInput id="pfms-ppadate" value={ppaDate} onChange={setPpaDate} required />
        </div>
        <div className="field">
          <label htmlFor="pfms-ppano">{t.ppaNo}</label>
          <input
            id="pfms-ppano"
            data-no-suggest
            value={ppaNo}
            onChange={(e) => setPpaNo(e.target.value.toUpperCase())}
            placeholder="C072548358355"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pfms-paid">{t.paidDate}</label>
          <DateInput id="pfms-paid" value={paidDate} onChange={setPaidDate} required />
        </div>
        <div className="field">
          <label htmlFor="pfms-voucher">{t.voucherNo}</label>
          <input
            id="pfms-voucher"
            data-no-suggest
            className="num-input"
            inputMode="numeric"
            value={voucherNo}
            onChange={(e) => setVoucherNo(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pfms-vendor">{t.pfmsVendor}</label>
          <input
            id="pfms-vendor"
            data-suggest="vendor.name"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pfms-purpose">{t.pfmsPurpose}</label>
          <input
            id="pfms-purpose"
            data-suggest="cheque.purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            required
          />
        </div>
      </div>

      <h3 style={{ marginTop: 14 }}>{t.pfmsBillsPaid}</h3>
      {available.length === 0 ? (
        <p className="muted">{t.noBillsAvailable}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th>{t.voucherNo}</th>
              <th>{t.billNo}</th>
              <th>{t.billDate}</th>
              <th>{t.billDescription}</th>
              <th>{t.grantHead}</th>
              <th className="num">{t.netAmount}</th>
            </tr>
          </thead>
          <tbody>
            {available.map((bill) => (
              <tr key={bill.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={billIds.includes(bill.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setBillIds((current) =>
                        checked ? [...current, bill.id] : current.filter((id) => id !== bill.id),
                      );
                      // The first bill ticked fills in what the PFMS row says, if still empty.
                      if (checked) {
                        if (vendor === "") setVendor(bill.vendorGu);
                        if (purpose === "") setPurpose(bill.descriptionGu);
                        if (voucherNo === "") setVoucherNo(String(bill.voucherNo));
                      }
                    }}
                  />
                </td>
                <td className="num">{bill.voucherNo}</td>
                <td className="num">{bill.billNo ?? "—"}</td>
                <td className="num">{formatDate(bill.billDate)}</td>
                <td>{bill.descriptionGu}</td>
                <td>{bill.headNameGu}</td>
                <td className="num">
                  <Money paise={bill.netPaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card" style={{ background: "var(--canvas)", marginTop: 14 }}>
        <table>
          <tbody>
            {[...allocation.entries()].map(([headId, share]) => (
              <tr key={headId}>
                <td>{heads.find((head) => head.id === headId)?.nameGu ?? headId}</td>
                <td className="num">
                  <Money paise={share} />
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <td>{t.pfmsAmount}</td>
              <td className="num">
                <Money paise={amountPaise} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {overLimit.length > 0 && (
        <div className="issue warning" style={{ marginTop: 12 }}>
          {overLimit.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}

      <div className="form-actions">
        <button className="primary" type="submit" disabled={!valid}>
          {t.save}
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

/**
 * The year's limit per grant head, with what is used and what is left. Typed
 * here, saved together, and copied to the other SMC schools from the saved
 * values - so the copy is never something the screen has not saved.
 */
function LimitsCard({
  t,
  limits,
  onSaved,
}: {
  t: Strings;
  limits: GrantLimitDto[];
  onSaved: (next: GrantLimitDto[]) => void;
}): JSX.Element {
  const initial = (): Record<number, string> =>
    Object.fromEntries(
      limits.map((row) => [row.grantHeadId, row.limitPaise === null ? "" : amountToInput(row.limitPaise)]),
    );
  const [typed, setTyped] = useState<Record<number, string>>(initial);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [applied, setApplied] = useState<ApplyLimitsResultDto | null>(null);

  // A save or a reload brings new limits: start the inputs from them again.
  useEffect(() => setTyped(initial()), [limits]);

  const parsed = limits.map((row) => {
    const text = (typed[row.grantHeadId] ?? "").trim();
    const limitPaise = text === "" ? null : tryParseAmount(text);
    return { row, text, limitPaise };
  });
  const unparsable = parsed.some((entry) => entry.text !== "" && entry.limitPaise === null);
  const dirty = parsed.some((entry) => entry.limitPaise !== entry.row.limitPaise);

  async function save(): Promise<void> {
    setBusy(true);
    setNote(null);
    setApplied(null);
    try {
      const result = await api.saveGrantLimits(
        parsed.map((entry) => ({ grantHeadId: entry.row.grantHeadId, limitPaise: entry.limitPaise })),
      );
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setNote(t.limitsSaved);
      onSaved(result.data);
    } finally {
      setBusy(false);
    }
  }

  async function applyToAll(): Promise<void> {
    if (!(await askConfirm(t.limitsApplyAllConfirm))) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await api.applyLimitsToAllSchools();
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setApplied(result.data);
    } finally {
      setBusy(false);
    }
  }

  const reasonText = (reason: ApplyLimitsResultDto["skipped"][number]["reason"]): string =>
    reason === "noSuchYear" ? t.limitsNoSuchYear : t.applyLayoutSkipped[reason];

  return (
    <div className="card">
      <h3>{t.limitsTitle}</h3>
      <p className="muted">{t.limitsSubtitle}</p>
      {issues.length > 0 && <IssueList issues={issues} />}
      <table>
        <thead>
          <tr>
            <th>{t.grantHead}</th>
            <th className="num">{t.limitColumn}</th>
            <th className="num">{t.limitUsed}</th>
            <th className="num">{t.limitRemaining}</th>
          </tr>
        </thead>
        <tbody>
          {parsed.map(({ row, limitPaise }) => {
            const remaining = limitPaise === null ? null : limitPaise - row.usedPaise;
            return (
              <tr key={row.grantHeadId}>
                <td>{row.headNameGu}</td>
                <td className="num">
                  <input
                    className="num-input"
                    inputMode="decimal"
                    data-no-suggest
                    aria-label={`${row.headNameGu} ${t.limitColumn}`}
                    value={typed[row.grantHeadId] ?? ""}
                    placeholder="0.00"
                    style={{ maxWidth: 140, textAlign: "right" }}
                    onChange={(e) => setTyped((current) => ({ ...current, [row.grantHeadId]: e.target.value }))}
                  />
                </td>
                <td className="num">
                  <Money paise={row.usedPaise} />
                </td>
                <td className="num" style={{ color: remaining !== null && remaining < 0 ? "var(--danger, #b42318)" : undefined }}>
                  {remaining === null ? t.limitNone : <Money paise={remaining} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="form-actions">
        <button className="primary" type="button" disabled={busy || !dirty || unparsable} onClick={() => void save()}>
          {t.limitsSave}
        </button>
        <button
          className="ghost"
          type="button"
          disabled={busy || dirty}
          title={dirty ? t.limitsUnsavedFirst : undefined}
          onClick={() => void applyToAll()}
        >
          {t.limitsApplyAll}
        </button>
        {note && <span className="muted">{note}</span>}
      </div>
      {applied && (
        <div className="muted" style={{ marginTop: 8 }}>
          <div>{applied.applied.length > 0 ? t.limitsApplied(applied.applied.length) : t.limitsAppliedNone}</div>
          {applied.skipped.map((skip) => (
            <div key={skip.profileId}>{t.limitsSkipped(skip.schoolNameGu, reasonText(skip.reason))}</div>
          ))}
        </div>
      )}
    </div>
  );
}
