@echo off
rem Atualizacao semanal da planilha CONTABILADE (segunda 19:05, apos o backup).
rem Etapa 1 (Node): gera scripts\recebidos_para_planilha.json a partir do Supabase.
rem Etapa 2 (Python do sistema, tem win32com + openpyxl): grava na planilha
rem preservando as Tabelas Dinamicas/Slicer.

set "PROJ=C:\Users\andre\Desktop\Anperez_money"
set "NODE=C:\Program Files\nodejs\node.exe"
set "PY=C:\Users\andre\AppData\Local\Programs\Python\Python314\python.exe"
set "LOG=%PROJ%\backups\logs\planilha_%date:~-4%%date:~-10,2%%date:~-7,2%.log"

if not exist "%PROJ%\backups\logs" mkdir "%PROJ%\backups\logs"

echo [%date% %time%] Etapa 1: gerando JSON do Supabase... >> "%LOG%"
cd /d "%PROJ%"
"%NODE%" scripts\gerar_recebidos_planilha.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERRO na etapa 1 (Node). >> "%LOG%"
    exit /b 1
)

echo [%date% %time%] Etapa 2: gravando na planilha... >> "%LOG%"
"%PY%" scripts\sincronizar_planilha_supabase.py >> "%LOG%" 2>&1
echo [%date% %time%] Planilha finalizada. >> "%LOG%"