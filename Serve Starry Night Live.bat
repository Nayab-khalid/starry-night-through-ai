@echo off
cd /d "%~dp0"
echo Starting Starry Night Live at http://localhost:8765  (close this window to stop it)
start "" http://localhost:8765/index.html
if exist venv\Scripts\python.exe (venv\Scripts\python.exe -m http.server 8765 --bind 127.0.0.1) else (py -3 -m http.server 8765 --bind 127.0.0.1)
