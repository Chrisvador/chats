/* Mes chats — fiches, photos, pesées, traitements avec rappels, stocks.
   Données dans Supabase (projet mes-chats), partagées par foyer. */
(() => {
'use strict';
const SB_URL = 'https://bqnfsvvaajgrurfozfkv.supabase.co';
const SB_KEY = 'sb_publishable_oepIKCobZddYfW4d2kKMvg_ZFFCX0bo';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'chats-auth' } });
const BUCKET = 'chats';

/* ---------- utilitaires ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsg = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const lss = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const today = () => new Date().toLocaleDateString('sv-SE');
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmtDate = d => { if (!d) return '—'; const [y, m, j] = d.split('-').map(Number); return `${j} ${MOIS[m - 1]} ${y}`; };
const fmtNum = (n, dec = 1) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: dec });
const plur = (n, s, p) => `${n} ${n > 1 ? (p || s + 's') : s}`;
function age(d) {
  if (!d) return null;
  const a = new Date(d + 'T12:00:00'), n = new Date();
  let m = (n.getFullYear() - a.getFullYear()) * 12 + n.getMonth() - a.getMonth(); if (n.getDate() < a.getDate()) m--;
  if (m < 0) return null;
  const y = Math.floor(m / 12), r = m % 12;
  return y ? `${plur(y, 'an')}${r ? ' ' + r + ' mois' : ''}` : `${r} mois`;
}
function relDay(d) {
  const n = daysBetween(today(), d);
  if (n === 0) return "Aujourd'hui"; if (n === 1) return 'Demain'; if (n === -1) return 'Hier';
  if (n < 0) return `En retard de ${plur(-n, 'jour')}`;
  if (n < 7) return `Dans ${plur(n, 'jour')}`;
  return fmtDate(d);
}

const SEXES = { male: 'Mâle', femelle: 'Femelle' };
const VIES = { interieur: 'Intérieur', exterieur: 'Extérieur', mixte: 'Intérieur et extérieur' };
const TYPES = { vermifuge: 'Vermifuge', antiparasitaire: 'Antipuces / tiques', vaccin: 'Vaccin', medicament: 'Médicament', soin: 'Soin', entretien: 'Entretien', autre: 'Autre' };
const FREQS = [[0, 'Une seule fois'], [1, 'Tous les jours'], [7, 'Toutes les semaines'], [14, 'Toutes les 2 semaines'], [30, 'Tous les mois'], [90, 'Tous les 3 mois'], [180, 'Tous les 6 mois'], [365, 'Tous les ans']];
const freqLbl = f => { if (!f) return 'Une seule fois'; const k = FREQS.find(x => x[0] === f); return k ? k[1] : `Tous les ${f} jours`; };
const freqTxt = t => t.jour_mois ? `Le ${t.jour_mois === 1 ? '1er' : t.jour_mois} de chaque mois` : freqLbl(t.frequence_jours);
const periode = t => t.jour_mois ? 30.44 : (t.frequence_jours || 0);
// Prochaine échéance après un soin fait le jour « done »
function nextDate(t, done) {
  if (t.jour_mois) {
    const base = addDays(done, t.prochaine_date ? 10 : 0);   // fait jusqu'à 10 jours en avance : compte pour l'échéance proche
    let [y, m] = base.split('-').map(Number);
    const cand = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${String(t.jour_mois).padStart(2, '0')}`;
    let d = cand(y, m); if (d <= base) { m++; if (m > 12) { m = 1; y++; } d = cand(y, m); }
    return d;
  }
  return t.frequence_jours ? addDays(done, t.frequence_jours) : null;
}
const nextMonthDay = j => nextDate({ jour_mois: j }, addDays(today(), -1));
const CATS = { croquettes: 'Croquettes', patee: 'Pâtée', friandises: 'Friandises', litiere: 'Litière', filtres: 'Filtres', autre: 'Autre' };
const UNITES = { kg: 'kg', sachet: 'sachets', boite: 'boîtes', unite: 'unités', g: 'g', l: 'l' };
const UNITE1 = { kg: 'kg', sachet: 'sachet', boite: 'boîte', unite: 'unité', g: 'g', l: 'l' };
const qty = (q, u) => `${fmtNum(q, u === 'kg' || u === 'l' ? 2 : 1)} ${q > 1 || u === 'kg' || u === 'g' || u === 'l' ? UNITES[u] : UNITE1[u]}`;

const ICON_CAT = '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><path d="M14 12l9 9h18l9-9v22c0 11-8 18-18 18S14 45 14 34z"/><circle cx="25" cy="32" r="2" fill="currentColor"/><circle cx="39" cy="32" r="2" fill="currentColor"/><path d="M29 39l3 2 3-2M20 40l-8 2M20 44l-7 4M44 40l8 2M44 44l7 4"/></svg>';
const I_EDIT = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const I_DEL = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
const I_CLOSE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const I_BACK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg>';

/* ---------- état ---------- */
let me = null, foyer = null, membres = [];
let C = [], W = [], PH = [], TR = [], PR = [], PD = [], MV = [];   // chats, pesées, photos, traitements, prises, produits, mouvements
let view = lsg('mc-view', 'chats'), soinFilter = 'tous', openId = null;
const CACHE = 'mc-cache';

let toastT;
function toast(msg, ms = 2800) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
const fail = e => { console.warn(e); toast((e && e.message) || 'Erreur'); };

/* ---------- photos : URLs signées gardées 6 jours ---------- */
let urls = lsg('mc-urls', {});
const URL_TTL = 7 * 24 * 3600;
async function signAll(paths) {
  const now = Date.now(), need = [...new Set(paths)].filter(p => p && !(urls[p] && urls[p].e > now + 24 * 3600e3));
  for (let i = 0; i < need.length; i += 100) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), URL_TTL);
    if (error) { console.warn(error); continue; }
    data.forEach(d => { if (d.signedUrl) urls[d.path] = { u: d.signedUrl, e: now + (URL_TTL - 3600) * 1e3 }; });
  }
  for (const k in urls) if (urls[k].e < now) delete urls[k];
  lss('mc-urls', urls);
}
const url = p => (p && urls[p] ? urls[p].u : '');
const thumb = p => p ? p.replace(/\.jpg$/, '_t.jpg') : '';
const photosOf = id => PH.filter(p => p.chat_id === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const mainPhoto = c => { const ps = photosOf(c.id); return ps.find(p => p.id === c.photo_principale) || ps[0] || null; };
const avatar = c => { const p = c && mainPhoto(c), u = p && url(thumb(p.chemin)); return u ? `<img src="${esc(u)}" alt="">` : esc((c?.nom || '?').slice(0, 1).toUpperCase()); };

/* ---------- calculs ---------- */
const chatNom = id => (C.find(c => c.id === id) || {}).nom || '—';
const sujet = t => t.chat_id ? chatNom(t.chat_id) : 'Maison';
const I_HOME = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3c3 4 6 7.5 6 11a6 6 0 01-12 0c0-3.5 3-7 6-11z"/><path d="M9 15a3 3 0 003 3"/></svg>';
const pesees = id => W.filter(w => w.chat_id === id).sort((a, b) => a.date.localeCompare(b.date));
const poids = id => { const p = pesees(id); return p.length ? p[p.length - 1] : null; };
const trActifs = () => TR.filter(t => t.actif);
const etat = t => { if (!t.prochaine_date) return 'none'; const n = daysBetween(today(), t.prochaine_date); return n < 0 ? 'late' : n === 0 ? 'today' : n <= 7 ? 'soon' : 'later'; };
const dus = () => trActifs().filter(t => t.prochaine_date && t.prochaine_date <= today());
const tacheLiee = p => trActifs().find(t => t.produit_id === p.id && periode(t) && t.prochaine_date);
function stockEst(p) { return Math.max(0, Number(p.stock_ref) - Number(p.conso_jour) * Math.max(0, daysBetween(p.date_ref, today()))); }
function joursRestants(p) {
  if (Number(p.conso_jour) > 0) return Math.floor(stockEst(p) / Number(p.conso_jour));
  const t = tacheLiee(p); if (!t) return null;
  const s = Math.floor(Number(p.stock_ref)), avant = Math.max(0, daysBetween(today(), t.prochaine_date));
  return Math.round(avant + Math.max(0, s) * periode(t));   // rupture au changement suivant le dernier en stock
}
const stockAlerte = p => { const j = joursRestants(p); return j !== null && j <= p.seuil_jours; };

/* ---------- données ---------- */
function saveCache() { lss(CACHE, { uid: me && me.id, foyer, membres, C, W, PH, TR, PR, PD, MV }); }
async function load() {
  const q = (t, o, asc = true) => sb.from(t).select('*').order(o, { ascending: asc });
  const r = await Promise.all([q('chats', 'nom'), q('pesees', 'date'), q('chat_photos', 'date', false), q('traitements', 'prochaine_date'),
    sb.from('prises').select('*').order('date', { ascending: false }).limit(300), q('produits', 'nom'), q('mouvements', 'date', false),
    sb.from('foyer_membres').select('*')]);
  const err = r.find(x => x.error);
  if (err) { console.warn(err.error); if (!C.length) toast('Chargement impossible : ' + err.error.message); return; }
  [C, W, PH, TR, PR, PD, MV, membres] = r.map(x => x.data);
  saveCache();
  await signAll(C.map(c => thumb(mainPhoto(c)?.chemin)));
  render();
  if (openId && sheetKind === 'chat') renderChat(true);
}

/* ---------- rendu principal ---------- */
function setView(v) {
  view = v; lss('mc-view', v);
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  $('vChats').hidden = v !== 'chats'; $('vSoins').hidden = v !== 'soins'; $('vStocks').hidden = v !== 'stocks';
  $('title').textContent = { chats: 'Mes chats', soins: 'Soins', stocks: 'Stocks' }[v];
  $('addLbl').textContent = { chats: 'Chat', soins: 'Ajouter', stocks: 'Produit' }[v];
  render(); window.scrollTo(0, 0);
}
function render() {
  if (!foyer) return;
  $('sub').textContent = foyer.nom;
  const nd = dus().length, ns = PD.filter(p => p.actif && stockAlerte(p)).length;
  $('dotSoins').hidden = !nd; $('dotSoins').textContent = nd;
  $('dotStocks').hidden = !ns; $('dotStocks').textContent = ns;
  if (view === 'chats') renderChats(); else if (view === 'soins') renderSoins(); else renderStocks();
}

function renderChats() {
  const list = C.filter(c => !c.decede).concat(C.filter(c => c.decede));
  if (!list.length) { $('vChats').innerHTML = `<div class="empty">${ICON_CAT}<p>Aucun chat pour l'instant.<br>Ajoutez le premier avec le bouton <b>Chat</b>.</p></div>`; return; }
  $('vChats').innerHTML = `<div class="grid">${list.map(c => {
    const p = mainPhoto(c), u = p && url(thumb(p.chemin)), w = poids(c.id);
    const t = trActifs().filter(x => x.chat_id === c.id), late = t.filter(x => ['late', 'today'].includes(etat(x))).length, soon = t.filter(x => etat(x) === 'soon').length;
    const bits = [age(c.date_naissance), w && fmtNum(w.poids_kg, 2) + ' kg'].filter(Boolean).join(' · ');
    return `<button class="card" data-id="${c.id}"><div class="ph">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : ICON_CAT}
      <div class="badges">${late ? `<span class="badge red">${plur(late, 'soin')} à faire</span>` : soon ? `<span class="badge amber">Soin cette semaine</span>` : ''}${c.decede ? '<span class="badge amber">Parti</span>' : ''}</div></div>
      <div class="body"><h3>${esc(c.nom)}</h3><div class="meta">${esc(bits || [VIES[c.mode_vie], c.race].filter(Boolean).join(' · ') || ' ')}</div></div></button>`;
  }).join('')}</div>`;
  $('vChats').querySelectorAll('.card').forEach(b => b.onclick = () => openChat(b.dataset.id));
}

