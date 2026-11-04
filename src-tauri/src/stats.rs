use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 86_400_000;

/// All `time_created`/`time_updated` columns are **milliseconds** since epoch
/// (verified against live data: values ~1.7e12; seconds would be ~1.7e9 and
/// every range query would silently return zero rows).

/// Resolve the opencode SQLite path.
/// Priority: $OPENCODE_DB_PATH env -> $HOME/.local/share/opencode/opencode.db
pub fn opencode_db_path() -> PathBuf {
    if let Ok(p) = std::env::var("OPENCODE_DB_PATH") {
        let pb = PathBuf::from(p);
        if !pb.as_os_str().is_empty() {
            return pb;
        }
    }
    if let Some(home) = dirs::home_dir() {
        return home
            .join(".local")
            .join("share")
            .join("opencode")
            .join("opencode.db");
    }
    PathBuf::from("opencode.db")
}

/// Refuse absurd files before SQLite touches them (friendly errors, no panic).
/// 32 GiB: real opencode.db files reach multi-GB size (seen 8.7 GB).
const MAX_DB_BYTES: u64 = 34_359_738_368;

fn open_ro(path: &std::path::Path) -> Result<Connection, String> {
    // No symlinks: an env override pointing elsewhere must be explicit, and
    // canonicalize-then-open would hide the indirection from error messages.
    if std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("database path must not be a symlink".to_string());
    }
    let canon = std::fs::canonicalize(path).map_err(|e| format!("open db failed: {e}"))?;
    if !canon.is_file() {
        return Err("database is not a regular file".to_string());
    }
    // No extension allowlist on purpose: $OPENCODE_DB_PATH may legitimately
    // point at a renamed copy. Size cap is the DoS guard.
    let size = std::fs::metadata(&canon).map(|m| m.len()).unwrap_or(0);
    if size > MAX_DB_BYTES {
        return Err(format!(
            "database too large ({size} bytes, cap is {MAX_DB_BYTES})"
        ));
    }
    let conn = Connection::open_with_flags(
        &canon,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("open db failed: {e}"))?;
    // Best-effort: don't fail if a pragma is not allowed in read-only mode.
    // mmap_size speeds up big read scans on multi-GB databases.
    let _ = conn.execute_batch(
        "PRAGMA busy_timeout=5000; PRAGMA query_only=ON; PRAGMA mmap_size=268435456;",
    );
    apply_perf_pragmas(&conn);
    Ok(conn)
}

