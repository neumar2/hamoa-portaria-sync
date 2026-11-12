@echo off
chcp 65001 > nul
title Hamoa Resort - Painel de Portaria & Acessos Faciais (Console)
color 0a

echo ==============================================================================
echo       HAMOA RESORT RESIDENCIAL - SERVIDOR LOCAL DE PORTARIA
echo ==============================================================================
echo Iniciando servidor na porta 3344...
echo.
echo Acesse pelo navegador:
echo   - Neste computador: http://localhost:3344/index.html
echo   - Na rede interna: http://^<IP_DO_SERVIDOR^>:3344/index.html
echo.
echo Para fechar o servidor, feche esta janela.
echo ==============================================================================
echo.

node "%~dp0server.js"

pause
