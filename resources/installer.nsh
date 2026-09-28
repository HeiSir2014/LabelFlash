; 卸载时删除开机自启项（值名与 app.setLoginItemSettings 的 name 一致：appId）。
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.cdl.labelflash"
!macroend