function trItem(t, withChat = true) {
  const c = C.find(x => x.id === t.chat_id), e = etat(t), maison = !t.chat_id;
  const when = t.prochaine_date ? `<div class="when ${e === 'late' || e === 'today' ? 'late' : e === 'soon' ? 'soon' : ''}">${esc(relDay(t.prochaine_date))}</div>` : '';
  const btn = t.actif ? `<button class="btn sm ${e === 'late' || e === 'today' ? 'ok' : ''}" data-fait="${t.id}">Fait</button>` : '';
  return `<div class="item clic" data-tr="${t.id}">${withChat ? `<div class="av">${maison ? I_HOME : avatar(c)}</div>` : `<span class="tag ${t.type}">${esc(TYPES[t.type])}</span>`}
    <div><div class="t">${withChat && !maison ? esc(c?.nom || '—') + ' · ' : ''}${esc(t.nom)}${t.dose ? ` <span class="s">(${esc(t.dose)})</span>` : ''}</div>
    <div class="s">${withChat ? `<span class="tag ${t.type}">${esc(TYPES[t.type])}</span> ` : ''}${esc(freqTxt(t))}</div>${when}</div>${btn}</div>`;
}
function bindTr(root) {
  root.querySelectorAll('[data-fait]').forEach(b => b.onclick = e => { e.stopPropagation(); faitForm(TR.find(t => t.id === b.dataset.fait)); });
  root.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => trForm(TR.find(t => t.id === b.dataset.tr)));
}

function renderSoins() {
  const vivants = C.filter(c => !c.decede);
  const aMaison = TR.some(t => !t.chat_id);
  if (soinFilter !== 'tous' && !(soinFilter === 'maison' && aMaison) && !C.some(c => c.id === soinFilter)) soinFilter = 'tous';
  const keep = t => soinFilter === 'tous' || (soinFilter === 'maison' ? !t.chat_id : t.chat_id === soinFilter);
  const filtres = [['tous', 'Tous']].concat(vivants.map(c => [c.id, c.nom]), aMaison ? [['maison', 'Maison']] : []);
  const act = trActifs().filter(keep).sort((a, b) => (a.prochaine_date || '9999').localeCompare(b.prochaine_date || '9999'));
  const g = { late: [], today: [], soon: [], later: [], none: [] }; act.forEach(t => g[etat(t)].push(t));
  const sec = (k, titre) => g[k].length ? `<div class="group">${titre}</div><div class="list">${g[k].map(t => trItem(t)).join('')}</div>` : '';
  const hist = PR.filter(keep).slice(0, 15);
  const fini = TR.filter(t => !t.actif).filter(keep).slice(0, 20);
  $('vSoins').innerHTML = `${filtres.length > 2 ? `<div class="seg" role="group" aria-label="Filtrer">${filtres.map(([id, n]) => `<button data-sf="${id}" aria-pressed="${soinFilter === id}">${esc(n)}</button>`).join('')}</div>` : ''}
    ${act.length ? sec('late', 'En retard') + sec('today', "Aujourd'hui") + sec('soon', '7 prochains jours') + sec('later', 'Plus tard') + sec('none', 'Sans date prévue')
      : `<div class="empty" style="margin-top:14px">${C.length ? 'Rien de prévu.<br>Ajoutez vermifuge, antipuces, vaccins ou entretien de la fontaine avec le bouton <b>Ajouter</b>.' : "Ajoutez d'abord vos chats."}</div>`}
    ${hist.length ? `<div class="group">Derniers soins faits</div><div class="box"><ul class="hist">${hist.map(p => { const t = TR.find(x => x.id === p.traitement_id); const m = membres.find(x => x.user_id === p.fait_par);
      return `<li><span class="d">${esc(fmtDate(p.date))}</span><span class="x"><b style="color:var(--fg)">${esc(p.chat_id ? chatNom(p.chat_id) : 'Maison')}</b> · ${esc(t ? t.nom : 'Traitement')}${m && m.prenom ? ' · ' + esc(m.prenom) : ''}${p.notes ? ' — ' + esc(p.notes) : ''}</span><button class="iconbtn" data-delp="${p.id}" aria-label="Supprimer">${I_DEL}</button></li>`; }).join('')}</ul></div>` : ''}
    ${fini.length ? `<details><summary class="group" style="cursor:pointer">Traitements terminés (${fini.length})</summary><div class="list">${fini.map(t => trItem(t)).join('')}</div></details>` : ''}`;
  $('vSoins').querySelectorAll('[data-sf]').forEach(b => b.onclick = () => { soinFilter = b.dataset.sf; renderSoins(); });
  $('vSoins').querySelectorAll('[data-delp]').forEach(b => b.onclick = () => delPrise(b.dataset.delp));
  bindTr($('vSoins'));
}

