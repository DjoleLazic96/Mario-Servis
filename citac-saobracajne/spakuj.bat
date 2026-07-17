@echo off
REM ============================================================
REM  Pakuje citac u SAMOSTALAN program za racunar servisa.
REM
REM  Rezultat: folder "AUTO SERVIS S23 citac" koji nosi svoju Javu.
REM  Na racunar servisa se samo prekopira i pokrene .exe -
REM  NE treba instalirati Javu ni bilo sta drugo.
REM
REM  Ovde (na racunaru gde se pakuje) treba JDK 21+.
REM
REM  Argument "bez-pauze" preskace cekanje na taster (za skripte i testove).
REM ============================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PAUZA=pause"
if /i "%~1"=="bez-pauze" set "PAUZA=rem"

where jpackage >nul 2>&1
if errorlevel 1 (
  echo   GRESKA: jpackage nije pronadjen. Treba JDK 21+ ^(ne samo JRE^).
  %PAUZA%
  exit /b 1
)

echo   [1/3] Prevodim...
if exist build rmdir /s /q build
mkdir build\out build\in
javac -encoding UTF-8 -d build\out src\CitacServer.java || goto :greska

echo   [2/3] Pravim jar...
jar --create --file build\in\citac.jar --main-class CitacServer -C build\out . || goto :greska

echo   [3/3] Pakujem sa Javom (traje ~30s)...
if exist "izlaz" rmdir /s /q "izlaz"
REM --add-opens: bez ovoga Java trajno "ne vidi" citac prikljucen POSLE pokretanja.
REM stdout.encoding: bez ovoga se srpska slova u prozoru prikazuju kao krakozjabre.
jpackage --type app-image --name "AUTO SERVIS S23 citac" ^
  --input build\in --main-jar citac.jar --main-class CitacServer ^
  --dest izlaz --add-modules java.smartcardio,jdk.httpserver,java.base ^
  --java-options "-Dfile.encoding=UTF-8" ^
  --java-options "-Dstdout.encoding=UTF-8" ^
  --java-options "-Dstderr.encoding=UTF-8" ^
  --java-options "--add-opens=java.smartcardio/sun.security.smartcardio=ALL-UNNAMED" ^
  --win-console --vendor "AUTO SERVIS S23" || goto :greska

rmdir /s /q build
echo.
echo   Gotovo:  %~dp0izlaz\AUTO SERVIS S23 citac
echo   Ceo taj folder prekopirati na racunar servisa i pokrenuti .exe
echo.
%PAUZA%
exit /b 0

:greska
echo.
echo   Pakovanje nije uspelo.
%PAUZA%
exit /b 1
