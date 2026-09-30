---
name: kinetics
description: "Kinetics: library of 153 spring-physics micro-interactions. Load when building or polishing UI motion: hover, click, toggle, toast, tab, modal, input feedback, reveals, loaders."
allowed-tools: Read Grep Glob
---

# kinetics

Library of 153 spring-physics micro-interactions, converted from [github.com/ckissi/kinetics](https://github.com/ckissi/kinetics) (MIT). Each effect ships copy-paste CSS, a React variant, and prompt-style guidance describing the exact motion.

## How to use

1. **Find the effect.** Read `references/catalog.md` — effects are grouped into *Interaction & Input*, *Feedback & State*, *Surface & Motion*. Each line names the effect and its one-line behavior. To search by need instead ("I need a notification animation"), grep the reference files for a keyword:

   ```
   grep -il "notification\|snackbar\|toast" .agents/skills/kinetics/references/*.md
   ```

   Keyword lines exist in every reference file (synonyms, UI patterns, use cases).

2. **Read the reference file** for the chosen effect (e.g. `references/toast-overshoot.md`). It contains: description, keywords, CSS, React, and prompt guidance with the exact curve/duration/direction.

3. **Adapt, never paste blind:**
   - Rename classes/selectors to match the project's naming, or scope them under an existing component.
   - Replace hardcoded colors (`#FF8A00`, etc.) with the project's design tokens.
   - Keep the spring parameters (cubic-bezier curve, duration, overshoot direction, stagger delays) — they are the point.
   - Compose with the surrounding design; motion must serve the interaction, not decorate.

## Principles baked into every effect

- **Spring feel over linear ease.** Overshoot curves like `cubic-bezier(0.34, 1.56, 0.64, 1)` / `cubic-bezier(0.18, 1.25, 0.4, 1)`; settle in ~0.3–0.6s.
- **Animate only `transform` and `opacity`** where possible — no layout thrash, no `max-height` hacks unless the effect explicitly calls for it (some do, e.g. Accordion Spring).
- **Respect `prefers-reduced-motion`.** When adding any of these to a project, gate nonessential motion: wrap animations so reduced-motion users get an instant or opacity-only version.
- **One idea per interaction.** A button presses; a toast overshoots; a card expands. Don't stack effects on one element.

## Relationship to antislop

Kinetics supplies honest, purposeful motion and pairs with the antislop rules: use it to fill interactions with real behavior instead of generic decoration, and run antislop's Delivery Gate on any UI work as usual.