/// Read-path performance pragmas, measured on a live 10.5 GB v2 database where
/// a full dashboard scan parses ~1 GB of message JSON: keeping GROUP BY/sort
/// temp trees in memory (`temp_store`) and a fixed 64 MiB page cache turn the
/// all-time scan from ~11 s into ~4 s. Best-effort like the other pragmas.
fn apply_perf_pragmas(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA temp_store=MEMORY; PRAGMA cache_size=-65536;");
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// days == 0 means all-time: epoch cutoff matches every row.
fn cutoff_ms(days: u32) -> i64 {
    if days == 0 {
        return 0;
    }
    let days = days.clamp(1, 365) as i64;
    now_ms().saturating_sub(days.saturating_mul(DAY_MS))
}

/// Non-finite floats are not valid JSON (serde_json would fail the whole
/// invoke), so every cost is sanitized before leaving Rust.
fn fin(f: f64) -> f64 {
    if f.is_finite() {
        f
    } else {
        0.0
    }
}

/// Tolerant integer decode for SUM() aggregates: token counts arrive as
/// integers, but a float or numeric string in the JSON would make
/// `r.get::<i64>` fail and sink the whole dashboard. COUNT(*) columns stay
/// strict (always ints).
fn num_i64(r: &rusqlite::Row, idx: usize) -> rusqlite::Result<i64> {
    if let Ok(Some(v)) = r.get::<_, Option<i64>>(idx) {
        return Ok(v);
    }
    if let Ok(Some(v)) = r.get::<_, Option<f64>>(idx) {
        if v.is_finite() {
            return Ok(v.round().clamp(i64::MIN as f64, i64::MAX as f64) as i64);
        }
    }
    if let Ok(Some(s)) = r.get::<_, Option<String>>(idx) {
        let t = s.trim();
        if let Ok(v) = t.parse::<i64>() {
            return Ok(v);
        }
        if let Ok(v) = t.parse::<f64>() {
            if v.is_finite() {
                return Ok(v.round().clamp(i64::MIN as f64, i64::MAX as f64) as i64);
            }
        }
    }
    Ok(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub exists: bool,
    pub size_bytes: u64,
    pub sessions: i64,
    pub messages: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub day: String,
    pub provider: String,
    pub model: String,
    pub messages: i64,
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub cost: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelStat {
    pub provider: String,
    pub model: String,
    pub messages: i64,
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub cost: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    pub directory: String,
    pub cost: f64,
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cache_read: i64,
    pub day: String,
    pub updated_ms: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub sessions: i64,
    pub messages: i64,
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub cost: f64,
}

/// Storage layout of the OpenCode database. OpenCode v2 (>= 2.0) writes
/// sessions/messages to `session_v2`/`session_message`; older releases used
/// `session`/`message`. A migrated v2 database still contains the legacy
/// tables (frozen — no longer written), so the v2 pair wins when present.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Schema {
    V1,
    V2,
}

impl Schema {
    fn sessions_table(self) -> &'static str {
        match self {
            Schema::V2 => "session_v2",
            Schema::V1 => "session",
        }
    }

    fn messages_table(self) -> &'static str {
        match self {
            Schema::V2 => "session_message",
            Schema::V1 => "message",
        }
    }

    /// Assistant-only filter. v2 stores the role in the `type` column; v1
    /// keeps it inside the message JSON. `alias` is the table alias with a
    /// trailing dot ("m.") for joined queries, empty otherwise.
    fn assistant_pred(self, alias: &str) -> String {
        match self {
            Schema::V2 => format!("{alias}type = 'assistant'"),
            Schema::V1 => format!("json_extract({alias}data,'$.role') = 'assistant'"),
        }
    }
}

fn detect_schema(conn: &Connection) -> Result<Schema, String> {
    let v2: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('session_v2','session_message')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("schema probe failed: {e}"))?;
    if v2 == 2 {
        return Ok(Schema::V2);
    }
    let v1: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('session','message')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("schema probe failed: {e}"))?;
    if v1 == 2 {
        return Ok(Schema::V1);
    }
    Err("unsupported database schema: no OpenCode session/message tables".to_string())
}

// CAST AS TEXT: a single non-string provider/model value must never fail
// the whole row decode (r.get::<String> errors on INTEGER).
// COALESCE covers both layouts: v2 nests the model under $.model
// ({id, providerID}); v1 stores providerID/modelID at the top level.
const PROVIDER_SQL: &str =
    "COALESCE(CAST(json_extract(data,'$.model.providerID') AS TEXT), CAST(json_extract(data,'$.providerID') AS TEXT), 'unknown')";
const MODEL_SQL: &str =
    "COALESCE(CAST(json_extract(data,'$.model.id') AS TEXT), CAST(json_extract(data,'$.modelID') AS TEXT), CAST(json_extract(data,'$.model.modelID') AS TEXT), 'unknown')";

pub fn db_info_inner() -> Result<DbInfo, String> {
    let path = opencode_db_path();
    let exists = path.is_file();
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if !exists {
        return Ok(DbInfo {
            path: path.to_string_lossy().to_string(),
            exists,
            size_bytes,
            sessions: 0,
            messages: 0,
        });
    }
    let conn = open_ro(&path)?;
    // Propagate (don't mask): a corrupt schema must surface, not read as zero.
    let (sessions, messages) = db_info_counts(&conn)?;
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        exists,
        size_bytes,
        sessions,
        messages,
    })
}

/// Counts for the dashboard diagnostics: sessions and messages in the active
/// layout (v2 tables when present).
fn db_info_counts(conn: &Connection) -> Result<(i64, i64), String> {
    let schema = detect_schema(conn)?;
    let sessions: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {}", schema.sessions_table()),
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("sessions count failed: {e}"))?;
    let messages: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {}", schema.messages_table()),
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("messages count failed: {e}"))?;
    Ok((sessions, messages))
}

/// Cheap freshness probe (no JSON extraction): lets the frontend skip a full
/// rescan when nothing changed. Used by the all-time auto-refresh tick.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Watermark {
    pub max_message_ms: i64,
    pub max_session_ms: i64,
    pub messages: i64,
    pub sessions: i64,
}