function renderStocks() {
  const act = PD.filter(p => p.actif).sort((a, b) => (joursRestants(a) ?? 1e9) - (joursRestants(b) ?? 1e9));
  const off = PD.filter(p => !p.actif);
  const card = p => {
    const est = stockEst(p), j = joursRestants(p), lvl = j === null ? '' : j <= Math.max(1, p.seuil_jours / 2) ? 'red' : j <= p.seuil_jours ? 'amber' : '';
    const pct = j !== null ? Math.min(100, j / (Math.max(1, p.seuil_jours) * 4) * 100) : Number(p.stock_ref) > 0 ? Math.min(100, est / Number(p.stock_ref) * 100) : 0;
    const lie = tacheLiee(p);
    const consoTxt = lie && !(Number(p.conso_jour) > 0) ? `1 ${UNITE1[p.unite]} · ${freqTxt(lie).toLowerCase()}` : Number(p.conso_jour) > 0 ? (p.unite === 'kg' ? `${fmtNum(p.conso_jour * 1000, 0)} g/jour` : `${fmtNum(p.conso_jour, 2)} ${Number(p.conso_jour) > 1 ? UNITES[p.unite] : UNITE1[p.unite]}/jour`) : 'Conso. non renseignée';
    return `<div class="stock" data-p="${p.id}"><div class="stock-h"><h3>${esc(p.nom)}</h3><span class="tag">${esc(CATS[p.categorie])}</span></div>
      <div class="gauge ${lvl}"><i style="width:${pct.toFixed(0)}%"></i></div>
      <div class="stock-n"><span>Reste <b>${esc(qty(est, p.unite))}</b></span>${j !== null ? `<span><b style="color:${lvl ? `var(--${lvl})` : 'inherit'}">${j <= 0 ? 'Épuisé' : plur(j, 'jour')}</b>${j > 0 ? ` · jusqu'au ${esc(fmtDate(addDays(today(), j)))}` : ''}</span>` : ''}<span>${esc(consoTxt)}</span></div>
      <div class="acts"><button class="btn sm pri" data-achat="${p.id}">+ Achat</button><button class="btn sm" data-inv="${p.id}">Inventaire</button><span style="flex:1"></span><button class="iconbtn" data-editp="${p.id}" aria-label="Modifier">${I_EDIT}</button></div></div>`;
  };
  const achats = MV.filter(m => m.type === 'achat').slice(0, 10);
  $('vStocks').innerHTML = act.length ? `<div class="list">${act.map(card).join('')}</div>
    ${achats.length ? `<div class="group">Derniers achats</div><div class="box"><ul class="hist">${achats.map(m => { const p = PD.find(x => x.id === m.produit_id);
      return `<li><span class="d">${esc(fmtDate(m.date))}</span><span class="x"><b style="color:var(--fg)">${esc(p ? p.nom : '—')}</b> · ${esc(p ? qty(m.quantite, p.unite) : m.quantite)}${m.prix_eur ? ' · ' + fmtNum(m.prix_eur, 2) + ' €' : ''}</span></li>`; }).join('')}</ul></div>` : ''}
    ${off.length ? `<details><summary class="group" style="cursor:pointer">Produits archivés (${off.length})</summary><div class="list">${off.map(card).join('')}</div></details>` : ''}`
    : `<div class="empty">Aucun produit suivi.<br>Ajoutez croquettes et pâtée avec le bouton <b>Produit</b> : stock actuel et consommation par jour suffisent pour prévoir la rupture.</div>`;
  $('vStocks').querySelectorAll('[data-achat]').forEach(b => b.onclick = () => achatForm(PD.find(p => p.id === b.dataset.achat)));
  $('vStocks').querySelectorAll('[data-inv]').forEach(b => b.onclick = () => invForm(PD.find(p => p.id === b.dataset.inv)));
  $('vStocks').querySelectorAll('[data-editp]').forEach(b => b.onclick = () => produitForm(PD.find(p => p.id === b.dataset.editp)));
}

