"use strict";
// music-cli — 音乐播放操控 Skill
// 通过 fetch 调用服务器 /api/entities?type=musicPlaylist 等，无外部依赖
//
// 命令：
//   playlist ls [--json]
//   playlist get <playlistId> [--json]
//   song play --id <songId> [--json]
// ===== Config =====
const SERVER_URL = process.env.LD_SERVER_URL || 'http://localhost:3456';
const SERVER_TOKEN = process.env.LD_SERVER_TOKEN || process.env.SERVER_TOKEN || '';
const DEVICE_ID = 'music-cli';
// ===== Helpers =====
function authHeaders() {
    const h = {
        'Content-Type': 'application/json',
        'X-Device-Id': DEVICE_ID,
    };
    if (SERVER_TOKEN)
        h['Authorization'] = `Bearer ${SERVER_TOKEN}`;
    return h;
}
async function healthCheck() {
    try {
        const res = await fetch(`${SERVER_URL}/api/health`, {
            headers: { 'X-Device-Id': DEVICE_ID },
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
async function apiFetch(path, options) {
    const res = await fetch(`${SERVER_URL}${path}`, {
        ...options,
        headers: { ...authHeaders(), ...(options?.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const errObj = body;
        const msg = errObj?.error;
        if (typeof msg === 'string')
            throw new Error(msg);
        throw new Error(JSON.stringify(msg || `HTTP ${res.status} ${res.statusText}`));
    }
    return body;
}
function parseArgs(argv) {
    const positional = [];
    const flags = {};
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--json') {
            json = true;
            continue;
        }
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('--')) {
                flags[key] = next;
                i++;
            }
            else {
                flags[key] = 'true';
            }
        }
        else {
            positional.push(arg);
        }
    }
    return { positional, flags, json };
}
function jsonOut(ok, payload) {
    console.log(JSON.stringify(ok ? { ok: true, data: payload } : { ok: false, error: payload }));
}
class ExitSignal extends Error {
}
function fail(msg, json, code) {
    if (json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
    }
    else {
        console.error(`Error: ${msg}`);
    }
    process.exitCode = code;
    throw new ExitSignal();
}
// ===== Playlist Commands =====
async function playlistLs(json) {
    const resp = (await apiFetch('/api/entities?type=musicPlaylist&limit=1000'));
    const items = resp.items;
    if (json) {
        jsonOut(true, items);
        return;
    }
    if (items.length === 0) {
        console.log('No playlists found.');
        return;
    }
    console.log(`Playlists (${items.length}):`);
    for (const e of items) {
        const name = String(e.data?.name || e.id);
        const songCount = Array.isArray(e.data?.songs) ? e.data.songs.length : 0;
        console.log(`  ${e.id}  ${name}  (${songCount} songs)`);
    }
}
async function playlistGet(playlistId, json) {
    const entity = (await apiFetch(`/api/entities/${playlistId}`));
    if (json) {
        jsonOut(true, entity);
        return;
    }
    console.log(`Playlist: ${entity.data?.name || entity.id}`);
    console.log(`  ID:      ${entity.id}`);
    console.log(`  Data:    ${JSON.stringify(entity.data)}`);
}
// ===== Song Commands =====
async function songPlay(songId, json) {
    const entity = (await apiFetch('/api/entities', {
        method: 'POST',
        body: JSON.stringify({
            type: 'musicPlayAction',
            data: { songId, action: 'play', timestamp: Date.now() },
        }),
    }));
    if (json) {
        jsonOut(true, entity);
        return;
    }
    console.log(`Play action recorded: ${entity.id} (song: ${songId})`);
}
// ===== Main =====
const USAGE = 'Usage: music-cli <playlist|song> <command> [args] [--json]\n' +
    'Commands:\n' +
    '  playlist ls [--json]\n' +
    '  playlist get <playlistId> [--json]\n' +
    '  song play --id <songId> [--json]';
async function main() {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        fail(USAGE, false, 2);
    }
    const resource = argv[0];
    const rest = argv.slice(1);
    const { positional, flags, json } = parseArgs(rest);
    // Health check
    const healthy = await healthCheck();
    if (!healthy) {
        fail(`Server not running at ${SERVER_URL}`, json, 1);
    }
    try {
        if (resource === 'playlist') {
            const cmd = positional[0];
            if (cmd === 'ls') {
                await playlistLs(json);
            }
            else if (cmd === 'get') {
                const id = positional[1];
                if (!id)
                    fail('Usage: playlist get <playlistId> [--json]', json, 2);
                await playlistGet(id, json);
            }
            else {
                fail(`Unknown playlist command: ${cmd || '(none)'}\nAvailable: ls, get`, json, 2);
            }
        }
        else if (resource === 'song') {
            const cmd = positional[0];
            if (cmd === 'play') {
                const id = flags['id'];
                if (!id)
                    fail('Usage: song play --id <songId> [--json]', json, 2);
                await songPlay(id, json);
            }
            else {
                fail(`Unknown song command: ${cmd || '(none)'}\nAvailable: play`, json, 2);
            }
        }
        else {
            fail(`Unknown resource: ${resource}\nAvailable: playlist, song`, json, 2);
        }
    }
    catch (err) {
        if (err instanceof ExitSignal)
            throw err;
        const msg = err instanceof Error ? err.message : String(err);
        fail(msg, json, 1);
    }
}
main().catch((err) => {
    if (!(err instanceof ExitSignal)) {
        process.exitCode = 1;
        console.error(err instanceof Error ? err.message : String(err));
    }
});
