!include "StrFunc.nsh"

Var SonicRoot

!macro SonicPathFunctions PREFIX
  Function ${PREFIX}SonicCheckTree
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    ClearErrors
    FindFirst $1 $2 "$SonicRoot$0\*"
    IfErrors unknown

    next:
      ${If} $2 != "."
      ${AndIf} $2 != ".."
        StrCpy $3 "$0\$2"
        System::Call 'kernel32::GetFileAttributesW(w "$SonicRoot$3") i .r4'
        IntOp $5 $4 & 0x400 ; FILE_ATTRIBUTE_REPARSE_POINT
        StrCmp $5 0 0 unknown
        IntOp $5 $4 & 0x10 ; FILE_ATTRIBUTE_DIRECTORY
        ${If} $5 != 0
          ${If} $3 != "\locales"
          ${AndIf} $3 != "\resources"
          ${AndIf} $3 != "\resources\app.asar.unpacked"
          ${AndIf} $3 != "\resources\app.asar.unpacked\desktop"
          ${AndIf} $3 != "\resources\app.asar.unpacked\desktop\native"
            Goto unknown
          ${EndIf}
          Push $3
          Call ${PREFIX}SonicCheckTree
          Pop $5
          StrCmp $5 1 0 unknown
        ${Else}
          StrCmp $3 "\${APP_EXECUTABLE_FILENAME}" advance
          StrCmp $3 "\${UNINSTALL_FILENAME}" advance
          StrCmp $3 "\uninstallerIcon.ico" advance
          StrCmp $3 "\chrome_100_percent.pak" advance
          StrCmp $3 "\chrome_200_percent.pak" advance
          StrCmp $3 "\d3dcompiler_47.dll" advance
          StrCmp $3 "\dxcompiler.dll" advance
          StrCmp $3 "\dxil.dll" advance
          StrCmp $3 "\electron_wer.dll" advance
          StrCmp $3 "\ffmpeg.dll" advance
          StrCmp $3 "\icudtl.dat" advance
          StrCmp $3 "\libEGL.dll" advance
          StrCmp $3 "\libGLESv2.dll" advance
          StrCmp $3 "\LICENSE.electron.txt" advance
          StrCmp $3 "\LICENSES.chromium.html" advance
          StrCmp $3 "\resources.pak" advance
          StrCmp $3 "\snapshot_blob.bin" advance
          StrCmp $3 "\v8_context_snapshot.bin" advance
          StrCmp $3 "\version" advance
          StrCmp $3 "\vk_swiftshader.dll" advance
          StrCmp $3 "\vk_swiftshader_icd.json" advance
          StrCmp $3 "\vulkan-1.dll" advance
          StrCmp $3 "\resources\app-update.yml" advance
          StrCmp $3 "\resources\app.asar" advance
          StrCmp $3 "\resources\default_app.asar" advance
          StrCmp $3 "\resources\elevate.exe" advance
          StrCmp $3 "\resources\app.asar.unpacked\desktop\native\NowPlayingHost.exe" advance
          StrCmp $3 "\resources\app.asar.unpacked\desktop\native\WallpaperHost.exe" advance
          StrCmp $0 "\locales" 0 unknown
          StrCpy $5 $2 4 -4
          StrCmp $5 ".pak" advance unknown
        ${EndIf}
      ${EndIf}
    advance:
      ClearErrors
      FindNext $1 $2
      IfErrors 0 next
      StrCpy $0 1
      Goto finish
    unknown:
      StrCpy $0 0
    finish:
      FindClose $1
      Pop $5
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Exch $0
  FunctionEnd

  ; Return 0 for unsafe, 1 for an empty destination, 2 for a known installation.
  Function ${PREFIX}SonicValidateRoot
    Exch $SonicRoot
    Push $0
    Push $1
    Push $2
    ; NSIS GetFullPathName needs an existing path. Win32 resolves a new path lexically.
    System::Call 'kernel32::GetFullPathNameW(w "$SonicRoot", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i .r1'
    ${If} $1 == 0
    ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
      Goto unsafe
    ${EndIf}
    StrCmp $0 $SonicRoot 0 unsafe
    StrCpy $1 $0 2 1
    StrCmp $1 ":\" 0 unsafe
    ${GetFileName} "$0" $1
    StrCmp $1 "${APP_FILENAME}" 0 unsafe
    !if "${PREFIX}" == "un."
      ${UnStrStr} $1 "$0" "'"
    !else
      ${StrStr} $1 "$0" "'"
    !endif
    StrCmp $1 "" 0 unsafe

    check_ancestor:
      System::Call 'kernel32::GetFileAttributesW(w r0) i .r1 ?e'
      Pop $2
      ${If} $1 == -1
        ${If} $2 != 2
        ${AndIf} $2 != 3
          Goto unsafe
        ${EndIf}
      ${Else}
        IntOp $1 $1 & 0x410
        StrCmp $1 16 0 unsafe
      ${EndIf}
      ${GetParent} "$0" $1
      StrCmp $1 "" check_root_contents
      StrCmp $1 $0 check_root_contents
      StrLen $2 $1
      ${If} $2 == 2
        StrCpy $1 "$1\"
      ${EndIf}
      StrCpy $0 $1
      Goto check_ancestor

    check_root_contents:
      ${DirState} "$SonicRoot" $0
      ${If} $0 == -1
        System::Call 'kernel32::GetFileAttributesW(w "$SonicRoot") i .r1 ?e'
        Pop $2
        ${If} $1 != -1
          Goto unsafe
        ${EndIf}
        ${If} $2 != 2
        ${AndIf} $2 != 3
          Goto unsafe
        ${EndIf}
      ${EndIf}
      ${If} $0 <= 0
        StrCpy $SonicRoot 1
        Goto finish
      ${EndIf}

      IfFileExists "$SonicRoot\${APP_EXECUTABLE_FILENAME}" 0 unsafe
      IfFileExists "$SonicRoot\resources\app.asar" 0 unsafe
      IfFileExists "$SonicRoot\${UNINSTALL_FILENAME}" 0 unsafe
      Push ""
      Call ${PREFIX}SonicCheckTree
      Pop $0
      StrCmp $0 1 0 unsafe
      StrCpy $SonicRoot 2
      Goto finish
    unsafe:
      StrCpy $SonicRoot 0
    finish:
      Pop $2
      Pop $1
      Pop $0
      Exch $SonicRoot
  FunctionEnd
