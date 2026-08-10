import { useCallback, useEffect, useId, useState } from 'react';
import { C } from '../../lib/theme.js';
import { Card, SectionTitle, EmptyState } from '../../components/primitives.jsx';
import { Icon } from '../../components/icons.jsx';
import { supportAdminCall } from '../../lib/data.js';
import { agoLabel } from '../../lib/supportAdmin.js';
import { composeWarning } from '../../lib/nudgeGate.js';

// Proactive nudges (Slice 13, plan §12). Compose a message to a specific
// user; it's HELD until due, then the still-relevant gate re-checks (did they
// already message us? already have an open thread? already nudged this week?)
// and auto-cancels instead of sending when the trigger cleared. Delivery is
// the in-app notification banner. Listing evaluates due nudges lazily.

const STATE_LABEL = { scheduled: 'Scheduled', sent: 'Sent', cancelled: 'Auto-cancelled' };

export default function SupportNudgesView({ onBack }) {
  const [nudges, setNudges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [delay, setDelay] = useState(0); // hours
  const [warning, setWarning] = useState(null);
  const [sending, setSending] = useState(false);
  const ids = useId();

  const load = useCallback(async () => {
    const res = await supportAdminCall('nudge_list');
    if (!res || res.ok === false) setError(res?.error || "Couldn't load nudges.");
    else setNudges(res.nudges || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // "Still relevant?" preview: check the target's live state as they type —
  // debounced 600ms so the backend isn't hammered per keystroke.
  useEffect(() => {
    const email = target.toLowerCase().trim();
    if (!/.+@.+/.test(email)) { setWarning(null); return undefined; }
    let alive = true;
    const t = setTimeout(async () => {
      const res = await supportAdminCall('nudge_context', { target_email: email });
      if (alive) setWarning(res?.ok ? composeWarning(res.context) : null);
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [target]);

  const create = useCallback(async () => {
    if (sending || !target.trim() || !text.trim()) return;
    setSending(true);
    setError('');
    const res = await supportAdminCall('nudge_create', { target_email: target.toLowerCase().trim(), body: text.trim(), delay_hours: delay });
    if (!res || res.ok === false) {
      setError(res?.error || "Couldn't create the nudge.");
    } else {
      setTarget(''); setText(''); setWarning(null);
      await load();
    }
    setSending(false);
  }, [sending, target, text, delay, load]);

  const cancel = useCallback(async (id) => {
    await supportAdminCall('nudge_cancel', { nudge_id: id });
    load();
  }, [load]);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button type="button" onClick={onBack} aria-label="Back to inbox" className="hit-slop"
          style={{ flexShrink: 0, width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer' }}>
          <Icon name="chevron" size={16} color={C.text} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <SectionTitle sub="Reach out before someone churns — a held nudge re-checks itself and cancels if they already came to you.">Nudges</SectionTitle>
      </div>

      {/* Composer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0 16px', padding: 12, borderRadius: 12, background: C.surface, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label htmlFor={`${ids}-to`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>To (user email)</label>
            <input id={`${ids}-to`} type="email" value={target} onChange={(e) => setTarget(e.target.value)}
              placeholder="student@school.edu"
              style={{ width: '100%', minHeight: 40, padding: '9px 11px', fontSize: 13, borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, color: C.text, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div>
            <label htmlFor={`${ids}-when`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>Send</label>
            <select id={`${ids}-when`} value={delay} onChange={(e) => setDelay(Number(e.target.value))}
              style={{ minHeight: 40, padding: '9px 11px', fontSize: 13, borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, color: C.text }}>
              <option value={0}>Now (next check)</option>
              <option value={24}>In 24 hours</option>
              <option value={72}>In 3 days</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${ids}-body`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>Message</label>
          <textarea id={`${ids}-body`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500}
            placeholder="Need a hand finishing setup? We're around."
            style={{ width: '100%', resize: 'none', minHeight: 56, padding: '9px 11px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, color: C.text, boxSizing: 'border-box', outline: 'none' }} />
        </div>
        {warning && <div role="status" style={{ fontSize: 12, color: C.amber }}>{warning}</div>}
        {error && <div role="alert" style={{ fontSize: 12, color: C.danger }}>{error}</div>}
        <button type="button" onClick={create} disabled={sending || !target.trim() || !text.trim()} className="btn-fill"
          style={{ alignSelf: 'flex-end', padding: '10px 18px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44, opacity: (sending || !target.trim() || !text.trim()) ? 0.5 : 1 }}>
          {sending ? 'Scheduling…' : 'Schedule nudge'}
        </button>
      </div>

      {loading ? <EmptyState>Loading nudges…</EmptyState>
        : nudges.length === 0 ? <EmptyState>No nudges yet. Scheduled ones are re-checked before sending and cancel themselves if the user already reached out.</EmptyState>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {nudges.map((n) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 9px',
                  color: n.state === 'sent' ? C.green : n.state === 'cancelled' ? C.textMid : C.blue,
                  background: n.state === 'sent' ? C.greenLight : n.state === 'cancelled' ? C.bg : C.blueLight,
                  border: `1px solid ${C.border}` }}>
                  {STATE_LABEL[n.state] || n.state}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.target_email} — {n.body}
                </span>
                <span style={{ flexShrink: 0, fontSize: 11, color: C.textMid }}>
                  {n.state === 'cancelled' && n.cancelled_reason ? n.cancelled_reason.replace(/_/g, ' ')
                    : n.state === 'sent' ? agoLabel(n.sent_at)
                    : `due ${new Date(n.send_after).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}`}
                </span>
                {n.state === 'scheduled' && (
                  <button type="button" onClick={() => cancel(n.id)} className="btn-pop hit-slop"
                    style={{ flexShrink: 0, minHeight: 30, padding: '5px 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text }}>
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
    </Card>
  );
}
