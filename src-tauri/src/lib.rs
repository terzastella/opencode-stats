// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod stats;

use stats::{
    DashboardData, DayStat, DbInfo, ModelStat, Overview, SessionRow, daily_stats_inner,
    dashboard_inner, db_info_inner, model_stats_inner, overview_inner, session_list_inner,
};

#[tauri::command]
fn db_info() -> Result<DbInfo, String> {
    db_info_inner()
}

#[tauri::command]
fn overview(days: Option<u32>) -> Result<Overview, String> {
    overview_inner(days.unwrap_or(30).clamp(1, 365))
}

#[tauri::command]
fn daily_stats(days: Option<u32>) -> Result<Vec<DayStat>, String> {
    daily_stats_inner(days.unwrap_or(30).clamp(1, 365))
}

#[tauri::command]
fn model_stats(days: Option<u32>) -> Result<Vec<ModelStat>, String> {
    model_stats_inner(days.unwrap_or(30).clamp(1, 365))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            db_info,
            overview,
            daily_stats,
            model_stats,
            session_list,
            dashboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
