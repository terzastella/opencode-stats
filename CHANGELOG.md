# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.7] - 2026-09-12

### Added
- Timeout wrapper for Tauri invokes (`src/lib/tauri-safe.ts`): a stuck IPC
  call now surfaces as an error instead of freezing the refresh loop.
- GitHub Actions CI (`.github/workflows/ci.yml`): frontend build on Ubuntu,
  full Tauri build on Windows, on every push/PR to `main`.

### Security
- Content Security Policy enabled: strict `script-src 'self'`, with explicit
  allowances for Tauri IPC (`ipc:` + `ipc.localhost`), ECharts tooltip inline
  styles, and data-URL avatars.

### Changed
- TypeScript pinned to exact 6.0.3 (lockfile already resolved to it).

## [0.1.6] - 2026-09-11

### Fixed
- Provider-filter crash (`model_sessions is not iterable`): the
  `selection_stats` API speaks camelCase (serde `rename_all`) but the
  TypeScript interfaces and usages were snake_case. Aligned to camelCase.
- Selection stats hardened with fallbacks so a future shape drift degrades
  instead of crashing the render.

## [0.1.5] - 2026-09-11

### Added
- Friendly "OpenCode is not installed" setup screen (no database found),
  with IT/EN language switch.
- Cost chart axis with readable sub-dollar ticks (`fmtCostCompact`).

### Fixed
- `isTauriRuntime()` detection for Tauri v2 internals.
- Installer branding: Terzastella publisher + custom pixel-bars icons.

### Changed
- README: install requirements, SmartScreen note, per-version changelog (EN/IT).

## [0.1.4] - 2026-09-11

### Added
- Release build script (`scripts/build-release.ps1`) scrubbing build-machine
  paths from the binary via `--remap-path-prefix`.
- Showcase README rebuild (hero, screenshots, download badge).

## [0.1.3] - 2026-09-10

### Added
- Hardening pass: honest provider filters, crash guards, cleanup.
- `Cargo.lock` / `package-lock.json` version sync for reproducible builds.

## [0.1.1] - 2026-09-10

### Added
- Initial release: Tauri v2 + React dashboard for OpenCode token usage
  (KPIs, daily/weekly charts, top models, provider filters, profile
  customization, EN/IT interface, dark theme).
