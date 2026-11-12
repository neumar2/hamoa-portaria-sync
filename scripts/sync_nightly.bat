@echo off
chcp 65001 > nul
title Sincronizacao Diaria MDC 4WEB -> vencimento.hamoa

set SCRIPT_DIR=%~dp0
set BASE_DIR=%SCRIPT_DIR%..
set PROCESSOR=%BASE_DIR%\scripts\process_sync.js

echo ==============================================================================
echo       HAMOA RESORT RESIDENCIAL - SINCRONIZADOR DIARIO MDC 4WEB
echo ==============================================================================

echo [1/2] Processando sincronizacao (SQL Server + Planilhas)...
node "%PROCESSOR%"

echo.
echo [2/2] Notificando recarga ao servidor local...
node -e "require('http').get('http://localhost:3344/api/reload', () => {}).on('error', () => {})" > nul 2>&1

echo.
echo Sincronizacao finalizada com sucesso!
echo ==============================================================================
