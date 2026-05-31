@echo off
REM ============================================================
REM Radio Globe - servidor local HTTP (necessario para o WebGL)
REM Abrir via file:// NAO funciona: o navegador bloqueia as
REM texturas do globo. Este script serve a pasta por HTTP.
REM ============================================================
setlocal
set PORT=8777
cd /d "%~dp0"

echo.
echo  Radio Globe -- iniciando servidor local em http://localhost:%PORT%
echo  (Ctrl+C para parar)
echo.

REM Tenta abrir o navegador apos um curto atraso.
start "" "http://localhost:%PORT%"

REM Python 3
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -m http.server %PORT%
  goto :eof
)

REM Python launcher (py)
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 -m http.server %PORT%
  goto :eof
)

REM Node (npx serve) como alternativa
where npx >nul 2>nul
if %ERRORLEVEL%==0 (
  npx --yes serve -l %PORT% .
  goto :eof
)

echo.
echo  [ERRO] Nao encontrei Python nem Node neste sistema.
echo  Instale o Python (https://www.python.org/downloads/) ou o Node.js,
echo  ou sirva esta pasta com qualquer servidor HTTP estatico.
echo.
pause