/* ---------- panneau générique ---------- */
let sheetKind = null;
function openSheet(title, body, { back = null, actions = '', kind = 'form' } = {}) {
  const s = $('sheet'); sheetKind = kind;
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="panel-head">
    ${back ? `<button class="iconbtn" id="shBack" aria-label="Retour">${I_BACK}</button>` : ''}<h2>${esc(title)}</h2>${actions}
    <button class="iconbtn" id="shClose" aria-label="Fermer">${I_CLOSE}</button></div><div class="panel-body">${body}</div></div>`;
  s.hidden = false; document.body.style.overflow = 'hidden';
  $('shClose').onclick = closeSheet;
  if (back) $('shBack').onclick = back;
  s.onclick = e => { if (e.target === s) closeSheet(); };
  const first = s.querySelector('input:not([type=hidden]),select,textarea'); if (first && matchMedia('(min-width:760px)').matches) first.focus();
}
function closeSheet() { sheetKind = null; $('sheet').hidden = true; $('sheet').innerHTML = ''; document.body.style.overflow = ''; openId = null; if (/^#(chat|traitement)\//.test(location.hash)) history.replaceState(null, '', location.pathname); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('viewer').hidden) closeViewer(); else if (!$('sheet').hidden) closeSheet(); } });
const backToChat = id => () => openChat(id);
const val = id => { const v = $(id).value.trim(); return v === '' ? null : v; };

/* ---------- fiche chat ---------- */
function openChat(id) { openId = id; history.replaceState(null, '', '#chat/' + id); renderChat(); const c = C.find(x => x.id === id); if (c) signAll(photosOf(id).flatMap(p => [p.chemin, thumb(p.chemin)])).then(() => { if (openId === id && sheetKind === 'chat') renderChat(true); }); }
function renderChat(keepScroll) {
  const c = C.find(x => x.id === openId); if (!c) { closeSheet(); return; }
  const panel = $('sheet').querySelector('.panel'), sc = keepScroll && panel ? panel.scrollTop : 0;
  const p = mainPhoto(c), u = p && (url(p.chemin) || url(thumb(p.chemin))), w = poids(c.id), ps = photosOf(c.id);
  const fact = (k, v) => v ? `<div class="fact"><span>${k}</span><strong>${esc(v)}</strong></div>` : '';
  const tr = trActifs().filter(t => t.chat_id === c.id).sort((a, b) => (a.prochaine_date || '9999').localeCompare(b.prochaine_date || '9999'));
  const hist = PR.filter(x => x.chat_id === c.id).slice(0, 10);
  const notes = [['Santé', c.sante], ['Alimentation', c.alimentation], ['Caractère', c.caractere], ['Notes', c.notes]].filter(x => x[1]);
  openSheet(c.nom, `
    <div class="hero">${u ? `<img src="${esc(u)}" alt="${esc(c.nom)}" data-view="${p.id}">` : ICON_CAT}</div>
    <div class="facts">
      ${fact('Âge', [age(c.date_naissance), c.date_naissance && `${c.naissance_estimee ? 'vers ' : 'né' + (c.sexe === 'femelle' ? 'e' : '') + ' le '}${fmtDate(c.date_naissance)}`].filter(Boolean).join(' · '))}
      ${fact('Poids', w && `${fmtNum(w.poids_kg, 2)} kg (${fmtDate(w.date)})`)}
      ${fact('Sexe', c.sexe && SEXES[c.sexe] + (c.sterilise ? (c.sexe === 'femelle' ? ', stérilisée' : ', castré') : ''))}
      ${fact('Race', c.race)}${fact('Robe', c.robe)}${fact('Yeux', c.yeux)}
      ${fact('Mode de vie', VIES[c.mode_vie])}
      ${fact('Arrivée', [c.date_arrivee && fmtDate(c.date_arrivee), c.provenance].filter(Boolean).join(' · '))}
      ${fact('Puce', c.puce)}${fact('Tatouage', c.tatouage)}
      ${fact('Stérilisation', c.date_sterilisation && fmtDate(c.date_sterilisation))}
      ${fact('Vétérinaire', c.veterinaire)}${fact('Assurance', c.assurance)}
    </div>
    <div class="section-title"><h3>Traitements</h3><button class="btn sm" id="addTr">+ Traitement</button></div>
    ${tr.length ? `<div class="list">${tr.map(t => trItem(t, false)).join('')}</div>` : '<p class="status">Aucun traitement en cours.</p>'}
    ${hist.length ? `<div class="box" style="margin-top:10px"><ul class="hist">${hist.map(h => { const t = TR.find(x => x.id === h.traitement_id); return `<li><span class="d">${esc(fmtDate(h.date))}</span><span class="x">${esc(t ? t.nom : '—')}${h.notes ? ' — ' + esc(h.notes) : ''}</span></li>`; }).join('')}</ul></div>` : ''}
    <div class="section-title"><h3>Poids</h3><button class="btn sm" id="addW">+ Pesée</button></div>
    ${weightChart(c.id)}
    <div class="section-title"><h3>Photos</h3><label class="btn sm" style="cursor:pointer">+ Photos<input type="file" id="addPh" accept="image/*" multiple hidden></label></div>
    <p class="status" id="upStatus"></p>
    ${ps.length ? `<div class="gallery">${ps.map(x => `<button data-view="${x.id}" aria-label="Photo du ${esc(fmtDate(x.date))}">${url(thumb(x.chemin)) ? `<img src="${esc(url(thumb(x.chemin)))}" alt="" loading="lazy">` : ''}${x.id === (p && p.id) ? '<span class="star">★</span>' : ''}</button>`).join('')}</div>` : '<p class="status">Pas encore de photo.</p>'}
    ${notes.length ? `<div class="section-title"><h3>Infos</h3></div>${notes.map(([k, v]) => `<div class="notes"><b>${k}</b>${esc(v)}</div>`).join('')}` : ''}
  `, { kind: 'chat', actions: `<button class="btn sm" id="editChat">${I_EDIT}<span>Modifier</span></button>` });
  const pn = $('sheet').querySelector('.panel'); if (sc) pn.scrollTop = sc;
  $('editChat').onclick = () => chatForm(c);
  $('addTr').onclick = () => trForm(null, c.id, backToChat(c.id));
  $('addW').onclick = () => peseeForm(c.id);
  $('addPh').onchange = e => { if (e.target.files.length) uploadPhotos(c.id, e.target.files); };
  pn.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openViewer(b.dataset.view));
  pn.querySelectorAll('[data-delw]').forEach(b => b.onclick = () => delPesee(b.dataset.delw));
  bindTr(pn);
  pn.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => trForm(TR.find(t => t.id === b.dataset.tr), c.id, backToChat(c.id)));
  pn.querySelectorAll('[data-fait]').forEach(b => b.onclick = e => { e.stopPropagation(); faitForm(TR.find(t => t.id === b.dataset.fait), backToChat(c.id)); });
}
function weightChart(id) {
  const p = pesees(id); if (!p.length) return '<p class="status">Aucune pesée.</p>';
  let svg = '';
  if (p.length > 1) {
    const W0 = 600, H0 = 150, pad = 22, t0 = Date.parse(p[0].date), t1 = Date.parse(p[p.length - 1].date) || t0 + 1;
    const vs = p.map(x => +x.poids_kg), lo = Math.min(...vs) - .2, hi = Math.max(...vs) + .2;
    const X = d => pad + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * (W0 - 2 * pad), Y = v => H0 - pad - (v - lo) / (hi - lo) * (H0 - 2 * pad);
    const pts = p.map(x => `${X(x.date).toFixed(1)},${Y(+x.poids_kg).toFixed(1)}`).join(' ');
    svg = `<svg viewBox="0 0 ${W0} ${H0}" preserveAspectRatio="none" role="img" aria-label="Évolution du poids">
      <polyline points="${pts}" fill="none" stroke="var(--acc)" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      ${p.map(x => `<circle cx="${X(x.date).toFixed(1)}" cy="${Y(+x.poids_kg).toFixed(1)}" r="4" fill="var(--acc)"/>`).join('')}</svg>
      <div class="status" style="display:flex;justify-content:space-between"><span>${esc(fmtDate(p[0].date))}</span><span>${fmtNum(Math.min(...vs), 2)}–${fmtNum(Math.max(...vs), 2)} kg</span><span>${esc(fmtDate(p[p.length - 1].date))}</span></div>`;
  }
  return `<div class="chart">${svg}<ul class="hist">${p.slice().reverse().slice(0, 6).map(x => `<li><span class="d">${esc(fmtDate(x.date))}</span><span class="x"><b style="color:var(--fg)">${fmtNum(x.poids_kg, 2)} kg</b></span><button class="iconbtn" data-delw="${x.id}" aria-label="Supprimer la pesée">${I_DEL}</button></li>`).join('')}</ul></div>`;
}

/* ---------- formulaires : chat ---------- */
function chatForm(c) {
  const n = !c; c = c || {};
  const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${l}</option>`).join('');
  openSheet(n ? 'Nouveau chat' : 'Modifier ' + c.nom, `<form class="f" id="fc">
    <label class="field"><span>Nom *</span><input id="c_nom" required value="${esc(c.nom)}"></label>
    <div class="row2"><label class="field"><span>Sexe</span><select id="c_sexe"><option value="">—</option>${opt(SEXES, c.sexe)}</select></label>
      <label class="field"><span>Mode de vie</span><select id="c_vie"><option value="">—</option>${opt(VIES, c.mode_vie)}</select></label></div>
    <div class="row2"><label class="field"><span>Date de naissance</span><input type="date" id="c_nais" value="${esc(c.date_naissance)}"></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="c_est"${c.naissance_estimee ? ' checked' : ''}>Date estimée</label></div>
    <div class="row2"><label class="field"><span>Race</span><input id="c_race" value="${esc(c.race)}" placeholder="Européen…"></label>
      <label class="field"><span>Robe</span><input id="c_robe" value="${esc(c.robe)}" placeholder="Tigré roux…"></label></div>
    <div class="row2"><label class="field"><span>Yeux</span><input id="c_yeux" value="${esc(c.yeux)}"></label>
      <label class="field"><span>Poids actuel (kg)</span><input id="c_poids" type="number" step="0.01" min="0.1" max="25" inputmode="decimal" placeholder="${esc(poids(c.id)?.poids_kg ?? '')}"><small>Ajoute une pesée datée d'aujourd'hui</small></label></div>
    <div class="row2"><label class="check"><input type="checkbox" id="c_ster"${c.sterilise ? ' checked' : ''}>Stérilisé(e)</label>
      <label class="field"><span>Date de stérilisation</span><input type="date" id="c_dster" value="${esc(c.date_sterilisation)}"></label></div>
    <div class="row2"><label class="field"><span>N° de puce</span><input id="c_puce" inputmode="numeric" value="${esc(c.puce)}"></label>
      <label class="field"><span>Tatouage</span><input id="c_tat" value="${esc(c.tatouage)}"></label></div>
    <div class="row2"><label class="field"><span>Arrivé(e) le</span><input type="date" id="c_arr" value="${esc(c.date_arrivee)}"></label>
      <label class="field"><span>Provenance</span><input id="c_prov" value="${esc(c.provenance)}" placeholder="Refuge, éleveur, voisin…"></label></div>
    <div class="row2"><label class="field"><span>Vétérinaire</span><input id="c_veto" value="${esc(c.veterinaire)}"></label>
      <label class="field"><span>Assurance</span><input id="c_ass" value="${esc(c.assurance)}"></label></div>
    <label class="field"><span>Santé (allergies, antécédents)</span><textarea id="c_sante">${esc(c.sante)}</textarea></label>
    <label class="field"><span>Alimentation</span><textarea id="c_alim">${esc(c.alimentation)}</textarea></label>
    <label class="field"><span>Caractère</span><textarea id="c_car">${esc(c.caractere)}</textarea></label>
    <label class="field"><span>Notes</span><textarea id="c_notes">${esc(c.notes)}</textarea></label>
    ${n ? '' : `<label class="check"><input type="checkbox" id="c_dec"${c.decede ? ' checked' : ''}>Parti (garder la fiche en souvenir)</label>`}
    <p class="err" id="c_err"></p>
    <div class="foot">${n ? '' : `<button type="button" class="btn danger" id="c_del">${I_DEL}Supprimer</button>`}<span class="spacer"></span><button class="btn pri" type="submit">Enregistrer</button></div>
  </form>`, { back: n ? null : backToChat(c.id) });
  if (!n) $('c_del').onclick = () => delChat(c);
  $('fc').onsubmit = async e => {
    e.preventDefault();
    const row = { nom: val('c_nom'), sexe: val('c_sexe'), mode_vie: val('c_vie'), date_naissance: val('c_nais'), naissance_estimee: $('c_est').checked,
      race: val('c_race'), robe: val('c_robe'), yeux: val('c_yeux'), sterilise: $('c_ster').checked, date_sterilisation: val('c_dster'),
      puce: val('c_puce'), tatouage: val('c_tat'), date_arrivee: val('c_arr'), provenance: val('c_prov'), veterinaire: val('c_veto'), assurance: val('c_ass'),
      sante: val('c_sante'), alimentation: val('c_alim'), caractere: val('c_car'), notes: val('c_notes') };
    if (!n) row.decede = $('c_dec').checked;
    const pw = parseFloat(String($('c_poids').value).replace(',', '.'));
    try {
      let r;
      if (n) r = await sb.from('chats').insert({ ...row, foyer_id: foyer.id }).select().single();
      else r = await sb.from('chats').update(row).eq('id', c.id).select().single();
      if (r.error) throw r.error;
      const saved = r.data; C = C.filter(x => x.id !== saved.id).concat(saved).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
      if (pw > 0) { const w = await sb.from('pesees').insert({ foyer_id: foyer.id, chat_id: saved.id, date: today(), poids_kg: pw }).select().single(); if (!w.error) W.push(w.data); }
      saveCache(); render(); openChat(saved.id); toast(n ? `${saved.nom} ajouté` : 'Fiche enregistrée');
    } catch (err) { $('c_err').textContent = err.message; }
  };
}
async function delChat(c) {
  if (!confirm(`Supprimer définitivement la fiche de ${c.nom}, ses photos, pesées et traitements ?\n\nPour garder un souvenir, cochez plutôt « Parti ».`)) return;
  const paths = photosOf(c.id).flatMap(p => [p.chemin, thumb(p.chemin)]);
  const { error } = await sb.from('chats').delete().eq('id', c.id); if (error) return fail(error);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  C = C.filter(x => x.id !== c.id); PH = PH.filter(x => x.chat_id !== c.id); W = W.filter(x => x.chat_id !== c.id); TR = TR.filter(x => x.chat_id !== c.id); PR = PR.filter(x => x.chat_id !== c.id);
  saveCache(); closeSheet(); render(); toast('Fiche supprimée');
}

