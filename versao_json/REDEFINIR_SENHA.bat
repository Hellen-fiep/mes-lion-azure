@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MES LION 1.0 JSON - REDEFINIR SENHA

echo Redefine a senha de um usuario do MES (versao JSON) e reativa o usuario.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\MES_LION_SERVER_JSON.ps1" -RedefinirSenha
echo.
pause
