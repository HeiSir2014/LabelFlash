; 卸载时删除开机自启项（值名与 app.setLoginItemSettings 的 name 一致：appId）。
; 覆盖安装和自动更新也会先运行旧版的卸载程序（带 --updated），那时不能删：
; 更新装完如果没有立刻启动程序，下次开机就不会自动启动了。程序每次启动都会按设置重新登记。
; 同样只在真正卸载时删掉安装时加的防火墙规则：只删这个安装目录下的程序的规则（每个 Windows 用户各装一份，
; 规则同名，不能按名称删掉别人的）。先不提权查一下有没有：安装时点了「否」、没加过规则的，卸载时不弹管理员确认。
; 这个宏在删除安装目录之前运行，程序路径还在。
!include "${BUILD_RESOURCES_DIR}\installer\firewall.nsh"

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.cdl.labelflash"
    Push $0
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    InitPluginsDir
    File "/oname=$PLUGINSDIR\firewall.ps1" "${PROJECT_DIR}\dist\.installer\firewall.ps1"
    !insertmacro labelflashFirewallCommand "-Check"
    nsExec::Exec `"$R0" $R1`
    Pop $0
    ${if} $0 == 0
      !insertmacro labelflashFirewallCommand "-Remove"
      ExecShellWait "runas" "$R0" "$R1" SW_HIDE
    ${endIf}
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    Pop $0
  ${endIf}
!macroend
