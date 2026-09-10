# OpenCode Stats

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue)
![Tauri 2](https://img.shields.io/badge/Tauri-2-purple) ![React 19](https://img.shields.io/badge/React-19-cyan)

> 🇬🇧 English below · 🇮🇹 [Italiano](#opencode-stats-1)

A lightweight desktop dashboard (**Tauri v2**, ~10 MB `.exe`, ~30 MB RAM) for your
OpenCode usage statistics: input/output tokens, cost, daily/weekly/all-time views,
charts and tables, customizable profile, EN/IT interface.

## Data (live, read-only)

It reads `~/.local/share/opencode/opencode.db` read-only (`OPENCODE_DB_PATH` override):

- `message.data` (JSON: `role/providerID/modelID/tokens/cost`) → KPIs, daily/weekly, per-provider split
- `session` (`cost/tokens_*` aggregates) → recent sessions list

Providers used through OpenCode (`opencode/*`, `ollama/*`, `lmstudio/*`, `llama.cpp/*`, …)
are filterable with **Combined / Split** views and stable per-provider colors.

The app is OpenCode-only: it only reads its database — no API keys, no auth,
no network (localhost only). Original files are only ever read.
No telemetry of any kind.

## Development

```powershell
npm install
npm run tauri dev      # app + hot reload (live data from your opencode.db)
```

Without Tauri (`npm run dev`) the UI shows a warning because Rust invokes are unavailable.
`npm run dev` + `?demo` opens a demo dataset (also handy for screenshots).

## Build `.exe`

```powershell
npm run tauri build
# -> src-tauri/target/release/opencode-stats.exe
# -> src-tauri/target/release/bundle/nsis/OpenCode Stats_0.1.1_x64-setup.exe (+ .msi)
```

> Note: if you change icons or `tauri.conf.json` and the exe doesn't pick them up,
> delete `src-tauri/target/release/build/opencode-stats-*/` before rebuilding:
> Tauri's build script (Windows resources/icons) doesn't always re-run on its own
> and would link stale resources. `cargo clean -p` alone is not enough.

## Structure

- `src-tauri/src/stats.rs` — read-only SQLite queries + `db_info/overview/daily_stats/model_stats/session_list/dashboard` commands
- `src/lib/` — `api.ts`, `types.ts`, `format.ts`, `profile.ts` (`localStorage` profile), `providers.ts` (stable provider colors), `brand.tsx` (provider logos), `i18n.ts` (EN/IT), `demo.ts` (`?demo` dataset)
- `src/App.tsx` — dashboard: KPIs, ECharts charts (tokens/cost/per-provider), top models, sessions
- Silent refresh every 30 s (pausable) + refresh on focus, light/dark theme, Daily (14 d) / Weekly (8 wks) / All ranges

## Legal notes

Provider icons come from [Simple Icons](https://simple-icons.org) (CC0, bundled locally —
no external loading). Additional marks vectorized from official sources:
[OpenCode brand](https://opencode.ai/brand) (MIT project, also for Zen),
Groq and Cerebras logos via Wikimedia Commons (referential use: they only identify
the token source in your statistics). All trademarks belong to their respective owners.

---

# OpenCode Stats

🇮🇹 Versione italiana — [English](#opencode-stats) sopra.

Dashboard desktop leggera (**Tauri v2**, `.exe` ~10 MB, ~30 MB RAM) per le statistiche di
utilizzo di OpenCode: input/output tokens, costo, viste giornaliere/settimanali/tutto,
grafici e tabelle, profilo personalizzabile, interfaccia EN/IT.

## Dati (live, sola lettura)

Legge in read-only `~/.local/share/opencode/opencode.db` (override con `OPENCODE_DB_PATH`):

- `message.data` (JSON: `role/providerID/modelID/tokens/cost`) → KPI, daily/weekly, split per provider
- `session` (aggregati `cost/tokens_*`) → lista sessioni recenti

I provider usati via OpenCode (`opencode/*`, `ollama/*`, `lmstudio/*`, `llama.cpp/*`, …)
sono filtrabili con vista **Sommati / Singoli** e colori stabili per provider.

L'app è dedicata a OpenCode: legge solo il suo database, niente chiavi API,
niente auth, niente rete (solo localhost). I file originali sono sempre e solo letti.
Nessuna telemetria di alcun tipo.

## Sviluppo

```powershell
npm install
npm run tauri dev      # app + hot reload (dati live dal tuo opencode.db)
```

Senza Tauri (`npm run dev`) l'UI mostra un avviso perché gli invoke Rust non sono disponibili.
`npm run dev` + `?demo` apre un dataset dimostrativo (comodo anche per screenshot).

## Build `.exe`

```powershell
npm run tauri build
# -> src-tauri/target/release/opencode-stats.exe
# -> src-tauri/target/release/bundle/nsis/OpenCode Stats_0.1.1_x64-setup.exe (+ .msi)
```

> Nota: se cambi icone o `tauri.conf.json` e l'exe non li recepisce, cancella
> `src-tauri/target/release/build/opencode-stats-*/` prima di rebuildare:
> lo script di build di Tauri (risorse Windows/icons) non sempre si ri-esegue
> da solo e linkerebbe risorse vecchie. `cargo clean -p` da solo non basta.

## Struttura

- `src-tauri/src/stats.rs` — query SQLite read-only + comandi `db_info/overview/daily_stats/model_stats/session_list/dashboard`
- `src/lib/` — `api.ts`, `types.ts`, `format.ts`, `profile.ts` (profilo in `localStorage`), `providers.ts` (colori stabili per provider), `brand.tsx` (loghi provider), `i18n.ts` (EN/IT), `demo.ts` (dataset `?demo`)
- `src/App.tsx` — dashboard: KPI, grafici ECharts (token/costo/per-provider), top modelli, sessioni
- Refresh silenzioso ogni 30 s (pausabile) + refresh su focus, tema chiaro/scuro, range Giornaliero (14 gg) / Settimanale (8 sett) / Tutto

## Note legali

Le icone dei provider vengono da [Simple Icons](https://simple-icons.org) (CC0, bundle
locale — nessun caricamento esterno). Marchi aggiuntivi vettorializzati dalle fonti
ufficiali: [OpenCode brand](https://opencode.ai/brand) (progetto MIT, anche per Zen),
logo Groq e logo Cerebras da Wikimedia Commons (uso referenziale: identificano solo
la sorgente dei token nelle tue statistiche). Tutti i marchi citati appartengono ai
rispettivi proprietari.
