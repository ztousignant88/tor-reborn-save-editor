@echo off
cd /d "%~dp0"
python serve_saves.py %*
if errorlevel 1 pause
