; 卸载时删除开机自启项（值名与 app.setLoginItemSettings 的 name 一致：appId）。
; 覆盖安装和自动更新也会先运行旧版的卸载程序（带 --updated），那时不能删：
; 更新装完如果没有立刻启动程序，下次开机就不会自动启动了。程序每次启动都会按设置重新登记。
; 同样只在真正卸载时删掉安装时加的防火墙规则（规则名和 src/shared/firewall-rule.ts 的 FIREWALL_RULE_NAME 一致，
; 有测试核对）。先不提权查一下有没有：安装时点了「否」、没加过规则的，卸载时不弹管理员确认。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.cdl.labelflash"
    Push $0
    nsExec::Exec `powershell.exe -NoProfile -NonInteractive -Command "if (Get-NetFirewallRule -DisplayName 'CDL-LabelFlash local API' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
    Pop $0
    ${if} $0 == 0
      ExecShellWait "runas" "powershell.exe" `-NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-NetFirewallRule -DisplayName 'CDL-LabelFlash local API' | Remove-NetFirewallRule"` SW_HIDE
    ${endIf}
    Pop $0
  ${endIf}
!macroend
