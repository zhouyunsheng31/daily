"use strict";
// memory-cli — 长期记忆操作 Skill
// 通过 fetch 调用服务器 /api/entities?type=memory，无外部依赖
//
// 命令：
//   save --content <text> [--type <type>] [--json]
//   list [--type <type>] [--limit <n>] [--json]
//   update <id> --content <text> [--json]
//   delete <id> [--json]
//   search <query> [--limit <n>] [--json]
// ===== Config =====
const SERVER_URL = process.env.LD_SERVER_URL || 'http://localhost:3456';
const SERVER_TOKEN = process.env.LD_SERVER_TOKEN || process.env.SERVER_TOKEN || '';
const DEVICE_ID = 'memory-cli';
const ENTITY_TYPE = 'memory';
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
// ===== Commands =====
async function memorySave(content, memType, json) {
    const data = { content };
    if (memType)
        data.type = memType;
    const entity = (await apiFetch('/api/entities', {
        method: 'POST',
        body: JSON.stringify({ type: ENTITY_TYPE, data }),
    }));
    if (json) {
        jsonOut(true, entity);
        return;
    }
    console.log(`Saved memory: ${entity.id}`);
    console.log(`  Content: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`);
    if (memType)
        console.log(`  Type:    ${memType}`);
}
async function memoryList(memType, limit, json) {
    const path = `/api/entities?type=${ENTITY_TYPE}&limit=${limit}`;
    const resp = (await apiFetch(path));
    let items = resp.items;
    if (memType) {
        items = items.filter((e) => String(e.data?.type || '') === memType);
    }
    if (json) {
        jsonOut(true, items);
        return;
    }
    if (items.length === 0) {
        console.log('No memories found.');
        return;
    }
    console.log(`Memories (${items.length}):`);
    for (const e of items) {
        const content = String(e.data?.content || '');
        const tag = e.data?.type ? ` [${e.data.type}]` : '';
        console.log(`  ${e.id}${tag}  ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`);
    }
}
async function memoryUpdate(id, content, json) {
    const entity = (await apiFetch(`/api/entities/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { content } }),
    }));
    if (json) {
        jsonOut(true, entity);
        return;
    }
    console.log(`Updated memory: ${entity.id} (version ${entity.version})`);
}
async function memoryDelete(id, json) {
    await apiFetch(`/api/entities/${id}`, { method: 'DELETE' });
    if (json) {
        jsonOut(true, { deleted: true, id });
        return;
    }
    console.log(`Deleted memory: ${id}`);
}
async function memorySearch(query, limit, json) {
    // Server does not expose /api/entities/search; fetch all memories then filter client-side.
    const resp = (await apiFetch(`/api/entities?type=${ENTITY_TYPE}&limit=1000`));
    const q = query.toLowerCase();
    const matches = resp.items.filter((e) => {
        return JSON.stringify(e.data || {}).toLowerCase().includes(q);
    });
    const limited = matches.slice(0, limit);
    if (json) {
        jsonOut(true, limited);
        return;
    }
    if (limited.length === 0) {
        console.log(`No memories matching "${query}".`);
        return;
    }
    console.log(`Search results (${limited.length} of ${matches.length}):`);
    for (const e of limited) {
        const content = String(e.data?.content || '');
        console.log(`  ${e.id}  ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`);
    }
}
// ===== Main =====
async function main() {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        fail('Usage: memory-cli <command> [args] [--json]\n' +
            'Commands:\n' +
            '  save --content <text> [--type <type>] [--json]\n' +
            '  list [--type <type>] [--limit <n>] [--json]\n' +
            '  update <id> --content <text> [--json]\n' +
            '  delete <id> [--json]\n' +
            '  search <query> [--limit <n>] [--json]', false, 2);
    }
    const { positional, flags, json } = parseArgs(argv);
    const cmd = positional[0];
    // Health check
    const healthy = await healthCheck();
    if (!healthy) {
        fail(`Server not running at ${SERVER_URL}`, json, 1);
    }
    try {
        if (cmd === 'save') {
            const content = flags['content'];
            if (!content)
                fail('Usage: save --content <text> [--type <type>] [--json]', json, 2);
            await memorySave(content, flags['type'], json);
        }
        else if (cmd === 'list') {
            const limit = flags['limit'] ? parseInt(flags['limit'], 10) : 50;
            if (isNaN(limit) || limit < 1)
                fail(`Invalid --limit: ${flags['limit']}`, json, 2);
            await memoryList(flags['type'], limit, json);
        }
        else if (cmd === 'update') {
            const id = positional[1];
            const content = flags['content'];
            if (!id || !content)
                fail('Usage: update <id> --content <text> [--json]', json, 2);
            await memoryUpdate(id, content, json);
        }
        else if (cmd === 'delete') {
            const id = positional[1];
            if (!id)
                fail('Usage: delete <id> [--json]', json, 2);
            await memoryDelete(id, json);
        }
        else if (cmd === 'search') {
            const query = positional[1];
            if (!query)
                fail('Usage: search <query> [--limit <n>] [--json]', json, 2);
            const limit = flags['limit'] ? parseInt(flags['limit'], 10) : 50;
            if (isNaN(limit) || limit < 1)
                fail(`Invalid --limit: ${flags['limit']}`, json, 2);
            await memorySearch(query, limit, json);
        }
        else {
            fail(`Unknown command: ${cmd || '(none)'}\nAvailable: save, list, update, delete, search`, json, 2);
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