pub fn watermark_inner() -> Result<Watermark, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    watermark_from_conn(&conn)
}

fn watermark_from_conn(conn: &Connection) -> Result<Watermark, String> {
    let schema = detect_schema(conn)?;
    let max_message_ms: i64 = conn
        .query_row(
            &format!(
                "SELECT COALESCE(MAX(time_created),0) FROM {}",
                schema.messages_table()
            ),
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("watermark messages failed: {e}"))?;
    let (max_session_ms, messages, sessions): (i64, i64, i64) = conn
        .query_row(
            &format!(
                "SELECT COALESCE(MAX(time_updated),0), COUNT(*), COUNT(DISTINCT id) FROM {}",
                schema.sessions_table()
            ),
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| format!("watermark sessions failed: {e}"))?;
    Ok(Watermark {
        max_message_ms,
        max_session_ms,
        messages,
        sessions,
    })
}

pub fn session_list_inner(days: u32, limit: u32) -> Result<Vec<SessionRow>, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    session_list_from_conn(&conn, days, limit)
}

fn session_list_from_conn(
    conn: &Connection,
    days: u32,
    limit: u32,
) -> Result<Vec<SessionRow>, String> {
    let schema = detect_schema(conn)?;
    let cutoff = cutoff_ms(days);
    let limit = limit.clamp(1, 500) as i64;
    // Two-phase scan. On v2 the phase-1 predicate is a cheap column check
    // (`type`), so only the candidates' messages get their multi-KB JSON
    // parsed; on a live 10.5 GB DB that measured ~9 s -> ~0.6 s with
    // identical rows (see session_list_two_phase_matches_reference). On
    // legacy v1 DBs both phases parse `$.role`, but those DBs are an order
    // of magnitude smaller (measured: no regression). Equal `time_updated`
    // values are tie-broken by `id` so the LIMIT boundary is deterministic.
    // Per-period attribution: the session row shows only assistant-message
    // usage inside the window (time_created >= cutoff), not the lifetime
    // session aggregates — so the list stays coherent with KPIs and charts.
    // HAVING hides sessions with no in-window assistant usage ($0 rows).
    let mut stmt = conn
        .prepare(&format!(
            "WITH candidates AS MATERIALIZED (
                SELECT s.id AS sid
                 FROM {sessions} s JOIN {messages} m ON m.session_id = s.id
                    AND m.time_created >= ?1 AND {assistant}
                 WHERE s.time_updated >= ?1
                 GROUP BY s.id
                 ORDER BY MAX(s.time_updated) DESC, s.id
                 LIMIT ?2
             )
             SELECT s.id, COALESCE(s.title,''), COALESCE(s.directory,''),
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.cost'),0.0)),0.0) AS cost,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.input'),0)),0) AS input,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.output'),0)),0) AS output,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.reasoning'),0)),0) AS reasoning,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.cache.read'),0)),0) AS cache_read,
                date(datetime(s.time_updated/1000,'unixepoch','localtime')) AS day,
                s.time_updated
             FROM candidates c JOIN {sessions} s ON s.id = c.sid
             LEFT JOIN {messages} m ON m.session_id = s.id
                AND m.time_created >= ?1 AND {assistant}
             GROUP BY s.id
             HAVING COUNT(m.session_id) > 0
             ORDER BY s.time_updated DESC, s.id
             LIMIT ?2",
            sessions = schema.sessions_table(),
            messages = schema.messages_table(),
            assistant = schema.assistant_pred("m."),
        ))
        .map_err(|e| format!("sessions prepare failed: {e}"))?;
    let rows = stmt
        .query_map((cutoff, limit), |r| {
            Ok(SessionRow {
                id: r.get(0)?,
                title: r.get(1)?,
                directory: r.get(2)?,
                cost: r.get(3)?,
                input: num_i64(r, 4)?,
                output: num_i64(r, 5)?,
                reasoning: num_i64(r, 6)?,
                cache_read: num_i64(r, 7)?,
                day: r.get(8)?,
                updated_ms: r.get(9)?,
            })
        })
        .map_err(|e| format!("sessions query failed: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let mut s = row.map_err(|e| format!("row decode failed: {e}"))?;
        s.cost = fin(s.cost);
        out.push(s);
    }
    Ok(out)
}

