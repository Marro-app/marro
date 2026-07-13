import { useState } from 'react';
import { C } from '../lib/theme.js';
import { fmt, todayStr } from '../lib/format.js';
import { Card, SectionTitle, XBtn, Banner, EmptyState, ChoiceGroup } from '../components/primitives.jsx';
import { DateField } from '../components/pickers.jsx';
import { useApp } from '../context/AppContext.js';
import { radioProps } from '../lib/ui-helpers.js';
import {
  effectiveRate, isRateEstimated, loanPrincipal, projectDebtAtGraduation,
  estimateRefunds, computeRunway, loanReturnWindows, refundNudgeState,
} from '../lib/loans.js';

// Loans tab — Phase 2 ("Loans, Debt & Runway"), commits 4 + 6 (Refund Playbook).
//
// Every string in this file was checked against the plan's "no label ships
// that a confused M1 would need to google" banned-jargon table before this
// shipped: no "disbursement" (→ "money arrives"/"part"), no "principal"
// (→ "amount borrowed"), no "interest accrual" (→ "interest that has built
// up so far"), no "capitalization" (never shown), no bare "origination fee"
// (→ "the ~1% fee the government takes off the top"), no "APY" (→ "interest
// rate"), no bare offered/accepted/disbursed (→ plain-English status labels).
// See docs/PRODUCT_DECISIONS.md "Phase 2 commit 4" for the read-through log.

