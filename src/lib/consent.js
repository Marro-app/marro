// Clickwrap consent capture for account registration.
//
// Why this exists: a Terms/Privacy agreement is only reliably enforceable if
// the user took an affirmative action to accept AND we can show a record of it
// (which version, when). Passive "by using this you agree" footers (browsewrap)
// are routinely thrown out — which would take the arbitration clause and the
// minor parental-consent down with them. So at signup we (a) require an
// affirmative action, (b) stash what was agreed, and (c) write it to the user's
// profile row once they're authenticated. See docs/DATA_ETHICS.md rule 5.
//
// Flow: AuthModal stashes the pending consent the moment the user triggers a
// signup (email "Create account" or "Continue with Google"). The stash lives in
// localStorage so it survives Google's full-page OAuth redirect and the email-
// confirmation round-trip — exactly like the pending invite code. On the next
// authenticated boot, App.jsx calls recordConsentIfPending() to persist it.

// Bump this whenever terms.html / privacy.html change materially, so the stored
// record reflects which version each user actually agreed to. Keep it in sync
// with the "Last updated" date on those pages.
export const TERMS_VERSION = '2026-08-02';

const KEY = 'marro_pending_consent';

// Called at the point of a signup action. `guardianAttested` is the minor
// checkbox state ("I'm 18+, or my parent/guardian agreed for me").
export function stashPendingConsent({ guardianAttested = false } = {}){
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: TERMS_VERSION,
      at: new Date().toISOString(),
      guardian: !!guardianAttested,
    }));
  } catch {
    // Private mode / storage disabled: the on-screen notice still forms the
    // agreement; we just can't persist the DB record. Non-fatal.
  }
}

// Called on authenticated boot with a ready supabase client. Writes the pending
// consent onto the user's profiles row (upsert, so it works whether or not the
// profile exists yet), then clears the stash. Best-effort: if it fails (e.g.
// offline) the stash remains and we retry on the next boot.
export async function recordConsentIfPending(sb){
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { pending = null; }
  if (!pending || !pending.v) return;
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (!user) return;
    const row = { user_id: user.id, terms_version: pending.v, terms_agreed_at: pending.at };
    // Only ever set guardian_attested true — never downgrade a prior true to
    // false (e.g. a later plain login shouldn't erase the original attestation).
    if (pending.guardian) row.guardian_attested = true;
    // merge-duplicates: on conflict, updates only the columns in `row`, so a
    // pre-existing `school` value is left untouched.
    const { error } = await sb.from('profiles').upsert(row, { onConflict: 'user_id' });
    if (!error) localStorage.removeItem(KEY);
  } catch {
    // leave the stash in place; next authenticated boot will retry
  }
}