/* ---------- pesées ---------- */
function peseeForm(chatId) {
  openSheet('Pesée · ' + chatNom(chatId), `<form class="f" id="fw">
    <div class="row2"><label class="field"><span>Date</span><input type="date" id="w_d" value="${today()}" required></label>
    <label class="field"><span>Poids (kg)</span><input id="w_p" type="number" step="0.01" min="0.1" max="25" inputmode="decimal" required></label></div>
    <p class="err" id="w_err"></p><div class="foot"><button class="btn pri" type="submit">Enregistrer</button></div></form>`, { back: backToChat(chatId) });
  $('fw').onsubmit = async e => {
    e.preventDefault();
    const r = await sb.from('pesees').insert({ foyer_id: foyer.id, chat_id: chatId, date: $('w_d').value, poids_kg: parseFloat($('w_p').value.replace(',', '.')) }).select().single();
    if (r.error) { $('w_err').textContent = r.error.message; return; }
    W.push(r.data); saveCache(); render(); openChat(chatId);
  };
}
async function delPesee(id) {
  const w = W.find(x => x.id === id); if (!w || !confirm(`Supprimer la pesée du ${fmtDate(w.date)} ?`)) return;
  const { error } = await sb.from('pesees').delete().eq('id', id); if (error) return fail(error);
  W = W.filter(x => x.id !== id); saveCache(); render(); renderChat(true);
}

