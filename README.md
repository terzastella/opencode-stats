<p align="center">
  <img src="src-tauri/icons/icon.png" width="96" alt="OpenCode Stats logo" />
</p>

<h1 align="center">OpenCode Stats</h1>

<p align="center">
  Lightweight desktop dashboard for your OpenCode usage — tokens, costs, charts.<br />
  <i>Tauri v2 · ~10 MB .exe · ~30 MB RAM · EN/IT</i>
</p>

<p align="center">
  <a href="https://github.com/terzastella/opencode-stats/releases"><b>⬇️ Download v0.1.1</b></a>
  &nbsp;·&nbsp;
  <a href="#opencode-stats-1">🇮🇹 Italiano</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/Tauri-2-purple" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-cyan" alt="React 19" />
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-en.png" width="700" alt="OpenCode Stats dashboard" />
</p>

| | |
|---|---|
| 📊 | Input/output tokens, cost, cache — daily, weekly, all-time |
| 📈 | Line, bar & donut charts, top models, recent sessions |
| 🎛️ | Per-provider filters, Combined / Split views, brand icons |
| 👤 | Customizable profile (photo, name, bio), light/dark theme |
| 🌍 | English + Italian interface |
| 🔒 | 100% local: read-only DB access, no keys, no auth, no telemetry |

<details>
<summary><b>More screenshots</b></summary>
<br />
<p align="center">
  <img src="docs/screenshots/chart-pie.png" width="700" alt="Donut chart view" /><br />
  <em>Donut view (toggle Bars / Pie on the card)</em>
</p>
<p align="center">
  <img src="docs/screenshots/settings.png" width="700" alt="Profile settings" /><br />
  <em>Profile settings (photo, name, bio)</em>
</p>
</details>

<details>
<summary><b>How data works</b></summary>
<br />

It reads `~/.local/share/opencode/opencode.db` read-only (`OPENCODE_DB_PATH` override):

- `message.data` (JSON: `role/providerID/modelID/tokens/cost`) → KPIs, daily/weekly, per-provider split
- `session` (`cost/tokens_*` aggregates) → recent sessions list

Providers used through OpenCode (`opencode/*`, `ollama/*`, `lmstudio/*`, `llama.cpp/*`, …)
are filterable with **Combined / Split** views and stable per-provider colors.

The app is OpenCode-only: it only reads its database — no API keys, no auth,
no network (localhost only). Original files are only ever read.
No telemetry of any kind.
</details>

<details>
<summary><b>Development & build</b></summary>
<br />

```powershell
npm install
npm run tauri dev      # app + hot reload (live data from your opencode.db)
```

Without Tauri (`npm run dev`) the UI shows a warning because Rust invokes are unavailable.
`npm run dev` + `?demo` opens a demo dataset (also handy for screenshots).

```powershell
npm run tauri build
# -> src-tauri/target/release/opencode-stats.exe
# -> src-tauri/target/release/bundle/nsis/OpenCode Stats_0.1.1_x64-setup.exe (+ .msi)
```

> Note: if you change icons or `tauri.conf.json` and the exe doesn't pick them up,
> delete `src-tauri/target/release/build/opencode-stats-*/` before rebuilding:
> Tauri's build script (Windows resources/icons) doesn't always re-run on its own
> and would link stale resources. `cargo clean -p` alone is not enough.
</details>

<details>
<summary><b>Project structure & legal</b></summary>
<br />

- `src-tauri/src/stats.rs` — read-only SQLite queries + `db_info/overview/daily_stats/model_stats/session_list/dashboard` commands
- `src/lib/` — `api.ts`, `types.ts`, `format.ts`, `profile.ts` (`localStorage` profile), `providers.ts` (stable provider colors), `brand.tsx` (provider logos), `i18n.ts` (EN/IT), `demo.ts` (`?demo` dataset)
- `src/App.tsx` — dashboard: KPIs, ECharts charts (tokens/cost/per-provider), top models, sessions
- Silent refresh every 30 s (pausable) + refresh on focus, light/dark theme, Daily (14 d) / Weekly (8 wks) / All ranges

