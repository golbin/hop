# rhwp v0.7.8 Upgrade 1-Pager

## Background

HOP currently pins `third_party/rhwp` to `033617e23847982135c02091a62f55031a3817b5` (`v0.7.7`) and uses `@rhwp/core` `0.7.7` in the studio host. Upstream released `v0.7.8` at `42cf91b6ba7b50fa1c853c01158a52ef68b45442`.

## Problem

The upstream release includes renderer, pagination, HWPX serialization, export API, and rhwp-studio behavior changes. HOP shadows selected rhwp-studio files, so upstream fixes in those files may be hidden unless ported into `apps/studio-host`.

## Goal

Update HOP to the upstream `v0.7.8` baseline when compatible, including the submodule pointer, matching npm WASM package, and any HOP-owned compatibility fixes needed to avoid masking upstream corrections.

## Non-goals

- Do not edit files under `third_party/rhwp`.
- Do not adopt upstream PWA behavior in the Tauri studio host unless required for compatibility.
- Do not change release versioning or create commits.

## Constraints

- Use `pnpm` only for JavaScript dependency work.
- Keep behavior cross-platform.
- Preserve HOP-owned desktop file, save, export, print, font, and event bridge behavior.
- Leave unrelated dirty worktree changes untouched.

## Implementation Outline

1. Compare `v0.7.7..v0.7.8` and identify upstream changes in files shadowed by HOP.
2. Pin `third_party/rhwp` to `v0.7.8`.
3. Update `@rhwp/core` to `0.7.8` so the packaged WASM matches the submodule source.
4. Port relevant upstream rhwp-studio behavior into HOP overrides, especially Task #394 transparent border auto-toggle disabling.
5. Update upstream baseline documentation.

## Verification Plan

Run focused checks first:

- `pnpm install --frozen-lockfile`
- `pnpm run build:studio`
- `pnpm run test:studio`
- `pnpm run test:desktop`
- `pnpm run clippy:desktop`

If these pass and time permits, run the Tauri debug app bundle build.

## Rollback Or Recovery

Revert the submodule pointer to `033617e23847982135c02091a62f55031a3817b5`, restore `@rhwp/core` to `0.7.7`, and revert the HOP override compatibility edits.