/// Combined dashboard payload: ONE grouped message scan feeds daily rows,
/// per-model aggregates and overview sums, plus one cheap count-only scan
/// for session/message totals (two scans total, replacing three).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub overview: Overview,
    pub daily: Vec<DayStat>,
    pub models: Vec<ModelStat>,
}

pub fn dashboard_inner(days: u32) -> Result<DashboardData, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    dashboard_from_conn(&conn, days)
}

fn dashboard_from_conn(conn: &Connection, days: u32) -> Result<DashboardData, String> {
    let schema = detect_schema(conn)?;
    let cutoff = cutoff_ms(days);
    let messages_table = schema.messages_table();
    let assistant = schema.assistant_pred("");
    let sql = format!(
        "SELECT date(datetime(time_created/1000,'unixepoch','localtime')) AS day,
            {provider} AS provider, {model} AS model,
            COUNT(*) AS messages,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.input'),0)),0) AS input,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.output'),0)),0) AS output,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.reasoning'),0)),0) AS reasoning,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.cache.read'),0)),0) AS cache_read,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.cache.write'),0)),0) AS cache_write,
            COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0.0)),0.0) AS cost
         FROM {messages_table}
         WHERE time_created >= ?1 AND {assistant}
         GROUP BY day, provider, model
         ORDER BY day ASC",
        provider = PROVIDER_SQL,
        model = MODEL_SQL,
        messages_table = messages_table,
        assistant = assistant
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("dashboard prepare failed: {e}"))?;
    let rows = stmt
        .query_map([cutoff], |r| {
            Ok(DayStat {
                day: r.get(0)?,
                provider: r.get(1)?,
                model: r.get(2)?,
                messages: r.get(3)?,
                input: num_i64(r, 4)?,
                output: num_i64(r, 5)?,
                reasoning: num_i64(r, 6)?,
                cache_read: num_i64(r, 7)?,
                cache_write: num_i64(r, 8)?,
                cost: r.get(9)?,
            })
        })
        .map_err(|e| format!("dashboard query failed: {e}"))?;

    let mut daily = Vec::new();
    let mut by_model: HashMap<(String, String), ModelStat> = HashMap::new();
    let mut overview = Overview {
        sessions: 0,
        messages: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache_read: 0,
        cache_write: 0,
        cost: 0.0,
    };
    for row in rows {
        let mut d = row.map_err(|e| format!("row decode failed: {e}"))?;
        d.cost = fin(d.cost);
        overview.messages = overview.messages.saturating_add(d.messages);
        overview.input = overview.input.saturating_add(d.input);
        overview.output = overview.output.saturating_add(d.output);
        overview.reasoning = overview.reasoning.saturating_add(d.reasoning);
        overview.cache_read = overview.cache_read.saturating_add(d.cache_read);
        overview.cache_write = overview.cache_write.saturating_add(d.cache_write);
        overview.cost += d.cost;
        by_model
            .entry((d.provider.clone(), d.model.clone()))
            .and_modify(|m| {
                m.messages = m.messages.saturating_add(d.messages);
                m.input = m.input.saturating_add(d.input);
                m.output = m.output.saturating_add(d.output);
                m.reasoning = m.reasoning.saturating_add(d.reasoning);
                m.cache_read = m.cache_read.saturating_add(d.cache_read);
                m.cache_write = m.cache_write.saturating_add(d.cache_write);
                m.cost += d.cost;
            })
            .or_insert(ModelStat {
                provider: d.provider.clone(),
                model: d.model.clone(),
                messages: d.messages,
                input: d.input,
                output: d.output,
                reasoning: d.reasoning,
                cache_read: d.cache_read,
                cache_write: d.cache_write,
                cost: d.cost,
            });
        daily.push(d);
    }
    // Cheap count-only scan (no JSON extraction) for session/message totals.
    let (messages, sessions): (i64, i64) = conn
        .query_row(
            &format!(
                "SELECT COUNT(*), COUNT(DISTINCT session_id) FROM {messages_table}
                 WHERE time_created >= ?1 AND {assistant}"
            ),
            [cutoff],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("dashboard count failed: {e}"))?;
    overview.messages = messages;
    overview.sessions = sessions;

    let mut models: Vec<ModelStat> = by_model.into_values().collect();
    models.sort_by(|a, b| b.input.cmp(&a.input));
    // Guard: non-finite floats are not valid JSON (would fail serialization).
    overview.cost = fin(overview.cost);
    for m in &mut models {
        m.cost = fin(m.cost);
    }
    Ok(DashboardData {
        overview,
        daily,
        models,
    })
}

