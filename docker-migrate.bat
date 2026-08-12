@echo off
echo Migrating data from SQLite to PostgreSQL...
echo Ensure PostgreSQL container is running: docker-up.bat
echo.
docker compose exec server node -e "import('./dist/db/connection.js').then(c => c.initDb()).then(() => import('./dist/db/schema.js')).then(s => s.initializeSchema()).then(() => import('./dist/db/migrateFromSqlite.js')).then(m => m.migrateFromSqlite()).then(r => { console.log('Migration report:', r); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
pause
