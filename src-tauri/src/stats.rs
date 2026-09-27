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
const MAX_DB_BYTES: u64 = 2_147_483_648; // 2 GiB, far above any real opencode.db

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
        return Err(format!("database too large ({size} bytes, cap is {MAX_DB_BYTES})"));
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
    Ok(conn)
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

// CAST AS TEXT: a single non-string provider/model value must never fail
// the whole row decode (r.get::<String> errors on INTEGER).
const PROVIDER_SQL: &str =
    "COALESCE(CAST(json_extract(data,'$.providerID') AS TEXT), CAST(json_extract(data,'$.model.providerID') AS TEXT), 'unknown')";
const MODEL_SQL: &str =
    "COALESCE(CAST(json_extract(data,'$.modelID') AS TEXT), CAST(json_extract(data,'$.model.modelID') AS TEXT), 'unknown')";

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
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0))
        .map_err(|e| format!("sessions count failed: {e}"))?;
    let messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM message", [], |r| r.get(0))
        .map_err(|e| format!("messages count failed: {e}"))?;
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        exists,
        size_bytes,
        sessions,
        messages,
    })
}

pub fn session_list_inner(days: u32, limit: u32) -> Result<Vec<SessionRow>, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    let cutoff = cutoff_ms(days);
    let limit = limit.clamp(1, 500) as i64;
    // Per-period attribution: the session row shows only assistant-message
    // usage inside the window (time_created >= cutoff), not the lifetime
    // session aggregates — so the list stays coherent with KPIs and charts.
    // HAVING hides sessions with no in-window assistant usage ($0 rows).
    let mut stmt = conn
        .prepare(
            "SELECT s.id, COALESCE(s.title,''), COALESCE(s.directory,''),
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.cost'),0.0)),0.0) AS cost,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.input'),0)),0) AS input,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.output'),0)),0) AS output,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.reasoning'),0)),0) AS reasoning,
                COALESCE(SUM(COALESCE(json_extract(m.data,'$.tokens.cache.read'),0)),0) AS cache_read,
                date(datetime(s.time_updated/1000,'unixepoch','localtime')) AS day,
                s.time_updated
             FROM session s LEFT JOIN message m ON m.session_id = s.id
                AND m.time_created >= ?1 AND json_extract(m.data,'$.role') = 'assistant'
             WHERE s.time_updated >= ?1
             GROUP BY s.id
             HAVING COUNT(m.session_id) > 0
             ORDER BY s.time_updated DESC
             LIMIT ?2",
        )
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
    let cutoff = cutoff_ms(days);
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
         FROM message
         WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'
         GROUP BY day, provider, model
         ORDER BY day ASC",
        provider = PROVIDER_SQL,
        model = MODEL_SQL
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
            "SELECT COUNT(*), COUNT(DISTINCT session_id) FROM message
             WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'",
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
    let cutoff = cutoff_ms(days);
    let sql = format!(
        "SELECT session_id, {provider} AS provider,
            COUNT(*) AS messages,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.input'),0)),0) AS input,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.output'),0)),0) AS output,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.reasoning'),0)),0) AS reasoning,
            COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0.0)),0.0) AS cost
         FROM message
         WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'
         GROUP BY session_id, provider",
        provider = PROVIDER_SQL
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
    Ok(SelectionStats {
        session_stats,
    })
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
        let mut stmt = conn
            .prepare(&format!("SELECT {literal} AS v"))
            .unwrap();
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
}
