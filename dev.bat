@echo off
set PATH=D:\nodejs\node-v22.16.0-win-x64;%PATH%
cd /d F:\allmylife\event

echo Starting backend server...
start "Daily API" cmd /c "cd /d F:\allmylife\event\server && npm run dev"

echo Waiting for backend to be ready (up to 30 seconds)...
setlocal enabledelayedexpansion
set "ready=0"
for /l %%i in (1,1,30) do (
    if "!ready!"=="0" (
        set "code=000"
        for /f "tokens=*" %%c in ('curl -s -o NUL -w "%%{http_code}" http://localhost:3456/api/health 2^>nul') do set "code=%%c"
        if "!code!"=="200" (
            set "ready=1"
            echo Backend is ready!
        ) else (
            ping -n 2 127.0.0.1 >nul 2>&1
        )
    )
)
if "!ready!"=="0" (
    echo WARNING: Backend is not ready after 30 seconds. Starting frontend anyway...
)
endlocal

echo Starting Electron dev server...
npm run dev
pause
