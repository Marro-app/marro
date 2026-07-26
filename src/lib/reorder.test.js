import { describe, it, expect } from 'vitest';
import { targetIndexFor, rowShift, REORDER_DEADZONE } from './reorder.js';

// Uniform 50px rows unless a test needs varied heights.
const H = [50, 50, 50, 50, 50];

describe('targetIndexFor — basic crossing', () => {
  it('stays put when the row has barely moved', () => {
    expect(targetIndexFor(0, 0, H)).toBe(0);
    expect(targetIndexFor(0, 5, H)).toBe(0);
  });

  it('takes the next row once past its midpoint plus the deadzone', () => {
    // row 1's midpoint is 25px down; adopting it costs 25 + 7 = 32
    expect(targetIndexFor(0, 31, H)).toBe(0);
    expect(targetIndexFor(0, 33, H)).toBe(1);
  });

  it('walks several rows when dragged far', () => {
    expect(targetIndexFor(0, 200, H)).toBe(4);
  });

  it('works upward as well as downward', () => {
    expect(targetIndexFor(4, -33, H)).toBe(3);
    expect(targetIndexFor(4, -200, H)).toBe(0);
  });

  it('never runs off either end of the list', () => {
    expect(targetIndexFor(4, 9999, H)).toBe(4);
    expect(targetIndexFor(0, -9999, H)).toBe(0);
  });
});

describe('targetIndexFor — hysteresis (the rubber-band fix)', () => {
  // Row 1's raw midpoint is 25px. Before the deadzone existed the target
  // flipped exactly there, so a pointer resting near 25 flipped every frame and
  // restarted the neighbours' slide each time — the visible rubber-banding.
  it('does not flip back and forth for jitter around the raw midpoint', () => {
    let idx = 0;
    for (const dy of [24, 26, 23, 27, 25, 24]) {
      idx = targetIndexFor(0, dy, H, idx);
      expect(idx).toBe(0); // never twitches
    }
  });

  it('holds the new target through jitter once it has been adopted', () => {
    let idx = targetIndexFor(0, 40, H, 0);
    expect(idx).toBe(1);
    for (const dy of [38, 42, 36, 44, 35]) {
      idx = targetIndexFor(0, dy, H, idx);
      expect(idx).toBe(1); // stays adopted
    }
  });

  it('gives a row back only after crossing the far side of the band', () => {
    const adopted = targetIndexFor(0, 40, H, 0);
    expect(adopted).toBe(1);
    // releasing costs midpoint − deadzone = 18
    expect(targetIndexFor(0, 20, H, adopted)).toBe(1);
    expect(targetIndexFor(0, 17, H, adopted)).toBe(0);
  });

  it('is symmetric when dragging upward', () => {
    let idx = targetIndexFor(4, -40, H, 4);
    expect(idx).toBe(3);
    for (const dy of [-38, -42, -36, -35]) {
      idx = targetIndexFor(4, dy, H, idx);
      expect(idx).toBe(3);
    }
    expect(targetIndexFor(4, -17, H, idx)).toBe(4);
  });

  it('leaves a real band, not a knife edge', () => {
    const adopt = targetIndexFor(0, 25 + REORDER_DEADZONE + 1, H, 0);
    const release = targetIndexFor(0, 25 - REORDER_DEADZONE - 1, H, 1);
    expect(adopt).toBe(1);
    expect(release).toBe(0);
  });
});

describe('targetIndexFor — varied row heights', () => {
  // Real lists are ragged: the subscriptions row has a subtitle, and narrow
  // viewports wrap labels onto a second line.
  const ragged = [75, 45, 45, 75, 75];

  it('uses each row own height rather than assuming a uniform pitch', () => {
    // row 1 is 45 tall → midpoint 22.5, +7 deadzone = 29.5
    expect(targetIndexFor(0, 29, ragged)).toBe(0);
    expect(targetIndexFor(0, 31, ragged)).toBe(1);
    // row 2 needs 45 + 22.5 = 67.5, +7 = 74.5
    expect(targetIndexFor(0, 74, ragged, 1)).toBe(1);
    expect(targetIndexFor(0, 76, ragged, 1)).toBe(2);
  });
});

describe('rowShift — how far the other rows slide', () => {
  const drag = { fromIdx: 0, toIdx: 2, heights: H };

  it('does not move the dragged row itself (it tracks the pointer)', () => {
    expect(rowShift(0, drag)).toBe(0);
  });

  it('slides the rows being passed up by exactly the dragged row height', () => {
    expect(rowShift(1, drag)).toBe(-50);
    expect(rowShift(2, drag)).toBe(-50);
  });

  it('leaves rows outside the moved range alone', () => {
    expect(rowShift(3, drag)).toBe(0);
    expect(rowShift(4, drag)).toBe(0);
  });

  it('slides rows DOWN when dragging upward', () => {
    const up = { fromIdx: 4, toIdx: 2, heights: H };
    expect(rowShift(2, up)).toBe(50);
    expect(rowShift(3, up)).toBe(50);
    expect(rowShift(1, up)).toBe(0);
  });

  it('moves nothing when there is no drag, or the target is the origin', () => {
    expect(rowShift(2, null)).toBe(0);
    expect(rowShift(2, { fromIdx: 1, toIdx: 1, heights: H })).toBe(0);
  });

  it('uses the DRAGGED row height for the gap, not the passed row height', () => {
    const ragged = [75, 45, 45];
    expect(rowShift(1, { fromIdx: 0, toIdx: 1, heights: ragged })).toBe(-75);
  });
});
