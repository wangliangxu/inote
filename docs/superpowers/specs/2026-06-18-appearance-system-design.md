# iNote Appearance System Design

Date: 2026-06-18

## Goal

Improve the current multi-theme and multi-icon appearance system so iNote feels coherent, calm, and durable for daily note taking. Keep the existing appearance flexibility, but make every option belong to one visual system.

## Current Problems

- The default light and dark CSS variables are self-referential, so the active theme can resolve poorly or fall back inconsistently.
- Dark mode reads muddy and green-tinted in the current app screenshot, with weak hierarchy between the topbar, sidebars, editor, assistant, and status bar.
- The settings panel uses many inline styles and a fixed blue active tab, which does not follow the selected theme.
- Todo dashboard styles are hardcoded to a warm paper palette and do not integrate with the theme tokens.
- Icon weight is globally configurable across too many Phosphor styles. Thin, light, filled, and other high-variance choices make the toolbar and navigation feel inconsistent.

## Design Direction

Use a restrained desktop productivity visual language:

- Quiet backgrounds with clear panel separation.
- Strong but not loud active states.
- One accent color per color theme.
- Text contrast that remains readable in dense tool surfaces.
- Rounded corners capped at 8px for buttons, cards, popovers, and dialogs unless a pill is semantically useful.
- Icons as functional controls first, not decorative variety.

## Scope

### Theme Tokens

Rebuild the base theme variables in `src/app/styles.css`.

The system should provide these token groups:

- App and surface backgrounds: `--bg-app`, `--bg-panel`, `--bg-sidebar`, `--bg-topbar`.
- Interactive backgrounds: `--bg-hover`, `--bg-active`.
- Text colors: `--text-main`, `--text-strong`, `--text-secondary`, `--text-muted`.
- Borders: `--border-main`, `--border-hover`.
- Accent and status colors: `--accent-main`, `--accent-danger`, `--accent-warning`, `--accent-info`.
- Soft status backgrounds for warnings, pills, and state indicators.

Default light and default dark must define concrete values, not self-references.

Supported color themes remain:

- Default
- Nord
- Sepia
- Ocean

Each color theme should work in light and dark mode. If the current code lacks a dark variant, add a consistent one rather than falling back to generic dark styling.

### Icon Strategy

Keep Phosphor as the single app icon library.

The appearance settings should recommend a smaller stable set:

- Regular
- Bold
- Duotone

Existing stored values for thin, light, and fill should remain readable for backward compatibility, but the UI should not encourage them as primary choices. If one of those legacy values is already selected, the app can preserve it until the user changes it.

Icon sizing should stay consistent across topbar, note list controls, settings tabs, metadata actions, and assistant controls.

### Settings Panel

Refactor `SettingsPanel` away from inline-heavy visual styling.

The settings dialog should use theme-aware CSS classes for:

- Header and close button.
- Tab rail.
- Active and inactive tab buttons.
- Section spacing.
- Labels, inputs, selects, checkboxes, and action rows.
- Status text.

The appearance tab should remain simple and scannable. It does not need a large preview gallery in this pass, but the controls should feel intentional and visually integrated.

### Todo Dashboard

Update `src/features/todo/TodoDashboard.css` to use global theme tokens instead of fixed beige/dark values.

Todo columns and cards should visually relate to the rest of the app while preserving a board-like workflow:

- Columns use subtle secondary surfaces.
- Cards use panel surfaces and normal borders.
- Drag-over and hover states use the shared accent and hover tokens.
- Due badges and priority icons reuse status colors.

### Editor and MDX Surfaces

Avoid broad changes to editor behavior. Only adjust styles where needed so the editor chrome and surrounding panels match the repaired theme tokens.

The MDX editor's own toolbar may keep its library controls, but its dark-mode integration should not fight the app theme.

## Non-Goals

- Do not replace Phosphor with another icon library.
- Do not remove the multi-theme feature.
- Do not add a full theme builder or custom color picker.
- Do not redesign the application layout.
- Do not change note, vault, search, or agent behavior.

## Acceptance Criteria

- Default light and dark themes render without unresolved or self-referential color variables.
- The main screen, settings dialog, right assistant panel, status bar, and todo board all share the same token system.
- The dark default theme has readable contrast and distinct panel hierarchy.
- The settings panel no longer relies on fixed blue tab styling.
- Appearance settings expose a stable recommended icon style set while preserving legacy stored values.
- `npm run build` succeeds.
- Existing theme tests pass or are updated to reflect the refined theme behavior.
- Browser verification is performed against `http://127.0.0.1:1420/` with screenshots of the main screen and appearance settings.

## Implementation Notes

- Keep changes scoped to `src/shared/theme.ts`, `src/app/styles.css`, `src/features/settings/SettingsPanel.tsx`, and `src/features/todo/TodoDashboard.css` unless verification reveals a directly related issue.
- Prefer CSS variables over inline styles.
- Preserve persisted localStorage keys so existing users do not lose their preferences.
- Because the repository already has unrelated dirty files, commit only this spec before implementation planning.
