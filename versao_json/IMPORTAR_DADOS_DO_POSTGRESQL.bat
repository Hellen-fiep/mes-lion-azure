@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MES LION 1.0 JSON - IMPORTAR DADOS DO MES POSTGRESQL

echo ================================================
echo Importar os dados do MES PostgreSQL (com historico)
echo ================================================
echo.
echo Use no computador onde o MES PostgreSQL esta instalado.
echo Copia dados do MES, usuarios (mesmas senhas), historico de
echo modificacoes e documentos para a pasta Dados desta versao.
echo Nada e alterado no PostgreSQL.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\IMPORTAR_POSTGRESQL.ps1"
echo.
pause
