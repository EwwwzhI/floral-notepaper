// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    floral_notepaper_lib::try_exit_for_cli_version_or_help();
    floral_notepaper_lib::run()
}
