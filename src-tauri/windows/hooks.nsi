; Mira NSIS インストーラ Hooks
;
; インストール / アンインストール直前に旧プロセスを終了させる。
; ナイーブに `taskkill /F` を撃つと、プロセスが存在しないとき NSIS ログに
; "ERROR: The process ... not found." が記録され、ユーザーが手動で同名 exe を
; 起動中に意図せず落とすリスクもある。
;
; 安全化方針:
;   1. まず `tasklist /FI "IMAGENAME eq xxx.exe" /NH` を nsExec::ExecToStack で実行。
;      stdout が "INFO:" で始まる場合は対象なし → kill を skip。
;      ($0=exit code は対象有無に関わらず 0 を返すため、stdout 内容で判定する)
;   2. それ以外 (= プロセスが見つかった) のときのみ taskkill /F /IM を実行。
;   3. taskkill 自体の失敗もログレベルに留め、インストール処理は継続させる。
;
; StrFunc.nsh の ${StrLoc} は installer.nsi の冒頭で宣言済み。
; アンインストール側では ${UnStrLoc} が必要だが、!macro 内宣言は不可なので
; ここではプレフィックス文字列の有無を ${StrLoc} 不要の単純な方法
; (stdout 先頭 5 文字を切り出して "INFO:" と一致するか) で判定する。

!macro KillIfRunning SUFFIX
    nsExec::ExecToStack 'cmd /C tasklist /NH /FI "IMAGENAME eq ${MAINBINARYNAME}.exe"'
    Pop $0
    Pop $1
    ; stdout 先頭 5 文字を抽出。対象なしのときは "INFO:" (No tasks ...) が来る。
    StrCpy $2 "$1" 5
    StrCmp $2 "INFO:" mira_kill_skip_${SUFFIX} 0
        nsExec::ExecToLog 'taskkill /F /IM "${MAINBINARYNAME}.exe"'
        Pop $0
    mira_kill_skip_${SUFFIX}:
!macroend

!macro NSIS_HOOK_PREINSTALL
    !insertmacro KillIfRunning "install"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
    !insertmacro KillIfRunning "uninstall"
!macroend
