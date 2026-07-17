@echo off
REM ============================================================
REM  AUTO SERVIS S23 - citac saobracajne dozvole
REM
REM  Pokrenuti PRE nego sto se otvori sajt, i ostaviti ukljuceno
REM  dok se radi. Prozor moze da se minimizuje, ali ne i zatvori.
REM
REM  Cita karticu i salje podatke sajtu kad se klikne
REM  "Ucitaj saobracajnu" u formi vozila.
REM ============================================================
chcp 65001 >nul
title AUTO SERVIS S23 - citac saobracajne

cd /d "%~dp0src"

where java >nul 2>&1
if errorlevel 1 (
  echo.
  echo   GRESKA: Java nije pronadjena.
  echo   Instalirati Java 21 ili noviju: https://adoptium.net
  echo.
  pause
  exit /b 1
)

echo.
echo   Pokrecem citac... (prvo pokretanje traje ~15 sekundi)
echo.

REM --add-opens: bez ovoga Java trajno "ne vidi" citac ako se prikljuci POSLE pokretanja.
REM Adresa sajta je vec ugradjena u CitacServer.java; ovde se moze dodati jos jedna.
java -Dfile.encoding=UTF-8 --add-opens java.smartcardio/sun.security.smartcardio=ALL-UNNAMED CitacServer.java

echo.
echo   Citac je zaustavljen.
pause
