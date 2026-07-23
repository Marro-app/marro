import { useState } from 'react';
import { C } from '../lib/theme.js';
import { fmt, todayStr, sanitizeMoneyInput } from '../lib/format.js';
import { Card, SectionTitle, XBtn, Banner, EmptyState, ChoiceGroup, InfoTip } from '../components/primitives.jsx';
import { DateField } from '../components/pickers.jsx';
import { useApp } from '../context/AppContext.js';
import { radioProps } from '../lib/ui-helpers.js';
import {
  effectiveFeePct, statutoryRate, isRateEstimated, isInterestDeferred,
  loanPrincipal, cashReceived, loanOfferedAmount, projectDebtAtGraduation, loanTypeKey,
  estimateRefunds, computeRunway, loanReturnWindows, refundNudgeState,
} from '../lib/loans.js';
import { disbFallbackDate, DAYS_PER_MONTH, DEFAULT_SAVINGS_APY, HYSA_RATE_RANGE_COPY, FDIC_INSURANCE_CAP } from '../lib/constants.js';

// Loans tab — Phase 2 ("Loans, Debt & Runway"), commits 4 + 6 (Refund Playbook).
//
// Every string in this file was checked against the plan's "no label ships
// that a confused M1 would need to google" banned-jargon table before this
// shipped: no "disbursement" (→ "money arrives"/"part"), no "principal"
// (→ "amount borrowed"), no "interest accrual" (→ "interest that has built
// up so far"), no "capitalization" (never shown), no bare "origination fee"
// (→ "the standard fee of about 1% the government takes off the top"), no "APY" (→ "interest
// rate"), no bare offered/accepted/disbursed (→ plain-English status labels).
// See docs/PRODUCT_DECISIONS.md "Phase 2 commit 4" for the read-through log.

