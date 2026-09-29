; CDL-云签速印 安装程序（electron-builder 的自定义 NSIS 脚本）。
;
; 图形安装时，这个进程只显示自绘界面（skin-ui.nsh）；真正的安装由同一个安装程序以静默子进程
; （/skin-child /S）完成，界面按子进程的退出码显示结果。
; 静默安装（/S，例如自动更新在程序退出时安装）不显示任何界面，直接执行安装。
; 卸载程序由构建第一段用 electron-builder 自带的脚本生成（scripts/installer/build-installer.ts），
; 这里只把它打进安装包。

!ifdef BUILD_UNINSTALLER
  !error "卸载程序由构建第一段生成，这个脚本只构建安装程序。"
!endif

; electron-builder 不为自定义脚本生成卸载程序，这个常量指向第一段取得的那一份。
!ifdef UNINSTALLER_OUT_FILE
  !undef UNINSTALLER_OUT_FILE
!endif
!define UNINSTALLER_OUT_FILE "${PROJECT_DIR}\dist\.installer\uninstaller.exe"
!define LABELFLASH_SKIN_DIR "${PROJECT_DIR}\dist\.installer"
!define SKIN_ICON "${MUI_ICON}"

Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory

!include "common.nsh"
!include "MUI2.nsh"
!include "multiUser.nsh"
!include "allowOnlyOneInstallerInstance.nsh"

; 按系统 DPI 渲染（界面按 DPI 选用对应比例的皮肤），不让 Windows 拉伸成模糊的位图。
ManifestDPIAware true
RequestExecutionLevel user

Var appExe
Var launchLink
Var isSkinChild

!addplugindir /x86-unicode "${BUILD_RESOURCES_DIR}\installer\plugins\x86-unicode"
!include "${LABELFLASH_SKIN_DIR}\skins.nsh"
!include "${BUILD_RESOURCES_DIR}\installer\skin-ui.nsh"
!include "${BUILD_RESOURCES_DIR}\installer\firewall.nsh"

Page custom showInstaller
!insertmacro MUI_PAGE_INSTFILES
!insertmacro addLangs

!ifmacrodef customHeader
  !insertmacro customHeader
!endif

Function .onInit
  Call setInstallSectionSpaceRequired
  SetOutPath $INSTDIR
  ${LogSet} on
  !ifmacrodef preInit
    !insertmacro preInit
  !endif

  ${GetParameters} $R0
  StrCpy $isSkinChild 0
  ClearErrors
  ${GetOptions} $R0 "/skin-child" $R1
  ${IfNot} ${Errors}
    StrCpy $isSkinChild 1
  ${EndIf}
  ; 自动更新点「重启更新」时带 --updated 拉起安装界面：跳过配置页，装完同样自动启动程序。
  StrCpy $skinIsUpdate 0
  ${If} ${isUpdated}
    StrCpy $skinIsUpdate 1
  ${EndIf}

  !insertmacro check64BitAndSetRegView
  ; 子进程运行时界面进程还在：「只允许一个安装程序」的检查会把子进程拦下。
  ${If} $isSkinChild != 1
    !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  ${EndIf}
  ; 只按当前用户安装：不需要管理员权限，自动更新也不会弹 UAC。
  ; 这三个变量来自 electron-builder 的多用户支持（「为所有用户安装」），这里固定为当前用户。
  StrCpy $hasPerUserInstallation 1
  StrCpy $hasPerMachineInstallation 0
  StrCpy $perMachineInstallationFolder ""
  !insertmacro setInstallModePerUser

  !ifmacrodef customInit
    !insertmacro customInit
  !endif
FunctionEnd

!include "installUtil.nsh"

Section "install" INSTALL_SECTION_ID
  !include "installSection.nsh"
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd

Function showInstaller
  ${If} $isSkinChild == 1
    Abort
  ${EndIf}
  Call skinShow
  Quit
FunctionEnd

; 以下两个函数供 skin-ui.nsh 调用。

; 由同一个安装程序以静默子进程执行安装。子进程不带 --force-run：程序由界面在显示「完成」之后启动，
; 不会启动两次。
Function skinStartInstall
  StrCpy $R0 "$EXEPATH"
  StrCpy $R2 "open"
  StrCpy $R1 "/skin-child /S"
  ${If} $skinIsUpdate == 1
    StrCpy $R1 "$R1 --updated"
  ${EndIf}
  ; NSIS 规定 /D= 必须放在最后，而且不能加引号。
  StrCpy $R1 "$R1 /D=$INSTDIR"
  Call skinSpawn
FunctionEnd

Function skinRunApp
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
FunctionEnd

; 装完、启动程序之前：弹管理员确认，加一条只放行本程序的防火墙入站规则（所有网络类型都生效；
; 脚本和配置中心「本机接口」页的按钮是同一份，见 src/shared/firewall-rule.ts）。
; 先加规则再启动：程序一启动就按规则决定要不要对局域网开放，有规则就直接开放。
; 操作员点「否」时照常装完、启动，程序只接受本机请求，之后可以在「本机接口」页再加。
; 更新时不走这里：规则按程序路径，路径不变。
Function skinAddFirewallRule
  File "/oname=$PLUGINSDIR\firewall.ps1" "${LABELFLASH_SKIN_DIR}\firewall.ps1"
  !insertmacro labelflashFirewallCommand ""
  StrCpy $R2 "runas"
  Call skinSpawn
FunctionEnd