const DISB_DEFAULTS = [
  { m: 8, d: 5, yrOffset: 0 },
  { m: 1, d: 10, yrOffset: 1 },
  { m: 3, d: 1, yrOffset: 1 },
  { m: 5, d: 1, yrOffset: 1 },
];
const pad2 = (n) => String(n).padStart(2, '0');
function defaultDisbDate(academicYear, i) {
  const t = DISB_DEFAULTS[i % DISB_DEFAULTS.length];
  return `${academicYear + t.yrOffset}-${pad2(t.m)}-${pad2(t.d)}`;
}
function splitEvenly(total, n) {
  const cents = Math.round((Number(total) || 0) * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}
const newDisb = (academicYear, i, amount = 0) => ({ id: `db_${Date.now()}_${i}_${Math.floor(Math.random() * 1e4)}`, amount, date: defaultDisbDate(academicYear, i), dateConfirmed: false });
const blankLoan = () => {
  const y = new Date().getFullYear();
  return {
    id: `ln_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    name: '', type: 'federal', academicYear: y, rate: null,
    status: 'disbursed',
    disbursements: [newDisb(y, 0), newDisb(y, 1)],
    feePct: null, notes: '',
    asOfBalance: null, asOfDate: null,
  };
};

const inputStyle = (extra = {}) => ({ border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', background: C.bg, color: C.text, fontSize: 13, boxSizing: 'border-box', ...extra });
const labelStyle = { fontSize: 11, color: C.textMid, marginBottom: 4, display: 'block', fontWeight: 600 };

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
        background: active ? C.tealLight : 'transparent', color: active ? C.teal : C.textMid,
        fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}>
      {children}
    </button>
  );
}

function LoanCard({ loan, idx, data, upd, moreOpen, toggleMore }) {
  const [pctText, setPctText] = useState(loan.rate != null ? String(Math.round(loan.rate * 1000) / 10) : '');
  const annualTotal = (loan.disbursements || []).reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const asOfMode = loan.asOfDate != null;
  const estimated = isRateEstimated(loan);
  const rateHigh = pctText !== '' && Number(pctText) > 20;

  const patch = (fn) => { const d = JSON.parse(JSON.stringify(data)); const l = d.loans[idx]; fn(l, d); upd(d); };

  const setAnnual = (v) => {
    const total = Number(v) || 0;
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
  const removePart = (i) => patch((l) => {
    if ((l.disbursements || []).length <= 1) return;
    l.disbursements = l.disbursements.filter((_, di) => di !== i);
  });

  return (
    <Card style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <XBtn label={`Delete loan ${loan.name || 'entry'}`} danger onClick={() => { const d = JSON.parse(JSON.stringify(data)); d.loans = d.loans.filter((l) => l.id !== loan.id); upd(d); }} />
      </div>

      {/* ── Always visible: name, type, school year, amount ── */}
      <div style={{ marginBottom: 12, paddingRight: 36 }}>
        <label style={labelStyle} htmlFor={`ln-name-${loan.id}`}>Name</label>
        <input id={`ln-name-${loan.id}`} type="text" value={loan.name} placeholder="e.g. Year 1 federal loan"
          aria-label="Loan name" onChange={(e) => patch((l) => { l.name = e.target.value; })}
          style={inputStyle({ width: '100%' })} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <span style={labelStyle} id={`ln-type-lbl-${loan.id}`}>Type</span>
          <ChoiceGroup role="radiogroup" ariaLabelledby={`ln-type-lbl-${loan.id}`} style={{ display: 'flex', gap: 6 }}>
            <SegButton active={loan.type === 'federal'} ariaLabel="Federal loan" onClick={() => patch((l) => { l.type = 'federal'; })}>Federal</SegButton>
            <SegButton active={loan.type === 'private'} ariaLabel="Private loan" onClick={() => patch((l) => { l.type = 'private'; })}>Private</SegButton>
          </ChoiceGroup>
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label style={labelStyle} htmlFor={`ln-year-${loan.id}`}>School year</label>
          <input id={`ln-year-${loan.id}`} type="number" value={loan.academicYear} aria-label="School year (the year it starts)"
            onChange={(e) => patch((l) => { l.academicYear = Number(e.target.value) || l.academicYear; })}
            style={inputStyle({ width: '100%' })} />
        </div>
      </div>

      {!asOfMode ? (
        <>
          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle} htmlFor={`ln-amt-${loan.id}`}>Amount you borrowed that year — <strong style={{ color: C.text }}>the original amount, not today’s balance</strong></label>
            <input id={`ln-amt-${loan.id}`} type="number" min="0" value={annualTotal || ''} placeholder="$0"
              aria-label="Amount you borrowed that year — the original amount, not today's balance"
              onChange={(e) => setAnnual(e.target.value)} style={inputStyle({ width: 160 })} />
          </div>
          <div style={{ fontSize: 11, color: C.gray, marginBottom: 10, lineHeight: 1.5 }}>
            Don’t have your numbers? Log into studentaid.gov → Dashboard → click a loan for its exact amounts, dates, and rate. Private loans: check your lender’s site.
          </div>

          <div style={{ fontSize: 11, color: C.textMid, marginBottom: 6, fontWeight: 600 }}>Money usually arrives in two parts — fall and spring:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {(loan.disbursements || []).map((d, i) => (
              <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" min="0" value={d.amount || ''} aria-label={`Part ${i + 1} amount`}
                  onChange={(e) => patch((l) => { l.disbursements[i].amount = Number(e.target.value) || 0; })}
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
            <label style={labelStyle} htmlFor={`ln-asof-bal-${loan.id}`}>Balance as of the date below</label>
            <input id={`ln-asof-bal-${loan.id}`} type="number" min="0" value={loan.asOfBalance || ''} aria-label="Balance as of the date below"
              onChange={(e) => patch((l) => { l.asOfBalance = Number(e.target.value) || 0; })} style={inputStyle({ width: '100%' })} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <span style={labelStyle}>As of</span>
            <DateField value={loan.asOfDate || todayStr()} ariaLabel="Balance as-of date"
              onChange={(v) => patch((l) => { l.asOfDate = v; })} style={{ width: '100%', fontSize: 12, padding: '5px 8px' }} />
          </div>
        </div>
      )}

      <button type="button" className="txt-act" onClick={() => patch((l) => { if (asOfMode) { l.asOfDate = null; l.asOfBalance = null; } else { l.asOfDate = todayStr(); l.asOfBalance = Math.round(loanPrincipal(l) * 100) / 100; } })}
        style={{ background: 'none', border: 'none', color: C.gray, fontSize: 11, textDecoration: 'underline', cursor: 'pointer', padding: '2px 0', marginTop: 4 }}>
        {asOfMode ? 'or enter what you originally borrowed instead' : 'or enter today’s balance as of a date instead'}
      </button>

      {/* ── Rate ── */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
        {loan.type === 'federal' && !estimated ? (
          <div style={{ fontSize: 12, color: C.textMid }}>
            Interest rate: <strong style={{ color: C.text }}>{(effectiveRate(loan) * 100).toFixed(2)}%</strong> (the federal rate for {loan.academicYear}–{String((loan.academicYear + 1) % 100).padStart(2, '0')} loans)
          </div>
        ) : (
          <div>
            <label style={labelStyle} htmlFor={`ln-rate-${loan.id}`}>Interest rate (as a percent){estimated && ' — estimated, enter yours if you know it'}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input id={`ln-rate-${loan.id}`} type="number" min="0" max="30" step="0.01" value={pctText}
                placeholder={estimated ? 'e.g. 7.94' : ''} aria-label="Interest rate as a percent"
                onChange={(e) => { const t = e.target.value; setPctText(t); const n = Number(t); patch((l) => { l.rate = t === '' ? null : (isNaN(n) ? l.rate : n / 100); }); }}
                style={inputStyle({ width: 90 })} />
              <span style={{ fontSize: 12, color: C.textMid }}>%</span>
              {pctText !== '' && !rateHigh && <span style={{ fontSize: 11, color: C.teal }}>✓</span>}
            </div>
            {rateHigh && <div role="alert" style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>That seems high — double-check?</div>}
          </div>
        )}
      </div>

      {/* ── More options ── */}
      <button type="button" onClick={toggleMore} aria-expanded={moreOpen} aria-controls={`ln-more-${loan.id}`}
        style={{ background: 'none', border: 'none', color: C.gray, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '10px 0 0 0', textDecoration: 'underline' }}>
        {moreOpen ? 'Hide options' : 'More options'}
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
          <div>
            <label style={labelStyle} htmlFor={`ln-fee-${loan.id}`}>Fee, as a percent {loan.type === 'federal' ? '(leave blank to use the ~1% fee the government takes off the top — we’ve included it)' : '(most private lenders don’t charge one)'}</label>
            <input id={`ln-fee-${loan.id}`} type="number" min="0" max="10" step="0.01" value={loan.feePct != null ? loan.feePct * 100 : ''}
              placeholder={loan.type === 'federal' ? '1.057' : '0'} aria-label="Fee as a percent"
              onChange={(e) => { const v = e.target.value; patch((l) => { l.feePct = v === '' ? null : (Number(v) / 100); }); }}
              style={inputStyle({ width: 100 })} />
          </div>
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
          <label style={labelStyle} htmlFor="bal-spendable">Available to spend</label>
          <input id="bal-spendable" type="number" min="0" value={spendable} placeholder="$0" required
            aria-label="Available to spend, across all accounts you spend from"
            onChange={(e) => { setSpendable(e.target.value); setConfirming(false); }}
            style={inputStyle({ width: 130 })} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="bal-savings">Set aside in savings (optional)</label>
          <input id="bal-savings" type="number" min="0" value={savings} placeholder="$0"
            aria-label="Set aside in savings, optional"
            onChange={(e) => setSavings(e.target.value)} style={inputStyle({ width: 130 })} />
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
          <div style={{ fontSize: 11, color: C.gray, marginBottom: 8, fontWeight: 600 }}>Past check-ins</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {[...sorted].reverse().map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: C.gray }}>{new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span style={{ color: C.text, fontWeight: 600 }}>{fmt(r.spendable)}{r.savings != null ? ` + ${fmt(r.savings)} savings` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ReminderBanner({ data, upd }) {
  const [snoozedThisSession, setSnoozedThisSession] = useState(false);
  if (data.loans.length > 0 || data.loanReminderSnooze != null || snoozedThisSession) return null;
  return (
    <Banner type="info" onClose={() => setSnoozedThisSession(true)}>
      Add your loans so Marro can show what you’ll really owe at graduation — interest included.
      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        <button type="button" className="txt-act" onClick={() => setSnoozedThisSession(true)} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Remind me later</button>
        <button type="button" className="txt-act" onClick={() => { const d = JSON.parse(JSON.stringify(data)); d.loanReminderSnooze = { choice: 'never', at: new Date().toISOString() }; upd(d); }} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Don’t show again</button>
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
// (dateConfirmed) — otherwise it reads as a soft "roughly N days."
const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
const PLAYBOOK_APY = 0.04; // illustrative midpoint of the "roughly 3.5–4.5%" range quoted in the card

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

  if (!show) {
    // "Did your refund land?" nudge (walkthrough §9) — shown once the expected
    // date has passed but nothing has auto-detected a balance jump yet. Confirming
    // is itself the evidence the hardening rules require (never a bare guess).
    const seasonWord = candidate.term.endsWith('-spring') ? 'spring' : candidate.term.endsWith('-fall') ? 'fall' : 'expected';
    return (
      <Banner type="info">
        Did your {seasonWord} refund land? Update your balance below to see the full picture.
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => setRefundNudgeConfirmed(candidate.term)}
            style={{ padding: '6px 14px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.blue}`, background: 'transparent', color: C.blue, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Yes, it landed
          </button>
        </div>
      </Banner>
    );
  }

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

  const windows = loanReturnWindows(data.loans || [], today).sort((a, b) => a.daysLeft - b.daysLeft);
  const window = windows[0] || null;

  return (
    <div role="region" aria-labelledby="playbook-heading" style={{ background: C.blueLight, border: `1px solid ${C.blueMid}`, borderRadius: 12, padding: '16px 18px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 10, right: 10 }}>
        <XBtn label="Dismiss — I've seen this" onClick={dismiss} />
      </div>
      <div id="playbook-heading" style={{ fontSize: 15, fontWeight: 700, color: C.text, paddingRight: 30 }}>📬 Your refund landed — a smart way to think about it</div>

      <ol style={{ margin: '12px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: C.text, lineHeight: 1.55 }}>
        <li>
          {semesterNeed != null
            ? <>This stretch needs about <strong>{fmt(semesterNeed)}</strong> ({monthsNeeded} month{monthsNeeded === 1 ? '' : 's'} × your ~{fmt(burnAmount)}/month pace).</>
            : <>Add your budget and a balance check-in and Marro can estimate what this stretch needs to cover.</>}
          {' '}Many students keep about one month&apos;s worth in checking.
        </li>
        <li>
          Consider parking the rest in savings.{' '}
          {parkAmount != null && parkAmount > 0
            ? <>Many online banks currently pay roughly 3.5–4.5% — {fmt(parkAmount)} parked for {monthsToHorizon} month{monthsToHorizon === 1 ? '' : 's'} could earn ~{fmt(earningsEstimate)} while staying instantly available and FDIC-insured (covered up to $250,000 per bank).</>
            : <>Many online banks currently pay roughly 3.5–4.5% while staying instantly available and FDIC-insured (covered up to $250,000 per bank).</>}
          {' '}(Heads up: savings interest may generate a small tax form — usually called a 1099-INT.)
        </li>
        <li>
          Borrowed more than you need? Unused federal loan money can be returned within 120 days of when it arrives — the interest and the fee on the returned part are cancelled, like it never happened.
          {window
            ? <> {window.dateConfirmed
                ? <>You have <strong>{window.daysLeft} days</strong> left on that money.</>
                : <>You have <strong>roughly {window.daysLeft} days</strong> left — confirm the exact date with your aid office.</>}</>
            : null}
          {' '}Your financial aid office can help you decide.
        </li>
      </ol>

      <div style={{ marginTop: 12, fontSize: 10.5, color: C.gray, lineHeight: 1.5 }}>
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
              <Banner type="info">Estimate — add your loans to make this exact</Banner>
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {proj.byLoan.map((row) => {
              const loan = loans.find((l) => l.id === row.loanId);
              return (
                <div key={row.loanId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: C.textMid }}>{loan?.name || 'Untitled loan'}</span>
                  <span style={{ color: C.text, fontWeight: 600 }}>{fmt(row.total)}{row.isEstimate ? ' (estimate)' : ''}</span>
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
          style={{ width: '100%', font: 'inherit', background: 'transparent', border: `2px dashed ${C.border}`, borderRadius: 12, minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', color: C.gray, transition: 'border-color 0.15s, color 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.gray; }}>
          <span style={{ fontSize: 24, fontWeight: 300, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Add loan</span>
        </button>
      </div>

      <BalanceCheckin data={data} upd={upd} />
    </div>
  );
}