/* ---------- traitements ---------- */
function trForm(t, chatId, back) {
  const n = !t;
  if (!t) t = chatId === 'maison' || !C.some(c => !c.decede)
    ? { chat_id: null, type: 'entretien', jour_mois: 1, prochaine_date: nextMonthDay(1), actif: true }
    : { chat_id: chatId || C.filter(c => !c.decede)[0].id, type: 'vermifuge', frequence_jours: 90, prochaine_date: today(), actif: true };
  const custom = !t.jour_mois && t.frequence_jours && !FREQS.some(f => f[0] === t.frequence_jours);
  const fsel = t.jour_mois ? 'm' : custom ? 'x' : String(t.frequence_jours || 0);
  const ofThis = PR.filter(p => p.traitement_id === t.id).slice(0, 8);
  openSheet(n ? 'Nouveau soin ou entretien' : t.nom, `<form class="f" id="ft">
    <div class="row2"><label class="field"><span>Pour</span><select id="t_chat"><option value=""${t.chat_id ? '' : ' selected'}>Maison (fontaine, litière…)</option>${C.filter(c => !c.decede || c.id === t.chat_id).map(c => `<option value="${c.id}"${c.id === t.chat_id ? ' selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></label>
      <label class="field"><span>Type</span><select id="t_type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}"${t.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="field"><span>Produit / intitulé *</span><input id="t_nom" required value="${esc(t.nom)}" placeholder="Ex. Milbemax, Typhus-Coryza, Fontaine — filtre…"></label>
    <label class="field"><span>Dose / détail</span><input id="t_dose" value="${esc(t.dose)}" placeholder="Ex. 1 comprimé, 1 pipette 0,5 ml"></label>
    <div class="row2"><label class="field"><span>Fréquence</span><select id="t_freq">${FREQS.map(([d, l]) => `<option value="${d}"${fsel === String(d) ? ' selected' : ''}>${l}</option>`).join('')}<option value="m"${fsel === 'm' ? ' selected' : ''}>Chaque mois, à jour fixe</option><option value="x"${fsel === 'x' ? ' selected' : ''}>Autre…</option></select></label>
      <label class="field" id="t_jF"${fsel === 'x' ? '' : ' hidden'}><span>Tous les … jours</span><input id="t_j" type="number" min="1" max="1000" value="${custom ? t.frequence_jours : ''}"></label>
      <label class="field" id="t_mF"${fsel === 'm' ? '' : ' hidden'}><span>Le … du mois</span><select id="t_m">${Array.from({ length: 28 }, (_, i) => i + 1).map(j => `<option value="${j}"${(t.jour_mois || 1) === j ? ' selected' : ''}>${j === 1 ? '1er' : j}</option>`).join('')}</select></label></div>
    <label class="field"><span>Consomme du stock</span><select id="t_prod"><option value="">Non</option>${PD.filter(p => p.actif || p.id === t.produit_id).map(p => `<option value="${p.id}"${p.id === t.produit_id ? ' selected' : ''}>1 ${esc(UNITE1[p.unite])} de « ${esc(p.nom)} »</option>`).join('')}</select><small>Ex. un filtre de fontaine : retiré du stock à chaque fois que c'est marqué fait.</small></label>
    <label class="field"><span>Prochaine date</span><input type="date" id="t_next" value="${esc(t.prochaine_date)}"><small>Un rappel est envoyé ce jour-là à l'heure réglée pour le foyer, puis chaque jour tant que ce n'est pas marqué fait.</small></label>
    <label class="field"><span>Notes</span><textarea id="t_notes">${esc(t.notes)}</textarea></label>
    ${n ? '' : `<label class="check"><input type="checkbox" id="t_act"${t.actif ? ' checked' : ''}>Traitement en cours (décocher pour l'arrêter)</label>`}
    <p class="err" id="t_err"></p>
    <div class="foot">${n ? '' : `<button type="button" class="btn danger" id="t_del">${I_DEL}Supprimer</button>`}<span class="spacer"></span>
      ${!n && t.actif ? '<button type="button" class="btn ok" id="t_fait">Marquer fait</button>' : ''}<button class="btn pri" type="submit">Enregistrer</button></div>
    ${ofThis.length ? `<div class="group">Historique</div><div class="box"><ul class="hist">${ofThis.map(p => `<li><span class="d">${esc(fmtDate(p.date))}</span><span class="x">${esc(p.notes || '')}</span></li>`).join('')}</ul></div>` : ''}
  </form>`, { back });
  $('t_freq').onchange = () => { const v = $('t_freq').value; $('t_jF').hidden = v !== 'x'; $('t_mF').hidden = v !== 'm';
    if (v === 'm' && n) $('t_next').value = nextMonthDay(+$('t_m').value); };
  $('t_m').onchange = () => { $('t_next').value = nextMonthDay(+$('t_m').value); };
  $('t_chat').onchange = () => { if (!$('t_chat').value) $('t_type').value = 'entretien'; else if ($('t_type').value === 'entretien') $('t_type').value = 'vermifuge'; };
  if (!n) { $('t_del').onclick = () => delTr(t, back); const f = $('t_fait'); if (f) f.onclick = () => faitForm(t, back); }
  $('ft').onsubmit = async e => {
    e.preventDefault();
    const fv = $('t_freq').value, freq = fv === 'x' ? parseInt($('t_j').value, 10) || null : fv === 'm' ? null : parseInt(fv, 10) || null;
    const row = { chat_id: $('t_chat').value || null, jour_mois: fv === 'm' ? +$('t_m').value : null, produit_id: $('t_prod').value || null, type: $('t_type').value, nom: val('t_nom'), dose: val('t_dose'), frequence_jours: freq, prochaine_date: val('t_next'), notes: val('t_notes'), derniere_notif: null };
    if (!n) row.actif = $('t_act').checked;
    const r = n ? await sb.from('traitements').insert({ ...row, foyer_id: foyer.id }).select().single() : await sb.from('traitements').update(row).eq('id', t.id).select().single();
    if (r.error) { $('t_err').textContent = r.error.message; return; }
    TR = TR.filter(x => x.id !== r.data.id).concat(r.data); saveCache(); render();
    if (back) back(); else closeSheet();
    toast('Enregistré');
  };
}
async function delTr(t, back) {
  if (!confirm(`Supprimer « ${t.nom} » et son historique ?`)) return;
  const { error } = await sb.from('traitements').delete().eq('id', t.id); if (error) return fail(error);
  TR = TR.filter(x => x.id !== t.id); PR = PR.filter(x => x.traitement_id !== t.id); saveCache(); render(); if (back) back(); else closeSheet();
}
function faitForm(t, back) {
  if (!t) return;
  const prod = t.produit_id && PD.find(p => p.id === t.produit_id);
  openSheet(t.chat_id ? `${chatNom(t.chat_id)} · ${t.nom}` : t.nom, `<form class="f" id="fp">
    <label class="field"><span>Fait le</span><input type="date" id="p_d" value="${today()}" max="${today()}" required></label>
    <label class="field"><span>Remarque</span><input id="p_n" placeholder="Facultatif"></label>
    <p class="status" id="p_info"></p><p class="err" id="p_err"></p>
    <div class="foot"><button class="btn ok" type="submit">Valider</button></div></form>`, { back });
  const info = () => { const nx = nextDate(t, $('p_d').value || today());
    $('p_info').textContent = (nx ? `Prochaine fois : ${fmtDate(nx)}` : 'Ponctuel : il sera marqué terminé.') + (prod ? ` · 1 ${UNITE1[prod.unite]} retiré de « ${prod.nom} » (reste ${fmtNum(Math.max(0, stockEst(prod) - 1), 1)}).` : ''); };
  $('p_d').oninput = info; info();
  $('fp').onsubmit = async e => {
    e.preventDefault();
    const d = $('p_d').value;
    const r = await sb.from('prises').insert({ foyer_id: foyer.id, traitement_id: t.id, chat_id: t.chat_id, date: d, fait_par: me.id, notes: val('p_n') }).select().single();
    if (r.error) { $('p_err').textContent = r.error.message; return; }
    const nx = nextDate(t, d);
    const upd = nx ? { prochaine_date: nx, derniere_notif: null } : { actif: false, prochaine_date: null, derniere_notif: null };
    const u = await sb.from('traitements').update(upd).eq('id', t.id).select().single();
    if (u.error) { $('p_err').textContent = u.error.message; return; }
    PR.unshift(r.data); TR = TR.map(x => x.id === t.id ? u.data : x);
    if (prod && !(Number(prod.conso_jour) > 0)) {
      const s = await sb.from('produits').update({ stock_ref: +Math.max(0, stockEst(prod) - 1).toFixed(2), date_ref: today(), derniere_notif: null }).eq('id', prod.id).select().single();
      if (!s.error) PD = PD.map(x => x.id === prod.id ? s.data : x);
    }
    saveCache(); render();
    if (back) back(); else closeSheet();
    toast('Noté ✓');
  };
}
async function delPrise(id) {
  const p = PR.find(x => x.id === id); if (!p || !confirm(`Supprimer ce soin du ${fmtDate(p.date)} de l'historique ?\n(La prochaine date du traitement n'est pas modifiée.)`)) return;
  const { error } = await sb.from('prises').delete().eq('id', id); if (error) return fail(error);
  PR = PR.filter(x => x.id !== id); saveCache(); render();
}

/* ---------- stocks ---------- */
function produitForm(p) {
  const n = !p; p = p || { categorie: 'croquettes', unite: 'kg', seuil_jours: 7, conso_jour: 0, stock_ref: 0, actif: true };
  const cj = u => u === 'kg' ? Math.round(Number(p.conso_jour) * 1000) : Number(p.conso_jour);
  openSheet(n ? 'Nouveau produit' : p.nom, `<form class="f" id="fd">
    <label class="field"><span>Nom *</span><input id="d_nom" required value="${esc(p.nom)}" placeholder="Ex. Croquettes Royal Canin Indoor"></label>
    <div class="row2"><label class="field"><span>Catégorie</span><select id="d_cat">${Object.entries(CATS).map(([k, l]) => `<option value="${k}"${p.categorie === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Compté en</span><select id="d_un">${['kg', 'sachet', 'boite', 'unite'].map(k => `<option value="${k}"${p.unite === k ? ' selected' : ''}>${UNITES[k]}</option>`).join('')}</select></label></div>
    <div class="row2"><label class="field"><span id="d_stL">Stock actuel</span><input id="d_st" type="number" step="0.01" min="0" inputmode="decimal" required value="${n ? '' : fmtNum(stockEst(p), 2).replace(/\s/g, '').replace(',', '.')}"></label>
      <label class="field"><span id="d_cjL">Consommation par jour</span><input id="d_cj" type="number" step="any" min="0" inputmode="decimal" value="${n ? '' : cj(p.unite)}"><small id="d_cjH"></small></label></div>
    <label class="field"><span>Alerte quand il reste moins de … jours</span><input id="d_seuil" type="number" min="1" max="90" value="${p.seuil_jours}"></label>
    <label class="field"><span>Où l'acheter</span><input id="d_four" value="${esc(p.fournisseur)}" placeholder="Magasin, site…"></label>
    <label class="field"><span>Notes</span><textarea id="d_notes">${esc(p.notes)}</textarea></label>
    ${n ? '' : `<label class="check"><input type="checkbox" id="d_act"${p.actif ? ' checked' : ''}>Produit suivi (décocher pour l'archiver)</label>`}
    <p class="err" id="d_err"></p>
    <div class="foot">${n ? '' : `<button type="button" class="btn danger" id="d_del">${I_DEL}Supprimer</button>`}<span class="spacer"></span><button class="btn pri" type="submit">Enregistrer</button></div></form>`);
  const lab = () => { const u = $('d_un').value;
    $('d_stL').textContent = `Stock actuel (${UNITES[u]})`;
    $('d_cjL').textContent = u === 'kg' ? 'Consommation par jour (g)' : `Consommation par jour (${UNITES[u]})`;
    $('d_cjH').textContent = u === 'kg' ? 'Total pour tous les chats, ex. 3 chats × 50 g = 150 g' : 'Ex. 3 chats × 1 sachet = 3, ou 1,5 boîte'; };
  $('d_un').onchange = lab; lab();
  $('d_cat').onchange = () => { if ($('d_cat').value !== 'filtres') return; $('d_un').value = 'unite'; lab();
    $('d_cjH').textContent = "Laissez vide : liez plutôt ce produit à la tâche d'entretien (Soins → la tâche → « Consomme du stock »).";
    if (n) $('d_seuil').value = 40; };
  if (!n) $('d_del').onclick = async () => { if (!confirm(`Supprimer « ${p.nom} » et ses achats ?`)) return;
    const { error } = await sb.from('produits').delete().eq('id', p.id); if (error) return fail(error);
    PD = PD.filter(x => x.id !== p.id); MV = MV.filter(x => x.produit_id !== p.id); saveCache(); closeSheet(); render(); };
  $('fd').onsubmit = async e => {
    e.preventDefault();
    const u = $('d_un').value, num = id => parseFloat(String($(id).value).replace(',', '.')) || 0;
    const row = { nom: val('d_nom'), categorie: $('d_cat').value, unite: u, stock_ref: num('d_st'), date_ref: today(),
      conso_jour: u === 'kg' ? num('d_cj') / 1000 : num('d_cj'), seuil_jours: parseInt($('d_seuil').value, 10) || 7, fournisseur: val('d_four'), notes: val('d_notes'), derniere_notif: null };
    if (!n) row.actif = $('d_act').checked;
    const r = n ? await sb.from('produits').insert({ ...row, foyer_id: foyer.id }).select().single() : await sb.from('produits').update(row).eq('id', p.id).select().single();
    if (r.error) { $('d_err').textContent = r.error.message; return; }
    PD = PD.filter(x => x.id !== r.data.id).concat(r.data); saveCache(); closeSheet(); render(); toast('Produit enregistré');
  };
}
function achatForm(p) {
  openSheet('Achat · ' + p.nom, `<form class="f" id="fa">
    <div class="row2"><label class="field"><span>Quantité achetée (${UNITES[p.unite]})</span><input id="a_q" type="number" step="0.01" min="0.01" inputmode="decimal" required></label>
      <label class="field"><span>Prix total (€)</span><input id="a_px" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Facultatif"></label></div>
    <label class="field"><span>Date</span><input type="date" id="a_d" value="${today()}" max="${today()}"></label>
    <p class="status">Stock estimé avant achat : ${esc(qty(stockEst(p), p.unite))}</p><p class="err" id="a_err"></p>
    <div class="foot"><button class="btn pri" type="submit">Ajouter au stock</button></div></form>`);
  $('fa').onsubmit = async e => {
    e.preventDefault();
    const q = parseFloat($('a_q').value.replace(',', '.')), px = parseFloat(String($('a_px').value).replace(',', '.')) || null;
    const m = await sb.from('mouvements').insert({ foyer_id: foyer.id, produit_id: p.id, type: 'achat', quantite: q, prix_eur: px, date: $('a_d').value || today() }).select().single();
    if (m.error) { $('a_err').textContent = m.error.message; return; }
    const r = await sb.from('produits').update({ stock_ref: +(stockEst(p) + q).toFixed(2), date_ref: today(), derniere_notif: null }).eq('id', p.id).select().single();
    if (r.error) { $('a_err').textContent = r.error.message; return; }
    MV.unshift(m.data); PD = PD.map(x => x.id === p.id ? r.data : x); saveCache(); closeSheet(); render(); toast('Stock mis à jour');
  };
}
function invForm(p) {
  const days = daysBetween(p.date_ref, today()), est = stockEst(p);
  openSheet('Inventaire · ' + p.nom, `<form class="f" id="fi">
    <p class="status">Le stock estimé est de ${esc(qty(est, p.unite))}. Saisissez ce qu'il reste vraiment : l'estimation repart de là.</p>
    <label class="field"><span>Stock réel (${UNITES[p.unite]})</span><input id="i_q" type="number" step="0.01" min="0" inputmode="decimal" required></label>
    <label class="check" id="i_recF" hidden><input type="checkbox" id="i_rec"><span id="i_recT"></span></label>
    <p class="err" id="i_err"></p><div class="foot"><button class="btn pri" type="submit">Enregistrer</button></div></form>`);
  let reel = null;
  $('i_q').oninput = () => {
    const q = parseFloat($('i_q').value.replace(',', '.'));
    reel = days >= 3 && q >= 0 && q < Number(p.stock_ref) ? (Number(p.stock_ref) - q) / days : null;
    $('i_recF').hidden = reel === null;
    if (reel !== null) $('i_recT').textContent = `Consommation constatée : ${p.unite === 'kg' ? fmtNum(reel * 1000, 0) + ' g' : fmtNum(reel, 2) + ' ' + UNITE1[p.unite]}/jour sur ${days} jours — l'utiliser`;
  };
  $('fi').onsubmit = async e => {
    e.preventDefault();
    const q = parseFloat($('i_q').value.replace(',', '.'));
    const upd = { stock_ref: q, date_ref: today(), derniere_notif: null }; if (reel !== null && $('i_rec').checked) upd.conso_jour = +reel.toFixed(3);
    const r = await sb.from('produits').update(upd).eq('id', p.id).select().single();
    if (r.error) { $('i_err').textContent = r.error.message; return; }
    await sb.from('mouvements').insert({ foyer_id: foyer.id, produit_id: p.id, type: 'inventaire', quantite: q });
    PD = PD.map(x => x.id === p.id ? r.data : x); saveCache(); closeSheet(); render(); toast('Inventaire enregistré');
  };
}

/* ---------- photos ---------- */
async function toJpeg(src, max, q) {
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Conversion impossible')), 'image/jpeg', q));
}
async function uploadPhotos(chatId, files) {
  const list = [...files]; let ok = 0; const say = m => { const s = $('upStatus'); if (s) s.textContent = m; };
  for (const f of list) {
    say(`Envoi des photos… ${ok + 1}/${list.length}`);
    try {
      const id = uuid(), path = `${foyer.id}/${chatId}/${id}.jpg`, st = sb.storage.from(BUCKET);
      const big = await toJpeg(f, 1600, .82), small = await toJpeg(f, 480, .78);
      let r = await st.upload(path, big, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error;
      r = await st.upload(thumb(path), small, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error;
      const d = f.lastModified ? new Date(f.lastModified).toLocaleDateString('sv-SE') : today();
      const ins = await sb.from('chat_photos').insert({ id, foyer_id: foyer.id, chat_id: chatId, chemin: path, date: d > today() ? today() : d }).select().single();
      if (ins.error) { await st.remove([path, thumb(path)]); throw ins.error; }
      PH.push(ins.data); ok++;
    } catch (e) { fail(e); }
  }
  await signAll(PH.filter(p => p.chat_id === chatId).flatMap(p => [p.chemin, thumb(p.chemin)]));
  saveCache(); say(''); render(); if (openId === chatId && sheetKind === 'chat') renderChat(true);
  if (ok) toast(`${plur(ok, 'photo')} ajoutée${ok > 1 ? 's' : ''}`);
}
let vList = [], vIdx = 0;
function openViewer(id) { const p = PH.find(x => x.id === id); if (!p) return; vList = photosOf(p.chat_id); vIdx = vList.findIndex(x => x.id === id); paintViewer(); }
async function paintViewer() {
  const p = vList[vIdx], c = C.find(x => x.id === p.chat_id), v = $('viewer');
  if (!url(p.chemin)) await signAll([p.chemin]);
  v.innerHTML = `<img src="${esc(url(p.chemin) || url(thumb(p.chemin)))}" alt="">
    <div class="vbar"><span class="cap">${esc(c?.nom)} · ${esc(fmtDate(p.date))} · ${vIdx + 1}/${vList.length}</span>
    ${vList.length > 1 ? '<button class="btn sm" id="vPrev" aria-label="Précédente">‹</button><button class="btn sm" id="vNext" aria-label="Suivante">›</button>' : ''}
    <button class="btn sm" id="vMain">★ Principale</button><button class="btn sm" id="vDel">${I_DEL}</button><button class="btn sm" id="vClose">Fermer</button></div>`;
  v.hidden = false;
  $('vClose').onclick = closeViewer;
  if ($('vPrev')) { $('vPrev').onclick = () => { vIdx = (vIdx - 1 + vList.length) % vList.length; paintViewer(); }; $('vNext').onclick = () => { vIdx = (vIdx + 1) % vList.length; paintViewer(); }; }
  $('vMain').onclick = async () => { const { error } = await sb.from('chats').update({ photo_principale: p.id }).eq('id', p.chat_id); if (error) return fail(error);
    C = C.map(x => x.id === p.chat_id ? { ...x, photo_principale: p.id } : x); saveCache(); render(); toast('Photo principale choisie'); };
  $('vDel').onclick = async () => { if (!confirm('Supprimer cette photo ?')) return;
    const { error } = await sb.from('chat_photos').delete().eq('id', p.id); if (error) return fail(error);
    await sb.storage.from(BUCKET).remove([p.chemin, thumb(p.chemin)]);
    PH = PH.filter(x => x.id !== p.id); saveCache(); closeViewer(); render(); };
  let x0 = null; v.ontouchstart = e => { x0 = e.touches[0].clientX; };
  v.ontouchend = e => { if (x0 === null || vList.length < 2) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) { vIdx = (vIdx + (dx < 0 ? 1 : -1) + vList.length) % vList.length; paintViewer(); } };
}
function closeViewer() { $('viewer').hidden = true; $('viewer').innerHTML = ''; if (openId && sheetKind === 'chat') renderChat(true); }

/* ---------- notifications push ---------- */
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error("Service de l'app pas encore prêt, réessayez dans un instant.")), 4000))]);
async function currentSub() { if (!pushOk()) return null; try { const reg = await swReady(); return await reg.pushManager.getSubscription(); } catch { return null; } }
async function saveSub(sub) {
  const j = sub.toJSON();
  const dev = isIOS ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && !/iPhone/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Ordinateur';
  const { error } = await sb.from('push_abonnements').upsert({ endpoint: j.endpoint, user_id: me.id, p256dh: j.keys.p256dh, auth: j.keys.auth, appareil: dev });
  if (error) throw error;
}
async function enablePush() {
  if (!pushOk()) throw new Error(isIOS && !standalone() ? "Sur iPhone/iPad, ajoutez d'abord l'app à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvrez-la depuis l'icône." : 'Ce navigateur ne gère pas les notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées. Autorisez-les dans les réglages de l\'appareil pour « Mes chats ».');
  const { data: key, error } = await sb.rpc('vapid_public'); if (error || !key) throw error || new Error('Clé de notification introuvable');
  const reg = await swReady();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  await saveSub(sub);
}
async function disablePush() {
  const sub = await currentSub(); if (!sub) return;
  await sb.from('push_abonnements').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe();
}

