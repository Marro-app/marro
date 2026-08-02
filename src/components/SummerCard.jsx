import { C } from '../lib/theme.js';
import { fmt, moTotal, blankSummer, blankSummerIncome } from '../lib/format.js';
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
// `year.summer` = { rent, situation, situationOther, income } (format.blankSummer);
// `income` is ONE take-home stream — a steady paycheck (cadence + amount + optional
// first/last dates) or cadence "other" with dated lumps. The steady path counts pay
// PERIODS itself so entering paydays can't inflate the total. Older saved years have
// no summer, so every read defaults it.

const SITUATIONS = [
  { id: 'research', label: 'Research' },
  { id: 'work',     label: 'Work' },
  { id: 'volunteer',label: 'Volunteer' },
  { id: 'off',      label: 'Taking off' },
  { id: 'other',    label: 'Other' },
];
const CADENCES = [
  { id: 'weekly',   label: 'Weekly' },
  { id: 'biweekly', label: 'Biweekly' },
  { id: 'monthly',  label: 'Monthly' },
  { id: 'other',    label: 'Other' },
];

const friendlyMonth = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const inputStyle = (extra = {}) => ({ width: 100, textAlign: 'right', fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 8px', background: C.bg, color: C.text, ...extra });
const pill = (active) => ({ fontSize: 11.5, fontWeight: 600, padding: '5px 11px', minHeight: 32, borderRadius: 999, cursor: 'pointer', border: `1px solid ${active ? C.sel : C.border}`, background: active ? C.selBg : 'transparent', color: active ? C.text : C.textMid });

export function SummerCard({ year, yearIndex, nextYear, data, upd, subsMo }) {
  const window = summerWindow(year, nextYear);
  if (!window) return null; // no real gap → no card (12-month/funded years, final year)

  const summer = year.summer || blankSummer();
  const income = summer.income || blankSummerIncome();
  const schoolRent = Number(year.monthly?.housing) || 0;
  const schoolPlan = moTotal({ ...year.monthly, subs: subsMo });

  const need = summerFundNeed({ monthlyPlan: schoolPlan, schoolRent, summerRent: summer.rent, window });
  const resources = summerResources({ window, income });
  const short = summerShortfall({ need, resources });
  const hasIncome = resources.total > 0;

  const yrLabel = year.label || 'Year ' + (yearIndex + 1);
  const patchSummer = (patch) => {
    const d = JSON.parse(JSON.stringify(data));
    d.years[yearIndex].summer = { ...blankSummer(), ...(d.years[yearIndex].summer || {}), ...patch };
    upd(d);
  };
  const patchIncome = (patch) => patchSummer({ income: { ...blankSummerIncome(), ...(summer.income || {}), ...patch } });
  const setLumps = (lumps) => patchIncome({ lumps });
  const addLump = () => setLumps([...(income.lumps || []), { id: 'sp' + Math.random().toString(36).slice(2, 8), amount: 0, date: window.start }]);
  const editLump = (id, field, val) => setLumps((income.lumps || []).map((s) => (s.id === id ? { ...s, [field]: val } : s)));
  const removeLump = (id) => setLumps((income.lumps || []).filter((s) => s.id !== id));

  const rentValue = summer.rent == null ? '' : summer.rent;
  const steady = income.cadence && income.cadence !== 'other';

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 5 }}>
          Your summer
        </span>
        <span style={{ fontSize: 11, color: C.gray }}>{friendlyMonth(window.start)} – {friendlyMonth(window.end)} · {window.months} month{window.months === 1 ? '' : 's'}</span>
      </div>

      {/* The cost, from their own plan with the rent line swapped */}
      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5, marginBottom: 10 }}>
        About <strong style={{ color: C.text }}>{fmt(need.monthly)}/mo</strong> for the summer{need.total > 0 ? <> — <strong style={{ color: C.text }}>{fmt(need.total)}</strong> across {window.months} month{window.months === 1 ? '' : 's'}</> : null}. Based on your monthly plan with summer rent swapped in.
      </div>

      {/* Summer rent — pre-filled with school-year rent (placeholder), editable */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderTop: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, color: C.textMid, display: 'flex', alignItems: 'center', gap: 4 }}>
          Summer rent
        </span>
        <input type="number" min="0" inputMode="numeric" value={rentValue} placeholder={String(schoolRent)}
          aria-label={`Summer rent — ${yrLabel}`}
          onChange={(e) => { const v = e.target.value.trim(); patchSummer({ rent: v === '' ? null : Math.max(0, Number(v) || 0) }); }}
          style={inputStyle()} />
      </div>

      {/* Your summer — situation (friendly, no judgement) + free text for "Other" */}
      <div style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.textMid, marginBottom: 6 }}>What are you up to?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SITUATIONS.map((s) => {
            const active = summer.situation === s.id;
            return (
              <button key={s.id} type="button" aria-pressed={active} onClick={() => patchSummer({ situation: active ? '' : s.id })} style={pill(active)}>{s.label}</button>
            );
          })}
        </div>
        {summer.situation === 'other' && (
          <input type="text" value={summer.situationOther || ''} placeholder="Tell us what you're up to"
            aria-label={`Describe your summer — ${yrLabel}`}
            onChange={(e) => patchSummer({ situationOther: e.target.value })}
            style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', background: C.bg, color: C.text }} />
        )}
      </div>

      {/* Summer income — ONE take-home stream. A steady paycheck (cadence + amount +
          optional first/last dates), or dated lumps under "Other". */}
      <div style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.textMid, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          How does your pay come in?
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CADENCES.map((c) => {
            const active = income.cadence === c.id;
            return (
              <button key={c.id} type="button" aria-pressed={active} onClick={() => patchIncome({ cadence: active ? '' : c.id })} style={pill(active)}>{c.label}</button>
            );
          })}
        </div>

        {/* Steady paycheck: amount + optional first/last dates (guessed from the
            summer window if left blank), with the computed total shown back. */}
        {steady && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: C.textMid, display: 'flex', alignItems: 'center', gap: 4 }}>
                Take-home per paycheck <InfoTip text="Your take-home pay per paycheck (after taxes), not the number in the offer letter." />
              </span>
              <input type="number" min="0" inputMode="numeric" value={income.perPaycheck || ''} placeholder="0"
                aria-label={`Take-home per paycheck — ${yrLabel}`}
                onChange={(e) => patchIncome({ perPaycheck: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle({ width: 100 })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <span style={{ fontSize: 11.5, color: C.gray, display: 'flex', alignItems: 'center', gap: 4 }}>
                First <DateField value={income.firstDate || ''} onChange={(v) => patchIncome({ firstDate: v || null })} ariaLabel={`First paycheck date — ${yrLabel}`} style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }} />
              </span>
              <span style={{ fontSize: 11.5, color: C.gray, display: 'flex', alignItems: 'center', gap: 4 }}>
                Last <DateField value={income.lastDate || ''} onChange={(v) => patchIncome({ lastDate: v || null })} ariaLabel={`Last paycheck date — ${yrLabel}`} style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }} />
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.gray, marginTop: 6 }}>
              {(income.perPaycheck || 0) > 0
                ? <>≈ {resources.periods} paycheck{resources.periods === 1 ? '' : 's'} · about <strong style={{ color: C.textMid }}>{fmt(resources.wageTotal)}</strong> over the summer{income.firstDate && income.lastDate ? '' : ' (estimated from the dates above — add your first & last payday to pin it down)'}.</>
                : 'Add your take-home per paycheck to see the summer total.'}
            </div>
          </div>
        )}

        {/* "Other" cadence: dated lumps (a one-time stipend on set date(s)). */}
        {income.cadence === 'other' && (
          <div style={{ marginTop: 10 }}>
            {(income.lumps || []).map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: C.gray }}>Stipend</span>
                <input type="number" min="0" inputMode="numeric" value={s.amount || ''} placeholder="0"
                  aria-label={`Stipend amount — ${yrLabel}`}
                  onChange={(e) => editLump(s.id, 'amount', Math.max(0, Number(e.target.value) || 0))}
                  style={inputStyle({ width: 88 })} />
                <span style={{ fontSize: 11, color: C.gray }}>lands</span>
                <DateField value={s.date || ''} onChange={(v) => editLump(s.id, 'date', v)} ariaLabel={`Stipend date — ${yrLabel}`} style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }} />
                <button type="button" className="btn-pop" aria-label="Remove stipend" onClick={() => removeLump(s.id)}
                  style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMid, cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn-pop" onClick={addLump}
              style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, padding: '5px 11px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMid, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 13, lineHeight: 1 }}>+</span> Add a stipend / lump
            </button>
          </div>
        )}
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
