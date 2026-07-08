// Side-effect-free Supabase public config for the api/ serverless routes.
//
// WHY THIS FILE EXISTS (audit M3): the api/ routes previously imported
// SUPABASE_URL / SUPABASE_ANON_KEY from ../src/lib/data.js. That module has a
// bottom-of-file IIFE that runs `setInterval(... window ...)` at import time —
// harmless in the browser, but `window` is undefined in the Node serverless
// runtime, and pulling data.js server-side also drags in supabase-js and the
// client-only helpers. This file re-declares ONLY the two public string
// constants with ZERO side effects, so every api/ route imports from here.
//
// These are the PUBLISHABLE url + anon key — RLS-gated, safe to ship (CLAUDE.md
// rule 4). They are intentionally kept identical to the values in
// src/lib/data.js (single logical source of truth for the client; this is the
// server mirror). If you rotate the project, update BOTH.
export const SUPABASE_URL      = "https://rjowpekykqlounnaegwn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_Kp89EOIm88PDospinCz-eA_wDs09kjq";
