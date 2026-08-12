@echo off
echo Starting Daily (Docker Compose)...
docker compose --env-file .env up -d
if errorlevel 1 (
    echo Failed to start. Check .env file exists.
    pause
    exit /b 1
)
echo.
echo Services started:
echo   - PostgreSQL: localhost:5432
echo   - Server:     http://localhost:3456
echo.
echo View logs: docker compose logs -f
echo Stop:      docker-down.bat
