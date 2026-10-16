@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MES LION 1.0 JSON - SERVIDOR REDE

echo ================================================
echo MES LION 1.0 JSON - sem PostgreSQL - REDE
echo ================================================
echo.
echo Os outros computadores acessam pelo navegador: http://IP-DESTE-PC:8765
echo Se o Windows perguntar sobre o Firewall, permita o acesso na rede.
echo Se a porta 8765 estiver bloqueada pela rede corporativa, solicite a liberacao a TI.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\MES_LION_SERVER_JSON.ps1" -HostIP 0.0.0.0 -Port 8765
if errorlevel 1 (
  echo.
  echo O MES nao foi iniciado. Feche outra instancia que esteja usando a porta 8765.
  pause
)
