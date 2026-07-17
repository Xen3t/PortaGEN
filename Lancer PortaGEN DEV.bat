@echo off
title PortaGEN V2 - Serveur DEV (developpement)
cd /d "%~dp0"

rem Garde-fou : un seul serveur PortaGEN a la fois (port 3302).
netstat -ano | findstr /C:":3302 " | findstr LISTENING >nul 2>&1
if %errorlevel%==0 (
    echo.
    echo   Un serveur PortaGEN tourne deja !
    echo   Fermez l'autre fenetre PortaGEN, puis relancez ce raccourci.
    echo.
    pause
    exit /b 1
)

echo ============================================
echo   PortaGEN V2 - MODE DEVELOPPEMENT
echo   A utiliser quand on travaille sur le code
echo   (sessions avec Claude). La 1re ouverture
echo   de chaque page est plus lente : normal.
echo   NE FERMEZ PAS cette fenetre : c'est elle
echo   qui fait tourner l'application.
echo ============================================
echo.

rem Ouvre le navigateur apres 8 secondes, en parallele du serveur.
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3302"

call npm run dev

echo.
echo Le serveur s'est arrete.
pause