/* ---------- réglages ---------- */
async function openSettings() {
  const sub = await currentSub().catch(() => null);
  const heures = Array.from({ length: 17 }, (_, i) => i + 6);
  const h = String(foyer.heure_rappel || '08:00').slice(0, 5);
  const moi = membres.find(m => m.user_id === me.id) || {};
  openSheet('Réglages', `
    <div class="box"><h3>Notifications sur cet appareil</h3>
      <p>${sub ? 'Activées : les rappels de soins et les alertes de stock arrivent ici.' : 'Pour recevoir les rappels de soins et les alertes de stock bas.'}
      ${!pushOk() && isIOS && !standalone() ? "<br><b>Sur iPhone/iPad :</b> Partager → « Sur l'écran d'accueil », puis ouvrez l'app depuis l'icône pour activer." : ''}</p>
      <div class="foot" style="justify-content:flex-start">${sub ? '<button class="btn" id="pTest">Envoyer un test</button><button class="btn danger" id="pOff">Désactiver</button>' : '<button class="btn pri" id="pOn">Activer les notifications</button>'}</div>
      <p class="status" id="pSt"></p></div>
    <div class="box"><h3>Heure des rappels</h3><p>Chaque jour à partir de cette heure (heure de Paris).</p>
      <div class="field"><select id="hr">${heures.map(x => { const v = String(x).padStart(2, '0') + ':00'; return `<option value="${v}"${v === h ? ' selected' : ''}>${x} h</option>`; }).join('')}</select></div></div>
    <div class="box"><h3>Foyer</h3>
      <label class="field"><span>Nom du foyer</span><input id="fNom" value="${esc(foyer.nom)}"></label>
      <p style="margin-top:12px">Membres : ${membres.map(m => esc(m.prenom || 'Sans prénom') + (m.user_id === me.id ? ' (vous)' : '')).join(', ')}</p>
      <p>Pour inviter un membre du foyer : il crée son compte dans l'app, choisit « Rejoindre avec un code » et saisit :</p>
      <div class="code">${esc(foyer.code)}</div>
      <div class="foot" style="justify-content:flex-start"><button class="btn" id="fShare">Partager l'invitation</button></div></div>
    <div class="box"><h3>Mon compte</h3>
      <label class="field"><span>Mon prénom</span><input id="mPrenom" value="${esc(moi.prenom)}"></label>
      <p style="margin-top:10px">${esc(me.email)}</p>
      <div class="foot" style="justify-content:flex-start"><button class="btn danger" id="logout">Se déconnecter</button></div></div>`);
  const st = $('pSt');
  if ($('pOn')) $('pOn').onclick = async () => { st.textContent = 'Activation…'; try { await enablePush(); st.textContent = ''; toast('Notifications activées'); openSettings(); } catch (e) { st.textContent = e.message || String(e); } };
  if ($('pOff')) $('pOff').onclick = async () => { await disablePush().catch(fail); openSettings(); };
  if ($('pTest')) $('pTest').onclick = async () => { st.textContent = 'Envoi…';
    const { data, error } = await sb.functions.invoke('rappels', { body: { test: true } });
    st.textContent = error ? 'Échec : ' + error.message : data.envoyees ? `Test envoyé à ${plur(data.envoyees, 'appareil')}.` : 'Aucun appareil joignable, réactivez les notifications.'; };
  $('hr').onchange = async () => { const { error } = await sb.from('foyers').update({ heure_rappel: $('hr').value }).eq('id', foyer.id); if (error) return fail(error); foyer.heure_rappel = $('hr').value; saveCache(); toast('Heure enregistrée'); };
  $('fNom').onchange = async () => { const v = $('fNom').value.trim(); if (!v) return; const { error } = await sb.from('foyers').update({ nom: v }).eq('id', foyer.id); if (error) return fail(error); foyer.nom = v; saveCache(); render(); };
  $('mPrenom').onchange = async () => { const v = $('mPrenom').value.trim() || null; const { error } = await sb.from('foyer_membres').update({ prenom: v }).eq('foyer_id', foyer.id).eq('user_id', me.id); if (error) return fail(error); membres = membres.map(m => m.user_id === me.id ? { ...m, prenom: v } : m); saveCache(); };
  $('fShare').onclick = async () => {
    const txt = `Rejoins le foyer « ${foyer.nom} » dans l'app Mes chats : ${location.origin + location.pathname}\nCrée ton compte puis choisis « Rejoindre avec un code » : ${foyer.code}`;
    try { if (navigator.share) await navigator.share({ title: 'Mes chats', text: txt }); else { await navigator.clipboard.writeText(txt); toast('Invitation copiée'); } } catch {}
  };
  $('logout').onclick = async () => { await disablePush().catch(() => {}); await sb.auth.signOut(); localStorage.removeItem(CACHE); location.reload(); };
}

