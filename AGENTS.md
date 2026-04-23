# Repository Guidelines

## Overview

HOP is a Tauri 2 desktop app for opening, editing, saving, printing, and exporting HWP/HWPX documents on macOS, Windows, and Linux.

Use `pnpm` only. Do not add npm or yarn lockfiles, commands, or workflow cache keys.

Core stack:

- Tauri 2, Rust, TypeScript
- Vite and Vitest for the studio host
- `third_party/rhwp` as the read-only upstream submodule

## Project Structure

```text
apps/
  desktop/       Tauri desktop shell and native Rust code
  studio-host/   HOP overlay for upstream rhwp-studio
third_party/
  rhwp/          read-only upstream submodule
assets/          icons, fonts, screenshots
docs/            development, architecture, and release notes
scripts/         maintenance scripts
tests/           repository-level tests
```

## Non-Negotiables

- Keep `third_party/rhwp` read-only for HOP product work. Put HOP behavior in `apps/desktop` or `apps/studio-host`.
- Preserve cross-platform behavior for macOS, Windows, and Linux. Avoid OS-specific path, shell, and filesystem assumptions.
- Never log secrets, signing certificates, notarization credentials, tokens, or private document contents.
- Do not move release tags, force-push, or rewrite history unless the user explicitly asks.
- Leave unrelated dirty worktree changes untouched.

## Planning

Write a short Problem 1-Pager before coding when work is non-trivial, ambiguous, cross-platform, release-related, or touches upstream integration:

- Background
- Problem
- Goal
- Non-goals
- Constraints
- Implementation outline
- Verification plan
- Rollback or recovery notes, when release/build behavior is involved

For small, obvious fixes, proceed after reading the relevant surrounding code.

## Code Quality

- Read the surrounding code before editing.
- Prefer explicit, intention-revealing code over hidden magic.
- Keep adapters thin: TypeScript UI should call clear bridge APIs; Rust should own native filesystem, document session, save/export/print, and OS integration behavior.
- Keep side effects at boundary layers.
- Use structured APIs for paths, JSON, TOML, YAML, and shell arguments instead of ad hoc string manipulation.
- Avoid premature abstractions. Extract helpers only when duplication is real or behavior becomes hard to read.
- Split long files and functions before they obscure behavior.
- Handle paths, encodings, date/time, and process execution with platform differences in mind.

Suggested limits:

- File: 300 LOC
- Function: 50 LOC
- Parameters: 5
- Cyclomatic complexity: 10

If a change needs to exceed these limits, document why in the 1-Pager or split the implementation.

## Upstream Boundary

`third_party/rhwp` is vendor source. Update it through:

```bash
RUN_CHECKS=1 scripts/update-upstream.sh
```

After an upstream update, check the submodule pointer, `apps/studio-host` alias/override compatibility, Rust native API compatibility, and HOP-specific file, print, window, and drag/drop flows.

## Testing

Use the most focused relevant verification first:

```bash
pnpm test
pnpm run test:upstream
pnpm run test:studio
pnpm run test:desktop
pnpm run clippy:desktop
pnpm run build:studio
pnpm --filter hop-desktop tauri build --debug --bundles app
```

For risky release, packaging, or cross-platform changes, identify which macOS, Windows, and Linux checks are needed before shipping.

## Codex Desktop Note

On macOS, `build:studio` or `vitest` can fail under Codex desktop because Codex may use its own signed Node binary, which can reject native bindings such as `rolldown`.

If `which node` resolves to `/Applications/Codex.app/.../node`, prefer an external Node runtime before running Vite or Vitest. For example:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm run build:studio
pnpm --filter @golbin/hop-studio-host exec vitest run src/core/tauri-bridge.test.ts
```

Use `which node` to confirm the external Node is selected.

## GitHub Actions And Release

- Workflows should use Node 24, Corepack, pnpm, and `pnpm install --frozen-lockfile`.
- Keep Tauri action inputs aligned with the installed `tauri-apps/tauri-action` version.
- Do not reintroduce npm native optional dependency workarounds after the pnpm migration.
- Release asset names must stay stable for README download links and GitHub Releases.

## Commit And PR

Keep commits small and task-focused. Stage only files related to the current task. Summaries should mention behavior changes, release/build impact, upstream impact, and verification performed.
Do not create commits or bump versions unless the user explicitly asks.
