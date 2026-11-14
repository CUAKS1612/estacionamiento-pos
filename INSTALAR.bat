@echo off
title Estacionamiento POS - Instalacion
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado. Descargalo de https://nodejs.org
    pause
    exit /b 1
)
echo.
echo  Instalando dependencias...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo  [ERROR] Fallo npm install. Revisa tu conexion a internet.
    pause
    exit /b 1
)
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo.
    echo  Se creo el archivo .env. Abrelo y pon el usuario y la contrasena de MySQL.
)
echo.
echo  Listo. Usa INICIAR.bat para arrancar el sistema.
pause
