/*
  Smoke test for Apple sync contract endpoints.

  Usage:
    node tools/apple_sync_smoke_test.js

  Optional env vars:
    TMR_BASE_URL=http://localhost:3002
*/

const { spawn } = require('child_process');

async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  // Fallback for older Node versions
  const mod = await import('node-fetch');
  return mod.default;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServerOnFreePort({ startPort = 3102, maxAttempts = 25 } = {}) {
  const serverCwd = require('path').join(__dirname, '..', 'server');
  let port = Number(startPort);

  for (let attempt = 0; attempt < maxAttempts; attempt++, port++) {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: serverCwd,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let listening = false;
    let exited = false;
    let exitCode = null;

    const onData = (chunk) => {
      const s = String(chunk);
      stdout += s;
      if (s.includes('listening on port') && s.includes(String(port))) {
        listening = true;
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      const s = String(chunk);
      stderr += s;
    });

    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
    });

    // Wait for either "listening" or an early crash.
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12_000) {
      if (listening) {
        return { baseUrl: `http://localhost:${port}`, child };
      }
      if (exited) {
        break;
      }
      await sleep(100);
    }

    // If it didn't start, kill and try next port.
    try { child.kill('SIGTERM'); } catch (_) {}
    await sleep(200);
    try { child.kill('SIGKILL'); } catch (_) {}

    const combined = (stdout + '\n' + stderr).toLowerCase();
    if (!combined.includes('eaddrinuse')) {
      const err = new Error(`Server failed to start on port ${port} (exit ${exitCode}).`);
      err.stdout = stdout;
      err.stderr = stderr;
      throw err;
    }
  }

  throw new Error(`Could not find a free port starting at ${startPort}`);
}

function pickSessionCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  // Take first cookie value only (tmr_session=...)
  const first = String(setCookieHeader).split(/,(?=[^;]+?=)/)[0];
  const tokenPair = first.split(';')[0].trim();
  return tokenPair || null;
}

