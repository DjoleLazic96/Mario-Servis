@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Karton - pokretanje
cd /d "%~dp0"

echo.
echo ==========================================
echo   KARTON - vodjenje auto servisa
echo ==========================================
echo.

REM ---------- 1) Docker Desktop ----------
docker info >nul 2>&1
if not errorlevel 1 goto dockerok

echo [1/5] Pokrecem Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo       Cekam da se Docker podigne (moze do 2 minuta)...
set /a n=0
:waitdocker
timeout /t 3 >nul
docker info >nul 2>&1
if not errorlevel 1 goto dockerok
set /a n+=1
if !n! lss 40 goto waitdocker
echo.
echo GRESKA: Docker se nije pokrenuo. Pokrenite Docker Desktop rucno pa probajte opet.
pause
exit /b 1

:dockerok
echo [1/5] Docker: OK

REM ---------- 2) Baza + Mailpit ----------
cd /d "%~dp0karton"
if not exist ".env" (
  echo       Pravim .env iz .env.example
  copy /y ".env.example" ".env" >nul
)
echo [2/5] Pokrecem bazu i Mailpit...
docker compose up -d >nul 2>&1
set /a n=0
:waitdb
for /f "delims=" %%i in ('docker inspect --format "{{.State.Health.Status}}" karton-db 2^>nul') do set DBST=%%i
if "!DBST!"=="healthy" goto dbok
timeout /t 2 >nul
set /a n+=1
if !n! lss 30 goto waitdb
echo GRESKA: Baza se nije podigla.
pause
exit /b 1
:dbok
echo [2/5] Baza: OK

REM ---------- 3) Migracije + seed (bezbedno je pokretati vise puta) ----------
echo [3/5] Migracije i pocetni podaci...
call pnpm migrate >nul 2>&1
call pnpm seed >nul 2>&1
echo [3/5] Baza spremna

REM ---------- 4) Servisi ----------
REM Trenutni folder je vec "karton", pa ga start nasledjuje (putanja ima razmake).
echo [4/5] Pokrecem API, worker, web i citac saobracajne...
start "Karton API"    /min cmd /k pnpm dev:api
start "Karton Worker" /min cmd /k pnpm dev:worker
start "Karton Web"    /min cmd /k pnpm dev:web
REM --add-opens: dozvoljava reset PC/SC konteksta ako se citac prikljuci posle starta.
REM Dozvoljeni sajtovi su UGRADJENI u CitacServer.java (i localhost i produkcija) - ovde se
REM namerno ne prosledjuje argument. Ranije je bas to bio uzrok: helper je odbijao zivi sajt
REM (403) jer mu ga niko nije prosledio, a aplikacija je javljala "Citac nije pokrenut".
start "Karton Citac"  /D "%~dp0citac-saobracajne\src" /min cmd /k java -Dfile.encoding=UTF-8 --add-opens java.smartcardio/sun.security.smartcardio=ALL-UNNAMED CitacServer.java

REM ---------- 5) Otvori aplikaciju ----------
echo [5/5] Cekam da se aplikacija podigne...
set /a n=0
:waitweb
timeout /t 2 >nul
curl -s -o nul http://localhost:5173 2>nul
if not errorlevel 1 goto webok
set /a n+=1
if !n! lss 20 goto waitweb
:webok
start "" http://localhost:5173

echo.
echo ==========================================
echo   Karton je pokrenut!
echo.
echo   Aplikacija:  http://localhost:5173
echo   Prijava:     admin  /  admin
echo   Mejlovi:     http://localhost:8025  (Mailpit)
echo.
echo   Za gasenje pokrenite:  zaustavi.bat
echo ==========================================
echo.
echo Ovaj prozor mozete zatvoriti.
if not defined KARTON_NOPAUSE pause
