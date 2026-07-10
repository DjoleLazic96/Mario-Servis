@echo off
chcp 65001 >nul
title Karton - zaustavljanje
cd /d "%~dp0"

echo.
echo Zaustavljam Karton...
echo.

REM Zatvori prozore servisa (API, Worker, Web, Citac) i njihovu decu
taskkill /FI "WINDOWTITLE eq Karton API*"    /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Karton Worker*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Karton Web*"    /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Karton Citac*"  /T /F >nul 2>&1
REM Rezerva: ugasi i citac pokrenut rucno (java proces sa CitacServer)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*CitacServer*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
echo   - Servisi zaustavljeni

REM Zaustavi bazu i Mailpit (podaci ostaju sacuvani)
cd /d "%~dp0karton"
docker compose stop >nul 2>&1
echo   - Baza i Mailpit zaustavljeni (podaci sacuvani)

echo.
echo Gotovo. Docker Desktop mozete ostaviti upaljen ili ga ugasiti rucno.
echo.
timeout /t 3 >nul
