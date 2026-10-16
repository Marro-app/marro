# Testing the auth changes — plain-language walkthrough

Everything below is grouped by feature. For each one: what to click, what you should see, and whether it's something you can test yourself or something I already tested for you (with the result).

---

## 1. "Looks like you already have an account" message

**What changed:** If you try to sign up with an email that's already registered, you now get a clear message telling you to sign in instead — instead of the old vague "check your email" message that didn't actually mean anything happened.

**How to test it yourself:**
1. Go to the site, click **Sign up**.
2. Enter an email you already have a Marro account with (your own works), and any password that meets the requirements.
3. Click **Create account**.
4. **Expected:** a message like *"Looks like you already have an account with this email — Sign in instead"*, with a clickable link that switches you to the login form.

---

## 2. Auto sign-out after 30 minutes of doing nothing

**What changed:** If you're signed in and don't touch anything for 30 minutes, you'll get a warning, then get signed out automatically — useful if you ever use Marro on a shared or public computer.

**Can't practically test yourself** (nobody wants to sit and wait 30 minutes), so I tested it myself using a shortcut: I temporarily set the wait time to 8 seconds instead of 30 minutes, watched it happen, then set it back to 30 minutes.

**What I saw:** After the shortened wait, a banner appeared saying *"You'll be signed out soon due to inactivity"* with a "Stay signed in" button. When I let it run out without clicking that button, it signed out automatically and landed back on the login screen with the message *"You were signed out after a period of inactivity. Sign back in to continue."* Worked exactly as intended.

**Optional light check you CAN do:** Next time you're signed in and step away for a bit (even just a couple minutes), watch for the little "you're about to be signed out" banner if you happen to be idle around the 29-minute mark — not something you need to force, just something you might notice naturally over time.

---

## 3. "Stay signed in on this device" checkbox

**What changed:** A checkbox on the login/signup screen. Checked (the default) = you stay logged in like before. Unchecked = you'll get signed out automatically once you close the browser — good for a shared computer where you don't want to leave yourself logged in.

**How to test it yourself:**
1. Open the login form — you should see a checkbox labeled **"Stay signed in on this device"**, checked by default.
2. To test the "off" behavior: uncheck it, log in, then fully quit and reopen your browser (not just close the tab — actually quit the browser app). You should be signed out when you come back.
3. To test the "on" behavior (default): leave it checked, log in, close and reopen your browser — you should still be signed in.

---

## 4. Always a way back if you get stuck signing up

**What changed:** Right after you sign up, if the confirmation email doesn't show up, there's now a "Didn't get it? Resend" button visible immediately — instead of you having to fail a login attempt first before that option appeared.

**How to test it yourself:**
1. Sign up with a new email.
2. Right after clicking **Create account**, look at the "check your email" message.
3. **Expected:** a **"Didn't get it? Resend"** link/button right there, without needing to do anything else first.

---

## 5. "Prove you're human" protection (mostly invisible)

**What changed:** A background check now runs on the login/signup/reset forms to block bots from spamming password attempts. It's designed to be invisible for real people — you shouldn't see or feel anything different.

**Not fully testable by either of us yet** — it's built and confirmed to be loading and working correctly in the code, but it's intentionally sitting inactive until we do two more things: (1) you create a free account with a service called Cloudflare and generate a real key, and (2) I flip a switch in Supabase's settings to actually start enforcing it. I didn't want to flip that switch until we're sure it's wired up right, since turning it on incorrectly could accidentally block real people from logging in.

**What I confirmed already:** using a temporary "always passes" test key (not a real one), I verified the check loads properly and stays invisible during normal sign-in/sign-up — no visible popup, no delay, nothing a real user would notice.

**Your action item, whenever you're ready:** create a free Cloudflare account, generate a "Turnstile" key, and send it to me — I'll wire it in and turn it on.

---

## 6. Fixing the broken confirmation emails (the "nothing arrived" bug)

**What was wrong:** Signing up (or resetting your password) was silently failing — Supabase couldn't send the confirmation email at all, so new signups were completely broken.

**Not testable by you directly** (it's a backend/email-delivery fix), but here's what I did to confirm it's fixed:
1. Found the real cause: the saved password Marro's email system was using to send mail had gone bad.
2. Replaced it with a fresh one (you generated it in Resend, I installed it).
3. Sent a real test signup to your own email (`mohijazi@chapman.edu`, and a variant of it) — **you saw it land in your inbox**, which is the proof this now works.

**You already personally verified this one** when you confirmed the email came through — nothing further needed.

---

## 7. Stopping people from creating unlimited accounts with tricks

**What was wrong:** Some email systems (Gmail, and pretty much every `.edu` school email including Chapman's) treat `you+anything@school.edu` as the exact same inbox as `you@school.edu`. Before this fix, Marro didn't know that, so someone could've signed up dozens of times using slight variations of one real email address, creating a pile of separate accounts all landing in one inbox.

**How to test it yourself:**
1. Try signing up with your own email plus anything after a `+`, like `mohijazi+test@chapman.edu` (assuming you already have an account under `mohijazi@chapman.edu`, which you do).
2. **Expected:** it should be rejected with *"An account already exists for this email address. Try signing in instead."* — even though the address looks different, Marro now recognizes it's really you.
3. As a sanity check, also try signing up with a genuinely new email you've never used before — that one should go through completely normally, to make sure this fix didn't accidentally block real new users.

**What I already tested for you:** I ran both of those exact scenarios directly before handing this off — the "+trick" version was correctly blocked, and a completely fresh email was correctly allowed through. Both worked exactly as expected. I also cleaned up all the test/junk accounts this created afterward, so your account list stays tidy.

---

## Quick checklist

| # | What | You can test | I already tested |
|---|------|:---:|:---:|
| 1 | "Already have an account" message | ✅ | — |
| 2 | 30-min auto sign-out | optional/passive | ✅ (sped up for testing) |
| 3 | "Stay signed in" checkbox | ✅ | — |
| 4 | Resend link right after signup | ✅ | — |
| 5 | Human-check protection | not yet — needs your Cloudflare key | ✅ (partially, with a test key) |
| 6 | Confirmation emails working again | you already confirmed it | ✅ |
| 7 | Blocking the "+trick" duplicate accounts | ✅ | ✅ |
