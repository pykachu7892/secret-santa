import { makeApi, HttpError } from "../lib/santa.js";
import { getStore } from "../lib/store.js";

let api;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée." });
    return;
  }
  try {
    api = api || makeApi(getStore());
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    res.status(200).json(await api(body));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: err.message && err.message.startsWith("Base de données") ? err.message : "Le serveur a eu un souci. Réessaie dans un instant." });
    }
  }
}
