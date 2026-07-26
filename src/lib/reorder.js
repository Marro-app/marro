// Drag-to-reorder geometry for the Monthly plan category list.
//
// Pure and dependency-free so it can be unit-tested: this math has produced two
// separate visual bugs (a spike on drop, then rubber-banding neighbours mid-drag)
// and had no coverage, which is exactly the kind of thing that regresses twice.
// The React side (BudgetTab) owns pointer events and rendering; everything about
// WHERE a row lands lives here.

/**
 * Extra travel, in px, required to move the drop target onto a new row — and
 * again to give it back. Without it the target swapped exactly AT a row's
 * midpoint, so a pointer resting on that line flipped the target every frame and
 * each flip restarted the neighbours' 0.18s slide: visible rubber-banding.
 * A 2×DEADZONE band now has to be crossed before anything moves, so ordinary
 * hand jitter sits inside it and nothing twitches.
 */
export const REORDER_DEADZONE = 7;

/**
 * Which index the dragged row would land on, given how far it has travelled.
 *
 * Walks outward from the row's original slot, taking a neighbour once the
 * pointer has passed that neighbour's midpoint (plus the deadzone). Row heights
 * vary — the subscriptions row carries a subtitle, and narrow viewports wrap
 * labels onto two lines — so real measured heights are passed in rather than a
 * uniform row height being assumed.
 *
 * @param {number} fromIdx  the dragged row's original index
 * @param {number} dy       pixels travelled since the drag started (+down/−up)
 * @param {number[]} heights measured row heights, in list order
 * @param {number} prevIdx  the target from the previous pointer event — drives
 *                          the hysteresis; defaults to `fromIdx` on first move
 */
export function targetIndexFor(fromIdx, dy, heights, prevIdx = fromIdx) {
  let idx = fromIdx, acc = 0;
  if (dy > 0) {
    for (let i = fromIdx + 1; i < heights.length; i++) {
      acc += heights[i];
      const mid = acc - heights[i] / 2;
      // Rows at or before the current target are already "taken": cheaper to
      // keep than to newly adopt, which is what creates the hysteresis band.
      if (dy > (i > prevIdx ? mid + REORDER_DEADZONE : mid - REORDER_DEADZONE)) idx = i; else break;
    }
  } else if (dy < 0) {
    for (let i = fromIdx - 1; i >= 0; i--) {
      acc += heights[i];
      const mid = acc - heights[i] / 2;
      if (-dy > (i < prevIdx ? mid + REORDER_DEADZONE : mid - REORDER_DEADZONE)) idx = i; else break;
    }
  }
  return idx;
}

/**
 * How far a NON-dragged row slides to open the gap. Only rows between the
 * dragged row's origin and its current target move, each by exactly the dragged
 * row's height, so the list reads as one continuous shift rather than a
 * scattering of independently-moving rows.
 */
export function rowShift(i, drag) {
  if (!drag || i === drag.fromIdx) return 0;
  const { fromIdx, toIdx, heights } = drag;
  if (fromIdx < toIdx && i > fromIdx && i <= toIdx) return -heights[fromIdx];
  if (fromIdx > toIdx && i >= toIdx && i < fromIdx) return heights[fromIdx];
  return 0;
}
