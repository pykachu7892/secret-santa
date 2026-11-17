// Stockage : Upstash Redis en ligne (Vercel), mémoire en local pour tester.
import { Redis } from "@upstash/redis";

function redisStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const r = new Redis({ url, token, automaticDeserialization: false });
  return {
    get: (k) => r.get(k),
    set: (k, v, ttl) => r.set(k, v, { ex: ttl }),
    async hgetall(k) {
      // Sans désérialisation automatique, Upstash renvoie une liste à plat [champ, valeur, champ, valeur…].
      const res = await r.hgetall(k);
      if (!res) return null;
      if (Array.isArray(res)) {
        if (!res.length) return null;
        const out = {};
        for (let i = 0; i + 1 < res.length; i += 2) out[String(res[i])] = res[i + 1];
        return out;
      }
      return Object.keys(res).length ? res : null;
    },
    async hset(k, field, v, ttl) { await r.hset(k, { [field]: v }); await r.expire(k, ttl); },
    hdel: (k, field) => r.hdel(k, field),
    async incr(k, ttl) { const n = await r.incr(k); if (n === 1) await r.expire(k, ttl); return n; },
    del: (k) => r.del(k),
  };
}

function memoryStore() {
  const kv = new Map();
  const live = (k) => {
    const e = kv.get(k);
    if (e && e.exp && e.exp < Date.now()) { kv.delete(k); return undefined; }
    return e;
  };
  const exp = (ttl) => (ttl ? Date.now() + ttl * 1000 : 0);
  return {
    _raw: kv,
    async get(k) { const e = live(k); return e ? e.v : null; },
    async set(k, v, ttl) { kv.set(k, { v, exp: exp(ttl) }); },
    async hgetall(k) { const e = live(k); return e ? { ...e.v } : null; },
    async hset(k, f, v, ttl) { const e = live(k) || { v: {} }; e.v[f] = v; e.exp = exp(ttl); kv.set(k, e); },
    async hdel(k, f) { const e = live(k); if (e) delete e.v[f]; },
    async incr(k, ttl) { const e = live(k); const n = (e ? Number(e.v) : 0) + 1; kv.set(k, { v: String(n), exp: e ? e.exp : exp(ttl) }); return n; },
    async del(k) { kv.delete(k); },
  };
}

let cached;
export function getStore() {
  if (cached) return cached;
  const redis = redisStore();
  if (redis) return (cached = redis);
  if (process.env.VERCEL) {
    throw new Error("Base de données manquante : ajoute Upstash Redis au projet Vercel (onglet Storage), puis redéploie.");
  }
  console.warn("[secret-santa] Pas de Redis configuré : stockage en mémoire (test local uniquement).");
  return (cached = memoryStore());
}
