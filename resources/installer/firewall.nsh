; 安装和卸载时运行 firewall.ps1（由 scripts/installer/build-skin.ts 从 src/shared/firewall-rule.ts 生成，
; 和配置中心「本机接口」页的按钮是同一份脚本）。安装程序和卸载程序都引用这个文件。
;
; 用 -Command 读出脚本再当作代码块运行，不用 -File：组策略规定了执行策略时，-File 连 -ExecutionPolicy Bypass 也会被拦下。
; PowerShell 写绝对路径：以管理员身份运行时不从 PATH 里找，免得用上同名的别的程序。

!ifndef LABELFLASH_FIREWALL_NSH
!define LABELFLASH_FIREWALL_NSH

!include "LogicLib.nsh"

!define LABELFLASH_POWERSHELL "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"

; 把 $R0 写成 PowerShell 单引号字符串的内容：单引号写两个（Windows 用户名里可以有单引号，
; 安装目录和临时目录都在用户目录下）。用到 $R2–$R4。
!macro labelflashPsQuote
  StrCpy $R2 ""
  StrCpy $R3 0
  ${Do}
    StrCpy $R4 $R0 1 $R3
    ${If} $R4 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $R4 == "'"
      StrCpy $R2 "$R2''"
    ${Else}
      StrCpy $R2 "$R2$R4"
    ${EndIf}
    IntOp $R3 $R3 + 1
  ${Loop}
  StrCpy $R0 $R2
!macroend

; 设置 $R0 = PowerShell 程序、$R1 = 参数：对安装目录下的主程序运行 $PLUGINSDIR\firewall.ps1。
; SWITCHES：""（加规则）、"-Remove"（删规则）、"-Check"（只查有没有，有就退出码 0）。用到 $R0–$R5。
!macro labelflashFirewallCommand SWITCHES
  StrCpy $R0 "$PLUGINSDIR\firewall.ps1"
  !insertmacro labelflashPsQuote
  StrCpy $R5 $R0
  StrCpy $R0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !insertmacro labelflashPsQuote
  StrCpy $R1 "-NoProfile -NonInteractive -WindowStyle Hidden -Command $\"& ([scriptblock]::Create([IO.File]::ReadAllText('$R5'))) -Program '$R0' ${SWITCHES}$\""
  StrCpy $R0 "${LABELFLASH_POWERSHELL}"
!macroend

!endif
