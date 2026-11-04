// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod stats;

use stats::{
    DashboardData, DbInfo, SelectionStats, SessionRow, Watermark, dashboard_inner, db_info_inner,
    selection_stats_inner, session_list_inner, watermark_inner,
};

// In Tauri v2, non-async commands run on the main thread, where a heavy SQL
// scan (a v2 dashboard scan parses ~1 GB of message JSON) blocks the window
// message loop — Windows reports the frozen window as "Application Hang".
// Every command therefore runs its synchronous stats code on the blocking
// thread pool, so scans never touch the UI thread.

#[tauri::command]
async fn db_info() -> Result<DbInfo, String> {
    tauri::async_runtime::spawn_blocking(db_info_inner)
        .await
        .map_err(|e| format!("db_info task failed: {e}"))?
}

/// Cheap freshness probe for the auto-refresh tick (no JSON extraction).
#[tauri::command]
async fn watermark() -> Result<Watermark, String> {
    tauri::async_runtime::spawn_blocking(watermark_inner)
        .await
        .map_err(|e| format!("watermark task failed: {e}"))?
}

#[tauri::command]
async fn session_list(days: Option<u32>, limit: Option<u32>) -> Result<Vec<SessionRow>, String> {
    let days = days.unwrap_or(30).clamp(0, 365);
    let limit = limit.unwrap_or(100);
    tauri::async_runtime::spawn_blocking(move || session_list_inner(days, limit))
        .await
        .map_err(|e| format!("session_list task failed: {e}"))?
}

/// Single-scan dashboard payload (overview + daily + models in one go).
/// days == 0 means all-time (no cutoff).
#[tauri::command]
async fn dashboard(days: Option<u32>) -> Result<DashboardData, String> {
    let days = days.unwrap_or(30).clamp(0, 365);
    tauri::async_runtime::spawn_blocking(move || dashboard_inner(days))
        .await
        .map_err(|e| format!("dashboard task failed: {e}"))?
}

/// Selection honesty data, called only when a provider filter is active.
#[tauri::command]
async fn selection_stats(days: Option<u32>) -> Result<SelectionStats, String> {
    let days = days.unwrap_or(30).clamp(0, 365);
    tauri::async_runtime::spawn_blocking(move || selection_stats_inner(days))
        .await
        .map_err(|e| format!("selection_stats task failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            db_info,
            session_list,
            dashboard,
            selection_stats,
            watermark
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
