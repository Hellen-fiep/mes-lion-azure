@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MES LION 1.0 JSON - GERAR PACOTE PARA OUTROS USUARIOS

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\GERAR_PACOTE.ps1"
echo.
pause