!macroend

!macro SonicRejectPath PATH
  MessageBox MB_OK|MB_ICONSTOP "安装目录无法确认，已停止以保护文件。$\r$\n${PATH}$\r$\n如目录中放有个人文件，请先将它们备份到其他位置。请勿强制覆盖或卸载。" /SD IDOK
  SetErrorLevel 2
  Quit
!macroend

!macro customHeader
  !include "getProcessInfo.nsh"
  Var pid
  !ifdef BUILD_UNINSTALLER
    ${UnStrStr}
    !insertmacro SonicPathFunctions "un."
  !else
    ${StrStr}
    !insertmacro SonicPathFunctions ""
    Function SonicValidateInstall
      Push "$INSTDIR"
      Call SonicValidateRoot
      Pop $0
      ${If} $0 == 0
        !insertmacro SonicRejectPath "$INSTDIR"
      ${EndIf}
      ${If} $0 == 2
        ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
        ReadRegStr $2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
        ${If} $1 != $INSTDIR
        ${OrIf} $2 == ""
          !insertmacro SonicRejectPath "$INSTDIR"
        ${EndIf}
      ${EndIf}
    FunctionEnd
  !endif
!macroend

!macro SonicCheckPreviousInstallation HIVE
  ReadRegStr $0 ${HIVE} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $1 ${HIVE} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $0 != ""
  ${OrIf} $1 != ""
    Push $0
    Call SonicValidateRoot
    Pop $2
    ${If} $2 == 0
      !insertmacro SonicRejectPath "$0"
    ${EndIf}
    ${If} $2 == 2
    ${AndIf} $1 == ""
      !insertmacro SonicRejectPath "$0"
    ${EndIf}
    ${If} $1 != ""
      StrCpy $2 '"$0\${UNINSTALL_FILENAME}"'
      StrLen $3 $2
      StrCpy $3 $1 $3
      ${If} $3 != $2
        !insertmacro SonicRejectPath "$0"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  ; The stock installer can invoke old uninstallers in both registry scopes.
  !insertmacro SonicCheckPreviousInstallation HKCU
  !insertmacro SonicCheckPreviousInstallation HKLM
  Call SonicValidateInstall
!macroend

!macro customPageAfterChangeDir
  ; Validate the final directory after the assisted installer chooses an install scope.
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SonicValidateInstall
!macroend

!macro SonicValidateUninstallRoot
  Push "$INSTDIR"
  Call un.SonicValidateRoot
  Pop $0
  ${If} $0 != 2
    !insertmacro SonicRejectPath "$INSTDIR"
  ${EndIf}
!macroend

!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    !insertmacro SonicValidateUninstallRoot
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customUnInstall
  ; Revalidate after the registry-selected scope and before stock recursive cleanup.
  !insertmacro SonicValidateUninstallRoot
!macroend
