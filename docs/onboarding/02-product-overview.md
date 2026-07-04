# Product Overview — What the App Actually Does

This is a plain-language walk through the app, as a user experiences it. No code. Where something is a screen or a button, it's described the way you'd see it.

## The big idea, visually

Marro's signature visual is a set of **growth rings** — like the rings of a tree — used as the app's logo and throughout the interface. The rings are both the brand and a way of showing progress and money at a glance. The whole app is designed to look calm and premium, closely following Apple's design style (clean, uncluttered, gentle motion).

## First impression: the landing page

Before signing in, a visitor sees a **scrolling story page** (the public "front door" of the site). As you scroll, it walks through Marro's pitch in a few beats:

1. *"Your aid package, turned into a plan."* — enter your aid and school costs once, and Marro shows what you actually have to live on each month.
2. *"It starts with one intimidating number."* — your aid letter is a wall of figures.
3. *"Marro hands you back one that matters."* — the math happens once: aid in, school costs out, and what remains becomes your monthly number.
4. *"Log it in seconds."* — quick expense entry between lectures.
5. *"Always know where you stand."* — your plan versus what you actually spent: ahead, behind, or on track.
6. *"Board exams. Rotation season. Marro sees them coming."* — it plans for med school's known expensive milestones before they hit a credit card.
7. *"By us. For us."* — built by a med student, for med students.

To use the app, a person **signs in with their Google account**. There's no anonymous browsing — you must sign in. This keeps each person's financial data private to them.

## Setting up (about 5 minutes, once)

A new user answers a short set of questions:

- **Their school** — picked from a searchable list of every US medical school. Some schools have multiple campuses, so it asks which one.
- **Their program** — is it a straight MD/DO, or a dual degree (like MD-PhD or MD plus a Master's), and how many years is it (anywhere from 3 to 8).
- **When they started** — which fall they began, so the app can lay out their years automatically.
- **Their money basics** — aid, school costs, rent and fixed monthly bills, any family/partner support, and other income.

From those answers, Marro figures out the person's academic years and their monthly financial picture without them building anything by hand.

## The main screens (tabs)

The app is organized into **tabs** — labeled sections you switch between, like tabs in a browser. Marro was recently **simplified down to a small number of visible tabs** so it's not overwhelming. Several older tabs still exist in the code but are **hidden** for now (they can be switched back on later without rebuilding them). Below are the tabs and what each does.

### Home / Budget (the main screen)
This is where a user spends almost all their time. It shows:
- **Their monthly plan** — how much they have to live on, and how it's divided across categories (groceries, rent, etc.).
- **Fixed monthly costs** — recurring bills, rolled into the budget with a "Manage" option to edit them.
- **A plan-vs-actual chart** — a simple visual of what they planned to spend versus what they actually spent, so they can see at a glance if they're ahead, behind, or on track.
- **A "quick add" button** — to log a one-off expense in seconds from anywhere.

At the top of the app, three key numbers are always visible: **Runway** (how long the money lasts), **Monthly plan** (what they have to live on), and **Debt** (what they'll owe). Note: Runway and Debt are currently placeholders that fill in fully once the loan math ships — see doc 03.

### Aid / Detail
A closer look at the financial aid and cost details behind the budget — the year-by-year picture of aid coming in and school costs going out. Users can add, edit, and remove academic years here (a removed year is archived and can be restored, not lost).

### Settings
Where a user manages their account and preferences — including changing their school, editing their program, editing spending categories, and switching between light and dark appearance.

### Hidden-for-now tabs (still built, switched off)
These exist and work, but are hidden to keep the app simple. They may return later:
- **Weekly** — detailed week-by-week expense logging, including importing expenses from a spreadsheet file.
- **Savings** — savings goals shown as progress rings (e.g. saving up for a board exam).
- **Charts** — additional spending charts and breakdowns.
- **Subscriptions** — tracking recurring subscriptions (this now folds into the Budget as "fixed monthly costs").

## What the everyday experience feels like

The intended rhythm is deliberately light:

- **Set up once** (~5 minutes).
- **Once a month**, the app plans to ask **one simple question**: *"what's your checking balance right now?"* From that single number it works out how the month actually went and updates the runway. (This "ask for the balance, not every expense" approach is a planned feature — see doc 03.)
- The app is designed to **look alive even when you don't touch it** — for example, the runway counts down over time on its own.
- It's **forgiving**: skip a month and nothing breaks; the next check-in just covers a longer stretch. The product voice literally embraces this — *"Marro doesn't need you every day."*

## Works offline, updates quietly

Marro is a **web app that behaves like an installed app**. It works offline, and new versions update silently in the background — never while you're in the middle of typing something. There's nothing to download from an app store today (a true phone-app version is a later plan).

## The honesty principle in the product

A design rule worth knowing because you'll see it everywhere: **anything the app estimates or the AI suggests is clearly marked as unconfirmed until the user approves it.** For example, if numbers are incomplete, a calm badge appears — *"Estimate — add your loans to make this exact"* — rather than an alarming error. Marro never silently presents a guess as a hard fact. This honesty is treated as a trust asset, not a nice-to-have.
