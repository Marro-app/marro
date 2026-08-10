import { useCallback, useEffect, useState } from 'react';
import { C } from '../../lib/theme.js';
import { Card, SectionTitle, EmptyState } from '../../components/primitives.jsx';
import { Icon } from '../../components/icons.jsx';
import { fetchSupportMetrics, fmtDuration, shareOfLoad, sparklinePoints } from '../../lib/supportMetrics.js';
import { agoLabel } from '../../lib/supportAdmin.js';

// Support Metrics (Slice 12, plan §13.5) — reporting, not an activity feed.
// Every number is an aggregate from the is_admin()-gated SECURITY DEFINER
// RPCs (supabase/support_metrics.sql); individual conversations stay in the
// inbox. Read-only.

const RANGES = [7, 30, 90];

function Tile({ label, value, sub }) {
  return (
    <div style={{ flex: '1 1 130px', minWidth: 130, padding: '12px 14px', borderRadius: 12, background: C.surface, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.textMid, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

export default function SupportMetricsView({ onBack }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d) => {
    setLoading(true);
    setData(await fetchSupportMetrics(d));
    setLoading(false);
  }, []);
  useEffect(() => { load(days); }, [load, days]);

  const o = data?.overview;
  const shares = shareOfLoad(data?.byAdmin || []);
  const spark = sparklinePoints(data?.daily || [], 14, 160, 32);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button type="button" onClick={onBack} aria-label="Back to inbox" className="hit-slop"
          style={{ flexShrink: 0, width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer' }}>
          <Icon name="chevron" size={16} color={C.text} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionTitle sub="Aggregates only — individual conversations live in the inbox.">Support metrics</SectionTitle>
        </div>
        <div role="group" aria-label="Date range" style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)} className="hit-slop"
              style={{ minHeight: 32, padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: days === r ? 700 : 500, cursor: 'pointer', border: `1px solid ${days === r ? C.sel : C.border}`, background: days === r ? C.selBg : 'transparent', color: C.text }}>
              {r}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <EmptyState>Crunching support numbers…</EmptyState>
      ) : data?.unavailable ? (
        <EmptyState>Metrics aren&apos;t available yet — run <code>supabase/support_metrics.sql</code> in Studio first.</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          {/* A · headline tiles */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tile label="New" value={o?.new_conversations ?? '—'} sub={`last ${days}d`} />
            <Tile label="Backlog" value={o?.open_backlog ?? '—'} sub="open right now" />
            <Tile label="Unanswered" value={o?.deferred_unanswered ?? '—'} sub="no reply yet" />
            <Tile label="First response" value={fmtDuration(o?.median_first_response_s)} sub={`median · p90 ${fmtDuration(o?.p90_first_response_s)}`} />
            <Tile label="Resolution" value={fmtDuration(o?.median_resolution_s)} sub={`median · p90 ${fmtDuration(o?.p90_resolution_s)}`} />
            <Tile label="Time to claim" value={fmtDuration(o?.median_claim_s)} sub="median" />
            <Tile label="Reopened" value={o?.reopened ?? '—'} sub="came back after resolve" />
            <Tile label="CSAT" value={data.csat?.up_count ?? 0} sub={`helpful · ${data.csat?.down_count ?? 0} not helpful`} />
          </div>

          {/* volume sparkline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textMid }}>Last 14 days</div>
            <svg width="160" height="32" role="img" aria-label={`Daily new conversations, last 14 days, peak ${spark.max}`} style={{ overflow: 'visible' }}>
              <polyline points={spark.points} fill="none" stroke={C.teal} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 11, color: C.textMid }}>peak {spark.max}/day</div>
          </div>

          {/* C · per-admin share of load */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8 }}>Who&apos;s responding</div>
            {(data.byAdmin || []).length === 0 ? (
              <div style={{ fontSize: 12, color: C.textMid }}>No claimed conversations in this window yet.</div>
            ) : data.byAdmin.map((a, i) => (
              <div key={a.admin_email} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 170, fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.admin_email}</div>
                <div aria-hidden="true" style={{ flex: 1, height: 8, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                  <div style={{ width: `${shares[i]}%`, height: '100%', background: C.teal }} />
                </div>
                <div style={{ width: 200, fontSize: 11, color: C.textMid }}>
                  {shares[i]}% · {a.handled} handled · {a.replies} replies · {a.resolved} resolved · CSAT {a.csat_up}/{a.csat_up + a.csat_down || 0}
                </div>
              </div>
            ))}
          </div>

          {/* D · volume by type */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8 }}>By type</div>
            {(data.byType || []).map((t) => (
              <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, fontSize: 12, color: C.text }}>
                <span style={{ width: 80 }}>{t.type === 'feedback' ? 'idea' : t.type}</span>
                <span style={{ color: C.textMid }}>{t.total} total · {t.resolved} resolved</span>
              </div>
            ))}
          </div>

          {/* A · live aging watchlist */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8 }}>Waiting on us right now</div>
            {(data.aging || []).length === 0 ? (
              <div style={{ fontSize: 12, color: C.green }}>Nothing is waiting — inbox zero.</div>
            ) : data.aging.map((row) => (
              <div key={row.conversation_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, fontSize: 12 }}>
                <span style={{ flex: 1, minWidth: 0, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(row.subject || 'Support chat').replace(/\s+/g, ' ').slice(0, 70)}
                </span>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: C.danger }}>waiting {agoLabel(row.waiting_since).replace(' ago', '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
