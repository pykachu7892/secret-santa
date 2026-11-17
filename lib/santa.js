// Logique du Secret Santa partagé : un groupe = une clé Redis + deux hashes.
import crypto from "node:crypto";

const TTL = 60 * 60 * 24 * 150; // les données s'effacent seules ~5 mois après la dernière écriture
const MAX_PEOPLE = 60;
const MAX_FAILS = 5;            // essais de code avant blocage
const LOCK_SECONDS = 10 * 60;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const rid = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const sameSecret = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeApi(store) {
  const kMeta = (id) => `ss:${id}`;
  const kPeople = (id) => `ss:${id}:p`;
  const kDrawn = (id) => `ss:${id}:v`;
  const kFails = (id, pid) => `ss:${id}:f:${pid}`;

  async function loadMeta(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{6,32}$/.test(id)) throw new HttpError(404, "Ce Secret Santa n’existe pas.");
    const raw = await store.get(kMeta(id));
    if (!raw) throw new HttpError(404, "Ce Secret Santa n’existe pas ou a expiré.");
    return JSON.parse(raw);
  }
  const saveMeta = (m) => store.set(kMeta(m.id), JSON.stringify(m), TTL);

  async function loadPeople(id) {
    const h = (await store.hgetall(kPeople(id))) || {};
    return Object.entries(h)
      .map(([pid, v]) => ({ pid, ...(typeof v === "string" ? JSON.parse(v) : v) }))
      .sort((a, b) => a.at - b.at);
  }

  const isAdmin = (m, key) => typeof key === "string" && key.length > 10 && sameSecret(sha("admin:" + key), m.adminHash);
  function requireAdmin(m, key) { if (!isAdmin(m, key)) throw new HttpError(403, "Seul l’organisateur peut faire ça."); }

  function parseReveal(body) {
    const revealDate = clean(body.revealDate, 10);
    const revealAt = Number(body.revealAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(revealDate) || !Number.isFinite(revealAt)) throw new HttpError(400, "Choisis la date du jour J.");
    return { revealDate, revealAt };
  }

  const actions = {
    async create(body) {
      const name = capitalize(clean(body.name, 40));
      if (!name) throw new HttpError(400, "Donne un nom au groupe.");
      const { revealDate, revealAt } = parseReveal(body);
      const id = rid(6);
      const adminKey = rid(18);
      const meta = {
        id, name, revealDate, revealAt,
        budget: clean(body.budget, 24),
        status: "open",
        adminHash: sha("admin:" + adminKey),
        createdAt: Date.now(),
        pairs: null,
      };
      await saveMeta(meta);
      return { id, adminKey };
    },

    async state(body) {
      const m = await loadMeta(body.id);
      const people = await loadPeople(m.id);
      const drawn = (await store.hgetall(kDrawn(m.id))) || {};
      const now = Date.now();
      const opened = m.status === "closed" && now >= m.revealAt;
      const byId = Object.fromEntries(people.map((p) => [p.pid, p.name]));
      const me = people.find((p) => p.pid === body.pid);
      return {
        id: m.id,
        name: m.name,
        budget: m.budget,
        revealDate: m.revealDate,
        revealAt: m.revealAt,
        status: m.status,
        now,
        isAdmin: isAdmin(m, body.adminKey),
        me: me ? { pid: me.pid, name: me.name } : null,
        people: people.map((p) => ({ pid: p.pid, name: p.name, drawn: !!drawn[p.pid], late: m.status === "closed" && !(m.pairs && m.pairs[p.pid]) })),
        list: opened && m.pairs
          ? people.filter((p) => m.pairs[p.pid]).map((p) => ({ from: p.name, to: byId[m.pairs[p.pid]] || "?" }))
          : null,
      };
    },

    async join(body) {
      const m = await loadMeta(body.id);
      if (m.status !== "open") throw new HttpError(409, "Les inscriptions sont fermées.");
      const name = capitalize(clean(body.name, 24));
      const pin = String(body.pin ?? "");
      if (!name) throw new HttpError(400, "Écris ton prénom.");
      if (!/^\d{4}$/.test(pin)) throw new HttpError(400, "Le code doit faire 4 chiffres.");
      const people = await loadPeople(m.id);
      if (people.length >= MAX_PEOPLE) throw new HttpError(409, `Le groupe est complet (${MAX_PEOPLE} personnes).`);
      if (people.some((p) => fold(p.name) === fold(name))) {
        throw new HttpError(409, `${name} est déjà inscrit. Si ce n’est pas toi, ajoute l’initiale de ton nom, par exemple ${name} L.`);
      }
      const pid = rid(6);
      const salt = rid(8);
      await store.hset(kPeople(m.id), pid, JSON.stringify({ name, salt, pinHash: sha(salt + pin), at: Date.now() }), TTL);
      // Si l'organisateur a fermé pile pendant l'inscription, on annule pour ne laisser personne sans tirage.
      const after = await loadMeta(m.id);
      if (after.status !== "open") {
        await store.hdel(kPeople(m.id), pid);
        throw new HttpError(409, "Les inscriptions viennent d’être fermées.");
      }
      return { pid, name };
    },

    async draw(body) {
      const m = await loadMeta(body.id);
      if (m.status !== "closed" || !m.pairs) throw new HttpError(409, "Le tirage n’a pas encore eu lieu. Attends que l’organisateur ferme les inscriptions.");
      const people = await loadPeople(m.id);
      const me = people.find((p) => p.pid === body.pid);
      if (!me) throw new HttpError(404, "Ce prénom n’est pas dans le groupe.");
      const fails = Number((await store.get(kFails(m.id, me.pid))) || 0);
      if (fails >= MAX_FAILS) throw new HttpError(429, "Trop d’essais ratés. Réessaie dans 10 minutes.");
      const pin = String(body.pin ?? "");
      if (!/^\d{4}$/.test(pin) || !sameSecret(sha(me.salt + pin), me.pinHash)) {
        const n = await store.incr(kFails(m.id, me.pid), LOCK_SECONDS);
        const left = MAX_FAILS - n;
        throw new HttpError(401, left > 0 ? `Code incorrect. Encore ${left} essai${left > 1 ? "s" : ""}.` : "Trop d’essais ratés. Réessaie dans 10 minutes.");
      }
      const toPid = m.pairs[me.pid];
      if (!toPid) throw new HttpError(409, "Tu n’étais pas inscrit au moment du tirage. Demande à l’organisateur de rouvrir les inscriptions.");
      const to = people.find((p) => p.pid === toPid);
      await store.hset(kDrawn(m.id), me.pid, String(Date.now()), TTL);
      return { from: me.name, to: to ? to.name : "?" };
    },

    async close(body) {
      const m = await loadMeta(body.id);
      requireAdmin(m, body.adminKey);
      if (m.status !== "open") throw new HttpError(409, "Le tirage est déjà fait.");
      const people = await loadPeople(m.id);
      if (people.length < 3) throw new HttpError(409, "Il faut au moins 3 inscrits pour tirer au sort.");
      // Une seule grande boucle : personne ne se tire lui-même, et personne ne reste coincé à la fin.
      const order = shuffle(people.map((p) => p.pid));
      const pairs = {};
      order.forEach((pid, i) => { pairs[pid] = order[(i + 1) % order.length]; });
      Object.assign(m, { status: "closed", pairs, closedAt: Date.now() });
      await saveMeta(m);
      return { ok: true };
    },

    async reopen(body) {
      const m = await loadMeta(body.id);
      requireAdmin(m, body.adminKey);
      Object.assign(m, { status: "open", pairs: null, closedAt: null });
      await saveMeta(m);
      await store.del(kDrawn(m.id));
      return { ok: true };
    },

    async remove(body) {
      const m = await loadMeta(body.id);
      requireAdmin(m, body.adminKey);
      if (m.status !== "open") throw new HttpError(409, "Rouvre les inscriptions avant de retirer quelqu’un.");
      await store.hdel(kPeople(m.id), String(body.pid || ""));
      return { ok: true };
    },

    async settings(body) {
      const m = await loadMeta(body.id);
      requireAdmin(m, body.adminKey);
      // La date du jour J se règle seulement avant le tirage : après, la liste reste scellée pour tout le monde.
      if (m.status !== "open") throw new HttpError(409, "Après le tirage, la date du jour J ne peut plus changer.");
      const { revealDate, revealAt } = parseReveal(body);
      Object.assign(m, { revealDate, revealAt, budget: clean(body.budget, 24) });
      await saveMeta(m);
      return { ok: true };
    },
  };

  return async function handle(body) {
    const fn = actions[body && body.action];
    if (!fn) throw new HttpError(400, "Action inconnue.");
    return fn(body);
  };
}
