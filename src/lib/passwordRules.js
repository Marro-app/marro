// Password rules — must MIRROR the Supabase Auth "Password requirements" setting
// (Authentication → Providers → Email): minimum length 8, plus at least one of
// each: lowercase, uppercase, digit, symbol. Keeping this in lockstep with the
// dashboard setting is what makes the on-screen checklist agree with Supabase's
// own server-side rejection — otherwise a user could satisfy the checklist and
// still get a WeakPasswordError (or vice-versa).
//
// If you change the dashboard setting, change PW_MIN_LEN / the checks here too.

export const PW_MIN_LEN = 8;

// Supabase's allowed symbol set (from the password-security docs). Matching the
// exact set (rather than "any non-alphanumeric") avoids false "met" states for
// characters Supabase doesn't count, e.g. spaces or emoji.
const PW_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export function passwordChecks(password){
  const p = password || '';
  return [
    { id: 'len',    label: `At least ${PW_MIN_LEN} characters`, met: p.length >= PW_MIN_LEN },
    { id: 'lower',  label: 'A lowercase letter',                met: /[a-z]/.test(p) },
    { id: 'upper',  label: 'An uppercase letter',               met: /[A-Z]/.test(p) },
    { id: 'digit',  label: 'A number',                          met: /[0-9]/.test(p) },
    { id: 'symbol', label: 'A symbol (e.g. ! ? @ #)',           met: [...p].some((ch) => PW_SYMBOLS.includes(ch)) },
  ];
}

export function passwordMeetsAll(password){
  return passwordChecks(password).every((c) => c.met);
}
