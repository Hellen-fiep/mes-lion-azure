@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MES LION 1.0 JSON - SERVIDOR

echo ================================================
echo MES LION 1.0 JSON - sem PostgreSQL
echo ================================================
echo.
echo Os dados ficam na pasta Dados (arquivos JSON).
echo Se houver outra versao do MES aberta, feche a janela
echo do servidor anterior antes de continuar.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\MES_LION_SERVER_JSON.ps1" -HostIP 127.0.0.1 -Port 8765
if errorlevel 1 (
  echo.
  echo O MES nao foi iniciado. Verifique a mensagem acima.
  pause
)
