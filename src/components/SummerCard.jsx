import { C } from '../lib/theme.js';
import { fmt, moTotal, blankSummer } from '../lib/format.js';
import { InfoTip } from './primitives.jsx';
import { DateField } from './pickers.jsx';
import { summerWindow, summerFundNeed, summerResources, summerShortfall } from '../lib/aid.js';

// Summer card (money-rework §4b). Guidance-on-demand, NOT a warning: it only
// appears when there's a REAL uncovered summer (summerWindow non-null), and it
// never tells a student they're "not funding summer" or nags about a gap. It
// shows what the summer costs per month (their own school-year plan with the rent
// line swapped) and lets them enter summer income; if they do, it shows a calm
// covered/left readout in neutral colour — no red, no alarm (founder call).
//
// `year.summer` is the persisted shape { rent, situation, wageMonthly, stipends[] }
// from format.blankSummer(); older saved years have none, so every read defaults it.

const SITUATIONS = [
  { id: 'research', label: 'Paid research' },
  { id: 'job',      label: 'A job' },
  { id: 'unpaid',   label: 'Unpaid / volunteer' },
  { id: 'off',      label: 'Taking it off' },
];

const friendlyMonth = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const inputStyle = (extra = {}) => ({ width: 100, textAlign: 'right', fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 8px', background: C.bg, color: C.text, ...extra });

export function SummerCard({ year, yearIndex, nextYear, data, upd, subsMo }) {
  const window = summerWindow(year, nextYear);
  if (!window) return null; // no real gap → no card (12-month/funded years, final year)

  const summer = year.summer || blankSummer();
  const schoolRent = Number(year.monthly?.housing) || 0;
  const schoolPlan = moTotal({ ...year.monthly, subs: subsMo });

  const need = summerFundNeed({ monthlyPlan: schoolPlan, schoolRent, summerRent: summer.rent, window });
  const resources = summerResources({ window, lumps: summer.stipends, monthlyWage: summer.wageMonthly });
  const short = summerShortfall({ need, resources });
  const hasIncome = resources.total > 0;

  // Persist a shallow patch onto years[yearIndex].summer.
  const patchSummer = (patch) => {
    const d = JSON.parse(JSON.stringify(data));
    d.years[yearIndex].summer = { ...blankSummer(), ...(d.years[yearIndex].summer || {}), ...patch };
    upd(d);
  };
  const setStipends = (stipends) => patchSummer({ stipends });
  const addStipend = () => setStipends([...(summer.stipends || []), { id: 'sp' + Math.random().toString(36).slice(2, 8), amount: 0, date: window.start }]);
  const editStipend = (id, field, val) => setStipends((summer.stipends || []).map((s) => (s.id === id ? { ...s, [field]: val } : s)));
  const removeStipend = (id) => setStipends((summer.stipends || []).filter((s) => s.id !== id));

  const rentValue = summer.rent == null ? '' : summer.rent;
  const label = `${friendlyMonth(window.start)} – ${friendlyMonth(window.end)}`;

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 5 }}>
          Your summer
          <InfoTip text="The months between when this year's aid stops and your next year begins. Aid doesn't cover them, so this is a separate little plan for the summer — fill in what you'll earn and spend." />
        </span>
        <span style={{ fontSize: 11, color: C.gray }}>{label} · {window.months} month{window.months === 1 ? '' : 's'}</span>
      </div>

      {/* The cost, from their own plan with the rent line swapped */}
      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5, marginBottom: 10 }}>
        About <strong style={{ color: C.text }}>{fmt(need.monthly)}/mo</strong> for the summer{need.total > 0 ? <> — <strong style={{ color: C.text }}>{fmt(need.total)}</strong> across {window.months} month{window.months === 1 ? '' : 's'}</> : null}. Based on your monthly plan with summer rent swapped in.
      </div>

      {/* Summer rent — pre-filled with school-year rent (placeholder), editable */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderTop: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, color: C.textMid, display: 'flex', alignItems: 'center', gap: 4 }}>
          Summer rent <InfoTip text="Going home for the summer? Set this to $0. On an away rotation with a second lease? Set it higher. Left blank, it uses your school-year rent." />
        </span>
        <input type="number" min="0" inputMode="numeric" value={rentValue} placeholder={String(schoolRent)}
          aria-label={`Summer rent — ${year.label || 'Year ' + (yearIndex + 1)}`}
          onChange={(e) => { const v = e.target.value.trim(); patchSummer({ rent: v === '' ? null : Math.max(0, Number(v) || 0) }); }}
          style={inputStyle()} />
      </div>

      {/* Your summer — situation (friendly, no judgement) */}
      <div style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.textMid, marginBottom: 6 }}>What are you up to?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SITUATIONS.map((s) => {
            const active = summer.situation === s.id;
            return (
              <button key={s.id} type="button" aria-pressed={active} onClick={() => patchSummer({ situation: active ? '' : s.id })}
                style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 11px', minHeight: 32, borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${active ? C.sel : C.border}`, background: active ? C.selBg : 'transparent', color: active ? C.text : C.textMid }}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Summer income — a steady wage and/or dated stipend lumps (take-home) */}
      <div style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textMid, display: 'flex', alignItems: 'center', gap: 4 }}>
            Take-home pay, about <InfoTip text="Your take-home pay (after taxes), not the number in the offer letter. A steady wage — biweekly is fine to smooth to a monthly amount." />
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" min="0" inputMode="numeric" value={summer.wageMonthly || ''} placeholder="0"
              aria-label={`Summer take-home pay per month — ${year.label || 'Year ' + (yearIndex + 1)}`}
              onChange={(e) => patchSummer({ wageMonthly: Math.max(0, Number(e.target.value) || 0) })}
              style={inputStyle({ width: 90 })} />
            <span style={{ fontSize: 11, color: C.gray }}>/mo</span>
          </div>
        </div>

        {/* Dated lumps — a stipend that lands on a specific date can't cover an
            earlier month (summerResources only counts lumps inside the window). */}
        <div style={{ marginTop: 8 }}>
          {(summer.stipends || []).map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: C.gray }}>Stipend</span>
              <input type="number" min="0" inputMode="numeric" value={s.amount || ''} placeholder="0"
                aria-label={`Stipend amount — ${year.label || 'Year ' + (yearIndex + 1)}`}
                onChange={(e) => editStipend(s.id, 'amount', Math.max(0, Number(e.target.value) || 0))}
                style={inputStyle({ width: 88 })} />
              <span style={{ fontSize: 11, color: C.gray }}>lands</span>
              <DateField value={s.date || ''} onChange={(v) => editStipend(s.id, 'date', v)} ariaLabel={`Stipend date — ${year.label || 'Year ' + (yearIndex + 1)}`} style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }} />
              <button type="button" className="btn-pop" aria-label="Remove stipend" onClick={() => removeStipend(s.id)}
                style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMid, cursor: 'pointer' }}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn-pop" onClick={addStipend}
            style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, padding: '5px 11px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMid, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13, lineHeight: 1 }}>+</span> Add a stipend / lump
          </button>
        </div>
      </div>

      {/* Calm covered/left readout — only once they've entered income. Neutral
          colour, never a red "you're short" (founder: guidance, not a warning). */}
      {hasIncome && need.total > 0 && (
        <div style={{ marginTop: 10, padding: '9px 12px', background: C.surfaceMid, borderRadius: 8, fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>
          Your summer income covers about <strong style={{ color: C.text }}>{fmt(Math.min(resources.total, need.total))}</strong> of {fmt(need.total)}
          {short.shortfall > 0
            ? <> — about <strong style={{ color: C.text }}>{fmt(short.shortfall)}</strong> left to plan for.</>
            : <> — <strong style={{ color: C.text }}>fully covered</strong>{short.surplus > 0 ? <>, with about {fmt(short.surplus)} to spare</> : null}.</>}
        </div>
      )}
    </div>
  );
}
