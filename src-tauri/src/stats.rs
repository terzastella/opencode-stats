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

fn open_ro(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
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

fn cutoff_ms(days: u32) -> i64 {
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
    let mut stmt = conn
        .prepare(
            "SELECT id, COALESCE(title,''), COALESCE(directory,''),
                COALESCE(cost,0.0), COALESCE(tokens_input,0), COALESCE(tokens_output,0),
                COALESCE(tokens_cache_read,0),
                date(datetime(time_updated/1000,'unixepoch','localtime')) AS day,
                time_updated
             FROM session
             WHERE time_updated >= ?1
             ORDER BY time_updated DESC
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
                input: r.get(4)?,
                output: r.get(5)?,
                cache_read: r.get(6)?,
                day: r.get(7)?,
                updated_ms: r.get(8)?,
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
                input: r.get(4)?,
                output: r.get(5)?,
                cache_read: r.get(6)?,
                cache_write: r.get(7)?,
                cost: r.get(8)?,
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
        overview.cache_read = overview.cache_read.saturating_add(d.cache_read);
        overview.cache_write = overview.cache_write.saturating_add(d.cache_write);
        overview.cost += d.cost;
        by_model
            .entry((d.provider.clone(), d.model.clone()))
            .and_modify(|m| {
                m.messages = m.messages.saturating_add(d.messages);
                m.input = m.input.saturating_add(d.input);
                m.output = m.output.saturating_add(d.output);
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelSessions {
    pub provider: String,
    pub model: String,
    pub sessions: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionProvider {
    pub session_id: String,
    pub provider: String,
}

/// Selection honesty data, fetched ONLY when a provider filter is active:
/// distinct sessions per (provider, model), plus the dominant provider
/// (by input tokens) of every session in range.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectionStats {
    pub model_sessions: Vec<ModelSessions>,
    pub session_providers: Vec<SessionProvider>,
}

pub fn selection_stats_inner(days: u32) -> Result<SelectionStats, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    let cutoff = cutoff_ms(days);
    let sql_models = format!(
        "SELECT {provider} AS provider, {model} AS model,
            COUNT(DISTINCT session_id) AS sessions
         FROM message
         WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'
         GROUP BY provider, model",
        provider = PROVIDER_SQL,
        model = MODEL_SQL
    );
    let mut stmt = conn
        .prepare(&sql_models)
        .map_err(|e| format!("selection models prepare failed: {e}"))?;
    let model_sessions: Vec<ModelSessions> = stmt
        .query_map([cutoff], |r| {
            Ok(ModelSessions {
                provider: r.get(0)?,
                model: r.get(1)?,
                sessions: r.get(2)?,
            })
        })
        .map_err(|e| format!("selection models query failed: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("row decode failed: {e}"))?;

    let sql_sessions = format!(
        "SELECT session_id, {provider} AS provider,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.input'),0)),0) AS input
         FROM message
         WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'
         GROUP BY session_id, provider",
        provider = PROVIDER_SQL
    );
    let mut stmt2 = conn
        .prepare(&sql_sessions)
        .map_err(|e| format!("selection sessions prepare failed: {e}"))?;
    let mut best: HashMap<String, (String, i64)> = HashMap::new();
    let rows = stmt2
        .query_map([cutoff], |r| {
            let session_id: String = r.get(0)?;
            let provider: String = r.get(1)?;
            let input: i64 = r.get(2)?;
            Ok((session_id, provider, input))
        })
        .map_err(|e| format!("selection sessions query failed: {e}"))?;
    for row in rows {
        let (session_id, provider, input) = row.map_err(|e| format!("row decode failed: {e}"))?;
        best.entry(session_id)
            .and_modify(|e| {
                if input > e.1 {
                    *e = (provider.clone(), input);
                }
            })
            .or_insert((provider, input));
    }
    let session_providers = best
        .into_iter()
        .map(|(session_id, (provider, _))| SessionProvider {
            session_id,
            provider,
        })
        .collect();
    Ok(SelectionStats {
        model_sessions,
        session_providers,
    })
}