/* ---------- liens profonds (notifications) ---------- */
function route() {
  const h = location.hash.slice(1);
  if (h === 'stocks') { closeSheet(); setView('stocks'); return; }
  let m = h.match(/^traitement\/(.+)$/);
  if (m) { setView('soins'); const t = TR.find(x => x.id === m[1]); if (t && t.actif) faitForm(t); return; }
  m = h.match(/^chat\/(.+)$/); if (m && C.some(c => c.id === m[1]) && openId !== m[1]) openChat(m[1]);
}
window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.url) { location.hash = e.data.url.split('#')[1] || ''; } });

/* ---------- foyer ---------- */
let onbMode = 'creer';
document.querySelectorAll('#onbForm .seg button').forEach(b => b.onclick = () => {
  onbMode = b.dataset.o; document.querySelectorAll('#onbForm .seg button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('onbNomF').hidden = onbMode !== 'creer'; $('onbCodeF').hidden = onbMode === 'creer';
});
$('onbOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('onbForm').onsubmit = async e => {
  e.preventDefault(); $('onbErr').textContent = ''; $('onbGo').disabled = true;
  try {
    const prenom = $('onbPrenom').value.trim();
    const r = onbMode === 'creer' ? await sb.rpc('creer_foyer', { p_nom: $('onbNom').value.trim(), p_prenom: prenom })
      : await sb.rpc('rejoindre_foyer', { p_code: $('onbCode').value.trim(), p_prenom: prenom });
    if (r.error) throw r.error;
    await enter();
  } catch (err) { $('onbErr').textContent = /Code inconnu/.test(err.message) ? 'Code inconnu : vérifiez-le auprès du membre qui vous invite.' : err.message; }
  finally { $('onbGo').disabled = false; }
};
async function enter() {
  const { data, error } = await sb.from('foyers').select('*').limit(1);
  if (error) { if (foyer) return showApp(); toast('Pas de réseau'); return; }
  if (!data.length) { $('auth').hidden = true; $('app').hidden = true; $('nav').hidden = true; $('onb').hidden = false; return; }
  foyer = data[0]; showApp(); await load(); route();
  currentSub().then(s => s && saveSub(s)).catch(() => {});
}
function showApp() { $('auth').hidden = true; $('onb').hidden = true; $('app').hidden = false; $('nav').hidden = false; setView(view); }

/* ---------- connexion ---------- */
let mode = 'login';
function paintMode() {
  const L = { login: ['Mes chats', 'Se connecter', 'Créer un compte', true], signup: ['Créer un compte', 'Créer le compte', "J'ai déjà un compte", false],
    reset: ['Mot de passe oublié', 'Envoyer le lien', 'Retour', false], newpw: ['Nouveau mot de passe', 'Enregistrer', '', false] }[mode];
  $('authTitle').textContent = L[0]; $('authGo').textContent = L[1]; $('authAlt').textContent = L[2]; $('authAlt').hidden = !L[2];
  $('authForgot').hidden = !L[3]; $('authEmailF').hidden = mode === 'newpw'; $('authPwF').hidden = mode === 'reset';
  $('authPw').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}
function showLogin(m) { $('app').hidden = true; $('nav').hidden = true; $('onb').hidden = true; $('auth').hidden = false; $('authErr').textContent = m || ''; paintMode(); }
$('authAlt').onclick = () => { mode = mode === 'login' ? 'signup' : 'login'; $('authErr').textContent = ''; paintMode(); };
$('authForgot').onclick = () => { mode = 'reset'; $('authErr').textContent = ''; paintMode(); };
$('authForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('authEmail').value.trim().toLowerCase(), pw = $('authPw').value, err = $('authErr'), go = $('authGo');
  err.textContent = ''; go.disabled = true;
  try {
    const back = location.origin + location.pathname;
    if (mode === 'login') { const { error } = await sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error; }
    else if (mode === 'signup') {
      if (pw.length < 8) throw new Error("Choisissez un mot de passe d'au moins 8 caractères.");
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: back } }); if (error) throw error;
      if (!data.session) { mode = 'login'; paintMode(); err.textContent = 'Compte créé. Confirmez via le lien reçu par e-mail, puis connectez-vous.'; }
    } else if (mode === 'reset') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back }); if (error) throw error;
      mode = 'login'; paintMode(); err.textContent = 'E-mail envoyé. Suivez le lien pour choisir un nouveau mot de passe.';
    } else if (mode === 'newpw') {
      if (pw.length < 8) throw new Error('Au moins 8 caractères.');
      const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error;
      mode = 'login'; const { data } = await sb.auth.getSession(); if (data.session) start(data.session);
    }
  } catch (e2) {
    const m = e2 && e2.message || '';
    err.textContent = /invalid login/i.test(m) ? 'E-mail ou mot de passe incorrect.' : /not confirmed/i.test(m) ? 'Adresse pas encore confirmée : ouvrez le lien reçu par e-mail.'
      : /already registered/i.test(m) ? 'Ce compte existe déjà : connectez-vous.' : /rate limit/i.test(m) ? 'Trop de tentatives, réessayez dans quelques minutes.'
      : /fetch|network/i.test(m) ? 'Pas de réseau.' : (m || 'Erreur inattendue.');
  } finally { go.disabled = false; }
};
function start(session) {
  if (me && me.id === session.user.id) return;
  me = session.user;
  const c = lsg(CACHE, null);
  if (c && c.uid === me.id && c.foyer) { ({ foyer, membres = [], C = [], W = [], PH = [], TR = [], PR = [], PD = [], MV = [] } = c); showApp(); }
  enter();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && me && foyer) load(); });
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'PASSWORD_RECOVERY') { mode = 'newpw'; showLogin('Choisissez votre nouveau mot de passe.'); return; }
  if (ev === 'SIGNED_IN' && session) start(session);
});
sb.auth.getSession().then(({ data }) => { if (data.session) start(data.session); else if (mode !== 'newpw') showLogin(); });

/* ---------- navigation ---------- */
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('acctBtn').onclick = openSettings;
$('addBtn').onclick = () => view === 'chats' ? chatForm(null) : view === 'soins' ? trForm(null, soinFilter !== 'tous' ? soinFilter : null) : produitForm(null);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
