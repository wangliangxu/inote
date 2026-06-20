# daisyUI Panel Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current daisyUI migration feel cohesive across the shell, settings modal, tags popover, prompt dialog, and note agent while preserving the existing app frame.

**Architecture:** Keep React state and data flow unchanged. Apply daisyUI classes at component boundaries, and keep the legacy CSS bridge for editor and feature panels that are not part of this pass.

**Tech Stack:** React 19, Vite, Tailwind CSS 4, daisyUI 5, Vitest.

---

### Task 1: Theme Helper Baseline

**Files:**
- Modify: `src/shared/theme.test.ts`
- Modify: `src/shared/theme.ts`

- [ ] Update tests to expect daisyUI theme names: default maps to `light`/`dark`, corporate maps to `corporate`/`business`, cupcake maps to `cupcake`/`dracula`, and nord maps to `nord`/`dim`.
- [ ] Run `npm test -- src/shared/theme.test.ts` and confirm the current test fails before adjusting implementation, because existing tests still reference removed custom themes.
- [ ] Keep `theme.ts` implementation aligned with the test expectations.
- [ ] Re-run `npm test -- src/shared/theme.test.ts` and confirm it passes.

### Task 2: Peripheral Panel Markup

**Files:**
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/tags/TagsPanel.tsx`
- Modify: `src/features/agent/NoteAgent.tsx`
- Modify: `src/app/App.tsx`

- [ ] Convert Settings tabs, inputs, selects, checkboxes, and action buttons to daisyUI classes.
- [ ] Convert Tags popover search, sort buttons, tag chips, and selected-note list to daisyUI classes.
- [ ] Convert NoteAgent result actions, quick action menu, textarea, and run button to daisyUI classes.
- [ ] Convert the prompt dialog in `App.tsx` to daisyUI modal/card/input/button classes.
- [ ] Preserve all handlers, props, labels, and disabled states.

### Task 3: CSS Bridge Cleanup

**Files:**
- Modify: `src/app/styles.css`

- [ ] Add small compatibility rules for `.btn.primary` and modal surfaces where old markup may still refer to legacy classes.
- [ ] Keep editor, calendar, todo, and MDXEditor CSS intact.
- [ ] Avoid deleting broad legacy selectors unless the related markup has been converted.

### Task 4: Verification

**Files:**
- No production edits expected.

- [ ] Run `npm test -- src/shared/theme.test.ts`.
- [ ] Run `npm run build`.
- [ ] If the dev server is useful for manual inspection, run `npm run dev` and share the localhost URL.
