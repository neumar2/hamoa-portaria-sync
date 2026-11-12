@echo off
chcp 65001 > nul
title Parar Servico Hamoa Portaria
color 0c

echo ==============================================================================
echo       HAMOA RESORT RESIDENCIAL - PARANDO SERVICO DA PORTARIA
echo ==============================================================================
echo.

schtasks /end /tn "HamoaPortariaSync" > nul 2>&1
echo [OK] Tarefa agendada finalizada.

echo.
echo Pressione qualquer tecla para sair...
pause > nul
