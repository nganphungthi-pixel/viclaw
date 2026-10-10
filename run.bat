@echo off
title Viclaw - AI Coding Agent
echo.
echo ========================================
echo   Starting Viclaw Setup Check...
echo ========================================
echo.

REM Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Install Node.js 22+ from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js installed

REM Check TypeScript
npx tsc --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] TypeScript not found. Run: npm install
)

REM Check dependencies
if not exist node_modules (
    echo [INSTALL] Installing dependencies...
    call npm install
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies found
)

REM Check .env
if not exist .env (
    echo [WARN] .env file not found. Copy .env.example to .env and configure.
    echo.
)

REM Check TypeScript compilation
echo.
echo [BUILD] Checking TypeScript...
call npx tsc --noEmit
if %errorlevel% neq 0 (
    echo [ERROR] TypeScript compilation failed!
    pause
    exit /b 1
)
echo [OK] TypeScript compiles clean

echo.
echo ========================================
echo   Starting Viclaw...
echo ========================================
echo.

REM Start chat mode
call npx tsx src/cli.ts chat

pause
