import { useState } from 'react';
import { C } from '../lib/theme.js';
import { fmt, todayStr } from '../lib/format.js';
import { normalizeReadings } from '../lib/loans.js';
import { Card, SectionTitle, Banner, InfoTip } from './primitives.jsx';

// Balance check-in — the monthly "what's your balance?" card. Moved here from the
// Loans tab (Money Rework §3a) so it can be the FIRST thing on the Budget tab: the
// one recurring action the retention loop depends on. Answers the student's first
// question — "is my real money where my plan says it should be?" (compareToPlan,
// surfaced via runway.actualPace) — as a prominent headline right at the moment
// they've entered their number.

// Small input helpers, kept local (they mirror the ones in LoansTab's loan cards).
const inputStyle = (extra = {}) => ({ border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', background: C.bg, color: C.text, fontSize: 13, boxSizing: 'border-box', ...extra });
const labelStyle = { fontSize: 11, color: C.text, marginBottom: 4, display: 'block', fontWeight: 600 };
const cleanNumInput = (e) => {
  const v = e.target.value.replace(/[^\d.]/g, '');
  const parts = v.split('.');
  return parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : v;
};

export function BalanceCheckin({ data, upd }) {
  const readings = data.balanceReadings || [];
  const sorted = [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // For the "Past check-ins" list: one row per DATE, matching how the math reads
  // them (normalizeReadings keeps the last entry saved for a day). Otherwise five
  // check-ins on the same day showed five identical rows — and looked like they
  // should count as five, when the pace math treats them as one.
  const displayReadings = normalizeReadings(readings, todayStr());
  const last = sorted[sorted.length - 1] || null;
  const lastSavings = [...sorted].reverse().find((r) => r.savings != null);

  const [spendable, setSpendable] = useState('');
  const [savings, setSavings] = useState(lastSavings ? String(lastSavings.savings) : '');
  const [confirming, setConfirming] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

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
    setJustSaved(true);
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
      <SectionTitle sub="No bank login, no linking accounts — just the number you see when you check your balance. Your “Vs your plan” status up top updates from this.">
        About how much do you have available for living costs right now?
      </SectionTitle>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 170px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="bal-spendable">Amount in your checking / cash</label>
            <InfoTip text="What's in your checking/spending account today. Aid or loan money counts once it's landed in your account." />
          </div>
          <input id="bal-spendable" type="number" min="0" value={spendable} placeholder="$0" required
            aria-label="Amount in your checking / cash, across all accounts you spend from"
            onChange={(e) => { setSpendable(cleanNumInput(e)); setConfirming(false); setJustSaved(false); }}
            style={inputStyle({ width: '100%' })} />
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <label style={labelStyle} htmlFor="bal-savings">Set aside in savings</label>
          <input id="bal-savings" type="number" min="0" value={savings} placeholder="$0"
            aria-label="Set aside in savings, optional"
            onChange={(e) => setSavings(cleanNumInput(e))} style={inputStyle({ width: '100%' })} />
        </div>
        <button type="submit" className="btn-pop" style={{ flexShrink: 0, padding: '8px 18px', minHeight: 36, borderRadius: 8, border: `1px solid ${C.teal}`, background: C.teal, color: C.bg, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Save
        </button>
      </form>

      {justSaved && !confirming && (
        <div role="status" style={{ marginTop: 10, fontSize: 12, color: C.green, fontWeight: 600 }}>
          ✓ Saved — your Safe to spend and year-end outlook up top are updated.
        </div>
      )}

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

      {displayReadings.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.text, marginBottom: 8, fontWeight: 600 }}>Past check-ins</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...displayReadings].reverse().slice(0, 5).map((r) => (
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
