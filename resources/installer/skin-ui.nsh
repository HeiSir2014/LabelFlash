; 自绘安装界面（nsNiuniuSkin）：圆形窗口，配置页 → 安装中 → 完成后自动启动程序并关闭。
;
; 引用前需要：
;   - !include 生成的 skins.nsh（文案、动画参数、extractSkinForDpi、skinTipText）
;   - !define SKIN_ICON（窗口图标）和 APP_FILENAME（安装目录名）
;   - 提供两个函数：
;       skinStartInstall  启动安装（通常调用 skinSpawn）；$0 返回 "" 表示已启动，否则是给用户看的错误
;       skinRunApp        启动安装好的程序
; 调用 skinShow 前设置 $skinIsUpdate（1 = 自动更新拉起的安装：跳过配置页）。

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

!define SKIN_TIMER_ID 1
!define SKIN_TICK_MS 60
; 约 3 秒换一条提示。
!define SKIN_TIP_TICKS 50
; 安装结束后进度每帧补 5%；满格停半秒再变成「完成」，完成画面停一秒多再启动程序。
!define SKIN_FINISH_STEP 5
!define SKIN_FULL_HOLD_TICKS 8
!define SKIN_DONE_HOLD_TICKS 20
!define SKIN_PAGE_CONFIG 0
!define SKIN_PAGE_INSTALLING 1
!define SKIN_COLOR_MESSAGE 0xFF55605B
!define SKIN_COLOR_ERROR 0xFFC8372D
!define SKIN_COLOR_SUCCESS 0xFF1F8A5B
!define SKIN_LOGPIXELSX 88

Var skinWindow
; 0 = 未开始，1 = 安装中，2 = 已装完、即将启动
Var skinState
Var skinProgress
Var skinTicks
Var skinHoldTicks
Var skinInstalled
Var skinIsUpdate

!define /ifndef SEE_MASK_NOCLOSEPROCESS 0x00000040
!define /ifndef WAIT_OBJECT_0 0
!define /ifndef WAIT_TIMEOUT 258

Var skinProcess

; 启动安装进程（$R0 = 程序，$R1 = 参数），保留进程句柄以便按退出码判断结果：
; 子进程中途出错退出也不会漏判。$0 返回 "" 表示已启动，否则是给用户看的错误。
Function skinSpawn
  System::Call '*(&l4, i ${SEE_MASK_NOCLOSEPROCESS}, p $HWNDPARENT, w "open", w "$R0", w "$R1", p 0, i ${SW_HIDE}, p, p, p, p, i, p, p) p .r2'
  System::Call 'shell32::ShellExecuteExW(p r2) i .r3'
  ${If} $3 == 0
    System::Free $2
    StrCpy $0 "${SKIN_TEXT_startFailed}"
    Return
  ${EndIf}
  System::Call '*$2(i, i, p, p, p, p, p, i, p, p, p, p, i, p, p .r4)'
  System::Free $2
  StrCpy $skinProcess $4
  StrCpy $0 ""
FunctionEnd

; $0 返回 "running"，或安装进程的退出码；等待失败时返回 -1。
Function skinPollInstall
  System::Call 'kernel32::WaitForSingleObject(p $skinProcess, i 0) i .r0'
  ${If} $0 = ${WAIT_TIMEOUT}
    StrCpy $0 "running"
    Return
  ${EndIf}
  ${If} $0 = ${WAIT_OBJECT_0}
    System::Call 'kernel32::GetExitCodeProcess(p $skinProcess, *i .r0)'
  ${Else}
    StrCpy $0 -1
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p $skinProcess)'
FunctionEnd

; 系统 DPI（安装程序声明了 DPI 感知，读到的是真实值）。返回在 $0。
Function skinSystemDpi
  System::Call 'user32::GetDC(p 0) p .r1'
  System::Call 'gdi32::GetDeviceCaps(p r1, i ${SKIN_LOGPIXELSX}) i .r0'
  System::Call 'user32::ReleaseDC(p 0, p r1)'
FunctionEnd

Function skinShow
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  Call skinSystemDpi
  !insertmacro extractSkinForDpi $0
  ; 插件固定从 logo.ico 读取窗口图标。
  File /oname=logo.ico "${SKIN_ICON}"
  nsNiuniuSkin::InitSkinPage "$PLUGINSDIR\" ""
  Pop $skinWindow
  ${If} $skinWindow == ""
  ${OrIf} $skinWindow == "error"
    MessageBox MB_ICONSTOP "安装界面加载失败，请重新下载安装包。"
    Quit
  ${EndIf}

  StrCpy $skinState 0
  nsNiuniuSkin::SetControlAttribute $skinWindow "editDir" "text" "$INSTDIR"
  GetFunctionAddress $0 skinOnInstall
  nsNiuniuSkin::BindCallBack $skinWindow "btnInstall" $0
  GetFunctionAddress $0 skinOnBrowse
  nsNiuniuSkin::BindCallBack $skinWindow "btnSelectDir" $0
  GetFunctionAddress $0 skinOnClose
  nsNiuniuSkin::BindCallBack $skinWindow "btnClose" $0
  nsNiuniuSkin::BindCallBack $skinWindow "syscommandclose" $0

  ${If} $skinIsUpdate == 1
    nsNiuniuSkin::SetWindowTile $skinWindow "${SKIN_TEXT_updateWindowTitle}"
    Call skinBeginInstall
  ${Else}
    nsNiuniuSkin::SetWindowTile $skinWindow "${SKIN_TEXT_windowTitle}"
    nsNiuniuSkin::ShowPageItem $skinWindow "wizardTab" ${SKIN_PAGE_CONFIG}
  ${EndIf}
  nsNiuniuSkin::ShowPage 0