/// Per-(session, provider) usage inside the window, fetched ONLY when a
/// provider filter is active. The frontend keeps a session when ANY selected
/// provider was used and shows only the selected providers' numbers — no
/// dominant-provider hiding.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionProviderStat {
    pub session_id: String,
    pub provider: String,
    pub messages: i64,
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cost: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectionStats {
    pub session_stats: Vec<SessionProviderStat>,
}

pub fn selection_stats_inner(days: u32) -> Result<SelectionStats, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    selection_stats_from_conn(&conn, days)
}

fn selection_stats_from_conn(conn: &Connection, days: u32) -> Result<SelectionStats, String> {
    let schema = detect_schema(conn)?;
    let cutoff = cutoff_ms(days);
    let sql = format!(
        "SELECT session_id, {provider} AS provider,
            COUNT(*) AS messages,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.input'),0)),0) AS input,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.output'),0)),0) AS output,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.reasoning'),0)),0) AS reasoning,
            COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0.0)),0.0) AS cost
         FROM {messages}
         WHERE time_created >= ?1 AND {assistant}
         GROUP BY session_id, provider",
        provider = PROVIDER_SQL,
        messages = schema.messages_table(),
        assistant = schema.assistant_pred("")
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("selection prepare failed: {e}"))?;
    let mut session_stats: Vec<SessionProviderStat> = stmt
        .query_map([cutoff], |r| {
            Ok(SessionProviderStat {
                session_id: r.get(0)?,
                provider: r.get(1)?,
                messages: r.get(2)?,
                input: num_i64(r, 3)?,
                output: num_i64(r, 4)?,
                reasoning: num_i64(r, 5)?,
                cost: r.get(6)?,
            })
        })
        .map_err(|e| format!("selection query failed: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("row decode failed: {e}"))?;
    // Non-finite floats are not valid JSON.
    for s in &mut session_stats {
        s.cost = fin(s.cost);
    }
    Ok(SelectionStats { session_stats })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn fin_sanitizes_non_finite() {
        assert_eq!(fin(1.5), 1.5);
        assert_eq!(fin(f64::NAN), 0.0);
        assert_eq!(fin(f64::INFINITY), 0.0);
        assert_eq!(fin(f64::NEG_INFINITY), 0.0);
    }

    fn decode_literal(literal: &str) -> i64 {
        let conn = Connection::open_in_memory().unwrap();
        let mut stmt = conn.prepare(&format!("SELECT {literal} AS v")).unwrap();
        let mut rows = stmt.query([]).unwrap();
        let row = rows.next().unwrap().unwrap();
        num_i64(&row, 0).unwrap()
    }

    #[test]
    fn num_i64_accepts_int_float_and_numeric_string() {
        assert_eq!(decode_literal("42"), 42);
        assert_eq!(decode_literal("4.6"), 5); // rounds
        assert_eq!(decode_literal("'123'"), 123);
        assert_eq!(decode_literal("' 7.4 '"), 7); // trims
    }

    #[test]
    fn num_i64_falls_back_to_zero() {
        assert_eq!(decode_literal("NULL"), 0);
        assert_eq!(decode_literal("'abc'"), 0);
        assert_eq!(decode_literal("'NaN'"), 0);
    }

    // ---- storage-layout fixtures -------------------------------------------
    // One logical history, two physical layouts:
    // - "v1": session/message tables, role/providerID/modelID inside the JSON.
    // - "v2": session_v2/session_message tables, role as `type` column, model
    //   nested under $.model ({id, providerID}). This is what OpenCode >= 2.0
    //   writes; the v2 test below is the regression guard for the migration.

    fn assistant_json(
        v2: bool,
        provider: &str,
        model: &str,
        cost: f64,
        input: i64,
        output: i64,
        reasoning: i64,
        cr: i64,
        cw: i64,
    ) -> String {
        if v2 {
            format!(
                r#"{{"agent":"build","model":{{"id":"{model}","providerID":"{provider}"}},"cost":{cost},"tokens":{{"input":{input},"output":{output},"reasoning":{reasoning},"cache":{{"read":{cr},"write":{cw}}}}}}}"#
            )
        } else {
            format!(
                r#"{{"role":"assistant","providerID":"{provider}","modelID":"{model}","cost":{cost},"tokens":{{"input":{input},"output":{output},"reasoning":{reasoning},"cache":{{"read":{cr},"write":{cw}}}}}}}"#
            )
        }
    }

    fn user_json(v2: bool) -> String {
        if v2 {
            r#"{"agent":"build","content":[]}"#.to_string()
        } else {
            r#"{"role":"user"}"#.to_string()
        }
    }

    fn insert_v1_message(conn: &Connection, id: &str, session: &str, tc: i64, data: String) {
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES (?1,?2,?3,?4)",
            (id, session, tc, data),
        )
        .unwrap();
    }

    fn insert_v2_message(
        conn: &Connection,
        id: &str,
        session: &str,
        ty: &str,
        tc: i64,
        seq: i64,
        data: String,
    ) {
        conn.execute(
            "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
             VALUES (?1,?2,?3,?4,?5,?5,?6)",
            (id, session, ty, seq, tc, data),
        )
        .unwrap();
    }

    /// Three sessions: recent usage, an old one only visible all-time, and one
    /// with no assistant usage (must be hidden from the session list).
    fn v1_fixture(now: i64) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_updated INTEGER NOT NULL);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session VALUES (?1,?2,?3,?4)",
            ("ses_recent", "Recent", "D:/proj", now - 60_000),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session VALUES (?1,?2,?3,?4)",
            ("ses_old", "Old", "D:/proj", now - 40 * DAY_MS),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session VALUES (?1,?2,?3,?4)",
            ("ses_nousage", "No usage", "D:/proj", now - 120_000),
        )
        .unwrap();
        insert_v1_message(
            &conn,
            "m1",
            "ses_recent",
            now - 50_000,
            assistant_json(false, "p1", "m1", 0.25, 100, 50, 10, 5, 2),
        );
        insert_v1_message(
            &conn,
            "m2",
            "ses_recent",
            now - 40_000,
            assistant_json(false, "p1", "m1", 0.25, 50, 25, 5, 3, 0),
        );
        insert_v1_message(&conn, "m3", "ses_recent", now - 30_000, user_json(false));
        insert_v1_message(
            &conn,
            "m4",
            "ses_old",
            now - 40 * DAY_MS,
            assistant_json(false, "p2", "m2", 1.0, 999, 111, 0, 0, 0),
        );
        insert_v1_message(&conn, "m5", "ses_nousage", now - 100_000, user_json(false));
        conn
    }

    fn v2_fixture(now: i64) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_updated INTEGER NOT NULL);
             CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
                 seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session_v2 VALUES (?1,?2,?3,?4)",
            ("ses_recent", "Recent", "D:/proj", now - 60_000),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session_v2 VALUES (?1,?2,?3,?4)",
            ("ses_old", "Old", "D:/proj", now - 40 * DAY_MS),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session_v2 VALUES (?1,?2,?3,?4)",
            ("ses_nousage", "No usage", "D:/proj", now - 120_000),
        )
        .unwrap();
        insert_v2_message(
            &conn,
            "m1",
            "ses_recent",
            "assistant",
            now - 50_000,
            1,
            assistant_json(true, "p1", "m1", 0.25, 100, 50, 10, 5, 2),
        );
        insert_v2_message(
            &conn,
            "m2",
            "ses_recent",
            "assistant",
            now - 40_000,
            2,
            assistant_json(true, "p1", "m1", 0.25, 50, 25, 5, 3, 0),
        );
        insert_v2_message(
            &conn,
            "m3",
            "ses_recent",
            "user",
            now - 30_000,
            3,
            user_json(true),
        );
        insert_v2_message(
            &conn,
            "m4",
            "ses_old",
            "assistant",
            now - 40 * DAY_MS,
            1,
            assistant_json(true, "p2", "m2", 1.0, 999, 111, 0, 0, 0),
        );
        insert_v2_message(
            &conn,
            "m5",
            "ses_nousage",
            "user",
            now - 100_000,
            1,
            user_json(true),
        );
        conn
    }

    /// Same assertions for both layouts: schema detection must make the v2
    /// tables behave exactly like the v1 ones.
    fn assert_contract(conn: &Connection, now: i64) {
        let (sessions, messages) = db_info_counts(conn).unwrap();
        assert_eq!((sessions, messages), (3, 5));

        let wm = watermark_from_conn(conn).unwrap();
        assert_eq!(wm.max_message_ms, now - 30_000);
        assert_eq!(wm.max_session_ms, now - 60_000);
        assert_eq!(wm.sessions, 3);

        let d30 = dashboard_from_conn(conn, 30).unwrap();
        assert_eq!(d30.overview.messages, 2);
        assert_eq!(d30.overview.sessions, 1);
        assert_eq!(d30.overview.input, 150);
        assert_eq!(d30.overview.output, 75);
        assert_eq!(d30.overview.reasoning, 15);
        assert_eq!(d30.overview.cache_read, 8);
        assert_eq!(d30.overview.cache_write, 2);
        assert!((d30.overview.cost - 0.5).abs() < 1e-9);
        assert_eq!(d30.models.len(), 1);
        assert_eq!(
            (
                d30.models[0].provider.as_str(),
                d30.models[0].model.as_str()
            ),
            ("p1", "m1")
        );
        assert_eq!(d30.models[0].input, 150);
        let mut day_input = 0;
        for row in &d30.daily {
            assert_eq!((row.provider.as_str(), row.model.as_str()), ("p1", "m1"));
            day_input += row.input;
        }
        assert_eq!(day_input, 150);

        let sl = session_list_from_conn(conn, 30, 100).unwrap();
        assert_eq!(sl.len(), 1);
        assert_eq!(sl[0].id, "ses_recent");
        assert_eq!(sl[0].input, 150);
        assert_eq!(sl[0].output, 75);

        let sel = selection_stats_from_conn(conn, 30).unwrap().session_stats;
        assert_eq!(sel.len(), 1);
        assert_eq!(sel[0].session_id, "ses_recent");
        assert_eq!((sel[0].provider.as_str(), sel[0].messages), ("p1", 2));
        assert_eq!(sel[0].input, 150);

        // All-time reaches the old session too; the usage-less one stays hidden.
        let all = dashboard_from_conn(conn, 0).unwrap();
        assert_eq!(all.overview.messages, 3);
        assert_eq!(all.overview.sessions, 2);
        assert_eq!(all.overview.input, 1149);
        assert!((all.overview.cost - 1.5).abs() < 1e-9);
        assert_eq!(all.models.len(), 2);

        let sl_all = session_list_from_conn(conn, 0, 100).unwrap();
        let ids: Vec<&str> = sl_all.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["ses_recent", "ses_old"]);
    }

    #[test]
    fn v1_schema_contract() {
        let now = now_ms();
        assert_contract(&v1_fixture(now), now);
    }

    #[test]
    fn v2_schema_contract() {
        let now = now_ms();
        assert_contract(&v2_fixture(now), now);
    }

    #[test]
    fn detect_schema_rejects_unknown_layout() {
        let conn = Connection::open_in_memory().unwrap();
        assert!(detect_schema(&conn).is_err());
    }

    #[test]
    fn perf_pragmas_applied() {
        let conn = Connection::open_in_memory().unwrap();
        apply_perf_pragmas(&conn);
        let temp_store: i64 = conn
            .query_row("PRAGMA temp_store", [], |r| r.get(0))
            .unwrap();
        assert_eq!(temp_store, 2, "temp_store must be MEMORY");
        let cache_size: i64 = conn
            .query_row("PRAGMA cache_size", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            cache_size, -65536,
            "cache_size must be the fixed 64 MiB budget"
        );
    }

    // ---- session_list two-phase parity -------------------------------------
    // The optimized session_list (candidate pre-selection, then JSON
    // aggregation only for the candidates) must return identical rows to the
    // single-pass query the app used before the optimization.

    type RefRow = (String, f64, i64, i64, i64, i64, String, i64);

    /// Single-pass query kept verbatim as the parity reference (the
    /// pre-optimization implementation, v2 flavor).
    fn reference_session_list_v2(conn: &Connection, days: u32, limit: u32) -> Vec<RefRow> {
        let cutoff = cutoff_ms(days);
        let mut stmt = conn
            .prepare(
                "SELECT s.id, COALESCE(SUM(COALESCE(json_extract(m.data,'$.cost'),0.0)),0.0),
                    COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.input'),0)),0),
                    COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.output'),0)),0),
                    COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.reasoning'),0)),0),
                    COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.cache.read'),0)),0),
                    date(datetime(s.time_updated/1000,'unixepoch','localtime')), s.time_updated
                 FROM session_v2 s LEFT JOIN session_message m ON m.session_id = s.id
                    AND m.time_created >= ?1 AND m.type='assistant'
                 WHERE s.time_updated >= ?1
                 GROUP BY s.id HAVING COUNT(m.session_id) > 0
                 ORDER BY s.time_updated DESC LIMIT ?2",
            )
            .unwrap();
        stmt.query_map((cutoff, limit as i64), |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                num_i64(r, 2)?,
                num_i64(r, 3)?,
                num_i64(r, 4)?,
                num_i64(r, 5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect()
    }

    fn as_ref_rows(rows: &[SessionRow]) -> Vec<RefRow> {
        rows.iter()
            .map(|s| {
                (
                    s.id.clone(),
                    s.cost,
                    s.input,
                    s.output,
                    s.reasoning,
                    s.cache_read,
                    s.day.clone(),
                    s.updated_ms,
                )
            })
            .collect()
    }

    /// 12 sessions, newest first (time_updated = now - i*1000), cycling three
    /// shapes: recent assistant usage, user-only (must be skipped without
    /// consuming a LIMIT slot), assistant usage only outside the 30d window.
    fn v2_many_sessions_fixture(now: i64) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_updated INTEGER NOT NULL);
             CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
                 seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
        )
        .unwrap();
        for i in 0..12i64 {
            let sid = format!("ses_{i:02}");
            let updated = now - i * 1000;
            conn.execute(
                "INSERT INTO session_v2 VALUES (?1,?2,'D:/p',?3)",
                (sid.as_str(), format!("S{i}"), updated),
            )
            .unwrap();
            match i % 3 {
                // Recent assistant usage (inside every window).
                0 => {
                    insert_v2_message(
                        &conn,
                        &format!("m{i}a"),
                        &sid,
                        "assistant",
                        updated - 500,
                        1,
                        assistant_json(true, "p1", "m1", 0.5, 10, 5, 1, 2, 0),
                    );
                    insert_v2_message(
                        &conn,
                        &format!("m{i}u"),
                        &sid,
                        "user",
                        updated - 400,
                        2,
                        user_json(true),
                    );
                }
                // Only old assistant usage: dropped by 30d, kept all-time.
                1 => {
                    insert_v2_message(
                        &conn,
                        &format!("m{i}a"),
                        &sid,
                        "assistant",
                        now - 40 * DAY_MS,
                        1,
                        assistant_json(true, "p2", "m2", 1.0, 100, 50, 0, 0, 0),
                    );
                    insert_v2_message(
                        &conn,
                        &format!("m{i}u"),
                        &sid,
                        "user",
                        updated - 100,
                        2,
                        user_json(true),
                    );
                }
                // No assistant usage at all: always hidden.
                _ => {
                    insert_v2_message(
                        &conn,
                        &format!("m{i}u"),
                        &sid,
                        "user",
                        updated - 100,
                        1,
                        user_json(true),
                    );
                }
            }
        }
        conn
    }

    #[test]
    fn session_list_two_phase_matches_reference() {
        let now = now_ms();
        let conn = v2_many_sessions_fixture(now);

        let ids30: Vec<String> = session_list_from_conn(&conn, 30, 100)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids30, vec!["ses_00", "ses_03", "ses_06", "ses_09"]);

        let ids_all: Vec<String> = session_list_from_conn(&conn, 0, 100)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(
            ids_all,
            vec!["ses_00", "ses_01", "ses_03", "ses_04", "ses_06", "ses_07", "ses_09", "ses_10"]
        );

        for days in [0u32, 30] {
            for limit in [4u32, 6, 100] {
                let got = as_ref_rows(&session_list_from_conn(&conn, days, limit).unwrap());
                let want = reference_session_list_v2(&conn, days, limit);
                assert_eq!(got, want, "parity days={days} limit={limit}");
            }
        }
    }
}
