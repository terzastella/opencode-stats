use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 86_400_000;

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

const PROVIDER_SQL: &str =
    "COALESCE(json_extract(data,'$.providerID'), json_extract(data,'$.model.providerID'), 'unknown')";
const MODEL_SQL: &str =
    "COALESCE(json_extract(data,'$.modelID'), json_extract(data,'$.model.modelID'), 'unknown')";

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
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0))
        .unwrap_or(0);
    let messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM message", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        exists,
        size_bytes,
        sessions,
        messages,
    })
}

pub fn overview_inner(days: u32) -> Result<Overview, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    let cutoff = now_ms() - (days as i64) * DAY_MS;
    let sql = format!(
        "SELECT COUNT(*), COUNT(DISTINCT session_id),
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.input'),0)),0),
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.output'),0)),0),
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.cache.read'),0)),0),
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.cache.write'),0)),0),
            COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0.0)),0.0)
         FROM message
         WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'"
    );
    let _ = PROVIDER_SQL;
    conn.query_row(&sql, [cutoff], |r| {
        Ok(Overview {
            messages: r.get(0)?,
            sessions: r.get(1)?,
            input: r.get(2)?,
            output: r.get(3)?,
            cache_read: r.get(4)?,
            cache_write: r.get(5)?,
            cost: r.get(6)?,
        })
    })
    .map_err(|e| format!("overview query failed: {e}"))
}

pub fn daily_stats_inner(days: u32) -> Result<Vec<DayStat>, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    let cutoff = now_ms() - (days as i64) * DAY_MS;
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
        .map_err(|e| format!("daily prepare failed: {e}"))?;
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
        .map_err(|e| format!("daily query failed: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row decode failed: {e}"))?);
    }
    Ok(out)
}

pub fn model_stats_inner(days: u32) -> Result<Vec<ModelStat>, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    let cutoff = now_ms() - (days as i64) * DAY_MS;
    let sql = format!(
        "SELECT {provider} AS provider, {model} AS model,
            COUNT(*) AS messages,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.input'),0)),0) AS input,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.output'),0)),0) AS output,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.cache.read'),0)),0) AS cache_read,
            COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.cache.write'),0)),0) AS cache_write,
            COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0.0)),0.0) AS cost
         FROM message
         WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'
         GROUP BY provider, model
         ORDER BY input DESC",
        provider = PROVIDER_SQL,
        model = MODEL_SQL
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("models prepare failed: {e}"))?;
    let rows = stmt
        .query_map([cutoff], |r| {
            Ok(ModelStat {
                provider: r.get(0)?,
                model: r.get(1)?,
                messages: r.get(2)?,
                input: r.get(3)?,
                output: r.get(4)?,
                cache_read: r.get(5)?,
                cache_write: r.get(6)?,
                cost: r.get(7)?,
            })
        })
        .map_err(|e| format!("models query failed: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row decode failed: {e}"))?);
    }
    Ok(out)
}

pub fn session_list_inner(days: u32, limit: u32) -> Result<Vec<SessionRow>, String> {
    let path = opencode_db_path();
    let conn = open_ro(&path)?;
    let cutoff = now_ms() - (days as i64) * DAY_MS;
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
        out.push(row.map_err(|e| format!("row decode failed: {e}"))?);
    }
    Ok(out)
}

/// Combined dashboard payload: ONE grouped message scan feeds daily rows,
/// per-model aggregates and overview sums (plus one cheap count query).
/// Replaces 3 separate full scans (overview + daily + models).
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
    let cutoff = now_ms() - (days as i64) * DAY_MS;
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
        let d = row.map_err(|e| format!("row decode failed: {e}"))?;
        overview.messages += d.messages;
        overview.input += d.input;
        overview.output += d.output;
        overview.cache_read += d.cache_read;
        overview.cache_write += d.cache_write;
        overview.cost += d.cost;
        by_model
            .entry((d.provider.clone(), d.model.clone()))
            .and_modify(|m| {
                m.messages += d.messages;
                m.input += d.input;
                m.output += d.output;
                m.cache_read += d.cache_read;
                m.cache_write += d.cache_write;
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
        .unwrap_or((overview.messages, 0));
    overview.messages = messages;
    overview.sessions = sessions;

    let mut models: Vec<ModelStat> = by_model.into_values().collect();
    models.sort_by(|a, b| b.input.cmp(&a.input));
    // Guard: non-finite floats are not valid JSON (would fail serialization).
    if !overview.cost.is_finite() {
        overview.cost = 0.0;
    }
    for m in &mut models {
        if !m.cost.is_finite() {
            m.cost = 0.0;
        }
    }
    Ok(DashboardData {
        overview,
        daily,
        models,
    })
}
