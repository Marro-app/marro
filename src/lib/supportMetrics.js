// ── Support metrics — fetchers + pure display math (Slice 12, plan §13.5) ───
// Fetchers mirror adminUsageMetrics(): each RPC is SECURITY DEFINER, checks
// is_admin() itself, and returns zero rows for anyone else — so `null` here
// means "unavailable" (RPC missing / not admin / network) and the UI says so.
// The pure helpers below are Vitest-covered.
import { getSupabase } from './data.js';

async function rpcRows(name, params) {
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc(name, params);
    if (error || data == null) return null;
    return Array.isArray(data) ? data : [data];
  } catch {
    return null;
  }
}

export async function fetchSupportMetrics(days) {
  const [overviewRows, byAdmin, aging, byType, daily, csatRows] = await Promise.all([
    rpcRows('support_metrics_overview', { p_days: days }),
    rpcRows('support_metrics_by_admin', { p_days: days }),
    rpcRows('support_aging'),
    rpcRows('support_volume_by_type', { p_days: days }),
    rpcRows('support_daily_volume', { p_days: 14 }),
    rpcRows('support_csat_summary', { p_days: 90 }),
  ]);
  return {
    overview: overviewRows?.[0] || null,
    byAdmin: byAdmin || [],
    aging: aging || [],
    byType: byType || [],
    daily: daily || [],
    csat: csatRows?.[0] || null,
    unavailable: overviewRows == null,
  };
}

// Seconds → compact human duration ("—", "42s", "8m", "3.2h", "1.4d").
export function fmtDuration(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return '—';
  const s = Number(seconds);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(s < 10 * 3600 ? 1 : 0)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

// Share-of-load percentages for the per-admin bars — integers summing to 100
// (largest-remainder rounding so the bars always add up).
export function shareOfLoad(rows, key = 'handled') {
  const total = (rows || []).reduce((n, r) => n + (Number(r[key]) || 0), 0);
  if (!total) return (rows || []).map(() => 0);
  const exact = rows.map((r) => (100 * (Number(r[key]) || 0)) / total);
  const floors = exact.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (remainder <= 0) break; floors[i] += 1; remainder -= 1; }
  return floors;
}

// Daily counts → SVG polyline points, padded to `days` trailing days (missing
// days are zero) so a quiet week doesn't render as a misleading short line.
export function sparklinePoints(daily, days = 14, w = 120, h = 28, nowMs = Date.now()) {
  const byDay = new Map((daily || []).map((d) => [String(d.day), Number(d.total) || 0]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    series.push(byDay.get(key) || 0);
  }
  const max = Math.max(1, ...series);
  const step = series.length > 1 ? w / (series.length - 1) : 0;
  const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  return { points: pts.join(' '), max, series };
}
