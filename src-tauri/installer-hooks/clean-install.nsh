!include LogicLib.nsh

!define TRADE_UNION_DISPLAY_NAME "Trade Union Group Manager"
!define TRADE_UNION_UNINSTALL_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"

!macro _TRADE_UNION_TRY_UNINSTALL ROOT_KEY SUBKEY
  ClearErrors
  ReadRegStr $2 ${ROOT_KEY} "${SUBKEY}" "DisplayName"

  ${IfNot} ${Errors}
    ${If} $2 == "${TRADE_UNION_DISPLAY_NAME}"
      ClearErrors
      ReadRegStr $3 ${ROOT_KEY} "${SUBKEY}" "QuietUninstallString"

      ${If} ${Errors}
      ${OrIf} $3 == ""
        ClearErrors
        ReadRegStr $3 ${ROOT_KEY} "${SUBKEY}" "UninstallString"

        ${IfNot} ${Errors}
          ${If} $3 != ""
            StrCpy $3 '$3 /S'
          ${EndIf}
        ${EndIf}
      ${EndIf}

      ${If} $3 != ""
        DetailPrint "Removing previous ${TRADE_UNION_DISPLAY_NAME} installation..."
        ExecWait '$3' $4
        DetailPrint "Previous ${TRADE_UNION_DISPLAY_NAME} uninstall exit code: $4"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro _TRADE_UNION_SCAN_UNINSTALL_ROOT ROOT_KEY
  StrCpy $0 0

  ${Do}
    EnumRegKey $1 ${ROOT_KEY} "${TRADE_UNION_UNINSTALL_ROOT}" $0
    ${If} $1 == ""
      ${Break}
    ${EndIf}

    !insertmacro _TRADE_UNION_TRY_UNINSTALL ${ROOT_KEY} "${TRADE_UNION_UNINSTALL_ROOT}\$1"
    IntOp $0 $0 + 1
  ${Loop}
!macroend

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for previous ${TRADE_UNION_DISPLAY_NAME} installations..."

  SetRegView 64
  !insertmacro _TRADE_UNION_SCAN_UNINSTALL_ROOT HKCU
  !insertmacro _TRADE_UNION_SCAN_UNINSTALL_ROOT HKLM

  SetRegView 32
  !insertmacro _TRADE_UNION_SCAN_UNINSTALL_ROOT HKCU
  !insertmacro _TRADE_UNION_SCAN_UNINSTALL_ROOT HKLM

  SetRegView 64
!macroend
