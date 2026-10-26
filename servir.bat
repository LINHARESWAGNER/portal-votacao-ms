@echo off
REM Abre o portal localmente em http://localhost:8077 (troque a porta aqui se precisar)
set PORTA=8077
cd /d "%~dp0"
start "" http://localhost:%PORTA%
python -m http.server %PORTA% --directory docs
