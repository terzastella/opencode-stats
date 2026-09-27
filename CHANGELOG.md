# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.10] - 2026-09-27

### Added
- Reasoning tokens as first-class metric: separate Reasoning row, Total
  generated (output + reasoning), per-model column, chart series, heatmap
  totals.
- True all-time range (was capped at 365 days) with automatic
  day/week/month chart granularity.
- Unit tests: 19 frontend (vitest, `npm test`) + 3 Rust (`cargo test`),
  with a dedicated CI job.

### Changed
- Recent sessions now show per-period numbers from message attribution
  instead of lifetime session aggregates.
- Provider filter uses real per-(session, provider) attribution instead of
  the dominant provider (filtered numbers intentionally diverge from
  `opencode stats` upstream).
- Merged 8 Dependabot updates (tauri 2.11.6, rusqlite 0.40.2, dirs 6,
  vite 8.3.1, react 19.3, actions v7).

### Fixed
- Removed leftover merge markers that reddened CI.

## [0.1.9] - 2026-09-27

### Security
- Stored-XSS guard: provider names from the OpenCode DB are now HTML-escaped
  in all ECharts tooltip/label formatters.
- Hardened Tauri CSP (`object-src 'none'`, `base-uri 'self'`,
  `frame-ancestors 'none'`).
- Photo upload restricted to JPEG/PNG/WebP/GIF (pre-existing BMP/AVIF photos
  reset to monogram on next load).
- Database hardening: symlinks rejected, 2 GiB size cap, tolerant integer
  decoding for aggregates.

### Changed
- `tauri` caret floor 2.11.1 (GHSA-7gmj-67g7-phm9), CI least-privilege with
  pinned runners, Dependabot (npm/cargo/actions), dynamic CI/release badges,
  evergreen download links, artifact gitignore/attributes.

## [0.1.8] - 2026-09-27

### Fixed
- Profile photo upload: valid JPG/PNG files were wrongly rejected as
  "over 10 MB". The app used `blob:` object URLs, which the Tauri CSP
  (`img-src`) blocks — it now uses `FileReader` data URLs, with distinct
  error messages for oversize / unsupported format / decode / save failures,
  empty-MIME tolerance by extension, explicit HEIC/TIFF rejection, and a
  JPEG quality loop so `cleanPhoto()` never silently discards the saved crop.

### Added
- GitHub-style token activity heatmap in profile settings: last 6 months of
  daily input+output tokens, purple intensity levels, month/day labels and a
  Less/More legend. Wide modal variant (1120px, no horizontal scroll, stacks
  below 1080px), 18px cells with month alignment, skeleton/error/empty states
  with retry, lazy 365d dashboard fetch with 30s cache, and a 365d demo
  dataset. IT/EN strings included.

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
