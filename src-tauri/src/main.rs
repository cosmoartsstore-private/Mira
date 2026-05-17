//! Mira アプリのエントリポイント。リリースビルドでは `windows_subsystem = "windows"` を
//! 指定してコンソールウィンドウを抑制し、`mira_lib::run` に処理を委譲する。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

fn main() {
    // L4 R4-Err-1 / L5 Robust-7: パニックを stderr + ファイル両方に吐く最後の防衛線。
    //   既定の panic handler は `windows_subsystem = "windows"` 配下では
    //   ターミナルが無いため何処にも出ない (= サイレントクラッシュ) ことがある。
    //   eprintln! は親プロセスに stderr 接続があれば拾われ、
    //   さらに LOCALAPPDATA\CosmoArtsStore\Mira\Data\logs\panic.log に追記書込し、
    //   サポート問合せ時に添付できるようにする。
    //
    //   panic hook 内での二次パニックを避けるため:
    //     - ファイルパス解決失敗 → 静かに無視 (eprintln のみ)
    //     - ディレクトリ作成失敗 → 静かに無視
    //     - OpenOptions / write 失敗 → 静かに無視
    //   いずれも `let _ =` で結果を捨て、unwrap/expect は一切使わない。
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[panic] {info}");
        write_panic_log(info);
    }));

    mira_lib::run();
}

/// LOCALAPPDATA\CosmoArtsStore\Mira\Data\logs\panic.log に panic 情報を追記する。
///
/// L5 Robust-7: panic hook 内で呼ばれるため、いかなる失敗でも二次 panic を起こしてはいけない。
///   失敗は黙って (eprintln のみで) 飲み込み、起動継続を最優先する。
fn write_panic_log(info: &std::panic::PanicHookInfo<'_>) {
    let Ok(local_app_data) = std::env::var("LOCALAPPDATA") else {
        return;
    };
    let log_dir = PathBuf::from(local_app_data)
        .join("CosmoArtsStore")
        .join("Mira")
        .join("Data")
        .join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let log_path = log_dir.join("panic.log");
    let Ok(mut f) = OpenOptions::new().append(true).create(true).open(&log_path) else {
        return;
    };
    // chrono は lib 側で使うが main は依存が薄いので std::time の SystemTime で簡素に。
    // 日時表記の正確さよりも「いつ書込まれたか順序が取れる」ことが重要。
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(f, "[{ts}] {info}");
}
