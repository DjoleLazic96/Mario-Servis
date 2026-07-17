@echo off
REM ============================================================
REM  Pravi jedan mali .exe citaca (~5.5 MB, bez Jave, bez foldera).
REM  Treba Go 1.21+ na PATH-u (https://go.dev/dl).
REM  Rezultat: "AUTO SERVIS S23 citac.exe" pored ovog fajla.
REM ============================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where go >nul 2>&1
if errorlevel 1 (
  echo   GRESKA: Go nije pronadjen. Instalirati Go 1.21+ sa https://go.dev/dl
  pause
  exit /b 1
)

echo   Pravim...
go build -ldflags "-s -w" -o "AUTO SERVIS S23 citac.exe" . || (echo   Nije uspelo. & pause & exit /b 1)

echo.
echo   Gotovo:  %~dp0AUTO SERVIS S23 citac.exe
echo   Taj JEDAN fajl je dovoljan na racunaru servisa — bez instalacije.
echo.
pause