async function main() {
  const fetchImpl = await getFetch();
  let childServer = null;
  let base = process.env.TMR_BASE_URL || null;

  if (!base) {
    const startPort = process.env.TMR_TEST_PORT ? Number(process.env.TMR_TEST_PORT) : 3102;
    const started = await startServerOnFreePort({ startPort });
    base = started.baseUrl;
    childServer = started.child;
    console.log('started test server at', base);
  }

  const username = 'apple_agent_smoke_' + Date.now();
  const password = 'passw0rd-' + Math.random().toString(16).slice(2) + '!';

  async function postJson(path, body, cookie) {
    const res = await fetchImpl(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return { res, text };
  }

  // Register (or login if username collision occurs)
  let cookie = null;
  {
    const { res, text } = await postJson('/auth/register', { username, password });
    if (res.status === 409) {
      const login = await postJson('/auth/login', { username, password });
      cookie = pickSessionCookie(login.res.headers.get('set-cookie'));
      if (!cookie) throw new Error('Login did not set a session cookie');
      console.log('login', login.res.status, login.text);
    } else {
      cookie = pickSessionCookie(res.headers.get('set-cookie'));
      if (!cookie) throw new Error('Register did not set a session cookie');
      console.log('register', res.status, text);
    }
  }

  // Status
  {
    const res = await fetchImpl(base + '/sync/apple/status', { headers: { Cookie: cookie } });
    const text = await res.text();
    console.log('status', res.status, text);
  }

  // Retrieve bearer token for native-agent style auth
  let bearerToken = null;
  {
    const res = await fetchImpl(base + '/auth/token', { headers: { Cookie: cookie } });
    const json = await res.json().catch(() => null);
    bearerToken = json && json.token ? String(json.token) : null;
    console.log('authToken', res.status, bearerToken ? 'ok' : 'missing');
    if (!bearerToken) throw new Error('Failed to retrieve bearer token from /auth/token');
  }

  const authz = { Authorization: `Bearer ${bearerToken}` };

  // Register a device token (recommended auth for iOS agents)
  let deviceToken = null;
  {
    const res = await fetchImpl(base + '/sync/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authz },
      body: JSON.stringify({ label: 'smoke-test-device' })
    });
    const json = await res.json().catch(() => null);
    deviceToken = json && json.deviceToken ? String(json.deviceToken) : null;
    console.log('deviceRegister', res.status, deviceToken ? 'ok' : 'missing');
    if (!deviceToken) throw new Error('Failed to register device token');
  }

  const deviceAuthz = { Authorization: `Device ${deviceToken}` };

  const now = Date.now();
  const externalId = 'CALITEM_' + now;

  // Upsert
  {
    const upsertBody = {
      sourceDevice: 'smoke-test',
      events: [
        {
          externalId,
          externalCalendarId: 'CAL_1',
          title: 'Apple Upsert Smoke',
          date: '2026-01-19',
          startTime: '11:00',
          endTime: '11:30',
          syncState: 'linked',
          lastSyncedAt: now
        }
      ]
    };

    const res = await fetchImpl(base + '/sync/apple/events/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...deviceAuthz },
      body: JSON.stringify(upsertBody)
    });
    const text = await res.text();
    console.log('upsert', res.status, text);
  }

  // Pull changes
  {
    const res = await fetchImpl(base + `/sync/apple/events/changes?since=0&includeDeleted=1`, { headers: deviceAuthz });
    const json = await res.json();
    const events = Array.isArray(json.events) ? json.events : [];
    const found = events.find((e) => String(e.externalId || '') === String(externalId));
    console.log('changes', res.status, 'found', Boolean(found));
  }

  // Pull server changes (provider-agnostic)
  {
    const res = await fetchImpl(base + `/sync/events/changes?since=0&includeDeleted=1`, { headers: deviceAuthz });
    const json = await res.json();
    const events = Array.isArray(json.events) ? json.events : [];
    const found = events.find((e) => String(e.externalId || '') === String(externalId));
    console.log('syncChangesAll', res.status, 'found', Boolean(found));
  }

  // Verify it round-trips through /events
  {
    const res = await fetchImpl(base + '/events', { headers: deviceAuthz });
    const json = await res.json();
    const events = Array.isArray(json.events) ? json.events : [];
    const found = events.find((e) => String(e.externalId || '') === String(externalId));

    console.log(
      'events',
      res.status,
      'found',
      Boolean(found),
      found
        ? {
            id: found.id,
            provider: found.provider,
            externalId: found.externalId,
            externalCalendarId: found.externalCalendarId,
            syncState: found.syncState,
            lastSyncedAt: found.lastSyncedAt,
            sourceDevice: found.sourceDevice
          }
        : null
    );

    if (!found) process.exitCode = 2;
  }

  // Conflict test: update server event, then attempt stale Apple upsert.
  {
    const evRes = await fetchImpl(base + '/events', { headers: deviceAuthz });
    const evJson = await evRes.json();
    const evEvents = Array.isArray(evJson.events) ? evJson.events : [];
    const found = evEvents.find((e) => String(e.externalId || '') === String(externalId));
    if (!found || !found.id) throw new Error('Missing server event id for conflict test');

    const newTitle = 'Server Edited Title';
    const updateBody = {
      event: {
        title: newTitle,
        date: found.date,
        startTime: found.startTime || null,
        endTime: found.endTime || null,
        description: found.description || '',
        reminderMinutes: found.reminderMinutes || 0,
        reminderAt: found.reminderAt || null,
        syncId: found.syncId || null,
        provider: found.provider || null,
        externalId: found.externalId || null,
        externalCalendarId: found.externalCalendarId || null,
        syncState: found.syncState || null,
        lastSyncedAt: found.lastSyncedAt || null,
        externalUpdatedAt: found.externalUpdatedAt || null,
        sourceDevice: 'server-edit',
        deletedAt: found.deletedAt || null
      }
    };

    const putRes = await fetchImpl(base + `/events/${found.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...deviceAuthz },
      body: JSON.stringify(updateBody)
    });
    console.log('serverUpdate', putRes.status, await putRes.text());

    // Attempt stale Apple upsert (old externalUpdatedAt)
    const staleUpsert = {
      sourceDevice: 'smoke-test',
      events: [
        {
          externalId,
          externalCalendarId: 'CAL_1',
          title: 'Apple Old Title',
          date: '2026-01-19',
          startTime: '11:00',
          endTime: '11:30',
          // Intentionally older than the server edit (we reuse initial now)
          externalUpdatedAt: now
        }
      ]
    };

    const staleRes = await fetchImpl(base + '/sync/apple/events/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...deviceAuthz },
      body: JSON.stringify(staleUpsert)
    });
    const staleText = await staleRes.text();
    console.log('staleUpsert', staleRes.status, staleText);

    const checkRes = await fetchImpl(base + '/events', { headers: deviceAuthz });
    const checkJson = await checkRes.json();
    const checkEvents = Array.isArray(checkJson.events) ? checkJson.events : [];
    const after = checkEvents.find((e) => String(e.externalId || '') === String(externalId));
    console.log('conflictCheck', checkRes.status, after ? after.title : null);
    if (!after || after.title !== newTitle) process.exitCode = 4;
  }

  // Tombstone/delete, then ensure it disappears from /events but stays visible to sync.
  {
    const delBody = {
      sourceDevice: 'smoke-test',
      events: [
        {
          externalId,
          externalCalendarId: 'CAL_1',
          title: 'Apple Upsert Smoke',
          date: '2026-01-19',
          deleted: true
        }
      ]
    };
    const res = await fetchImpl(base + '/sync/apple/events/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...deviceAuthz },
      body: JSON.stringify(delBody)
    });
    const text = await res.text();
    console.log('tombstone', res.status, text);

    const changesRes = await fetchImpl(base + `/sync/apple/events/changes?since=0&includeDeleted=1`, { headers: deviceAuthz });
    const changesJson = await changesRes.json();
    const changesEvents = Array.isArray(changesJson.events) ? changesJson.events : [];
    const tomb = changesEvents.find((e) => String(e.externalId || '') === String(externalId));
    console.log('changesAfterDelete', changesRes.status, 'deletedAt', tomb ? (Number(tomb.deletedAt) || 0) : null);

    const evRes = await fetchImpl(base + '/events', { headers: deviceAuthz });
    const evJson = await evRes.json();
    const evEvents = Array.isArray(evJson.events) ? evJson.events : [];
    const stillVisible = evEvents.some((e) => String(e.externalId || '') === String(externalId));
    console.log('eventsAfterDelete', evRes.status, 'visible', stillVisible);
    if (stillVisible) process.exitCode = 3;
  }

  if (childServer) {
    try { childServer.kill('SIGTERM'); } catch (_) {}
  }
}

main().catch((e) => {
  console.error('smoke test failed:', e);
  process.exitCode = 1;
});
