@echo off
chcp 65001 > nul
title Instalador do Sistema Hamoa - Portaria & Acessos Faciais
color 0b

echo ==============================================================================
echo       HAMOA RESORT RESIDENCIAL - INSTALADOR OFICIAL DO SERVIDOR
echo                   Controle de Acessos e Vencimento Facial
echo ==============================================================================
echo.
echo [1/4] Verificando ambiente do servidor...

if not exist "C:\Program Files\nodejs\node.exe" (
    echo [ERRO] Node.js nao localizado em "C:\Program Files\nodejs\node.exe".
    echo Por favor, instale o Node.js no servidor antes de prosseguir.
    pause
    exit /b 1
)

echo [OK] Node.js detectado com sucesso.
echo.

echo [2/4] Liberando porta 3344 no Firewall do Windows para a rede interna...
netsh advfirewall firewall delete rule name="Hamoa Portaria Web" > nul 2>&1
netsh advfirewall firewall add rule name="Hamoa Portaria Web" dir=in action=allow protocol=TCP localport=3344 profile=any description="Servidor Web do Painel de Acessos Faciais Hamoa" > nul
echo [OK] Porta 3344 liberada no Firewall.
echo.

echo [3/4] Registrando Tarefa no Windows para iniciar com o servidor (24h/7d)...
schtasks /delete /tn "HamoaPortariaSync" /f > nul 2>&1
if exist "%~dp0task_service.xml" (
    schtasks /create /tn "HamoaPortariaSync" /xml "%~dp0task_service.xml" /f > nul
) else (
    schtasks /create /tn "HamoaPortariaSync" /tr "\"C:\Program Files\nodejs\node.exe\" \"%~dp0server.js\"" /sc onstart /ru SYSTEM /f > nul
)

if %ERRORLEVEL% EQU 0 (
    echo [OK] Tarefa agendada "HamoaPortariaSync" criada com sucesso (inicia no boot do Windows sem limite de tempo).
) else (
    echo [AVISO] Nao foi possivel criar via SYSTEM. Criando para o usuario atual...
    schtasks /create /tn "HamoaPortariaSync" /tr "\"C:\Program Files\nodejs\node.exe\" \"%~dp0server.js\"" /sc onlogon /f > nul
)
echo.

echo [4/4] Iniciando o servico agora...
schtasks /run /tn "HamoaPortariaSync" > nul 2>&1

echo.
echo ==============================================================================
echo                  INSTALACAO CONCLUIDA COM SUCESSO!
echo ==============================================================================
echo.
echo O sistema agora roda 24h por dia neste servidor, mesmo com outros PCs desligados.
echo.
echo Enderecos de Acesso:
echo   - Local neste servidor: http://localhost:3344/index.html
echo   - Para outros computadores/celulares na rede: http://^<IP_DO_SERVIDOR^>:3344/index.html
echo.
echo Pressione qualquer tecla para finalizar...
pause > nul
