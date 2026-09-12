@echo off
rem Backup semanal do Supabase (segunda 19:00).
rem Configuracoes de autenticacao vem do .env.local (SUPABASE_EMAIL/SUPABASE_SENHA).
rem Usa a URL/ANON_KEY do proprio .env.local; nao requer instalacao extra.

set "PROJ=C:\Users\andre\Desktop\Anperez_money"
set "NODE=C:\Program Files\nodejs\node.exe"
set "LOG=%PROJ%\backups\logs\backup_%date:~-4%%date:~-10,2%%date:~-7,2%.log"

if not exist "%PROJ%\backups\logs" mkdir "%PROJ%\backups\logs"

echo [%date% %time%] Iniciando backup... >> "%LOG%"
cd /d "%PROJ%"
"%NODE%" scripts\backup_supabase.mjs >> "%LOG%" 2>&1
echo [%date% %time%] Backup finalizado. >> "%LOG%"