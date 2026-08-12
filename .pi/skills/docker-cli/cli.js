#!/usr/bin/env node
// docker-cli Skill — Docker container manipulation CLI
// Safe wrapper around the `docker` CLI with a strict command whitelist.
// Only 6 commands are allowed: ps, up, down, logs, run, exec.
// Uses child_process.execFile (no shell) to prevent command injection.
import { execFile } from 'node:child_process';
// ============================================================================
// Constants
// ============================================================================
const MAIN_COMPOSE_FILE = 'docker-compose.yml';
const NETWORK_NAME = 'living-dashboard-net';
// Forward slashes for Docker Desktop on Windows (matches main compose convention)
const DATA_VOLUME_MOUNT = 'F:/allmylife/event/data:/data:rw';
const ALLOWED_COMMANDS = new Set(['ps', 'up', 'down', 'logs', 'run', 'exec']);
// Exit codes
const EXIT_OK = 0;
const EXIT_BUSINESS_ERROR = 1;
const EXIT_PARAM_ERROR = 2;
class ParamError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ParamError';
    }
}
// ============================================================================
// Argument parsing
// ============================================================================
/**
 * Quick pre-scan for the --json flag so that parseArgs errors are emitted
 * in the correct format (JSON vs text). Stops at `--` (passthrough).
 */
function detectJsonFlag(argv) {
    for (const arg of argv) {
        if (arg === '--')
            break;
        if (arg === '--json')
            return true;
    }
    return false;
}
function parseArgs(argv) {
    const result = {
        command: null,
        positionals: [],
        files: [],
        tail: null,
        json: false,
    };
    let passthrough = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (passthrough) {
            result.positionals.push(arg);
            continue;
        }
        if (arg === '--') {
            passthrough = true;
            continue;
        }
        if (arg === '--json') {
            result.json = true;
            continue;
        }
        if (arg === '--file' || arg === '-f') {
            if (i + 1 >= argv.length) {
                throw new ParamError(`Missing value for ${arg}`);
            }
            result.files.push(argv[++i]);
            continue;
        }
        if (arg === '--tail') {
            if (i + 1 >= argv.length) {
                throw new ParamError('Missing value for --tail');
            }
            const raw = argv[++i];
            const n = Number.parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 0) {
                throw new ParamError(`Invalid --tail value: ${raw}`);
            }
            result.tail = n;
            continue;
        }
        // Everything else (including unknown --xxx options) is treated as positional.
        // This is essential for `run`/`exec` where the container command may itself
        // accept --flags (e.g. `psql --version`, `python --help`).
        // Use `--` to force the rest as positional when you need to pass --json/--tail
        // to the container command.
        if (result.command === null) {
            result.command = arg;
        }
        else {
            result.positionals.push(arg);
        }
    }
    return result;
}
// ============================================================================
// Docker CLI runner (execFile, no shell, args as array)
// ============================================================================
function runDocker(args) {
    return new Promise((resolveFn) => {
        execFile('docker', args, { shell: false, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                // err.code is a number when the process exited non-zero,
                // or a string like 'ENOENT' when docker binary is not found.
                const exitCode = typeof err.code === 'number' ? err.code : -1;
                resolveFn({
                    stdout: stdout ?? '',
                    stderr: stderr ?? err.message,
                    exitCode,
                });
            }
            else {
                resolveFn({
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                    exitCode: 0,
                });
            }
        });
    });
}
async function checkDockerInstalled() {
    const r = await runDocker(['--version']);
    return r.exitCode === 0;
}
/**
 * Docker Compose prefixes network names with the project name
 * (e.g. `living-dashboard-net` → `event_living-dashboard-net`).
 * `docker run --network` needs the actual Docker network name, so we
 * resolve it at runtime by listing networks that match the base name.
 * Falls back to the base name if resolution fails.
 */