FunctionEnd

; 安装目录：必须是完整的本地路径；最后一级不是程序目录名时补上。
; 卸载会删除整个安装目录，所以不能直接装进用户选的现有文件夹（例如 D:\ 或桌面）。
; 输入和输出都在栈顶，无效时输出 ""。
Function skinNormalizeInstallDir
  Exch $0
  Push $1
  Push $2
  ; 去掉末尾的反斜杠
  StrCpy $1 $0 1 -1
  ${If} $1 == "\"
    StrCpy $0 $0 -1
  ${EndIf}
  StrCpy $1 $0 1 1
  StrCpy $2 $0 1 2
  ${If} $1 != ":"
  ${OrIf} $2 != "\"
    StrCpy $0 ""
  ${Else}
    ${GetFileName} $0 $1
    ; StrCmp 不区分大小写，和 Windows 路径一致。
    ${If} $1 != "${APP_FILENAME}"
      StrCpy $0 "$0\${APP_FILENAME}"
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; 配置页的提示行：$0 = 文字，$1 = 颜色。
Function skinShowMessage
  nsNiuniuSkin::SetControlAttribute $skinWindow "message" "text" "$0"
  nsNiuniuSkin::SetControlAttribute $skinWindow "message" "textcolor" "$1"
FunctionEnd

Function skinOnInstall
  nsNiuniuSkin::GetControlAttribute $skinWindow "editDir" "text"
  Call skinNormalizeInstallDir
  Pop $0
  ${If} $0 == ""
    StrCpy $0 "${SKIN_TEXT_invalidPath}"
    StrCpy $1 ${SKIN_COLOR_ERROR}
    Call skinShowMessage
    Return
  ${EndIf}
  StrCpy $INSTDIR $0
  nsNiuniuSkin::SetControlAttribute $skinWindow "editDir" "text" "$INSTDIR"
  Call skinBeginInstall
FunctionEnd

Function skinOnBrowse
  nsNiuniuSkin::SelectInstallDirEx $skinWindow "${SKIN_TEXT_chooseDirTitle}"
  Call skinNormalizeInstallDir
  Pop $0
  ${If} $0 != ""
    nsNiuniuSkin::SetControlAttribute $skinWindow "editDir" "text" "$0"
  ${EndIf}
FunctionEnd

Function skinBeginInstall
  StrCpy $skinState 1
  StrCpy $skinProgress 0
  StrCpy $skinTicks 0
  StrCpy $skinHoldTicks 0
  StrCpy $skinInstalled 0
  nsNiuniuSkin::SetControlAttribute $skinWindow "btnClose" "enabled" "false"
  ${If} $skinIsUpdate == 1
    nsNiuniuSkin::SetControlAttribute $skinWindow "percentCaption" "text" "${SKIN_TEXT_updating}"
  ${Else}
    nsNiuniuSkin::SetControlAttribute $skinWindow "percentCaption" "text" "${SKIN_TEXT_installing}"
  ${EndIf}
  nsNiuniuSkin::SetControlAttribute $skinWindow "tip" "text" "${SKIN_TEXT_tips_0}"
  nsNiuniuSkin::SetControlAttribute $skinWindow "orbit" "visible" "true"
  Call skinShowProgress
  nsNiuniuSkin::ShowPageItem $skinWindow "wizardTab" ${SKIN_PAGE_INSTALLING}

  Call skinStartInstall
  ${If} $0 != ""
    Call skinFail
    Return
  ${EndIf}
  GetFunctionAddress $0 skinOnTick
  nsNiuniuSkin::SetTimerCallBack $skinWindow ${SKIN_TIMER_ID} ${SKIN_TICK_MS} $0
FunctionEnd

; 安装进程不报告进度，这里按时间估一个：前段快、后段慢，停在 95% 等安装真正结束。
; 实测一次安装十几秒，大约走到 70%–85% 时结束，然后快速补满。
Function skinAdvanceProgress
  ${If} $skinProgress < 60
    IntOp $1 $skinTicks % 2
  ${ElseIf} $skinProgress < 85
    IntOp $1 $skinTicks % 5
  ${ElseIf} $skinProgress < 95
    IntOp $1 $skinTicks % 15
  ${Else}
    StrCpy $1 1
  ${EndIf}
  ${If} $1 == 0
    IntOp $skinProgress $skinProgress + 1
  ${EndIf}