// Exported so the "remove part preserves the loan total" fix (C3) is
// hand-checkable in isolation — see loans.test.js.
export function splitEvenly(total, n) {
  const cents = Math.round((Number(total) || 0) * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}
const newDisb = (academicYear, i, amount = 0) => ({ id: `db_${Date.now()}_${i}_${Math.floor(Math.random() * 1e4)}`, amount, date: disbFallbackDate(academicYear, i), dateConfirmed: false });
const blankLoan = () => {
  const y = new Date().getFullYear();
  return {
    id: `ln_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    name: '', type: 'federal', subtype: null, academicYear: y, rate: null,
    status: 'disbursed',
    offeredAmount: null,
    disbursements: [newDisb(y, 0), newDisb(y, 1)],
    feePct: null, notes: '',
    asOfBalance: null, asOfDate: null,
    // Interest deferral (null = derive default from the loan type; see isInterestDeferred).
    interestDeferred: null, interestStartDate: null,
  };
};

// ── 5-first-class loan-type picker (A2) ──────────────────────────────────────
// Each option writes BOTH `subtype` (drives the interest-model math in
// loans.js) and `type` (kept for legacy-math-fallback + sync compat, per the
// implementation plan §3.2: 1-3 store type:"federal", 4-6 store
// type:"private" — the HPSL family, "Private", and "Other" all get manual-
// rate-style handling if an older client ever reads just `type`).
const LOAN_TYPE_OPTIONS = [
  { key: 'directUnsubGrad', type: 'federal', label: 'Federal — Direct Unsubsidized (most common)' },
  { key: 'gradPLUS', type: 'federal', label: 'Federal — Grad PLUS' },
  { key: 'directUnsubUndergrad', type: 'federal', label: 'Federal — from college (undergrad)' },
  { key: 'hpsl', type: 'private', label: 'School health-professions loan (HPSL / Primary Care / LDS — often 5%)' },
  { key: 'private', type: 'private', label: 'Private' },
  { key: 'otherUserRate', type: 'private', label: "Other / I'll enter my rate" },
];
const HPSL_FAMILY = new Set(['hpsl', 'pcl', 'lds']);
const UNDERGRAD_KEYS = new Set(['directUnsubUndergrad', 'directSubUndergrad']);
// Loan types whose interest rate is set by rule rather than by the student:
// the HRSA family + Perkins carry a rate fixed by law; the Direct Loan family
// takes the government's rate for the year borrowed. Both are still editable
// (item 21) — we just show a heads-up when the student overrides a set rate.
const FIXED_STATUTORY_KEYS = new Set(['hpsl', 'pcl', 'lds', 'perkins']);
const GOV_TABLE_KEYS = new Set(['directUnsubGrad', 'gradPLUS', 'directUnsubUndergrad', 'directSubUndergrad']);
/** Which picker option should read as selected for a given loan — collapses pcl/lds onto the "hpsl" row per the design (identical profile; keys stay distinct in the data only). */
function pickerKeyFor(loan) {
  const key = loanTypeKey(loan);
  return HPSL_FAMILY.has(key) ? 'hpsl' : key;
}

const inputStyle = (extra = {}) => ({ border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', background: C.bg, color: C.text, fontSize: 13, boxSizing: 'border-box', ...extra });
// Labels use full-strength text (not textMid): form labels are load-bearing
// a11y content and must stay clearly legible on every surface, including the
// tinted info cards where a dimmer token dips under 4.5:1 in dark mode (item 12).
const labelStyle = { fontSize: 11, color: C.text, marginBottom: 4, display: 'block', fontWeight: 600 };

// ── #2 leading-zeros, the real fix ───────────────────────────────────────────
// sanitizeMoneyInput already strips a leading zero, but that alone never fixed
// the "050" the founder kept seeing: a controlled <input type="number"> whose
// sanitized value maps back to the SAME stored number makes React skip the DOM
// write (the value prop didn't change), so the literal "050" the user typed
// stays on screen. The fix is to write the cleaned string straight back onto
// the input node in the change handler — that corrects what's rendered whether
// or not React re-renders. EVERY money/percent input on the card routes its
// onChange through this, so they all behave. Returns the cleaned string.
const cleanNumInput = (e) => {
  const clean = sanitizeMoneyInput(e.target.value);
  if (e.target.value !== clean) e.target.value = clean; // strip the leading zero the user sees right now
  return clean;
};

// Why a loan's projected total is (or stays) an estimate — one plain-language
// reason per condition, so the Debt widget can explain exactly which fields to
// fill to make it exact, AND why a loan can legitimately stay an estimate even
// with every visible field filled (a private loan has no government formula).
function loanEstimateReasons(loan) {
  const reasons = [];
  const key = loanTypeKey(loan);
  if (key === 'private' || key === 'otherUserRate') {
    reasons.push(loan.rate != null
      ? 'It’s a private or “other” loan, which has no government-set rate or fee formula — so its total stays an estimate even with your rate filled in.'
      : 'It’s a private or “other” loan with no rate entered yet. Add its rate from your paperwork.');
  } else if (isRateEstimated(loan)) {
    reasons.push('Its school year isn’t in our rate table yet, so its rate is approximate. It becomes exact once that year’s rate is published.');
  }
  const disb = loan.disbursements || [];
  if (loan.asOfDate == null && (disb.length === 0 || disb.some((d) => !d.date))) {
    reasons.push('A money-arrival date is a guess. Set the date each part of the money lands to make it exact.');
  }
  return reasons;
}

// iOS-style switch. The whole row (track + label) is one role="switch" button,
// so it's keyboard-operable, has a ≥44px hit target, and announces its state.
function Toggle({ checked, onChange, label, describedBy }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '4px 0',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
      <span aria-hidden="true" style={{ flexShrink: 0, width: 42, height: 26, borderRadius: 13, padding: 2,
        display: 'inline-flex', alignItems: 'center',
        background: checked ? C.teal : C.surfaceMid, border: `1px solid ${checked ? C.teal : C.border}`,
        transition: 'background .15s, border-color .15s' }}>
        <span style={{ width: 20, height: 20, borderRadius: 10, background: checked ? C.bg : C.gray,
          transform: checked ? 'translateX(16px)' : 'translateX(0)', transition: 'transform .18s cubic-bezier(0.23,1,0.32,1)' }} />
      </span>
      <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, lineHeight: 1.4 }}>{label}</span>
    </button>
  );
}

const STATUS_OPTIONS = [
  { v: 'offered', label: 'Offered to me (haven’t accepted yet)' },
  { v: 'accepted', label: 'Accepted (money on the way)' },
  { v: 'disbursed', label: 'Money received' },
];

function SegButton({ active, onClick, children, ariaLabel }) {
  return (
    <button type="button" {...radioProps(active)} aria-label={ariaLabel}
      onClick={onClick}
      style={{ flex: 1, padding: '8px 10px', minHeight: 36, borderRadius: 8, border: `1px solid ${active ? C.teal : C.border}`,
        background: active ? C.tealLight : 'transparent', color: active ? C.teal : C.text,
        fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}>
      {children}
    </button>
  );
}

function LoanCard({ loan, idx, data, upd, moreOpen, toggleMore }) {
  const [pctText, setPctText] = useState(loan.rate != null ? String(Math.round(loan.rate * 1000) / 10) : '');
  const annualTotal = (loan.disbursements || []).reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const offered = loanOfferedAmount(loan);
  const asOfMode = loan.asOfDate != null;
  const rateHigh = pctText !== '' && Number(pctText) > 20;

  // School year shown as a full range (item 19) — 2026 → "2026–2027".
  const yearRange = `${loan.academicYear}–${loan.academicYear + 1}`;

  // ── Rate (item 21): the field is ALWAYS editable regardless of type. For a
  // type whose rate is set by rule, we leave `loan.rate` null (so the correct
  // statutory/government number keeps flowing from the rate table) and show
  // that number as the placeholder plus a plain-language note; typing a value
  // overrides it, and we warn that they've replaced a set rate.
  const typeKey = loanTypeKey(loan);
  const isFixedStatutory = FIXED_STATUTORY_KEYS.has(typeKey);
  const isGovTable = GOV_TABLE_KEYS.has(typeKey);
  const hasSetRate = isFixedStatutory || isGovTable;
  const rateOverridden = loan.rate != null;
  // The TRUE statutory rate for this type, ignoring any override (item 6 fix) —
  // used for the placeholder and the "this type's set rate is X%" heads-up.
  const statPct = hasSetRate ? (statutoryRate(loan) * 100).toFixed(2) : null;
  // The type's default fee (Grad PLUS 4.228%, other federal Direct ~1.057%, else 0),
  // ignoring any override — used as the fee-field placeholder.
  const feeDefaultPct = effectiveFeePct({ ...loan, feePct: null }) * 100;
  // Does this loan type carry an origination fee at all? Only the federal Direct
  // family + Grad PLUS do — HPSL/private/other are fee-free. Gates both the fee
  // field (#1) and the "cash actually received" line.
  const typeHasFee = effectiveFeePct({ ...loan, feePct: null }) > 0;
  // #1 — the fee is skimmed off the top: this is what actually lands in the
  // account (null in current-balance mode or when there's no fee).
  const cash = cashReceived(loan);
  const feeDisplayPct = +(effectiveFeePct(loan) * 100).toFixed(2);

  // Per-type entry framing (item 7): federal + school health-professions loans
  // come from an award letter (offer vs. accepted); private/other loans don't —
  // they just have a loan amount you're borrowing from a lender.
  const isFederal = loan.type === 'federal';
  const awardFraming = isFederal || HPSL_FAMILY.has(typeKey);
  const balanceSource = isFederal ? 'studentaid.gov' : 'your loan servicer';

  // Interest deferral toggle (founder decision) + its "starts on" date.
  const deferred = isInterestDeferred(loan);

  // ── 120-day return countdown (items 18 & 24, item 8): the 120-day return
  // rule is a FEDERAL (Direct Loan / Title IV) borrowers' right — it does NOT
  // apply to private loans or the HRSA health-professions family, so the
  // countdown is gated to federal Direct loans only. Tied to THIS loan,
  // computed fresh each render; shows the soonest-expiring open window.
  const isFederalReturn = GOV_TABLE_KEYS.has(typeKey);
  const myWindows = isFederalReturn ? loanReturnWindows([loan], todayStr()) : [];
  const returnWindow = myWindows.length ? myWindows.reduce((a, b) => (b.daysLeft < a.daysLeft ? b : a)) : null;

  const patch = (fn) => { const d = JSON.parse(JSON.stringify(data)); const l = d.loans[idx]; fn(l, d); upd(d); };

  const setAnnual = (v) => {
    const total = Math.max(0, Number(v) || 0);
    patch((l) => {
      const n = Math.max(1, (l.disbursements || []).length || 2);
      const amounts = splitEvenly(total, n);
      l.disbursements = (l.disbursements || []).map((d, i) => ({ ...d, amount: amounts[i] }));
    });
  };
  const addPart = () => patch((l) => {
    const n = (l.disbursements || []).length + 1;
    l.disbursements = [...(l.disbursements || []), newDisb(l.academicYear, n - 1)];
    const amounts = splitEvenly(l.disbursements.reduce((a, d) => a + (Number(d.amount) || 0), 0), n);
    l.disbursements = l.disbursements.map((d, i) => ({ ...d, amount: amounts[i] }));
  });
  // ⚠ FIX (2026-07-18 hotfix, break-testing finding C3): removing a part used
  // to just drop that row — and its dollar amount — from the loan entirely
  // (a $41,000 loan silently became $27,333 with no warning). "Add another
  // part" re-splits the loan's existing total across the new row count, so
  // removing a part now mirrors that: the remaining rows are re-split so the
  // loan's total borrowed is unchanged unless the student explicitly edits an
  // amount afterward.
  const removePart = (i) => patch((l) => {
    if ((l.disbursements || []).length <= 1) return;
    const total = l.disbursements.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const remaining = l.disbursements.filter((_, di) => di !== i);
    const amounts = splitEvenly(total, remaining.length);
    l.disbursements = remaining.map((d, di) => ({ ...d, amount: amounts[di] }));
  });

  return (
    <Card style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <XBtn label={`Remove loan ${loan.name || 'entry'}`} onClick={() => { const d = JSON.parse(JSON.stringify(data)); d.loans = d.loans.filter((l) => l.id !== loan.id); upd(d); }} />
      </div>

      {/* ── Always visible: name, type, school year, amount ── */}
      <div style={{ marginBottom: 12, paddingRight: 36 }}>
        <label style={labelStyle} htmlFor={`ln-name-${loan.id}`}>Name</label>
        <input id={`ln-name-${loan.id}`} type="text" value={loan.name} placeholder="e.g. Year 1 federal loan"
          aria-label="Loan name" onChange={(e) => patch((l) => { l.name = e.target.value; })}
          style={inputStyle({ width: '100%' })} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={labelStyle} htmlFor={`ln-type-${loan.id}`}>Type</label>
          <select id={`ln-type-${loan.id}`} value={pickerKeyFor(loan)} aria-label="Loan type"
            onChange={(e) => {
              const opt = LOAN_TYPE_OPTIONS.find((o) => o.key === e.target.value);
              patch((l) => { l.subtype = opt.key; l.type = opt.type; });
            }}
            style={inputStyle({ width: '100%' })}>
            {LOAN_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label style={labelStyle} htmlFor={`ln-year-${loan.id}`}>School year (start)</label>
          <input id={`ln-year-${loan.id}`} type="number" value={loan.academicYear} aria-label="School year the loan is for — enter the year it starts"
            onChange={(e) => patch((l) => { l.academicYear = Number(e.target.value) || l.academicYear; })}
            style={inputStyle({ width: '100%' })} />
          <div style={{ fontSize: 11, color: C.text, marginTop: 4 }}>School year {yearRange}</div>
        </div>
      </div>

      {UNDERGRAD_KEYS.has(loan.subtype) && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: C.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={loan.subtype === 'directSubUndergrad'}
            onChange={(e) => patch((l) => { l.subtype = e.target.checked ? 'directSubUndergrad' : 'directUnsubUndergrad'; })} />
          This one is Subsidized (interest-free while you’re in school)
        </label>
      )}

      <div style={{ marginBottom: 12 }}>
        <span style={labelStyle} id={`ln-entrymode-lbl-${loan.id}`}>What are you entering?</span>
        <ChoiceGroup role="radiogroup" ariaLabelledby={`ln-entrymode-lbl-${loan.id}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SegButton active={!asOfMode} ariaLabel={awardFraming ? 'From my award letter — what I was offered and what I accepted' : 'The loan amount I am borrowing'}
            onClick={() => patch((l) => { l.asOfDate = null; l.asOfBalance = null; })}>
            {awardFraming ? 'Award letter' : 'Loan amount'}
          </SegButton>
          <SegButton active={asOfMode} ariaLabel={`My current balance today${isFederal ? ' on studentaid.gov' : ''}`}
            onClick={() => patch((l) => { l.asOfDate = todayStr(); l.asOfBalance = Math.round(loanPrincipal(l) * 100) / 100; })}>
            Current balance
          </SegButton>
        </ChoiceGroup>
        <div style={{ fontSize: 11, color: C.text, marginTop: 6, lineHeight: 1.5 }}>
          {asOfMode
            ? `Current balance is what you owe today, from ${balanceSource} (interest already baked in).`
            : awardFraming
              ? 'Award letter is what your school offered and what you chose to accept. Use this if the loan is new.'
              : 'Loan amount is what you’re borrowing from your lender. Use this if the loan is new.'}
        </div>
      </div>

      {!asOfMode ? (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            {awardFraming && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor={`ln-offer-${loan.id}`}>
                    Amount offered <span style={{ fontWeight: 400, color: C.text }}>(optional)</span>
                  </label>
                  <InfoTip text="The full amount your award letter offered for this loan. You don't have to take all of it — record it here just for reference. It doesn't change what you owe." />
                </div>
                <input id={`ln-offer-${loan.id}`} type="number" min="0" value={loan.offeredAmount ?? ''} placeholder="$0"
                  aria-label="Amount offered in your award letter, optional"
                  onChange={(e) => { const v = cleanNumInput(e); patch((l) => { l.offeredAmount = v === '' ? null : Number(v) || 0; }); }}
                  style={inputStyle({ width: 150 })} />
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor={`ln-amt-${loan.id}`}>
                  {awardFraming
                    ? <>Amount you accepted <span style={{ fontWeight: 400, color: C.text }}>(what you borrow)</span></>
                    : <>Loan amount <span style={{ fontWeight: 400, color: C.text }}>(what you’re borrowing)</span></>}
                </label>
                {!awardFraming && <InfoTip text="The total you're borrowing from this lender — the amount you'll pay back, plus interest. Everything Marro shows is based on this number." />}
              </div>
              <input id={`ln-amt-${loan.id}`} type="number" min="0" value={annualTotal || ''} placeholder="$0"
                aria-label={awardFraming ? 'Amount you accepted — what you actually borrow and pay back' : 'Loan amount — what you are borrowing and pay back'}
                onChange={(e) => setAnnual(cleanNumInput(e))} style={inputStyle({ width: 150 })} />
            </div>
          </div>
          {awardFraming && (
            <div style={{ fontSize: 11, color: C.text, marginBottom: 8, lineHeight: 1.5 }}>
              You can accept less than you&apos;re offered. Everything Marro shows — what you&apos;ll owe and its interest — is based on the amount you accepted.
            </div>
          )}
          {awardFraming && offered != null && annualTotal > 0 && annualTotal < offered && (
            <div style={{ fontSize: 11, color: C.text, marginBottom: 10, lineHeight: 1.5 }}>
              You accepted <strong style={{ color: C.text }}>{fmt(annualTotal)}</strong> of the <strong style={{ color: C.text }}>{fmt(offered)}</strong> offered.
            </div>
          )}
          {/* #1 — the fee reduces the cash you RECEIVE; you still owe the full accepted amount. */}
          {cash != null && annualTotal > 0 && (
            <div style={{ fontSize: 11, color: C.text, marginBottom: 10, lineHeight: 1.5 }}>
              About <strong style={{ color: C.text }}>{fmt(cash)}</strong> actually reaches your account (after the {feeDisplayPct}% fee). You still owe the full <strong style={{ color: C.text }}>{fmt(annualTotal)}</strong>.
            </div>
          )}
          <div style={{ fontSize: 11, color: C.text, marginBottom: 10, lineHeight: 1.5 }}>
            {isFederal
              ? <>Don&apos;t have your numbers? Log into studentaid.gov → Dashboard → click a loan for its exact amounts, dates, and rate.</>
              : awardFraming
                ? <>Don&apos;t have your numbers? Check your award letter or ask your school&apos;s financial aid office for the exact amounts and dates.</>
                : <>Don&apos;t have your numbers? Check your lender&apos;s website or welcome packet for the exact amounts, dates, and rate.</>}
          </div>

          <div style={{ fontSize: 11, color: C.text, marginBottom: 6, fontWeight: 600 }}>This usually arrives in two parts — fall and spring:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {(loan.disbursements || []).map((d, i) => (
              <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" min="0" value={d.amount || ''} aria-label={`Part ${i + 1} amount`}
                  onChange={(e) => { const v = cleanNumInput(e); patch((l) => { l.disbursements[i].amount = Number(v) || 0; }); }}
                  style={inputStyle({ width: 100 })} />
                <DateField value={d.date || ''} ariaLabel={`Part ${i + 1} — about when the money arrives`}
                  onChange={(v) => patch((l) => { l.disbursements[i].date = v; l.disbursements[i].dateConfirmed = true; })}
                  style={{ width: 130, fontSize: 12, padding: '5px 8px' }} />
                {(loan.disbursements || []).length > 1 && (
                  <XBtn label={`Remove part ${i + 1}`} size={26} iconSize={12} onClick={() => removePart(i)} />
                )}
              </div>
            ))}
          </div>
          <button type="button" className="txt-act" onClick={addPart}
            style={{ background: 'none', border: 'none', color: C.teal, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}>
            + add another part
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={labelStyle} htmlFor={`ln-asof-bal-${loan.id}`}>What you owe today</label>
            <input id={`ln-asof-bal-${loan.id}`} type="number" min="0" value={loan.asOfBalance || ''} aria-label="What you owe today, from studentaid.gov"
              onChange={(e) => { const v = cleanNumInput(e); patch((l) => { l.asOfBalance = Number(v) || 0; }); }} style={inputStyle({ width: '100%' })} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <span style={labelStyle}>As of</span>
            <DateField value={loan.asOfDate || todayStr()} ariaLabel="Balance as-of date"
              onChange={(v) => patch((l) => { l.asOfDate = v; })} style={{ width: '100%', fontSize: 12, padding: '5px 8px' }} />
          </div>
        </div>
      )}

      {/* ── 120-day return countdown (items 18 & 24) ──
          Replaces the two duplicate top-of-tab return banners with a compact
          line embedded in the card it belongs to. Recomputed fresh each render
          (see `returnWindow` above), so an edited date is never stale. */}
      {returnWindow && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', background: C.blueLight, border: `1px solid ${C.blueMid}`, borderRadius: 8 }}>
          <div style={{ flex: 1, fontSize: 12, color: C.text, lineHeight: 1.6 }}>
            <strong style={{ color: C.text }}>
              {returnWindow.dateConfirmed ? `${returnWindow.daysLeft} days left` : `About ${returnWindow.daysLeft} days left`}
            </strong>{' '}to return money from this loan you didn&apos;t need. The interest and fee on anything you send back are cancelled — like you never borrowed it.
            {!returnWindow.dateConfirmed && ' Confirm the exact deadline with your aid office.'} Your aid office handles it.
          </div>
          <InfoTip text="Federal loans can be returned within 120 days of the money arriving. Returning unused money cancels its interest and fee, as if it never happened." />
        </div>
      )}

      {/* ── Interest: rate + deferral (items 6, 9, 21) ──
          The rate field is ALWAYS editable. For a type whose rate is set by
          rule (HRSA family fixed by law; Direct Loan family = the government's
          rate for the year borrowed) we leave `loan.rate` null so the correct
          number keeps flowing from the rate table and show it as the
          placeholder. The "this type's set rate is X%" explanation now lives in
          a keyboard-reachable InfoTip (item 6) and always shows the TRUE
          statutory rate (`statPct`), never whatever the student typed. */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor={`ln-rate-${loan.id}`}>Interest rate (as a percent)</label>
          <InfoTip text={
            isFixedStatutory
              ? `This loan type's rate is set by law at ${statPct}%.${rateOverridden ? ` You've entered a different rate — clear the field to use ${statPct}% again.` : ' Leave the field blank to use it, or type your own from your paperwork.'}`
              : isGovTable
                ? `The government sets the rate for ${yearRange} loans at ${statPct}%.${rateOverridden ? ` You've entered a different rate — clear the field to use ${statPct}% again.` : ' Leave the field blank to use it, or type your own from your paperwork.'}`
                : "Enter the interest rate from your loan paperwork or your lender's website."
          } />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input id={`ln-rate-${loan.id}`} type="number" min="0" max="30" step="0.01" value={pctText}
            placeholder={hasSetRate ? statPct : 'e.g. 7.94'} aria-label="Interest rate as a percent"
            onChange={(e) => { const t = cleanNumInput(e); setPctText(t); const n = Number(t); patch((l) => { l.rate = t === '' ? null : (isNaN(n) ? l.rate : n / 100); }); }}
            style={inputStyle({ width: 90 })} />
          <span style={{ fontSize: 12, color: C.text }}>%</span>
          {pctText !== '' && !rateHigh && <span style={{ fontSize: 11, color: C.teal }} aria-hidden="true">✓</span>}
        </div>
        {rateHigh && <div role="alert" style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>That seems high — double-check?</div>}
        {!rateOverridden && !hasSetRate && (
          <div style={{ fontSize: 11, color: C.text, marginTop: 4, lineHeight: 1.5 }}>
            Enter the rate from your loan paperwork.
          </div>
        )}

        {/* Interest deferral toggle (founder decision): default ON for
            HPSL/subsidized, OFF for unsubsidized/private — editable per loan. */}
        <div style={{ marginTop: 8 }}>
          <Toggle checked={deferred} label="Interest isn’t accruing yet"
            describedBy={`ln-defer-hint-${loan.id}`}
            onChange={(next) => patch((l) => { l.interestDeferred = next; if (!next) l.interestStartDate = null; })} />
          <div id={`ln-defer-hint-${loan.id}`} style={{ fontSize: 11, color: C.text, marginTop: 2, lineHeight: 1.5 }}>
            {deferred
              ? 'While this is on, Marro adds no interest until the date you set below.'
              : 'Interest is building from the day each part of the money arrives.'}
          </div>
          {deferred && (
            <div style={{ marginTop: 8, maxWidth: 200 }}>
              <span style={labelStyle}>Interest starts on</span>
              <DateField value={loan.interestStartDate || ''} ariaLabel="Date interest starts accruing"
                onChange={(v) => patch((l) => { l.interestStartDate = v; })}
                style={{ width: '100%', fontSize: 12, padding: '5px 8px' }} />
              {!loan.interestStartDate && (
                <div style={{ fontSize: 11, color: C.text, marginTop: 4, lineHeight: 1.5 }}>
                  No date yet, so Marro adds no interest for this loan. Set the date interest kicks in — often when you finish school or residency.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── More options (#9) ──
          The WHOLE row is one full-width button, so clicking anywhere along it —
          not just on the chevron — toggles the section. Keyboard-operable with a
          correct aria-expanded/aria-controls; the chevron is decorative. */}
      <button type="button" onClick={toggleMore} aria-expanded={moreOpen} aria-controls={`ln-more-${loan.id}`}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%',
          background: 'none', border: 'none', color: C.text, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          padding: '12px 0 4px', minHeight: 44, textAlign: 'left' }}>
        <span>{moreOpen ? 'Hide options' : 'More options'}</span>
        <span aria-hidden="true" style={{ fontSize: 11, color: C.textMid, transition: 'transform .15s',
          transform: moreOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
      </button>
      {moreOpen && (
        <div id={`ln-more-${loan.id}`} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle} htmlFor={`ln-status-${loan.id}`}>Status</label>
            <select id={`ln-status-${loan.id}`} value={loan.status} aria-label="Loan status"
              onChange={(e) => patch((l) => { l.status = e.target.value; })} style={inputStyle({ width: '100%' })}>
              {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          {/* #1 — the loan fee only exists for the federal Direct family + Grad
              PLUS, and only matters when entering award-letter amounts (in
              current-balance mode the fee is already baked into the balance).
              Hidden entirely for HPSL/private/other and in current-balance mode. */}
          {!asOfMode && typeHasFee && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor={`ln-fee-${loan.id}`}>Loan fee (%)</label>
                <InfoTip text="Federal loans take a small fee off the top before the money reaches you. You still owe the full amount you accepted — the fee just means a little less cash lands in your account. Leave blank to use the standard fee, or type your own from your paperwork." />
              </div>
              <input id={`ln-fee-${loan.id}`} type="number" min="0" max="10" step="0.01"
                value={loan.feePct != null ? +(loan.feePct * 100).toFixed(3) : ''}
                placeholder={String(+(feeDefaultPct).toFixed(3))} aria-label="Loan fee as a percent"
                onChange={(e) => { const v = cleanNumInput(e); patch((l) => { l.feePct = v === '' ? null : (Number(v) / 100); }); }}
                style={inputStyle({ width: 100 })} />
            </div>
          )}
          <div>
            <label style={labelStyle} htmlFor={`ln-notes-${loan.id}`}>Notes</label>
            <textarea id={`ln-notes-${loan.id}`} value={loan.notes || ''} aria-label="Notes about this loan" rows={2}
              onChange={(e) => patch((l) => { l.notes = e.target.value; })} style={inputStyle({ width: '100%', resize: 'vertical', fontFamily: 'inherit' })} />
          </div>
        </div>
      )}
    </Card>
  );
}

function BalanceCheckin({ data, upd }) {
  const readings = data.balanceReadings || [];
  const sorted = [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = sorted[sorted.length - 1] || null;
  const lastSavings = [...sorted].reverse().find((r) => r.savings != null);

  const [spendable, setSpendable] = useState('');
  const [savings, setSavings] = useState(lastSavings ? String(lastSavings.savings) : '');
  const [confirming, setConfirming] = useState(false);

  const needsConfirm = (n) => {
    if (!last) return false;
    const prev = Number(last.spendable) || 0;
    if (Math.abs(n - prev) > 20000) return true;
    if (prev > 0 && (n > prev * 3 || n < prev / 3)) return true;
    return false;
  };

  const save = () => {
    const n = Number(spendable);
    if (isNaN(n)) return;
    const d = JSON.parse(JSON.stringify(data));
    d.balanceReadings = [...(d.balanceReadings || []), {
      id: `br_${Date.now()}`, date: todayStr(), spendable: n,
      savings: savings === '' ? null : Number(savings),
    }];
    upd(d);
    setSpendable('');
    setConfirming(false);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const n = Number(spendable);
    if (isNaN(n) || spendable === '') return;
    if (!confirming && needsConfirm(n)) { setConfirming(true); return; }
    save();
  };

  return (
    <Card>
      <SectionTitle sub="No bank login, no linking accounts — just the number you see when you check your balance.">
        About how much do you have available for living costs right now?
      </SectionTitle>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="bal-spendable">Amount in your checking / cash</label>
            <InfoTip text="What's in your checking/spending account today. Aid or loan money counts once it's landed in your account." />
          </div>
          <input id="bal-spendable" type="number" min="0" value={spendable} placeholder="$0" required
            aria-label="Amount in your checking / cash, across all accounts you spend from"
            onChange={(e) => { setSpendable(cleanNumInput(e)); setConfirming(false); }}
            style={inputStyle({ width: 130 })} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="bal-savings">Set aside in savings</label>
          <input id="bal-savings" type="number" min="0" value={savings} placeholder="$0"
            aria-label="Set aside in savings, optional"
            onChange={(e) => setSavings(cleanNumInput(e))} style={inputStyle({ width: 130 })} />
        </div>
        <button type="submit" className="btn-pop" style={{ padding: '8px 18px', minHeight: 36, borderRadius: 8, border: `1px solid ${C.teal}`, background: C.teal, color: C.bg, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Save
        </button>
      </form>
      {confirming && (
        <div role="alert" style={{ marginTop: 10 }}>
          <Banner type="warn">
            Big change from last time — just checking?
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setConfirming(false)} style={{ padding: '6px 12px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Let me fix it</button>
              <button type="button" onClick={save} style={{ padding: '6px 12px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.amber}`, background: C.amber, color: C.bg, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, that’s right</button>
            </div>
          </Banner>
        </div>
      )}

      {sorted.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.text, marginBottom: 8, fontWeight: 600 }}>Past check-ins</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {[...sorted].reverse().map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: C.text }}>{new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span style={{ color: C.text, fontWeight: 600 }}>{fmt(r.spendable)}{r.savings != null ? ` + ${fmt(r.savings)} savings` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── 120-day return window (items 18 & 24) ────────────────────────────────────
// The old design rendered a separate full-width banner PER open window at the
// top of the tab — two loans meant two near-identical "you can still return
// borrowed money" cards with different day counts and no way to tell which loan
// each belonged to or to dismiss them. That's gone: the countdown now lives
// inside each loan's own card (see `returnWindow` in LoanCard), so it's always
// clear which loan it's about. The surplus-dollar estimate that used to ride
// along here was dropped with it — the embedded line keeps the plain-language
// education without inventing a per-window savings figure.

// Item 17: the ✕ and the old "Remind me later" button did the exact same
// thing — hide the banner until the next visit (no timed reminder is ever
// scheduled). Only "Don't show this again" is permanent. The old copy implied
// a schedule that didn't exist, so it's gone: the ✕ IS the dismiss-for-now
// action (the banner simply comes back next visit), and the one remaining
// button is the honest permanent opt-out.
function ReminderBanner({ data, upd }) {
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  if ((data.loans || []).length > 0 || data.loanReminderSnooze != null || dismissedThisSession) return null;
  return (
    <Banner type="info" onClose={() => setDismissedThisSession(true)}>
      Add your loans so Marro can show what you’ll really owe at graduation — interest included. Closing this hides it for now; it comes back next time you open Marro.
      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        <button type="button" className="txt-act" onClick={() => { const d = JSON.parse(JSON.stringify(data)); d.loanReminderSnooze = { choice: 'never', at: new Date().toISOString() }; upd(d); }} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Don’t show this again</button>
      </div>
    </Banner>
  );
}

// ── Refund Playbook (commit 6) ──────────────────────────────────────────────
// One-time educational card that appears when a semester's aid refund lands
// (walkthrough §7) — see the plan's "Refund Playbook card" content rules
// (compliance-reviewed): a range not bank names, earnings framed as an
// example, FDIC stated accurately, a tax-form heads-up, the 120-day return
// window framed as "many students choose to…" never "you should," never a
// suggestion to invest, and a footer disclaimer that this is education, not
// individualized advice. Dismissing writes refundPlaybookSeen so it shows at
// most once per semester's refund. A days-count in the return-window bullet
// is only ever a hard number when the disbursement date was user-confirmed
// (dateConfirmed) — otherwise it reads as a soft "about N days."
const MONTH_MS = DAYS_PER_MONTH * 24 * 60 * 60 * 1000;
// The illustrative APY used to estimate "parking money in savings" earnings.
// ⚠ Was a private local constant here (0.04) while SavingsTab's Growth
// Projector had its OWN independent, un-persisted 4.5% default — two
// disagreeing "assumed rate" values (hardcoded-values-audit.md 2.1/2.2).
// Now both read the one shared default; Package B's Money Plan tab will let
// the student override it (persisted to `moneyPlanRateSeen`), and this will
// read that override too.
const PLAYBOOK_APY = DEFAULT_SAVINGS_APY;

function RefundPlaybook({ data, upd, moSpend, refundNudgeConfirmed, setRefundNudgeConfirmed }) {
  const today = todayStr();
  const gradDate = data.years?.[data.years.length - 1]?.endDate || null;
  const readings = data.balanceReadings || [];
  const refunds = estimateRefunds(data.years || []);
  const seen = data.refundPlaybookSeen;

  // Shared with the header nudge (App.jsx) via refundNudgeState, so both
  // surfaces agree on exactly the same candidate term and never disagree
  // about whether the full card or just the "did it land?" nudge should show.
  const { candidate, showPlaybook: show } = refundNudgeState({
    years: data.years, readings, refundPlaybookSeen: seen, today, confirmedTerm: refundNudgeConfirmed,
  });

  if (!candidate) return null;

  const dismiss = () => {
    const d = JSON.parse(JSON.stringify(data));
    d.refundPlaybookSeen = { term: candidate.term, at: new Date().toISOString() };
    upd(d);
    setRefundNudgeConfirmed(null);
  };

  // ⚠ FIX (2026-07-18 hotfix, break-testing finding H1): this used to render
  // its own "Did your refund land?" banner here too — a second, NON-dismissible
  // copy of the header's nudge (App.jsx, same `refundNudgeState` candidate),
  // so the two stacked and only one had a working X. The header banner is the
  // single source of truth for the nudge (it's dismissible and its "Yes, it
  // landed" button already routes here via `setTab("loans")`); this component
  // only ever renders the full Playbook card below, once `show` is true.
  if (!show) return null;

  // ── Numbers this card shows — every one is computed, never guessed ──
  const sortedReadings = [...readings].filter((r) => r.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sortedReadings[sortedReadings.length - 1] || null;
  const spendable = latest ? Number(latest.spendable) || 0 : null;

  const nextAfter = refunds.find((r) => r.date && r.date > candidate.date) || null;
  const horizonDate = nextAfter?.date || gradDate;
  const monthsNeeded = horizonDate ? Math.max(1, Math.round((new Date(horizonDate + 'T12:00:00') - new Date(candidate.date + 'T12:00:00')) / MONTH_MS)) : null;

  const upcomingForBurn = refunds.filter((r) => r.date && r.date > candidate.date);
  const runway = computeRunway({ readings, plannedMonthlyBurn: moSpend, upcomingRefunds: upcomingForBurn, gradDate, today });
  // A measured burn straddling the refund that JUST landed reads as strongly
  // negative/"growing" (the refund itself looks like a giant month of savings) —
  // that's real math, not a bug, but useless for "what does the rest of the
  // semester cost." Fall back to the plan whenever the measured number isn't a
  // real positive spend rate.
  const burnAmount = runway.burn?.amount > 0 ? runway.burn.amount : (moSpend ?? null);

  const semesterNeed = monthsNeeded != null && burnAmount != null ? monthsNeeded * burnAmount : null;
  const parkAmount = spendable != null && semesterNeed != null ? Math.max(spendable - semesterNeed, 0) : null;
  const monthsToHorizon = monthsNeeded;
  const earningsEstimate = parkAmount != null && monthsToHorizon != null ? parkAmount * PLAYBOOK_APY * (monthsToHorizon / 12) : null;

  // The 120-day return right is federal Direct-loan only (item 8) — never
  // count private or HRSA health-professions loans toward this bullet.
  const federalLoans = (data.loans || []).filter((l) => GOV_TABLE_KEYS.has(loanTypeKey(l)));
  const windows = loanReturnWindows(federalLoans, today).sort((a, b) => a.daysLeft - b.daysLeft);
  const window = windows[0] || null;

  return (
    <div role="region" aria-labelledby="playbook-heading" style={{ background: C.blueLight, border: `1px solid ${C.blueMid}`, borderRadius: 12, padding: '16px 18px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 10, right: 10 }}>
        <XBtn label="Dismiss — I've seen this" onClick={dismiss} />
      </div>
      <div id="playbook-heading" style={{ fontSize: 15, fontWeight: 700, color: C.text, paddingRight: 30 }}>Your refund landed — a smart way to think about it</div>

      <ol style={{ margin: '12px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: C.text, lineHeight: 1.55 }}>
        <li>
          {semesterNeed != null
            ? <>This stretch needs about <strong>{fmt(semesterNeed)}</strong> ({monthsNeeded} month{monthsNeeded === 1 ? '' : 's'} × your pace of about {fmt(burnAmount)}/month).</>
            : <>Add your budget and a balance check-in and Marro can estimate what this stretch needs to cover.</>}
          {' '}Many students keep about one month&apos;s worth in checking.
        </li>
        <li>
          Consider parking the rest in savings.{' '}
          {parkAmount != null && parkAmount > 0
            ? <>Many online banks currently pay {HYSA_RATE_RANGE_COPY} — {fmt(parkAmount)} parked for {monthsToHorizon} month{monthsToHorizon === 1 ? '' : 's'} could earn about {fmt(earningsEstimate)} while staying instantly available and FDIC-insured (covered up to {fmt(FDIC_INSURANCE_CAP)} per bank).</>
            : <>Many online banks currently pay {HYSA_RATE_RANGE_COPY} while staying instantly available and FDIC-insured (covered up to {fmt(FDIC_INSURANCE_CAP)} per bank).</>}
          {' '}(Heads up: savings interest may generate a small tax form — usually called a 1099-INT.)
        </li>
        <li>
          Borrowed more than you need? Unused federal loan money can be returned within 120 days of when it arrives — the interest and the fee on the returned part are cancelled, like it never happened.
          {window
            ? <> {window.dateConfirmed
                ? <>You have <strong>{window.daysLeft} days</strong> left on that money.</>
                : <>You have <strong>about {window.daysLeft} days</strong> left — confirm the exact date with your aid office.</>}</>
            : null}
          {' '}Your financial aid office can help you decide.
        </li>
      </ol>

      <div style={{ marginTop: 12, fontSize: 10.5, color: C.text, lineHeight: 1.5 }}>
        General education, not individualized financial advice — confirm specifics with your loan servicer or aid office.
      </div>
    </div>
  );
}

export function LoansTab() {
  const { data, upd, moSpend, refundNudgeConfirmed, setRefundNudgeConfirmed } = useApp();
  const [moreOpenIds, setMoreOpenIds] = useState(() => new Set());
  const toggleMore = (id) => setMoreOpenIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const loans = data.loans || [];
  const gradDate = data.years?.[data.years.length - 1]?.endDate || null;
  const proj = projectDebtAtGraduation(loans, gradDate);
  const counted = loans.filter((l) => l.status === 'accepted' || l.status === 'disbursed');

  // Item 11: spell out WHY the total is an estimate instead of the old, confusing
  // "add your loans to make this exact" (shown even after loans were added). Each
  // reason maps to a real driver of `proj.isEstimate` in loans.js.
  const estimateReasons = [];
  if (proj.isEstimate && counted.length > 0) {
    const flags = { private: false, rate: false, dates: false };
    for (const l of counted) {
      const key = loanTypeKey(l);
      if (key === 'private' || key === 'otherUserRate') flags.private = true;
      else if (isRateEstimated(l)) flags.rate = true;
      const disb = l.disbursements || [];
      if (l.asOfDate == null && (disb.length === 0 || disb.some((d) => !d.date))) flags.dates = true;
    }
    if (flags.private) estimateReasons.push('a private or “other” loan, which has no government-set rate or fee formula');
    if (flags.rate) estimateReasons.push('a loan whose school year isn’t in our rate table yet, so its rate is approximate');
    if (flags.dates) estimateReasons.push('a money-arrival date Marro had to guess');
  }

  const addLoan = () => { const d = JSON.parse(JSON.stringify(data)); d.loans = [...(d.loans || []), blankLoan()]; upd(d); };

  return (
    <div role="tabpanel" id="tab-panel" aria-labelledby="tab-loans" tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <RefundPlaybook data={data} upd={upd} moSpend={moSpend} refundNudgeConfirmed={refundNudgeConfirmed} setRefundNudgeConfirmed={setRefundNudgeConfirmed} />
      <ReminderBanner data={data} upd={upd} />

      {loans.length === 0 && (
        <EmptyState>
          Loans are money you’ll pay back after school. Most students take one per school year — add yours and Marro tracks what they’ll really cost.
        </EmptyState>
      )}

      {counted.length > 0 && (
        <Card>
          <SectionTitle>What you’ll owe at graduation, interest included</SectionTitle>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.text, fontFamily: "'Newsreader',Georgia,serif" }}>{fmt(proj.total)}</div>
          {proj.isEstimate && (
            <div style={{ marginTop: 10 }}>
              <Banner type="info">
                {counted.length === 0
                  ? 'Estimate — add your loans to make this exact.'
                  : estimateReasons.length > 0
                    ? <><strong>This total includes an estimate</strong> because it uses {estimateReasons.join('; ')}. Federal loans with a confirmed rate and dates are calculated exactly.</>
                    : 'This total includes an estimate. Federal loans with a confirmed rate and dates are calculated exactly.'}
              </Banner>
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {proj.byLoan.map((row) => {
              const loan = loans.find((l) => l.id === row.loanId);
              const reasons = row.isEstimate && loan ? loanEstimateReasons(loan) : [];
              return (
                <div key={row.loanId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: C.text }}>{loan?.name || 'Untitled loan'}</span>
                  <span style={{ color: C.text, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {fmt(row.total)}
                    {row.isEstimate && (
                      <>
                        <span style={{ color: C.text, fontWeight: 400 }}>(estimate)</span>
                        {/* #5 — the "estimate" is explainable: exactly why this loan
                            is an estimate and what to fill to make it exact. */}
                        <InfoTip text={reasons.length > 0
                          ? `This total is an estimate: ${reasons.join(' ')}`
                          : 'This total is an estimate.'} />
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
        {loans.map((loan, i) => (
          <LoanCard key={loan.id} loan={loan} idx={i} data={data} upd={upd}
            moreOpen={moreOpenIds.has(loan.id)} toggleMore={() => toggleMore(loan.id)} />
        ))}
        <button type="button" aria-label="Add loan" onClick={addLoan}
          style={{ width: '100%', font: 'inherit', background: 'transparent', border: `2px dashed ${C.border}`, borderRadius: 12, minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', color: C.text, transition: 'border-color 0.15s, color 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text; }}>
          <span style={{ fontSize: 24, fontWeight: 300, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Add loan</span>
        </button>
      </div>

      <BalanceCheckin data={data} upd={upd} />
    </div>
  );
}
