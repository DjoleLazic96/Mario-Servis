@echo off
REM ============================================================
REM  Postavlja da se citac SAM pokrene pri paljenju racunara.
REM  Radi bez admin prava — samo ubaci precicu u Startup folder.
REM  Za uklanjanje: obrisati precicu iz  shell:startup
REM ============================================================
chcp 65001 >nul
setlocal
set "EXE=%~dp0AUTO SERVIS S23 citac.exe"

if not exist "%EXE%" (
  echo   GRESKA: ne vidim  "AUTO SERVIS S23 citac.exe"  pored ovog fajla.
  pause
  exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\AUTO SERVIS S23 citac.lnk"

powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%');" ^
  "$s.TargetPath='%EXE%'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"

if exist "%LNK%" (
  echo.
  echo   Gotovo — citac ce se sam pokretati pri paljenju racunara.
  echo   (Da iskljucite: obrisite precicu iz  shell:startup^)
  echo.
  echo   Pokrecem ga i sada...
  start "" "%EXE%"
) else (
  echo   Nesto nije uspelo — precica nije napravljena.
)
pause