Provider icons come from [Simple Icons](https://simple-icons.org) (CC0, bundled locally —
no external loading). Additional marks vectorized from official sources:
[OpenCode brand](https://opencode.ai/brand) (MIT project, also for Zen),
Groq and Cerebras logos via Wikimedia Commons (referential use: they only identify
the token source in your statistics). All trademarks belong to their respective owners.
</details>

---

# OpenCode Stats

<p align="center">
  🇮🇹 Versione italiana — <a href="#opencode-stats">English</a> sopra · <a href="https://github.com/terzastella/opencode-stats/releases"><b>⬇️ Download v0.1.1</b></a>
</p>

Dashboard desktop leggera (**Tauri v2**, `.exe` ~10 MB, ~30 MB RAM) per le statistiche di
utilizzo di OpenCode: input/output tokens, costo, viste giornaliere/settimanali/tutto,
grafici e tabelle, profilo personalizzabile, interfaccia EN/IT.

<p align="center">
  <img src="docs/screenshots/dashboard-it.png" width="700" alt="Dashboard OpenCode Stats" />
</p>

| | |
|---|---|
| 📊 | Token input/output, costi, cache — giornaliero, settimanale, tutto |
| 📈 | Grafici linee, barre e torta, top modelli, sessioni recenti |
| 🎛️ | Filtri per provider, viste Sommati / Singoli, loghi brand |
| 👤 | Profilo personalizzabile (foto, nome, bio), tema chiaro/scuro |
| 🌍 | Interfaccia inglese + italiano |
| 🔒 | 100% locale: sola lettura DB, niente chiavi, niente telemetria |

<details>
<summary><b>Altri screenshot</b></summary>
<br />
<p align="center">
  <img src="docs/screenshots/chart-pie.png" width="700" alt="Vista torta" /><br />
  <em>Vista torta (toggle Barre / Torta sulla card)</em>
</p>
<p align="center">
  <img src="docs/screenshots/settings.png" width="700" alt="Impostazioni profilo" /><br />
  <em>Pannello impostazioni profilo</em>
</p>
</details>

<details>
<summary><b>Come funzionano i dati</b></summary>
<br />

Legge in read-only `~/.local/share/opencode/opencode.db` (override con `OPENCODE_DB_PATH`):

- `message.data` (JSON: `role/providerID/modelID/tokens/cost`) → KPI, daily/weekly, split per provider
- `session` (aggregati `cost/tokens_*`) → lista sessioni recenti

I provider usati via OpenCode (`opencode/*`, `ollama/*`, `lmstudio/*`, `llama.cpp/*`, …)
sono filtrabili con vista **Sommati / Singoli** e colori stabili per provider.

L'app è dedicata a OpenCode: legge solo il suo database, niente chiavi API,
niente auth, niente rete (solo localhost). I file originali sono sempre e solo letti.
Nessuna telemetria di alcun tipo.
</details>

<details>
<summary><b>Sviluppo e build</b></summary>
<br />

```powershell
npm install
npm run tauri dev      # app + hot reload (dati live dal tuo opencode.db)
```

Senza Tauri (`npm run dev`) l'UI mostra un avviso perché gli invoke Rust non sono disponibili.
`npm run dev` + `?demo` apre un dataset dimostrativo (comodo anche per screenshot).

```powershell
npm run tauri build
# -> src-tauri/target/release/opencode-stats.exe
# -> src-tauri/target/release/bundle/nsis/OpenCode Stats_0.1.1_x64-setup.exe (+ .msi)
```

> Nota: se cambi icone o `tauri.conf.json` e l'exe non li recepisce, cancella
> `src-tauri/target/release/build/opencode-stats-*/` prima di rebuildare:
> lo script di build di Tauri (risorse Windows/icons) non sempre si ri-esegue
> da solo e linkerebbe risorse vecchie. `cargo clean -p` da solo non basta.
</details>

<details>
<summary><b>Struttura progetto e note legali</b></summary>
<br />

- `src-tauri/src/stats.rs` — query SQLite read-only + comandi `db_info/overview/daily_stats/model_stats/session_list/dashboard`
- `src/lib/` — `api.ts`, `types.ts`, `format.ts`, `profile.ts` (profilo in `localStorage`), `providers.ts` (colori stabili per provider), `brand.tsx` (loghi provider), `i18n.ts` (EN/IT), `demo.ts` (dataset `?demo`)
- `src/App.tsx` — dashboard: KPI, grafici ECharts (token/costo/per-provider), top modelli, sessioni
- Refresh silenzioso ogni 30 s (pausabile) + refresh su focus, tema chiaro/scuro, range Giornaliero (14 gg) / Settimanale (8 sett) / Tutto

Le icone dei provider vengono da [Simple Icons](https://simple-icons.org) (CC0, bundle
locale — nessun caricamento esterno). Marchi aggiuntivi vettorializzati dalle fonti
ufficiali: [OpenCode brand](https://opencode.ai/brand) (progetto MIT, anche per Zen),
logo Groq e logo Cerebras da Wikimedia Commons (uso referenziale: identificano solo
la sorgente dei token nelle tue statistiche). Tutti i marchi citati appartengono ai
rispettivi proprietari.
</details>
