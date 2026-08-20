@echo off
chcp 65001 >nul
title ANPEREZ Money - servidor de desenvolvimento
cd /d "%~dp0"

rem Verifica se o npm existe antes de qualquer coisa
where npm >nul 2>nul
if errorlevel 1 (
    echo [iniciar] npm nao encontrado. Instale o Node.js em https://nodejs.org e tente de novo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [iniciar] Instalando dependencias - primeira execucao pode demorar...
    call npm install
    if errorlevel 1 goto falhou
)

echo [iniciar] Subindo o servidor em http://localhost:5173
echo [iniciar] A janela do navegador abre sozinha. Deixe esta janela aberta.
echo [iniciar] Para encerrar o servidor depois, feche esta janela.
call npm run dev -- --open
goto fim

:falhou
echo.
echo [iniciar] Algo deu errado. Para ver o erro, rode manualmente:
echo     npm install
echo     npm run dev
pause
exit /b 1

:fim
echo.
echo [iniciar] Servidor encerrado.
pause