FunctionEnd

Function skinShowProgress
  IntOp $1 $skinProgress % ${SKIN_RING_STEP}
  IntOp $1 $skinProgress - $1
  IntFmt $1 "%03d" $1
  nsNiuniuSkin::SetControlAttribute $skinWindow "ring" "bkimage" "images\ring\p$1.png"
  nsNiuniuSkin::SetControlAttribute $skinWindow "percent" "text" "$skinProgress%"
FunctionEnd

Function skinOnTick
  IntOp $skinTicks $skinTicks + 1
  ${If} $skinState == 2
    IntOp $skinHoldTicks $skinHoldTicks + 1
    ${If} $skinHoldTicks >= ${SKIN_DONE_HOLD_TICKS}
      nsNiuniuSkin::KillTimerCallBack $skinWindow ${SKIN_TIMER_ID}
      Call skinRunApp
      nsNiuniuSkin::ExitDUISetup
    ${EndIf}
    Return
  ${EndIf}

  IntOp $1 $skinTicks % ${SKIN_ORBIT_FRAMES}
  IntFmt $1 "%02d" $1
  nsNiuniuSkin::SetControlAttribute $skinWindow "orbit" "bkimage" "images\orbit\o$1.png"

  IntOp $1 $skinTicks % ${SKIN_TIP_TICKS}
  ${If} $1 == 0
    IntOp $1 $skinTicks / ${SKIN_TIP_TICKS}
    IntOp $1 $1 % ${SKIN_TIP_COUNT}
    !insertmacro skinTipText $1 $0
    nsNiuniuSkin::SetControlAttribute $skinWindow "tip" "text" "$0"
  ${EndIf}

  ${If} $skinInstalled == 0
    Call skinPollInstall
    ${If} $0 == "running"
      Call skinAdvanceProgress
    ${ElseIf} $0 == 0
      StrCpy $skinInstalled 1
    ${Else}
      StrCpy $0 "${SKIN_TEXT_installFailed} $0"
      Call skinFail
      Return
    ${EndIf}
  ${EndIf}

  ${If} $skinInstalled == 1
    ${If} $skinProgress < 100
      IntOp $skinProgress $skinProgress + ${SKIN_FINISH_STEP}
      ${If} $skinProgress > 100
        StrCpy $skinProgress 100
      ${EndIf}
    ${Else}
      IntOp $skinHoldTicks $skinHoldTicks + 1
      ${If} $skinHoldTicks >= ${SKIN_FULL_HOLD_TICKS}
        Call skinShowDone
        Return
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Call skinShowProgress
FunctionEnd

; 装完：整圈变绿打勾，稍停后由 skinOnTick 启动程序并关闭窗口，不需要用户再点。
Function skinShowDone
  StrCpy $skinState 2
  StrCpy $skinHoldTicks 0
  nsNiuniuSkin::SetControlAttribute $skinWindow "orbit" "visible" "false"
  nsNiuniuSkin::SetControlAttribute $skinWindow "ring" "bkimage" "images\ring\done.png"
  ; 勾画在百分比的位置，文字放到它下面的提示行。
  nsNiuniuSkin::SetControlAttribute $skinWindow "percent" "text" ""
  nsNiuniuSkin::SetControlAttribute $skinWindow "percentCaption" "text" ""
  ${If} $skinIsUpdate == 1
    nsNiuniuSkin::SetControlAttribute $skinWindow "tip" "text" "${SKIN_TEXT_updatedLaunching}"
  ${Else}
    nsNiuniuSkin::SetControlAttribute $skinWindow "tip" "text" "${SKIN_TEXT_installedLaunching}"
  ${EndIf}
  nsNiuniuSkin::SetControlAttribute $skinWindow "tip" "textcolor" "${SKIN_COLOR_SUCCESS}"
FunctionEnd

; 出错回到配置页，可以改目录后重试。错误文字在 $0。
Function skinFail
  nsNiuniuSkin::KillTimerCallBack $skinWindow ${SKIN_TIMER_ID}
  StrCpy $skinState 0
  nsNiuniuSkin::SetControlAttribute $skinWindow "btnClose" "enabled" "true"
  StrCpy $1 ${SKIN_COLOR_ERROR}
  Call skinShowMessage
  nsNiuniuSkin::ShowPageItem $skinWindow "wizardTab" ${SKIN_PAGE_CONFIG}
FunctionEnd

; 安装进行中不能关闭：中途关掉界面，后台的安装仍会继续，用户却看不到结果。
Function skinOnClose
  ${If} $skinState != 0
    Return
  ${EndIf}
  nsNiuniuSkin::ExitDUISetup
FunctionEnd
