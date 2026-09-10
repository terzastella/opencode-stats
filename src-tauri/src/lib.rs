// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod stats;

use stats::{
    DashboardData, DbInfo, SelectionStats, SessionRow, dashboard_inner, db_info_inner,
    selection_stats_inner, session_list_inner,
};

#[tauri::command]
fn db_info() -> Result<DbInfo, String> {
    db_info_inner()
}

#[tauri::command]
fn session_list(days: Option<u32>, limit: Option<u32>) -> Result<Vec<SessionRow>, String> {
    session_list_inner(days.unwrap_or(30).clamp(1, 365), limit.unwrap_or(100))
}

/// Single-scan dashboard payload (overview + daily + models in one go).
#[tauri::command]
fn dashboard(days: Option<u32>) -> Result<DashboardData, String> {
    dashboard_inner(days.unwrap_or(30).clamp(1, 365))
}

/// Selection honesty data, called only when a provider filter is active.
#[tauri::command]
fn selection_stats(days: Option<u32>) -> Result<SelectionStats, String> {
    selection_stats_inner(days.unwrap_or(30).clamp(1, 365))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            db_info,
            session_list,
            dashboard,
            selection_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
