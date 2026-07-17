@echo off
title PortaGEN V2 - Serveur PROD (rapide)
cd /d "%~dp0"

rem Garde-fou : un seul serveur PortaGEN a la fois (port 3302).
rem Impose aussi la regle : on ne construit JAMAIS pendant qu'un serveur tourne.
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
echo   PortaGEN V2 - MODE PRODUCTION (rapide)
echo   A utiliser au quotidien. Etape 1 :
echo   construction de la version optimisee
echo   (1 a 3 minutes). Etape 2 : demarrage,
echo   puis toutes les pages sont rapides.
echo   NE FERMEZ PAS cette fenetre : c'est elle
echo   qui fait tourner l'application.
echo ============================================
echo.
echo [1/2] Construction en cours, patientez...
echo.

call npm run build
if errorlevel 1 (
    echo.
    echo   La construction a echoue : l'application n'a pas demarre.
    echo   Utilisez "Lancer PortaGEN DEV.bat" en attendant, et
    echo   signalez le probleme a Claude.
    echo.
    pause
    exit /b 1
)

echo.
echo [2/2] Demarrage du serveur... le navigateur va s'ouvrir.
echo.

rem Ouvre le navigateur apres 3 secondes (le demarrage prod est immediat).
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3302"

call npm run start

echo.
echo Le serveur s'est arrete.
pause
