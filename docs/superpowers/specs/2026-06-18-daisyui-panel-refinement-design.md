# daisyUI Panel Refinement Design

## Goal

Continue the daisyUI migration without destabilizing the existing iNote frame. This pass keeps the current three-pane layout, editor behavior, note persistence, Tauri calls, and workspace state intact.

## Approved Scope

Use option B from the visual companion: stabilize the daisyUI shell and lightly unify the Settings, Tags, Agent, and prompt dialog surfaces. The editor and MDXEditor internals remain on the existing CSS bridge because they are higher-risk and have recent behavior fixes.

## Approach

- Keep `App.tsx` as the shell owner and only adjust classes where the current daisyUI conversion already exists.
- Convert peripheral panel markup to daisyUI utility/component classes while preserving event handlers and props.
- Retain CSS bridge variables in `styles.css` so older feature components continue to inherit daisyUI theme tokens.
- Verify theme helper behavior, then run the app build to catch TypeScript and Tailwind/daisyUI regressions.

## Guardrails

- No changes to note model, vault scanning, LLM request logic, or Tauri command contracts.
- No structural rewrite of the editor or right-sidebar state.
- No destructive git operations.
