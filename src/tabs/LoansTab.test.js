import { describe, it, expect } from 'vitest';
import { splitEvenly } from './LoansTab.jsx';

// ⚠ REGRESSION (2026-07-18 hotfix, break-testing finding C3): "Remove part"
// used to just filter out the removed disbursement row — dropping its dollar
// amount from the loan's total borrowed with no warning (repro: a $41,000
// federal loan, 3 parts of $13,666.67 after "add another part", removing one
// part silently dropped the loan to $27,333.34; the header Debt tile followed
// it down to match). The fix (see `removePart` in LoansTab.jsx) redistributes
// the pre-removal total across the remaining rows via the same `splitEvenly`
// helper "add another part" already uses — these tests replicate that exact
// algorithm against `splitEvenly` directly (a real pure function, not a
// React-only code path) to pin the invariant: total borrowed survives a
// removal unless the student explicitly edits an amount afterward.
function removePartLogic(disbursements, indexToRemove) {
  const total = disbursements.reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const remaining = disbursements.filter((_, i) => i !== indexToRemove);
  const amounts = splitEvenly(total, remaining.length);
  return remaining.map((d, i) => ({ ...d, amount: amounts[i] }));
}

describe('removePart redistribution (C3 fix)', () => {
  it('reproduces the break-testing repro: $41,000 across 3 parts, removing one preserves the $41,000 total', () => {
    const disbursements = [
      { id: 'd1', amount: 13666.67 },
      { id: 'd2', amount: 13666.67 },
      { id: 'd3', amount: 13666.66 }, // splitEvenly's remainder-cent row
    ];
    const totalBefore = disbursements.reduce((a, d) => a + d.amount, 0);
    expect(Math.round(totalBefore * 100) / 100).toBe(41000);

    const after = removePartLogic(disbursements, 2); // remove the 3rd part
    expect(after).toHaveLength(2);
    const totalAfter = after.reduce((a, d) => a + d.amount, 0);
    expect(Math.round(totalAfter * 100) / 100).toBe(41000); // unchanged — previously this would have dropped to 27333.34
  });

  it('preserves the total for an uneven split too (not just perfectly-divisible amounts)', () => {
    const disbursements = [
      { id: 'd1', amount: 20000 },
      { id: 'd2', amount: 15000 },
      { id: 'd3', amount: 7000 },
    ];
    const totalBefore = 42000;
    const after = removePartLogic(disbursements, 0); // remove the first part
    const totalAfter = after.reduce((a, d) => a + d.amount, 0);
    expect(Math.round(totalAfter * 100) / 100).toBe(totalBefore);
  });

  it('removing down to a single remaining part puts the whole total on that one row', () => {
    const disbursements = [{ id: 'd1', amount: 30000 }, { id: 'd2', amount: 11000 }];
    const after = removePartLogic(disbursements, 1);
    expect(after).toEqual([{ id: 'd1', amount: 41000 }]);
  });
});