async function resolveNetworkName(baseName) {
    const r = await runDocker([
        'network', 'ls',
        '--filter', `name=${baseName}`,
        '--format', '{{.Name}}',
    ]);
    if (r.exitCode === 0) {
        const names = r.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        if (names.length > 0) {
            return names[0];
        }
    }
    return baseName;
}
// ============================================================================
// Output helpers
// ============================================================================
function emitSuccess(data, json) {
    if (json) {
        const payload = { ok: true, data };
        process.stdout.write(JSON.stringify(payload) + '\n');
    }
    // In text mode, each command handler writes its own human-readable output.
}
function emitError(error, json, exitCode) {
    if (json) {
        const payload = { ok: false, error };
        process.stdout.write(JSON.stringify(payload) + '\n');
    }
    else {
        process.stderr.write(`Error: ${error}\n`);
    }
    process.exit(exitCode);
}
// ============================================================================
// Command handlers
// ============================================================================
async function cmdPs(json) {
    const r = await runDocker(['ps', '--format', '{{json .}}']);
    if (r.exitCode !== 0) {
        emitError(r.stderr.trim() || 'docker ps failed', json, EXIT_BUSINESS_ERROR);
    }
    // `docker ps --format "{{json .}}"` prints one JSON object per line.
    const containers = [];
    for (const line of r.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            containers.push(JSON.parse(trimmed));
        }
        catch {
            // Skip malformed lines (should not happen with --format json)
        }
    }
    if (json) {
        emitSuccess({ containers }, json);
    }
    else {
        if (containers.length === 0) {
            process.stdout.write('No running containers.\n');
        }
        else {
            const rows = containers.map((c) => ({
                Name: c.Names ?? c.Name ?? '',
                Image: c.Image ?? '',
                Status: c.Status ?? '',
                Ports: c.Ports ?? '',
            }));
            const headers = ['Name', 'Image', 'Status', 'Ports'];
            const widths = headers.map((h) => Math.max(h.length, ...rows.map((row) => String(row[h]).length)));
            const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
            process.stdout.write(fmt([...headers]) + '\n');
            for (const row of rows) {
                process.stdout.write(fmt([row.Name, row.Image, row.Status, row.Ports]) + '\n');
            }
        }
    }
    return EXIT_OK;
}
async function cmdUp(service, files, json) {
    const args = ['compose', '-f', MAIN_COMPOSE_FILE];
    for (const f of files) {
        args.push('-f', f);
    }
    args.push('up', '-d', service);
    const r = await runDocker(args);
    if (r.exitCode !== 0) {
        emitError(r.stderr.trim() || `docker compose up ${service} failed`, json, EXIT_BUSINESS_ERROR);
    }
    if (json) {
        emitSuccess({ service, action: 'up', stdout: r.stdout, stderr: r.stderr }, json);
    }
    else {
        process.stdout.write(r.stdout);
        if (r.stderr)
            process.stderr.write(r.stderr);
    }
    return EXIT_OK;
}
async function cmdDown(service, files, json) {
    const args = ['compose', '-f', MAIN_COMPOSE_FILE];
    for (const f of files) {
        args.push('-f', f);
    }
    args.push('down', service);
    const r = await runDocker(args);
    if (r.exitCode !== 0) {
        emitError(r.stderr.trim() || `docker compose down ${service} failed`, json, EXIT_BUSINESS_ERROR);
    }
    if (json) {
        emitSuccess({ service, action: 'down', stdout: r.stdout, stderr: r.stderr }, json);
    }
    else {
        process.stdout.write(r.stdout);
        if (r.stderr)
            process.stderr.write(r.stderr);
    }
    return EXIT_OK;
}
async function cmdLogs(service, tail, json) {
    const args = ['compose', 'logs'];
    if (tail !== null) {
        args.push('--tail', String(tail));
    }
    args.push(service);
    const r = await runDocker(args);
    if (r.exitCode !== 0) {
        emitError(r.stderr.trim() || `docker compose logs ${service} failed`, json, EXIT_BUSINESS_ERROR);
    }
    if (json) {
        const lines = r.stdout.split('\n');
        // Drop trailing empty line from final newline
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        emitSuccess({ service, tail, lines }, json);
    }
    else {
        process.stdout.write(r.stdout);
        if (r.stderr)
            process.stderr.write(r.stderr);
    }
    return EXIT_OK;
}
async function cmdRun(image, cmd, json) {
    // Force --rm (auto-cleanup), network, and data volume mount.
    // No -d (foreground only, so AI can capture output).
    // Resolve the actual Docker network name (compose adds a project prefix).
    const networkName = await resolveNetworkName(NETWORK_NAME);
    const args = [
        'run', '--rm',
        '--network', networkName,
        '-v', DATA_VOLUME_MOUNT,
        image,
        ...cmd,
    ];
    const r = await runDocker(args);
    if (r.exitCode !== 0) {
        emitError(r.stderr.trim() || `docker run ${image} failed`, json, EXIT_BUSINESS_ERROR);
    }
    if (json) {
        emitSuccess({ image, cmd, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }, json);
    }
    else {
        process.stdout.write(r.stdout);
        if (r.stderr)
            process.stderr.write(r.stderr);
    }
    return EXIT_OK;
}
async function cmdExec(service, cmd, json) {
    const args = ['compose', 'exec', service, ...cmd];
    const r = await runDocker(args);
    if (r.exitCode !== 0) {
        emitError(r.stderr.trim() || `docker compose exec ${service} failed`, json, EXIT_BUSINESS_ERROR);
    }
    if (json) {
        emitSuccess({ service, cmd, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }, json);
    }
    else {
        process.stdout.write(r.stdout);
        if (r.stderr)
            process.stderr.write(r.stderr);
    }
    return EXIT_OK;
}
// ============================================================================
// Usage
// ============================================================================
const USAGE = `Usage: node cli.js <command> [args] [--json]

Commands:
  ps                              List running containers
  up <service> [--file <f>]       Start a compose service (detached)
  down <service> [--file <f>]     Stop a compose service
  logs <service> [--tail <n>]     View service logs
  run <image> <cmd...>            Run a one-off container (auto --rm + network + volume)
  exec <service> <cmd...>         Execute command in a running service

Options:
  --json                          Output JSON { ok, data | error }
  --file <path>, -f <path>        Compose overlay file (repeatable, for up/down)
  --tail <n>                      Show last N log lines (for logs)
  --                              Pass remaining args as positional (for run/exec)

Exit codes:
  0 success, 1 business error, 2 param error
`;
// ============================================================================
// Main entry
// ============================================================================
async function main() {
    const argv = process.argv.slice(2);
    let parsed;
    try {
        parsed = parseArgs(argv);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emitError(msg, detectJsonFlag(argv), EXIT_PARAM_ERROR);
    }
    const jsonFlag = parsed.json;
    if (!parsed.command) {
        process.stderr.write(USAGE);
        return EXIT_PARAM_ERROR;
    }
    if (!ALLOWED_COMMANDS.has(parsed.command)) {
        emitError(`Unknown command: ${parsed.command}. Allowed: ps, up, down, logs, run, exec`, jsonFlag, EXIT_PARAM_ERROR);
    }
    // Check Docker is installed before executing any command.
    const installed = await checkDockerInstalled();
    if (!installed) {
        emitError('Docker not installed', jsonFlag, EXIT_BUSINESS_ERROR);
    }
    switch (parsed.command) {
        case 'ps': {
            return await cmdPs(jsonFlag);
        }
        case 'up': {
            const service = parsed.positionals[0];
            if (!service) {
                emitError('Usage: up <service> [--file <overlay>] [--json]', jsonFlag, EXIT_PARAM_ERROR);
            }
            return await cmdUp(service, parsed.files, jsonFlag);
        }
        case 'down': {
            const service = parsed.positionals[0];
            if (!service) {
                emitError('Usage: down <service> [--file <overlay>] [--json]', jsonFlag, EXIT_PARAM_ERROR);
            }
            return await cmdDown(service, parsed.files, jsonFlag);
        }
        case 'logs': {
            const service = parsed.positionals[0];
            if (!service) {
                emitError('Usage: logs <service> [--tail <n>] [--json]', jsonFlag, EXIT_PARAM_ERROR);
            }
            return await cmdLogs(service, parsed.tail, jsonFlag);
        }
        case 'run': {
            const image = parsed.positionals[0];
            if (!image) {
                emitError('Usage: run <image> <cmd...> [--json]', jsonFlag, EXIT_PARAM_ERROR);
            }
            const cmd = parsed.positionals.slice(1);
            return await cmdRun(image, cmd, jsonFlag);
        }
        case 'exec': {
            const service = parsed.positionals[0];
            if (!service) {
                emitError('Usage: exec <service> <cmd...> [--json]', jsonFlag, EXIT_PARAM_ERROR);
            }
            const cmd = parsed.positionals.slice(1);
            if (cmd.length === 0) {
                emitError('Usage: exec <service> <cmd...> [--json] — cmd is required', jsonFlag, EXIT_PARAM_ERROR);
            }
            return await cmdExec(service, cmd, jsonFlag);
        }
        default: {
            // Unreachable: ALLOWED_COMMANDS check above rejects unknown commands.
            emitError(`Unknown command: ${parsed.command}`, jsonFlag, EXIT_PARAM_ERROR);
        }
    }
    // Unreachable
    return EXIT_OK;
}
main()
    .then((code) => {
    process.exit(code);
})
    .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Fatal: ${msg}\n`);
    process.exit(EXIT_BUSINESS_ERROR);
});
