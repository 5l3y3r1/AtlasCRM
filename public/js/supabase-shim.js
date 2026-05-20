/**
 * supabase-shim.js — drop-in compat layer for `@supabase/supabase-js` v2.
 *
 * Exposes:  window.supabase.createClient(url, key)
 *
 * The returned client supports the subset of the Supabase SDK that the
 * warm.ge frontend uses:
 *
 *   client.auth.signUp({ email, password })
 *   client.auth.signInWithPassword({ email, password })
 *   client.auth.signOut()
 *   client.auth.getSession()
 *
 *   client.from(table)
 *     .select('cols')                 // chainable
 *     .select('cols', { count, head })
 *     .insert(obj | obj[])            // chainable (.select().single())
 *     .update(obj)                    // chainable
 *     .delete()                       // chainable
 *     .eq / neq / gt / gte / lt / lte / like / ilike / is / in
 *     .order(col, { ascending })
 *     .limit(n)
 *     .single()      .maybeSingle()
 *     then-able:     `const { data, error } = await client.from(...).select()`
 *
 *   client.storage.from(bucket).upload(path, file)
 *
 * URL/KEY arguments are accepted for SDK compatibility but ignored — calls
 * always go to /api/* on the same origin.
 */
(function () {
  'use strict';

  const API = '';   // same-origin

  function jsonFetch(path, opts = {}) {
    return fetch(API + path, {
      ...opts,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    }).then(async (r) => {
      const text = await r.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
      if (!r.ok) {
        const err = new Error(body?.error || `HTTP ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return body;
    });
  }

  /* ─── Query builder (thenable) ──────────────────────────────────── */
  class QueryBuilder {
    constructor(table) {
      this.table  = table;
      this.params = new URLSearchParams();
      this._method = 'GET';
      this._body   = null;
      this._single = false;
      this._count  = null;     // 'exact' | null
      this._head   = false;
      this._returnSelect = true; // postgres-style: insert/update return rows
    }

    _filter(op, col, val) {
      if (Array.isArray(val)) {
        this.params.append(col, `${op}.(${val.join(',')})`);
      } else if (val === null) {
        this.params.append(col, `${op}.null`);
      } else {
        this.params.append(col, `${op}.${val}`);
      }
      return this;
    }
    eq(c,v){return this._filter('eq', c, v);}
    neq(c,v){return this._filter('neq', c, v);}
    gt(c,v){return this._filter('gt', c, v);}
    gte(c,v){return this._filter('gte', c, v);}
    lt(c,v){return this._filter('lt', c, v);}
    lte(c,v){return this._filter('lte', c, v);}
    like(c,v){return this._filter('like', c, v);}
    ilike(c,v){return this._filter('ilike', c, v);}
    is(c,v){return this._filter('is', c, v === null ? 'null' : 'notnull');}
    in(c,v){return this._filter('in', c, v);}
    or(expr){ if (expr) this.params.append('or', `(${expr})`); return this; }
    not(col, op, val) {
      // PostgREST syntax: col=not.<op>.<value>
      if (val === null) val = 'null';
      if (Array.isArray(val)) val = `(${val.join(',')})`;
      this.params.append(col, `not.${op}.${val}`);
      return this;
    }
    filter(col, op, val) { return this._filter(op, col, val); }

    order(col, { ascending = true } = {}) {
      const cur = this.params.get('order');
      const piece = `${col}.${ascending ? 'asc' : 'desc'}`;
      this.params.set('order', cur ? `${cur},${piece}` : piece);
      return this;
    }
    limit(n) { this.params.set('limit', String(n)); return this; }
    range(from, to) { this.params.set('offset', String(from)); this.params.set('limit', String(to - from + 1)); return this; }

    select(cols = '*', opts = {}) {
      this.params.set('select', cols);
      if (opts.count === 'exact') {
        this._count = 'exact';
        this.params.set('count', 'exact');
      }
      if (opts.head) {
        this._head = true;
        this.params.set('head', 'true');
      }
      return this;
    }

    insert(rows) {
      this._method = 'POST';
      this._body   = rows;
      return this;
    }
    update(patch) {
      this._method = 'PATCH';
      this._body   = patch;
      return this;
    }
    delete() {
      this._method = 'DELETE';
      return this;
    }

    single()       { this._single = true; return this; }
    maybeSingle()  { this._single = true; this._maybe = true; return this; }

    // Make this object awaitable
    then(resolve, reject) {
      return this._exec().then(resolve, reject);
    }
    catch(rej) { return this._exec().catch(rej); }
    finally(fn){ return this._exec().finally(fn); }

    async _exec() {
      const qs = this.params.toString();
      const path = `/api/data/${this.table}${qs ? '?' + qs : ''}`;
      const opts = { method: this._method };
      if (this._body !== null) opts.body = JSON.stringify(this._body);

      try {
        const { data, count } = await jsonFetch(path, opts);
        let out = data;
        if (this._single) {
          out = Array.isArray(data) ? (data[0] || null) : data;
        }
        return { data: out, error: null, count: count ?? null, status: 200 };
      } catch (e) {
        return { data: null, error: { message: e.message, status: e.status }, count: null, status: e.status || 500 };
      }
    }
  }

  /* ─── Auth ──────────────────────────────────────────────────────── */
  function makeAuth() {
    return {
      async signUp({ email, password, options }) {
        try {
          const meta = (options && options.data) || {};
          const body = { email, password, ...meta };
          const { data } = await jsonFetch('/api/auth/signup', {
            method: 'POST', body: JSON.stringify(body)
          });
          return { data, error: null };
        } catch (e) {
          return { data: null, error: { message: e.message } };
        }
      },
      async signInWithPassword({ email, password }) {
        try {
          const { data } = await jsonFetch('/api/auth/login', {
            method: 'POST', body: JSON.stringify({ email, password })
          });
          return { data, error: null };
        } catch (e) {
          return { data: null, error: { message: e.message } };
        }
      },
      async signOut() {
        try {
          await jsonFetch('/api/auth/logout', { method: 'POST' });
          return { error: null };
        } catch (e) {
          return { error: { message: e.message } };
        }
      },
      async getSession() {
        try {
          const { data } = await jsonFetch('/api/auth/session');
          return { data, error: null };
        } catch (e) {
          return { data: { session: null }, error: { message: e.message } };
        }
      },
      async getUser() {
        try {
          const { data } = await jsonFetch('/api/auth/me');
          return { data: { user: data }, error: null };
        } catch (e) {
          return { data: { user: null }, error: { message: e.message } };
        }
      },
      onAuthStateChange() { /* no-op subscription for SDK compat */
        return { data: { subscription: { unsubscribe(){} } } };
      },
    };
  }

  /* ─── Storage (minimal — uploads files via /api/upload) ─────────── */
  function makeStorage() {
    return {
      from(/* bucket */) {
        return {
          async upload(filePath, file) {
            const fd = new FormData();
            fd.append('files', file, filePath || file.name);
            const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
            const body = await res.json();
            if (!res.ok) return { data: null, error: { message: body.error || 'Upload failed' } };
            const file0 = body.data[0] || null;
            return { data: { path: file0?.url || '' }, error: null };
          },
          getPublicUrl(filePath) {
            return { data: { publicUrl: filePath.startsWith('/uploads/') ? filePath : `/uploads/${filePath}` } };
          },
        };
      },
    };
  }

  /* ─── Client factory ────────────────────────────────────────────── */
  function createClient(/* url, key */) {
    return {
      auth:    makeAuth(),
      storage: makeStorage(),
      from(table) { return new QueryBuilder(table); },
      // RPC isn't used by the current frontend, but stub for safety
      async rpc(/* name, args */) { return { data: null, error: { message: 'rpc not implemented' } }; },
    };
  }

  // Expose under the same global the real SDK uses
  window.supabase = { createClient };
})();
