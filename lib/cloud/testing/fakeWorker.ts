/**
 * An in-memory stand-in for the cloud library worker, as a `fetch` function, for specs. It keeps the behaviour
 * the client depends on: etags that change only with content (like R2's MD5), If-Match conflicts, wrong PIN vs.
 * no library, session tokens (with a switch to expire them all), and missing objects. It skips what the client
 * can't observe: the EID check, throttling, quotas, rate limits. The real worker's own tests cover those.
 */

type Obj = { body: Uint8Array<ArrayBuffer>; etag: string };

export interface FakeWorker {
  fetch: typeof fetch;
  /** Every stored key → object (markers as JSON bodies). */
  store: Map<string, Obj>;
  /** Share objects by key. */
  shares: Map<string, { kind: 'once' | 'multi'; title: string; body: Uint8Array<ArrayBuffer>; created: number; revokeToken: string }>;
  /** Make every issued session token invalid (the client should re-unlock). */
  expireSessions(): void;
  /** Count of requests by "METHOD /path-pattern". */
  calls: Map<string, number>;
}

async function etagOf(body: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
  return Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

function err(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function ok(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

export function fakeWorker(): FakeWorker {
  const store = new Map<string, Obj>();
  const sessions = new Map<string, string>(); // token → marker
  const calls = new Map<string, number>();
  /** Shares, apart from `store` so tests can check they hold nothing about the library. */
  const shares = new Map<string, { kind: 'once' | 'multi'; title: string; body: Uint8Array<ArrayBuffer>; created: number; revokeToken: string }>();

  async function put(key: string, body: Uint8Array<ArrayBuffer>): Promise<Obj> {
    const obj = { body, etag: await etagOf(body) };
    store.set(key, obj);
    return obj;
  }

  function sessionFor(request: Request): string | null {
    const token = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    return token ? (sessions.get(token) ?? null) : null;
  }

  function issue(marker: string): { token: string; expires: number } {
    const token = `fake.${randomHex()}`;
    sessions.set(token, marker);
    return { token, expires: Math.floor(Date.now() / 1000) + 86400 };
  }

  const ifMatch = (r: Request) => (r.headers.get('If-Match') ?? '').replace(/^"(.*)"$/, '$1');

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "v1"
    const route = `${request.method} /${parts.map((p, i) => (i > 0 && /^[0-9a-f]{32}$/.test(p) ? ':id' : p)).join('/')}`;
    calls.set(route, (calls.get(route) ?? 0) + 1);

    if (route === 'GET /marker/:id') {
      const m = store.get(`marker/${parts[1]}`);
      return m ? new Response(m.body, { headers: { 'Content-Type': 'application/json' } }) : err(404, 'no_library');
    }
    if (route === 'POST /library') {
      const form = await request.formData();
      const marker = String(form.get('marker'));
      const main = String(form.get('main'));
      if (store.has(`marker/${marker}`)) {
        if (form.get('replace') !== 'true') return err(409, 'library_exists');
        for (const key of [...store.keys()]) if (key === `marker/${marker}` || key.startsWith(`lib/${marker}/`)) store.delete(key);
      }
      const body = new Uint8Array(await (form.get('body') as Blob).arrayBuffer());
      const obj = await put(`lib/${marker}/${main}`, body);
      await put(`marker/${marker}`, new TextEncoder().encode(String(form.get('settings'))));
      const session = issue(marker);
      return ok({ etag: obj.etag, ...session }, 201);
    }
    if (route === 'POST /unlock') {
      const { marker, main } = (await request.json()) as { marker: string; main: string };
      if (!store.has(`marker/${marker}`)) return err(404, 'no_library');
      const obj = store.get(`lib/${marker}/${main}`);
      if (!obj) return err(404, 'wrong_pin');
      const session = issue(marker);
      return new Response(obj.body, {
        headers: { ETag: `"${obj.etag}"`, 'X-Session-Token': session.token, 'X-Session-Expires': String(session.expires) },
      });
    }

    if (route === 'GET /share/:id' || route === 'POST /share/:id/claim' || route === 'DELETE /share/:id') {
      const key = `share/${parts[1]}`;
      const share = shares.get(key);
      if (!share) return err(404, 'not_found');
      if (request.method === 'GET') return ok({ kind: share.kind, title: share.title, created: share.created, expires: share.created + 30 * 86400_000, size: share.body.length });
      if (request.method === 'DELETE') {
        if (request.headers.get('X-Revoke-Token') !== share.revokeToken) return err(403, 'forbidden');
        shares.delete(key);
        return new Response(null, { status: 204 });
      }
      if (share.kind === 'once') shares.delete(key);
      return new Response(share.body, { headers: { 'X-Share-Kind': share.kind } });
    }

    const marker = sessionFor(request);
    if (route === 'GET /plan/:id') {
      const obj = store.get(`plan/${parts[1]}`);
      return obj ? new Response(obj.body, { headers: { ETag: `"${obj.etag}"` } }) : err(404, 'not_found');
    }
    if (!marker) return err(401, 'unauthorized');

    if (route === 'GET /lib/:id/:id' || route === 'PUT /lib/:id/:id' || route === 'DELETE /lib/:id/:id' || route === 'POST /lib/:id/:id/rekey') {
      if (parts[1] !== marker) return err(403, 'forbidden');
      const key = `lib/${parts[1]}/${parts[2]}`;
      const current = store.get(key);
      if (!current) return err(404, 'not_found');
      if (request.method === 'GET') return new Response(current.body, { headers: { ETag: `"${current.etag}"` } });
      if (request.method === 'DELETE') {
        store.delete(`marker/${marker}`);
        store.delete(key);
        return new Response(null, { status: 204 });
      }
      if (ifMatch(request) !== current.etag) return err(412, 'conflict', { ETag: `"${current.etag}"` });
      if (request.method === 'PUT') {
        const obj = await put(key, new Uint8Array(await request.arrayBuffer()));
        return ok({ etag: obj.etag });
      }
      const form = await request.formData();
      const next = String(form.get('main'));
      const obj = await put(`lib/${marker}/${next}`, new Uint8Array(await (form.get('body') as Blob).arrayBuffer()));
      await put(`marker/${marker}`, new TextEncoder().encode(String(form.get('settings'))));
      store.delete(key);
      return ok({ etag: obj.etag });
    }
    if (route === 'POST /shares') {
      const form = await request.formData();
      const id = randomHex();
      const revokeToken = randomHex();
      const created = Date.now();
      shares.set(`share/${id}`, {
        kind: String(form.get('kind')) as 'once' | 'multi',
        title: String(form.get('title')),
        body: new Uint8Array(await (form.get('body') as Blob).arrayBuffer()),
        created,
        revokeToken,
      });
      return ok({ id, revokeToken, expires: created + 30 * 86400_000 }, 201);
    }
    if (route === 'POST /plans') {
      const id = randomHex();
      const obj = await put(`plan/${id}`, new Uint8Array(await request.arrayBuffer()));
      return ok({ id, etag: obj.etag }, 201);
    }
    if (route === 'PUT /plan/:id' || route === 'DELETE /plan/:id') {
      const key = `plan/${parts[1]}`;
      if (!store.has(key)) return err(404, 'not_found');
      if (request.method === 'DELETE') {
        store.delete(key);
        return new Response(null, { status: 204 });
      }
      return ok({ etag: (await put(key, new Uint8Array(await request.arrayBuffer()))).etag });
    }
    if (route === 'POST /touch') {
      const { ids } = (await request.json()) as { ids: string[] };
      return ok({ touched: 0, missing: ids.filter(id => !store.has(`plan/${id}`)) });
    }
    return err(404, 'not_found');
  }

  return {
    fetch: (input, init) => handle(new Request(input, init)),
    store,
    shares,
    calls,
    expireSessions: () => sessions.clear(),
  };
}
