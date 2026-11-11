// Rappels Mes chats : traitements à faire et stocks bientôt épuisés, envoyés en notification Web Push.
// Appel horaire par pg_cron (en-tête x-cron), ou appel « test » depuis l'app (JWT de l'utilisateur).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string; user_id: string };

// Date et heure locales d'un fuseau
function local(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const TYPES: Record<string, string> = { vermifuge: "Vermifuge", antiparasitaire: "Antiparasitaire", vaccin: "Vaccin", medicament: "Médicament", soin: "Soin", entretien: "Entretien", rdv: "RDV vétérinaire", autre: "Traitement" };
const MOTIFS: Record<string, string> = { controle: "Contrôle", vaccin: "Vaccin", puce: "Puçage", sterilisation: "Stérilisation", maladie: "Consultation", dents: "Dents", analyses: "Analyses", autre: "Rendez-vous" };
const fmtH = (h: string | null) => h ? " à " + h.slice(0, 5).replace(":", " h ").replace(/ h 00$/, " h") : "";
const UNITES: Record<string, string> = { kg: "kg", g: "g", sachet: "sachets", boite: "boîtes", unite: "unités", l: "l" };
const fmtQ = (q: number, u: string) => `${(Math.round(q * 10) / 10).toLocaleString("fr-FR")} ${UNITES[u] ?? u}`;

async function send(subs: Sub[], payload: Record<string, unknown>) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 12 * 3600 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_abonnements").delete().eq("endpoint", s.endpoint);
      else console.warn("push", code, (e as Error).message);
    }
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { data: cfg, error: cfgErr } = await sb.rpc("config_serveur");
  if (cfgErr || !cfg) return json({ error: "config" }, 500);
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);

  // --- Mode test : notification à l'utilisateur connecté ---
  if (req.headers.get("x-cron") !== cfg.cron) {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "non autorisé" }, 401);
    const { data: subs } = await sb.from("push_abonnements").select("*").eq("user_id", u.user.id);
    const n = await send(subs ?? [], { title: "Mes chats", body: "Les notifications fonctionnent sur cet appareil 🐾", tag: "test", url: "./" });
    return json({ envoyees: n, appareils: subs?.length ?? 0 });
  }

  // --- Mode horaire ---
  const { data: foyers } = await sb.from("foyers").select("id, fuseau, heure_rappel");
  const bilan: unknown[] = [];
  for (const f of foyers ?? []) {
    const now = local(f.fuseau || "Europe/Paris");
    if (now.hm < String(f.heure_rappel).slice(0, 5)) continue; // pas encore l'heure du rappel du jour

    const { data: membres } = await sb.from("foyer_membres").select("user_id").eq("foyer_id", f.id);
    const ids = (membres ?? []).map((m) => m.user_id);
    if (!ids.length) continue;
    const { data: subs } = await sb.from("push_abonnements").select("*").in("user_id", ids);
    if (!subs?.length) continue;
    const { data: chats } = await sb.from("chats").select("id, nom").eq("foyer_id", f.id);
    const nomChat = Object.fromEntries((chats ?? []).map((c) => [c.id, c.nom]));

    // Traitements dus (aujourd'hui ou en retard), rappel une fois par jour jusqu'à ce qu'ils soient faits
    const { data: tr } = await sb.from("traitements").select("*").eq("foyer_id", f.id).eq("actif", true)
      .not("prochaine_date", "is", null).lte("prochaine_date", addDays(now.date, 1));
    // Soins : le jour J puis chaque jour tant que non fait. RDV véto : la veille et le jour même seulement.
    const dus = (tr ?? []).filter((t) => (!t.derniere_notif || t.derniere_notif < now.date) &&
      (t.type === "rdv" ? t.prochaine_date >= now.date : t.prochaine_date <= now.date));
    for (const t of dus) {
      if (t.type === "rdv") {
        const demain = t.prochaine_date > now.date;
        await send(subs, {
          title: `${nomChat[t.chat_id] ?? "Chat"} · vétérinaire ${demain ? "demain" : "aujourd'hui"}${fmtH(t.heure)}`,
          body: [t.nom || MOTIFS[t.motif] || "Rendez-vous", t.lieu, t.notes].filter(Boolean).join(" — "),
          tag: `rdv-${t.id}`, url: `./#chat/${t.chat_id}`,
        });
        await sb.from("traitements").update({ derniere_notif: now.date }).eq("id", t.id);
        continue;
      }
      const retard = daysBetween(t.prochaine_date, now.date);
      const quand = retard <= 0 ? "aujourd'hui" : retard === 1 ? "en retard d'1 jour" : `en retard de ${retard} jours`;
      await send(subs, {
        title: t.chat_id ? `${nomChat[t.chat_id] ?? "Chat"} · ${TYPES[t.type] ?? "Traitement"}` : `Maison · ${TYPES[t.type] ?? "Entretien"}`,
        body: `${t.nom}${t.dose ? " (" + t.dose + ")" : ""} — ${quand}`,
        tag: `tr-${t.id}`, url: `./#traitement/${t.id}`,
      });
      await sb.from("traitements").update({ derniere_notif: now.date }).eq("id", t.id);
    }

    // Stocks : alerte quand il reste moins que le seuil, répétée tous les 3 jours
    // Produits consommés par jour, ou à chaque tâche d'entretien liée (ex. filtres de fontaine)
    const { data: pr } = await sb.from("produits").select("*").eq("foyer_id", f.id).eq("actif", true);
    const { data: liees } = await sb.from("traitements").select("produit_id, jour_mois, frequence_jours, prochaine_date")
      .eq("foyer_id", f.id).eq("actif", true).not("produit_id", "is", null).not("prochaine_date", "is", null);
    for (const p of pr ?? []) {
      let reste: number, jours: number;
      if (Number(p.conso_jour) > 0) {
        reste = Math.max(0, Number(p.stock_ref) - Number(p.conso_jour) * Math.max(0, daysBetween(p.date_ref, now.date)));
        jours = Math.floor(reste / Number(p.conso_jour));
      } else {
        const t = (liees ?? []).find((x) => x.produit_id === p.id && (x.jour_mois || x.frequence_jours));
        if (!t) continue;
        reste = Math.max(0, Math.floor(Number(p.stock_ref)));
        jours = Math.round(Math.max(0, daysBetween(now.date, t.prochaine_date)) + reste * (t.jour_mois ? 30.44 : t.frequence_jours));
      }
      if (jours > p.seuil_jours) continue;
      if (p.derniere_notif && p.derniere_notif > addDays(now.date, -3)) continue;
      await send(subs, {
        title: jours <= 0 ? `Rupture : ${p.nom}` : `Stock bas : ${p.nom}`,
        body: jours <= 0 ? "Stock estimé épuisé — pense à racheter." : `Il reste environ ${fmtQ(reste, p.unite)}, soit ${jours} jour${jours > 1 ? "s" : ""}.`,
        tag: `st-${p.id}`, url: "./#stocks",
      });
      await sb.from("produits").update({ derniere_notif: now.date }).eq("id", p.id);
    }
    bilan.push({ foyer: f.id, traitements: dus.length });
  }
  return json({ ok: true, bilan });
});
