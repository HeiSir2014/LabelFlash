; 卸载时删除开机自启项（值名与 app.setLoginItemSettings 的 name 一致：appId）。
; 覆盖安装和自动更新也会先运行旧版的卸载程序（带 --updated），那时不能删：
; 更新装完如果没有立刻启动程序，下次开机就不会自动启动了。程序每次启动都会按设置重新登记。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.cdl.labelflash"
  ${endIf}
!macroend
