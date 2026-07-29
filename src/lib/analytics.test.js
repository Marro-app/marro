import { describe, it, expect } from 'vitest';
import { sanitizeIdentifier, deriveIdentifier } from './analytics.js';

// ── sanitizeIdentifier ────────────────────────────────────────────────────
describe('sanitizeIdentifier', () => {
  it('strips digits', () => {
    expect(sanitizeIdentifier('Step 1')).toBe('step');
  });

  it('strips currency symbols and leftover punctuation from amounts', () => {
    expect(sanitizeIdentifier('Pay $1,234.56 now')).toBe('pay-now');
  });

  it('collapses whitespace and lowercases/slugifies', () => {
    expect(sanitizeIdentifier('  Add   Expense  ')).toBe('add-expense');
    expect(sanitizeIdentifier('Delete Account')).toBe('delete-account');
  });

  it('caps length at 40 chars with no trailing hyphen', () => {
    const long = 'a'.repeat(60);
    const out = sanitizeIdentifier(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(sanitizeIdentifier(null)).toBe('');
    expect(sanitizeIdentifier(undefined)).toBe('');
    expect(sanitizeIdentifier('')).toBe('');
    expect(sanitizeIdentifier('   $42.00   ')).toBe('');
  });
});

// ── deriveIdentifier: priority order + never reading free-typed values ────
describe('deriveIdentifier', () => {
  it('prefers data-analytics over everything else', () => {
    const el = document.createElement('button');
    el.setAttribute('data-analytics', 'custom-id');
    el.setAttribute('aria-label', 'Aria Label');
    el.id = 'some-id';
    el.textContent = 'Visible Text';
    expect(deriveIdentifier(el)).toBe('custom-id');
  });

  it('falls back to aria-label when no data-analytics', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'Save Budget');
    el.id = 'some-id';
    el.textContent = 'Visible Text';
    expect(deriveIdentifier(el)).toBe('save-budget');
  });

  it('falls back to name/id when no data-analytics or aria-label', () => {
    const el = document.createElement('button');
    el.id = 'submit-btn';
    el.textContent = 'Visible Text';
    expect(deriveIdentifier(el)).toBe('submit-btn');
  });

  it('falls back to visible text as a last resort', () => {
    const el = document.createElement('button');
    el.textContent = 'Add Category';
    expect(deriveIdentifier(el)).toBe('add-category');
  });

  it('sanitizes digits/currency out of visible text (e.g. dollar amounts)', () => {
    const el = document.createElement('button');
    el.textContent = 'Withdraw $500.00';
    expect(deriveIdentifier(el)).toBe('withdraw');
  });

  it('reads value only for submit/button inputs, never other input types', () => {
    const submitEl = document.createElement('input');
    submitEl.type = 'submit';
    submitEl.value = 'Send';
    expect(deriveIdentifier(submitEl)).toBe('send');

    const textEl = document.createElement('input');
    textEl.type = 'text';
    textEl.value = 'user typed secret stuff';
    expect(deriveIdentifier(textEl)).toBe('');
  });
});
