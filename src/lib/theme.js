// Design tokens — C mutates in place via applyTheme so all imported refs stay live.
// ── Design tokens ─────────────────────────────────────────────────────────────
// Theme-swappable: C is assigned from THEMES[theme]; toggling does
// Object.assign(C, THEMES[next]) + a state update so every inline ref recomputes.
// The <style> block mirrors a subset as CSS custom properties (--bg etc.) —
// keep both in sync (documented in docs/DESIGN_SYSTEM.md).
export const THEMES = {
  dark: {
    // Backgrounds — warm near-black (neutral; green ambient identity retired)
    bg:         "#101210",
    bgDark:     "#161814",
    white:      "#1A1C18",                  // glass-card fallback surface (legacy key name)
    surface:    "rgba(255,255,255,0.06)",   // inner panels, sub-tiles, non-card containers
    surfaceMid: "rgba(255,255,255,0.10)",   // slightly elevated surface (hover, active)
    glassTooltip: "rgba(16,18,16,0.88)",    // dark glass for chart tooltips + dropdowns
    glassCard:  "rgba(246,239,221,0.07)",   // inline glass surfaces (mirrors --glass-card)
    scrim:      "rgba(0,0,0,0.65)",         // modal overlay backdrop
    scrimStrong:"rgba(0,0,0,0.80)",         // stacked/nested modal backdrop (over another modal's own glass)
    // Selection / active states — cream, never a semantic hue (rule: selection ≠ danger)
    sel:        "rgba(246,239,221,0.75)",   // selected border
    selBg:      "rgba(246,239,221,0.14)",   // selected fill
    tabActiveBg:"rgba(246,239,221,0.92)",   // active tab pill
    tabMuted:   "rgba(246,239,221,0.50)",   // inactive tab text
    creamSoft:  "rgba(246,239,221,0.16)",   // soft filled secondary buttons
    // Text
    text:       "#F6EFDD",
    textMid:    "rgba(246,239,221,0.65)",
    gray:       "rgba(246,239,221,0.63)",
    // Borders
    border:     "rgba(255,255,255,0.12)",
    borderDark: "rgba(255,255,255,0.20)",
    // Destructive / errors ONLY (delete, reset, error banners) — warm clay
    danger:      "#E08A6B",
    dangerLight: "rgba(224,138,107,0.18)",
    dangerMid:   "rgba(224,138,107,0.40)",
    // Negative DATA (over-budget, deficits, actual-vs-plan series) — amber.
    // Paired with the blue positive below: colorblind-safe (deuteranopia/protanopia),
    // and always accompanied by +/− signs or labels (color is never the only signal).
    neg:        "#E5A23E",
    negLight:   "rgba(229,162,62,0.15)",
    negMid:     "rgba(229,162,62,0.32)",
    // Positive / surplus / on-track — blue (legacy key names teal/green kept, same value)
    teal:       "#82AEDB",
    tealLight:  "rgba(130,174,219,0.16)",
    tealMid:    "rgba(130,174,219,0.34)",
    green:      "#82AEDB",
    greenLight: "rgba(130,174,219,0.16)",
    greenMid:   "rgba(130,174,219,0.34)",
    // Info banners/chips — slate (blue is now the positive hue)
    blue:       "#9FB0BC",
    blueLight:  "rgba(159,176,188,0.16)",
    blueMid:    "rgba(159,176,188,0.32)",
    // Milestone / warning — marigold
    amber:      "#DDA528",
    amberLight: "rgba(221,165,40,0.15)",
    amberMid:   "rgba(221,165,40,0.30)",
    purple:     "#DDA528",
    purpleLight:"rgba(221,165,40,0.15)",
    // Brand tokens
    ink:        "#26251E",                  // dark text on cream fills (active tab pill)
    cream:      "#F6EFDD",
    marigold:   "#DDA528",
    lowTide:    "#7C8471",
    // Ordered so NO two neighbours (incl. the wrap from last→first) share a hue family:
    // blue → gold → tan → sage-gray → sand → steel → ochre → cream → slate → lilac
    chartColors: ["#82AEDB","#DDA528","#D99C7C","#9CB5A4","#C9C2A6","#5E8FBC","#C8861A","#F6EFDD","#7FA0B8","#B89BC7"],
  },
  light: {
    // Backgrounds — warm off-white; alphas re-derived for white compositing (not mirrored)
    bg:         "#ECEAE2",
    bgDark:     "#E2DFD5",
    white:      "#F2F0E8",
    surface:    "rgba(30,30,20,0.05)",
    surfaceMid: "rgba(30,30,20,0.09)",
    glassTooltip: "rgba(250,248,242,0.94)",
    glassCard:  "rgba(255,255,255,0.42)",
    scrim:      "rgba(40,38,32,0.35)",
    scrimStrong:"rgba(40,38,32,0.58)",      // stacked/nested modal backdrop (over another modal's own glass)
    // Selection / active states — ink on light
    sel:        "rgba(38,37,30,0.55)",
    selBg:      "rgba(38,37,30,0.08)",
    tabActiveBg:"rgba(255,255,255,0.96)",
    tabMuted:   "rgba(38,37,30,0.68)",
    creamSoft:  "rgba(38,37,30,0.08)",
    // Text
    text:       "#26251E",
    textMid:    "rgba(38,37,30,0.68)",
    gray:       "rgba(38,37,30,0.68)",
    // Borders
    border:     "rgba(30,30,20,0.12)",
    borderDark: "rgba(30,30,20,0.20)",
    // Destructive / errors — clay, darkened for contrast on light
    danger:      "#964B2E",
    dangerLight: "rgba(176,90,56,0.12)",
    dangerMid:   "rgba(176,90,56,0.30)",
    // Negative data — amber, darkened. Worst-case AA context for this token is
    // text on negLight composited over the page bg (not the lighter card), so it
    // must clear 4.5:1 there — #805700 gives 4.7:1; #9C6A00 only hit 3.5:1.
    neg:        "#805700",
    negLight:   "rgba(156,106,0,0.10)",
    negMid:     "rgba(156,106,0,0.28)",
    // Positive — blue, darkened for AA text contrast on light cards
    teal:       "#2F6196",
    tealLight:  "rgba(51,104,158,0.10)",
    tealMid:    "rgba(51,104,158,0.30)",
    green:      "#2F6196",
    greenLight: "rgba(51,104,158,0.10)",
    greenMid:   "rgba(51,104,158,0.30)",
    // Info — slate
    blue:       "#4F6373",
    blueLight:  "rgba(92,114,130,0.10)",
    blueMid:    "rgba(92,114,130,0.28)",
    // Milestone / warning — marigold, darkened for text legibility on light
    amber:      "#7A5A0D",
    amberLight: "rgba(168,123,18,0.12)",
    amberMid:   "rgba(168,123,18,0.30)",
    purple:     "#7A5A0D",
    purpleLight:"rgba(168,123,18,0.12)",
    // Brand tokens
    ink:        "#26251E",
    cream:      "#F6EFDD",
    marigold:   "#7A5A0D",
    lowTide:    "#9A9E8D",
    // Same hue order as dark, lifted ~30 L points down; cream slot → ink
    chartColors: ["#33689E","#C8861A","#B06A45","#5E7A68","#9A9474","#4A7AAE","#8A6A10","#26251E","#5E88A8","#7E5E94"],
  },
};
export const C = {...THEMES.dark};
export const CHART_COLORS = [...THEMES.dark.chartColors];
// Swap every themed surface at once: the C object mutates in place (all ~400
// inline refs recompute on the next render), CSS picks up [data-theme], and
// the browser chrome follows via the theme-color meta.
export const applyTheme = (dark) => {
  const t = THEMES[dark ? "dark" : "light"];
  Object.assign(C, t);
  CHART_COLORS.length = 0; CHART_COLORS.push(...t.chartColors);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // Two media-scoped theme-color metas exist for pre-JS chrome; post-load we set
  // both to the user's actual theme so whichever the browser picks by OS pref matches.
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = t.bg; });
};
// Sync C to the FOUC guard's resolved theme at module load, so screens that render
// before app data loads (LoginScreen) use the right tokens. The data-driven
// useEffect re-applies on load + toggle.
applyTheme(document.documentElement.dataset.theme !== "light");
// Shared Recharts tooltip styling (G3 glass tier). A function, not a constant:
// C mutates on theme swap, so styles must be rebuilt per render.
export const tipProps = () => ({
  labelStyle:{color:C.text,fontWeight:600,marginBottom:2},
  itemStyle:{color:C.text,padding:"1px 0"},
  contentStyle:{background:C.glassTooltip,color:C.text,border:`1px solid ${C.borderDark}`,borderRadius:12,fontSize:12,padding:"8px 12px",boxShadow:"0 8px 24px rgba(0,0,0,0.22)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)"},
  // Hover cursor: bars get a soft selection wash, line charts a muted guide — never the stock grey
  cursor:{fill:C.selBg,stroke:C.borderDark},
  // Track the pointer 1:1 — the default 400ms position ease makes the box trail the cursor
  isAnimationActive:false,
});

// ── SVG brand icons (inline, no external deps) ────────────────────────────────
