@echo off
title Estacionamiento POS
cd /d "%~dp0"
if not exist "node_modules" call npm install --no-audit --no-fund
echo.
echo  Abre en el navegador:  http://localhost:3002
echo  (MySQL debe estar encendido. Cierra esta ventana para detener el sistema.)
echo.
node app.js
pause
