/* SyndicoScope : script de la page.
   Premier jet du 28/10/2026, d'après la spécification de design et d'architecture du même jour (§§ 4 à 8).
   Les données viennent de la page elle-même (#donnees-json, #contours-json) ou, pour l'aperçu, de
   donnees.json et contours.json chargés à côté. Aucune personne n'est nommée, aucune adresse n'est écrite,
   aucun état de mandat n'apparaît sur la carte ni dans une liste. */
(function () {
  "use strict";

  // ---------- Réglages ----------
  const DEPARTEMENTS = { "13": "Bouches-du-Rhône" };
  const PAGE = 25;          // lignes avant « Afficher les … syndics suivants »
  const SEUIL = 10;         // en dessous : « 2 sur 7 », jamais de pourcentage
  const MAX_CARTE = 3;      // syndics en couleur sur la carte
  const MAX_LISTE = 3;      // syndics dans la liste courte
  const PAGE_JUMEAU = 200;  // lignes du tableau jumeau de la carte, par tranche
  const Z95 = 1.959964, Z998 = 3.090232;
  const BENEVOLE = -1, INCONNU = -2, SANS_SIRET = -4, ABSENTE = -9;
  const HORIZON_ANNONCES = 5;   // années : une annonce plus ancienne ne sort que dans la fiche
  const LOIN = 50000;           // mètres : au-delà, un bureau unique se dit « gestion à distance »
  // Les sept devenirs d'une copropriété déclarée chez un syndic au T3 2025. Ils font 100 % des copropriétés
  // suivies, toujours dans cet ordre ; la couleur k est le jeton --dev-k de la feuille de style.
  const DEVENIRS = [
    ["restees", "Toujours chez le même syndic", "toujours déclarées chez ce syndic, y compris dans un autre établissement de la même société"],
    ["groupe", "Société du même groupe", "déclarées chez une autre société du même groupe"],
    ["concurrent", "Autre syndic professionnel", "déclarées chez un syndic professionnel sans lien de groupe avec celui-ci"],
    ["nonPro", "Bénévole ou syndic non identifié", "déclarées avec un syndic bénévole, un syndic professionnel sans numéro d'établissement (SIRET) ou un syndic de type non connu"],
    ["expSans", "Mandat expiré sans successeur déclaré", "mandat arrivé à sa date de fin, sans nouveau mandat déclaré au registre"],
    ["pasMandat", "« Pas de mandat en cours »", "le registre indique « pas de mandat en cours » : aucun syndic n'y est déclaré"],
    ["absente", "Sortie du registre", "la copropriété ne figure plus au registre"],
  ];
  // libellés des codes d'activité (nomenclature d'activités française) les plus fréquents chez les syndics
  const NAF = { "68.32A": "administration d'immeubles et autres biens immobiliers", "68.31Z": "agences immobilières", "68.20A": "location de logements",
    "68.20B": "location de terrains et d'autres biens immobiliers", "68.10Z": "activités des marchands de biens immobiliers", "70.10Z": "activités des sièges sociaux",
    "64.20Z": "activités des sociétés holding" };
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  // Tranches d'effectif du répertoire des entreprises : bornes basse et haute
  const TRANCHES = { "00": [0, 0], "01": [1, 2], "02": [3, 5], "03": [6, 9], "11": [10, 19], "12": [20, 49], "21": [50, 99], "22": [100, 199],
    "31": [200, 249], "32": [250, 499], "41": [500, 999], "42": [1000, 1999], "51": [2000, 4999], "52": [5000, 9999], "53": [10000, null] };
  const URL_REGISTRE = "https://www.data.gouv.fr/fr/datasets/registre-national-dimmatriculation-des-coproprietes/";
  const URL_CARTES_PRO = "https://www.data.gouv.fr/fr/datasets/?q=cartes%20professionnelles%20immobilier"; // [à vérifier] fichier des CCI
  const urlBodacc = (siren) => "https://www.bodacc.fr/explore/dataset/annonces-commerciales/table/?sort=dateparution&q=" + encodeURIComponent(siren);
  const urlAnnuaire = (siren) => "https://annuaire-entreprises.data.gouv.fr/entreprise/" + encodeURIComponent(siren);
  // Retours des utilisateurs : tickets publics du dépôt (formulaires de .github/ISSUE_TEMPLATE/)
  const URL_TICKET = "https://github.com/bthollet/SyndicoScope/issues/new";
  const RETOURS = {
    bogue: { modele: "bogue.yml", titre: "[Bogue] " },
    donnees: { modele: "erreur-de-donnees.yml", titre: "[Données] " },
    idee: { modele: "idee.yml", titre: "[Idée] " },
  };
  const SVG_ALERTE = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M10 5.5v5.5M10 13.8v.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const SVG_COCHE = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SYMB = {
    anneau: '<svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="5" style="fill:var(--map-land);stroke:var(--benevole-ring);stroke-width:2"/></svg>',
    inconnu: '<svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="3.5" style="fill:var(--map-land);stroke:var(--control);stroke-width:1.25"/></svg>',
    losange: '<svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><path d="M11 4 18 11 11 18 4 11Z" style="fill:var(--syn-other);stroke:var(--ink);stroke-width:1.5"/></svg>',
    viseur: '<svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7.5" style="fill:none;stroke:var(--ink);stroke-width:3"/><circle cx="11" cy="11" r="2" style="fill:var(--ink)"/></svg>',
    zone: '<svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><rect x="3" y="5" width="16" height="12" style="fill:var(--map-land);stroke:var(--map-zone);stroke-width:2.5"/></svg>',
    cercle: '<svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8" style="fill:var(--band-998);stroke:var(--accent);stroke-width:2"/></svg>',
  };

  // ---------- Données préparées ----------
  let D = null, G = null, M = null;
  let Z = [], ZC = new Map(), FEATS = [], ENTS = [], ENT_PAR_ANCRE = new Map();
  let N = 0, IMMAT = [], LAT, LON, ZONE, LOTS, PER, SYN, DR, RET, CLASSE, TAILLE, ENT, ENT3, PAR_ZONE = [], TOUTES, INDEX_IMMAT = new Map();
  let B = {}, RE_IMMAT = /^[A-Z]{2}[0-9]{7}$/, T3 = "3e trimestre 2025";
  let carte = null, coucheContours = null, couchePoints = null, coucheBureaux = null, coucheCopro = null, coucheCercle = null;
  let COUL = {}, PTS = new Int32Array(0), XY = new Float32Array(0), cadragePrevu = false, aideMolette = false;
  const cache = new Map();

  // ---------- État de la page ----------
  const etat = {
    mode: "liste", zone: 0, cercle: null, choixCentre: false,
    taille: -1, constr: -1, copro: null, regle: { taille: false, constr: false },
    colonnes: "ensemble", tri: { col: "nom", dir: "asc" }, limite: PAGE, chiffreTel: "devenir",
    couleurs: new Map(), surb: -1, panorama: true,
    vue: "tableau", fiche: null, perimetre: "zone", indicateur: "autre", defilement: 0, retourFoyer: null,
    liste: [], confirmerVider: false, jumeau: PAGE_JUMEAU,
    recherche: "", voirAnciens: false, statutListe: null, notePerimetre: "", carte: false, groupes: false, decisions: 10,
  };

  // ---------- Outils ----------
  const $ = (id) => document.getElementById(id);
  const fEnt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const f1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nb = (n) => fEnt.format(n);
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // accord en français : 0 et 1 au singulier
  function pl(n, un, plusieurs) { return nb(n) + " " + (Math.abs(n) >= 2 ? plusieurs : un); }
  function pct(p, k) {
    if (p == null || !isFinite(p)) return "—";
    const v = 100 * p;
    if (v === 0) return "0 %";
    if (v < 0.05) return "moins de 0,1 %";
    if (v < 9.95) return f1.format(v) + " %";
    return fEnt.format(Math.round(v)) + " %";
  }
  function pctAxe(p) {
    const v = Math.round(p * 1000) / 10;
    return (Number.isInteger(v) ? fEnt.format(v) : f1.format(v)) + " %";
  }
  function txtTaux(k, n) {
    if (!n) return "—";
    if (n < SEUIL) return nb(k) + " sur " + nb(n);
    return pct(k / n, k) + " (" + nb(k) + " sur " + nb(n) + ")";
  }
  function celTaux(k, n) {
    if (!n) return "—";
    if (n < SEUIL) return nb(k) + " sur " + nb(n);
    return '<span class="taux">' + pct(k / n, k) + '</span><span class="taux-detail">' + nb(k) + " sur " + nb(n) + "</span>";
  }
  function distanceTxt(m) {
    if (m == null || !isFinite(m)) return "—";
    if (m < 25) return "moins de 50 m";
    if (m < 975) return fEnt.format(Math.round(m / 50) * 50) + " m";
    if (m < 9950) return f1.format(m / 1000) + " km";
    return fEnt.format(Math.round(m / 1000)) + " km";
  }
  function solde(n) { return n > 0 ? "+" + nb(n) : n < 0 ? "−" + nb(-n) : "0"; }
  function rayonTxt(r) { return r < 1000 ? nb(r) + " m" : nb(r / 1000) + " km"; }
  function dateCourte(iso) {
    if (!iso) return "—";
    const p = String(iso).slice(0, 10).split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function dateLongue(iso) {
    if (!iso) return "date non connue";
    const p = String(iso).slice(0, 10).split("-").map(Number);
    return (p[2] === 1 ? "1er" : p[2]) + " " + MOIS[p[1] - 1] + " " + p[0];
  }
  function trimestre(iso) {
    const p = String(iso).slice(0, 7).split("-").map(Number);
    let q = Math.ceil(p[1] / 3) - 1, a = p[0];
    if (q === 0) { q = 4; a -= 1; }
    return (q === 1 ? "1er" : q + "e") + " trimestre " + a;
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/['\u2019`\-_.()]/g, " ").replace(/\s+/g, " ").trim();
  }
  function sirenGroupe(s) { return String(s).replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3"); }
  function liste(arr) { return arr.length < 2 ? arr.join("") : arr.slice(0, -1).join(", ") + " et " + arr[arr.length - 1]; }
  function majuscule(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function metres(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function wilson(k, n) {
    const p = k / n, z2 = Z95 * Z95, d = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / d, h = Z95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  const stock = {
    lire(cle, defaut) {
      try { const v = window.localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch (e) { return defaut; }
    },
    ecrire(cle, v) {
      try { window.localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* navigation privée ou aperçu : la page marche sans */ }
    },
  };
  function annoncer(texte) {
    const el = $("annonce");
    el.textContent = "";
    window.setTimeout(() => { el.textContent = texte; }, 60);
  }
  function memo(cle, f) {
    if (cache.has(cle)) return cache.get(cle);
    if (cache.size > 80) cache.clear();
    const v = f();
    cache.set(cle, v);
    return v;
  }

  // ---------- Chargement ----------
  async function charger() {
    const elD = document.getElementById("donnees-json"), elC = document.getElementById("contours-json");
    if (elD && elC) return { donnees: JSON.parse(elD.textContent), contours: JSON.parse(elC.textContent) };
    const rep = await Promise.all([fetch("donnees.json"), fetch("contours.json")]);
    if (!rep[0].ok || !rep[1].ok) throw new Error("HTTP " + rep[0].status + " / " + rep[1].status);
    const json = await Promise.all([rep[0].json(), rep[1].json()]);
    return { donnees: json[0], contours: json[1] };
  }

  function bbox(g) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const pt of poly[0]) {
      if (pt[0] < x0) x0 = pt[0];
      if (pt[1] < y0) y0 = pt[1];
      if (pt[0] > x1) x1 = pt[0];
      if (pt[1] > y1) y1 = pt[1];
    }
    return [x0, y0, x1, y1];
  }

  function preparer(donnees, contours) {
    D = donnees; G = contours; M = D.meta;
    B = M.drapeaux || {};
    try { if (M.motif_immat && M.motif_immat.regex) RE_IMMAT = new RegExp(M.motif_immat.regex); } catch (e) { /* motif par défaut */ }
    T3 = trimestre(M.date_t3 || "2025-10-29");
    // les indicateurs d'ancienneté que les dates du registre ne permettent pas encore de mesurer disparaissent
    for (const k of majNonMesurables()) {
      const c = COLS.findIndex((x) => x.id === "maj" + k);
      if (c >= 0) COLS.splice(c, 1);
      const j = INDICATEURS.indexOf("maj" + k);
      if (j >= 0) INDICATEURS.splice(j, 1);
    }
    if (M.maj && M.maj.base === "mandat_en_cours") {
      for (const c of COLS) if (/^maj\d+$/.test(c.id)) c.def = "Parmi ses copropriétés comparables dont le mandat est en cours, celles dont la fiche au registre n'a pas été mise à jour depuis plus de " + c.id.slice(3) + " mois, à la date des données.";
    }

    // zones : communes et arrondissements
    Z = M.zones.map((z, i) => ({ i, code: z[0], nom: z[1], type: z[2], parent: z[3], lat: z[4], lon: z[5], decoupee: !!z[6], enfants: [], p: null }));
    ZC = new Map(Z.map((z) => [z.code, z]));
    for (const z of Z) {
      if (z.parent && ZC.has(z.parent)) { z.p = ZC.get(z.parent); z.p.enfants.push(z); }
      const k = norm(z.nom);
      z.cles = Array.from(new Set([k, k.replace(/\bsainte\b/g, "ste").replace(/\bsaint\b/g, "st")]));
    }
    // « Tout le département » : une zone de plus, qui couvre toutes les copropriétés chargées (audit P2-14)
    const nomDep = M.nom_departement || DEPARTEMENTS[M.departement] || "Département " + M.departement;
    const avecPos = Z.filter((z) => z.lat != null && z.lon != null && !z.p);
    const zd = { i: Z.length, code: String(M.departement), nom: nomDep, type: "departement", parent: null,
      lat: avecPos.reduce((a, z) => a + z.lat, 0) / (avecPos.length || 1), lon: avecPos.reduce((a, z) => a + z.lon, 0) / (avecPos.length || 1),
      decoupee: false, enfants: [], p: null, dep: true };
    zd.cles = Array.from(new Set([norm(nomDep), "tout le departement", "departement", norm(String(M.departement))]));
    Z.push(zd); ZC.set(zd.code, zd);
    FEATS = [];
    for (const f of (G && G.features) || []) {
      const z = ZC.get(f.properties.code);
      if (!z || z.decoupee) continue;
      FEATS.push({ f, z, bbox: bbox(f.geometry) });
    }

    // syndics : une entité par SIREN (les établissements d'une même société sont réunis). Les syndics masqués
    // (entrepreneurs individuels, syndics non trouvés au répertoire) portent une clé « ei-N » ou « nt-N »,
    // préfixée du département au national : ni numéro, ni lien externe, ni nom propre à leur sujet.
    ENTS = []; ENT_PAR_ANCRE = new Map();
    const parSiren = new Map(), entDe = new Int16Array(D.syndics.length);
    D.syndics.forEach((s, k) => {
      let e = parSiren.get(s.siren);
      if (!e) {
        const cle = String(s.siren), ei = !!s.ei || /(^|\D)ei-\d+$/.test(cle);
        e = { i: ENTS.length, siren: s.siren, ei, masque: ei || s.trouve === false || /(^|\D)nt-\d+$/.test(cle), s, bureaux: [], groupe: s.groupe || null };
        const num = (cle.match(/(\d+)$/) || [])[1];
        e.nom = e.ei ? "Syndic professionnel (entreprise individuelle)" + (num ? " n° " + num : "") : (s.nom || "Syndic sans dénomination");
        e.tri = norm(e.nom);
        e.cherche = norm([e.nom, e.masque ? "" : s.sigle].concat(e.masque ? [] : s.enseignes || []).filter(Boolean).join(" "));
        e.ancre = "s-" + cle;
        ENTS.push(e); parSiren.set(s.siren, e); ENT_PAR_ANCRE.set(e.ancre, e.i);
      }
      // le bureau déclaré au registre, puis le siège s'il est ailleurs
      for (const [b, registre] of [[s.bureau, true], [s.siege, false]]) {
        if (!b || b.lat == null || b.lon == null) continue;
        const deja = e.bureaux.find((x) => x.siret === b.siret);
        if (deja) { deja.registre = deja.registre || registre; continue; }
        e.bureaux.push(Object.assign({}, b, { registre }));
      }
      entDe[k] = e.i;
    });
    for (const e of ENTS) {
      const actifs = e.bureaux.filter((b) => b.etat !== "F");
      if (actifs.length) e.bureaux = actifs;
    }

    // copropriétés, en tableaux typés
    const lignes = D.copros.lignes, ch = D.copros.champs, col = (n) => ch.indexOf(n);
    const cI = col("immat"), cLa = col("lat"), cLo = col("lon"), cZ = col("zone"), cLt = col("lots"), cP = col("periode");
    const cS = col("syndic"), cD = col("drapeaux"), cS3 = col("syndic_t3"), cR = col("retention");
    N = lignes.length;
    IMMAT = new Array(N); LAT = new Float64Array(N); LON = new Float64Array(N); ZONE = new Int16Array(N); LOTS = new Int32Array(N);
    PER = new Int8Array(N); SYN = new Int16Array(N); DR = new Int16Array(N); RET = new Int8Array(N);
    CLASSE = new Int8Array(N); TAILLE = new Int8Array(N); ENT = new Int16Array(N); ENT3 = new Int16Array(N);
    const tailles = M.tailles, periodes = M.periodes, parZone = Z.map(() => []);
    INDEX_IMMAT = new Map();
    for (let i = 0; i < N; i++) {
      const l = lignes[i];
      IMMAT[i] = l[cI];
      LAT[i] = l[cLa] == null ? NaN : l[cLa];
      LON[i] = l[cLo] == null ? NaN : l[cLo];
      ZONE[i] = l[cZ]; LOTS[i] = l[cLt] || 0; PER[i] = l[cP]; SYN[i] = l[cS]; DR[i] = l[cD]; RET[i] = l[cR];
      const s3 = l[cS3];
      CLASSE[i] = PER[i] >= 0 && periodes[PER[i]] ? periodes[PER[i]][3] : -1;
      let t = -1;
      for (let k = 0; k < tailles.length; k++) {
        const lo = tailles[k][1], hi = tailles[k][2];
        if (LOTS[i] >= lo && (hi == null || LOTS[i] <= hi)) { t = k; break; }
      }
      TAILLE[i] = t;
      ENT[i] = SYN[i] >= 0 ? entDe[SYN[i]] : SYN[i];
      ENT3[i] = s3 >= 0 ? entDe[s3] : s3;
      if (ZONE[i] >= 0 && parZone[ZONE[i]]) parZone[ZONE[i]].push(i);
      if (!INDEX_IMMAT.has(IMMAT[i]) || SYN[i] !== ABSENTE) INDEX_IMMAT.set(IMMAT[i], i);
    }
    PAR_ZONE = parZone.map((a) => Int32Array.from(a));
    TOUTES = new Int32Array(N);
    for (let i = 0; i < N; i++) TOUTES[i] = i;
  }

  // ---------- Zones ----------
  function dansAnneau(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function dansGeometrie(lon, lat, g) {
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      if (!dansAnneau(lon, lat, poly[0])) continue;
      let trou = false;
      for (let h = 1; h < poly.length; h++) if (dansAnneau(lon, lat, poly[h])) { trou = true; break; }
      if (!trou) return true;
    }
    return false;
  }
  function zoneSous(lat, lon) {
    for (const x of FEATS) {
      const b = x.bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (dansGeometrie(lon, lat, x.f.geometry)) return x.z;
    }
    return null;
  }
  function lignesZone(z) {
    if (z.dep) return TOUTES;
    return memo("LZ" + z.i, () => {
      if (!z.enfants.length) return PAR_ZONE[z.i];
      const parts = [PAR_ZONE[z.i]].concat(z.enfants.map((c) => PAR_ZONE[c.i]));
      const out = new Int32Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    });
  }
  function lignesCercle(c) {
    const dLa = c.r / 111320, dLo = c.r / (111320 * Math.cos(c.lat * Math.PI / 180)), out = [];
    for (let i = 0; i < N; i++) {
      if (Math.abs(LAT[i] - c.lat) > dLa || Math.abs(LON[i] - c.lon) > dLo) continue;
      if (metres(c.lat, c.lon, LAT[i], LON[i]) <= c.r) out.push(i);
    }
    return Int32Array.from(out);
  }
  function cleZone() {
    if (etat.mode === "cercle" && etat.cercle) return "c" + etat.cercle.lat.toFixed(5) + "," + etat.cercle.lon.toFixed(5) + "," + etat.cercle.r;
    return "z" + etat.zone;
  }
  function lignesCourantes() {
    return memo("L" + cleZone(), () => (etat.mode === "cercle" && etat.cercle ? lignesCercle(etat.cercle) : lignesZone(Z[etat.zone])));
  }
  function zoneDuCentre() { return etat.cercle ? memo("ZC" + cleZone(), () => zoneSous(etat.cercle.lat, etat.cercle.lon)) : null; }
  function communeDeZone() {
    if (etat.mode === "cercle" && etat.cercle) {
      const zc = zoneDuCentre();
      return zc ? { z: zc.p || zc, meme: false } : null;
    }
    const z = Z[etat.zone];
    if (z.dep) return { z, meme: true };
    if (z.type === "arrondissement" && z.p) return { z: z.p, meme: false };
    return { z, meme: true };
  }
  function nomZone() {
    if (etat.mode === "cercle" && etat.cercle) {
      const zc = zoneDuCentre();
      return zc ? zc.nom : "Cercle";
    }
    return Z[etat.zone].nom;
  }
  function autourDe() {
    const c = etat.cercle;
    if (!c) return "";
    if (c.source === "copro") return "autour de votre copropriété";
    if (c.source === "adresse") return "autour de l'adresse choisie";
    if (c.source === "point") return "autour du point choisi";
    return "autour du centre de " + (Z[etat.zone] ? Z[etat.zone].nom : "la zone");
  }
  function libelleZone() {
    if (etat.mode === "cercle" && etat.cercle) return "cercle de " + rayonTxt(etat.cercle.r) + " " + autourDe();
    return Z[etat.zone].nom;
  }
  function codesSelection() {
    if (etat.mode !== "liste") return new Set();
    const z = Z[etat.zone];
    if (z.dep) return new Set(FEATS.map((x) => x.z.code));
    return new Set(z.enfants.length ? z.enfants.map((c) => c.code) : [z.code]);
  }

  // ---------- Calcul des chiffres ----------
  function comparable(i) {
    return (etat.taille < 0 || TAILLE[i] === etat.taille) && (etat.constr < 0 || CLASSE[i] === etat.constr);
  }
  function nouveauStat() {
    return { comp: 0, tout: 0, lotsComp: 0, n0: 0, restees: 0, internes: 0, groupe: 0, concurrent: 0, nonPro: 0, expSans: 0,
      pasMandat: 0, absente: 0, arr: 0, arrNouv: 0, arrPro: 0, arrNonPro: 0, arrGroupe: 0, majN: 0, maj12: 0, maj18: 0, finN: 0, finK: 0 };
  }
  function memeGroupe(a, b) {
    const ga = ENTS[a].groupe, gb = ENTS[b].groupe;
    return !!(ga && gb && ga.id === gb.id);
  }
  // Une passe sur les lignes d'un périmètre. Les totaux portent les mêmes champs que les syndics :
  // ils servent de repères (copropriétés gérées par des syndics professionnels).
  function agreger(rows) {
    const par = new Map(), tot = nouveauStat();
    Object.assign(tot, { copros: 0, comparables: 0, lotsTout: 0, lotsComparables: 0, benevoles: 0, inconnus: 0, sansSiret: 0 });
    const st = (e) => { let s = par.get(e); if (!s) { s = nouveauStat(); par.set(e, s); } return s; };
    const bMajC = B.maj_connue || 256, bM12 = B.maj_12 || 64, bM18 = B.maj_18 || 128, bEcd = B.en_cours_datee || 32, bFin = B.fin_passee || 8;
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j], comp = comparable(i), e = ENT[i], e3 = ENT3[i];
      if (SYN[i] !== ABSENTE) {
        tot.copros++; tot.lotsTout += LOTS[i];
        if (e >= 0) { st(e).tout++; tot.tout++; }
        if (comp) {
          tot.comparables++; tot.lotsComparables += LOTS[i];
          if (e >= 0) {
            const s = st(e), d = DR[i];
            s.comp++; s.lotsComp += LOTS[i]; tot.comp++; tot.lotsComp += LOTS[i];
            if (d & bMajC) {
              s.majN++; tot.majN++;
              if (d & bM12) { s.maj12++; tot.maj12++; }
              if (d & bM18) { s.maj18++; tot.maj18++; }
            }
            if (d & bEcd) {
              s.finN++; tot.finN++;
              if (d & bFin) { s.finK++; tot.finK++; }
            }
            if (e3 !== e) {
              if (e3 >= 0 && memeGroupe(e3, e)) { s.arrGroupe++; tot.arrGroupe++; } else {
                s.arr++; tot.arr++;
                if (e3 === ABSENTE) { s.arrNouv++; tot.arrNouv++; } else if (e3 >= 0) { s.arrPro++; tot.arrPro++; } else { s.arrNonPro++; tot.arrNonPro++; }
              }
            }
          } else if (e === BENEVOLE) tot.benevoles++;
          else if (e === SANS_SIRET) tot.sansSiret++;
          else tot.inconnus++;
        }
      }
      if (comp && e3 >= 0) {
        const s = st(e3);
        s.n0++; tot.n0++;
        switch (RET[i]) {
          case 0: s.restees++; tot.restees++; break;
          case 1: s.restees++; s.internes++; tot.restees++; tot.internes++; break;
          case 2: s.groupe++; tot.groupe++; break;
          case 3: s.concurrent++; tot.concurrent++; break;
          case 4: s.nonPro++; tot.nonPro++; break;
          case 5: s.expSans++; tot.expSans++; break;
          case 6: s.pasMandat++; tot.pasMandat++; break;
          case 7: s.absente++; tot.absente++; break;
          default: break;
        }
      }
    }
    return { par, tot };
  }
  function calculer() {
    const f = etat.taille + ":" + etat.constr, kz = cleZone();
    const Dp = memo("D|" + f, () => agreger(TOUTES));
    // la zone « tout le département » est le repère du département lui-même
    const A = etat.mode === "liste" && Z[etat.zone].dep ? Dp : memo("A" + kz + "|" + f, () => agreger(lignesCourantes()));
    const com = communeDeZone();
    const C = com && !com.meme ? memo("Az" + com.z.i + "|" + f, () => agreger(lignesZone(com.z))) : null;
    return { A, C, Dp, com };
  }
  function compterSyndics(A) {
    let n = 0;
    for (const s of A.par.values()) if (s.comp > 0) n++;
    return n;
  }
  function monSyndic() { return etat.copro != null && ENT[etat.copro] >= 0 ? ENT[etat.copro] : null; }
  function pointRef() {
    if (etat.copro != null) return { lat: LAT[etat.copro], lon: LON[etat.copro], quoi: "de votre copropriété" };
    if (etat.mode === "cercle" && etat.cercle) return { lat: etat.cercle.lat, lon: etat.cercle.lon, quoi: "du centre du cercle" };
    const z = Z[etat.zone];
    if (z.dep) return null;
    return { lat: z.lat, lon: z.lon, quoi: "du centre de la zone" };
  }
  function bureauProche(e, ref) {
    if (!ref) { const b = e.bureaux.find((x) => x.registre) || e.bureaux[0]; return b ? { b, d: null } : null; }
    let best = null, dm = Infinity;
    for (const b of e.bureaux) {
      const d = metres(ref.lat, ref.lon, b.lat, b.lon);
      if (d < dm) { dm = d; best = b; }
    }
    return best ? { b: best, d: dm } : null;
  }

  // ---------- La société ----------
  // le répertoire des entreprises inscrit le 1er janvier 1900 quand il n'a pas de date : on ne la montre pas
  function dateCreation(e) { const d = e.s.creation; return d && String(d).slice(0, 10) > "1900-01-01" ? d : null; }
  function annee(iso) { return iso ? Number(String(iso).slice(0, 4)) : null; }
  function age(iso) {
    if (!iso) return null;
    const ref = String(M.date_reference), a = Number(ref.slice(0, 4)) - Number(String(iso).slice(0, 4));
    return ref.slice(5, 10) < String(iso).slice(5, 10) ? a - 1 : a;
  }
  function creationTxt(e) {
    const d = dateCreation(e);
    if (!d) return e.s.creation ? "Non datée" : "—";
    return annee(d) + " (" + pl(age(d), "an", "ans") + ")";
  }
  function effectifConnu(e) { return !!(e.s.tranche && TRANCHES[e.s.tranche] && e.s.effectif && e.s.effectif !== "non renseigné"); }
  function effectifTxt(e) {
    if (!effectifConnu(e)) return "Non déclaré";
    return e.s.effectif + (e.s.effectif_annee ? " (" + e.s.effectif_annee + ")" : "");
  }
  function dirigeeTxt(e, court) {
    const d = e.s.dirigee_par;
    if (!d || !d.length) return court ? "—" : "";
    if (court) return d.length === 1 ? d[0] : d[0] + " et " + pl(d.length - 1, "autre", "autres");
    return d.length === 1 ? "Dirigée par la société " + d[0] : "Dirigée par les sociétés " + liste(d);
  }
  function dernier(dates) { return dates && dates.length ? dates.slice().sort().pop() : null; }
  // annonce de moins de HORIZON_ANNONCES ans à la date des données
  function recente(iso) {
    if (!iso) return false;
    const ref = String(M.date_reference).slice(0, 10);
    return String(iso).slice(0, 10) > (Number(ref.slice(0, 4)) - HORIZON_ANNONCES) + ref.slice(4);
  }
  // annonces d'alerte (procédure collective, radiation) : montrées seulement quand la chaîne a contrôlé leur rattachement,
  // numéro au registre et nom de la société (contrat des données § 9) ; des données antérieures à ce contrôle n'en montrent aucune
  function bodaccControle() { return "ecartees_nom_discordant" in (((M.sources || {}).bodacc) || {}); }
  function alertesBodacc(s0) {
    const b = (s0 && s0.bodacc) || {};
    return bodaccControle() ? { procedures: b.procedures || [], radiations: b.radiations || [] } : { procedures: [], radiations: [] };
  }
  // faits datés du BODACC, en clair : [libellé, date]. Sans « tous », seulement ceux de moins de 5 ans.
  function bodaccFaits(e, tous) {
    const b = e.s.bodacc || {}, al = alertesBodacc(e.s), out = [];
    const dates = al.procedures.map((x) => x.date).filter(Boolean).sort(), proc = dates.length ? dates[dates.length - 1] : null;
    if (proc && (tous || recente(proc))) {
      const a0 = dates[0].slice(0, 4), a1 = proc.slice(0, 4);
      out.push(["Procédure collective publiée en " + a0 + (a0 !== a1 ? ", dernière annonce en " + a1 : ""), proc]);
    }
    const rad = dernier(al.radiations);
    if (rad && (tous || recente(rad))) out.push(["Radiation publiée en " + rad.slice(0, 4), rad]);
    if (b.dernier_achat && (tous || recente(b.dernier_achat))) out.push(["Achat de fonds publié en " + b.dernier_achat.slice(0, 4), b.dernier_achat]);
    return out;
  }
  function bodaccTxt(e) {
    const f = bodaccFaits(e, false);
    return f.length ? f.map((x) => x[0]).join(" · ") : "—";
  }
  function identite(e) {
    if (e.ei) return "Entrepreneur individuel : nom et numéros non publiés";
    if (e.masque) return "Syndic non identifié au répertoire des entreprises : numéros non publiés";
    return (e.s.forme || e.s.forme_courte || "Forme juridique non renseignée") + " · numéro d'entreprise (SIREN) " + sirenGroupe(e.siren);
  }
  // « MARSEILLE 8EME », « AIX-EN-PROVENCE » → nom lisible ; le nom de la zone quand la commune est chargée
  function communeLisible(b) {
    const z = b.zone && ZC.get(String(b.zone));
    if (z) return z.nom;
    const petits = /^(de|du|des|la|le|les|en|sur|sous|lès|lez|et|d|l)$/;
    return String(b.commune || "").toLowerCase().split(/([\s'-]+)/)
      .map((m, k) => (k && petits.test(m)) || /^[\s'-]+$/.test(m) ? m : m.charAt(0).toUpperCase() + m.slice(1)).join("") || "commune non renseignée";
  }
  // Le bureau le plus proche parmi ceux que l'on sait placer (bureau déclaré au registre, siège), et ce que
  // l'on ne sait pas placer : les autres établissements ouverts au répertoire. On ne trie jamais sur cette distance.
  function bureauInfo(e, ref) {
    const bp = bureauProche(e, ref);
    if (!bp) return null;
    const nLoc = e.bureaux.length, nEtab = e.s.etab_ouverts;
    const nonLoc = nEtab != null && nEtab > 1 ? Math.max(0, nEtab - nLoc) : 0;
    const distance = nEtab != null && nEtab <= nLoc && bp.d > LOIN;
    return { b: bp.b, d: bp.d, commune: communeLisible(bp.b), nonLoc, distance, nLoc };
  }
  function bureauTxt(bi, court) {
    if (!bi) return "—";
    const ou = bi.commune + (bi.d != null ? ", " + distanceTxt(bi.d) : "") + (bi.b.precision === "approchee" ? " (position approchée)" : "");
    let t;
    if (bi.distance) t = "Gestion à distance : " + (bi.nLoc === 1 ? "un seul bureau, à " + bi.commune + " (" + distanceTxt(bi.d) + ")" : "bureaux connus loin d'ici, le plus proche à " + ou);
    else t = (bi.b.registre ? "Bureau déclaré au registre : " : "Siège : ") + ou;
    if (bi.nonLoc >= 1 && !court) t += " — " + pl(bi.nonLoc, "autre établissement ouvert au répertoire, non localisé ici", "autres établissements ouverts au répertoire, non localisés ici");
    return t;
  }
  function bureauHtml(bi) {
    if (!bi) return "—";
    const prec = bi.b.precision === "approchee" ? " (position approchée)" : "";
    if (bi.distance) {
      return "<span>Gestion à distance</span><span class=\"taux-detail\">" + esc((bi.nLoc === 1 ? "un seul bureau, à " : "le plus proche à ") + bi.commune + " (" + distanceTxt(bi.d) + ")" + prec) + "</span>";
    }
    return "<span>" + esc(bi.commune + (bi.d != null ? " · " + distanceTxt(bi.d) : "")) + "</span><span class=\"taux-detail\">" + esc((bi.b.registre ? "bureau déclaré au registre" : "siège") + prec) + "</span>"
      + (bi.nonLoc >= 1 ? "<span class=\"taux-detail\">" + esc("+ " + pl(bi.nonLoc, "établissement non localisé", "établissements non localisés")) + "</span>" : "");
  }

  // ---------- Devenir des copropriétés de 2025 (sept devenirs, 100 %) ----------
  function arrivees(s) { return s.arr + s.arrGroupe; }
  function arrVenues(s) { return s.arrPro + s.arrGroupe; }       // venues d'un autre syndic professionnel
  function arrDeclarees(s) { return s.arrNouv + s.arrNonPro; }   // déclarées depuis
  function evolTxt(s) { return nb(s.n0) + " → " + nb(s.comp) + " (" + solde(s.comp - s.n0) + ")"; }
  function arriveesTxt(s) {
    const a = arrivees(s);
    if (!a) return "Aucune arrivée";
    const v = arrVenues(s), d = arrDeclarees(s);
    return solde(a) + " : " + nb(v) + " venue" + (v >= 2 ? "s" : "") + " d'un autre syndic professionnel"
      + (s.arrGroupe ? " (dont " + nb(s.arrGroupe) + " du même groupe)" : "") + ", " + nb(d) + " déclarée" + (d >= 2 ? "s" : "") + " depuis";
  }
  function devenirAria(s) {
    if (!s.n0) return "Aucune copropriété déclarée au " + T3 + ".";
    return pl(s.n0, "copropriété déclarée", "copropriétés déclarées") + " au " + T3 + " : "
      + DEVENIRS.filter((d) => s[d[0]] > 0).map((d) => nb(s[d[0]]) + " " + d[1].toLowerCase().replace(/« |»/g, "")).join(", ") + ". Aujourd'hui : " + nb(s.comp) + ".";
  }
  // barre empilée des sept devenirs ; chaque segment porte son libellé, le tout une description
  function barreDevenir(s, grande) {
    if (!s.n0) return '<span class="taux-detail">Aucune copropriété déclarée chez lui en 2025</span>';
    return '<span class="barre-devenir' + (grande ? " grande" : "") + '" role="img" aria-label="' + esc(devenirAria(s)) + '">'
      + DEVENIRS.map((d, k) => (s[d[0]] > 0 ? '<span class="d' + (k + 1) + '" style="flex-grow:' + s[d[0]] + '" title="' + esc(nb(s[d[0]]) + " sur " + nb(s.n0) + " : " + d[1]) + '"></span>' : "")).join("")
      + "</span>";
  }
  function legendeDevenirs() {
    return '<span class="legende-devenir">' + DEVENIRS.map((d, k) => '<span><i class="pastille-d d' + (k + 1) + '" aria-hidden="true"></i>' + esc(d[1]) + "</span>").join("") + "</span>";
  }

  // ---------- Colonnes du tableau (§ 4.5, textes du § 5.8 ; audit UX du 28/10/2026) ----------
  // Chaque colonne porte son titre, sa définition écrite sous l'en-tête (def), sa clé de tri (cle : null quand
  // la ligne ne se trie pas sur elle ; sansTri : jamais), sa cellule (html) et son texte (texte : comparateur,
  // copies, export). « cache » : colonne du comparateur et des copies, absente du tableau.
  function partTxt(k, n) { return n < SEUIL ? nb(k) + " sur " + nb(n) : pct(k / n, k) + " des comparables"; }
  function colNombre(id, titre, def, f, o) {
    return Object.assign({ id, titre, def, num: true, cle: (s) => f(s), html: (s) => nb(f(s)), texte: (s) => nb(f(s)) }, o || {});
  }
  function colTaux(id, titre, def, kn, o) {
    return Object.assign({ id, titre, def, num: true, taux: true, kn,
      cle: (s, T) => { const v = kn(s, T); return v[1] >= SEUIL ? v[0] / v[1] : null; },
      html: (s, T) => { const v = kn(s, T); return celTaux(v[0], v[1]); },
      texte: (s, T) => { const v = kn(s, T); return txtTaux(v[0], v[1]); } }, o || {});
  }
  function colSoc(id, titre, def, f, cle) {
    return { id, titre, def, soc: true, cle: (s, T, e) => (e ? cle(e) : null), html: (s, T, e) => (e ? esc(f(e)) : "—"), texte: (s, T, e) => (e ? f(e) : "—") };
  }
  function devenirHtml(s, T, e) {
    if (!s.n0) return '<span class="taux-detail">' + esc("Aucune en 2025" + (s.comp ? " ; " + nb(s.comp) + " aujourd'hui" : "")) + "</span>";
    return '<span class="devenir">' + barreDevenir(s) + '<span class="evol">' + esc(evolTxt(s)) + "</span>"
      + '<span class="taux-detail">' + esc(nb(s.restees) + " sur " + nb(s.n0) + (e ? " toujours chez lui" : " toujours chez le même syndic") + " · " + (arrivees(s) ? solde(arrivees(s)) + " arrivée" + (arrivees(s) >= 2 ? "s" : "") : "aucune arrivée")) + "</span></span>";
  }
  function devenirTexte(s) {
    if (!s.n0) return "Aucune en 2025" + (s.comp ? " ; " + nb(s.comp) + " aujourd'hui" : "");
    return evolTxt(s) + " ; " + DEVENIRS.map((d) => d[1] + " " + nb(s[d[0]])).join(", ") + " ; arrivées " + (arrivees(s) ? arriveesTxt(s) : "0");
  }
  const COLS = [
    colNombre("comp", "Copropriétés comparables", "Copropriétés comparables de la zone qui le déclarent aujourd'hui.", (s) => s.comp),
    { id: "compPart", titre: "Copropriétés comparables", num: true, def: "Combien le déclarent aujourd'hui, et leur part parmi les copropriétés comparables de la zone, syndics bénévoles compris.",
      cle: (s) => s.comp,
      html: (s, T) => '<span class="taux">' + nb(s.comp) + "</span>" + (T.comparables ? '<span class="taux-detail">' + esc(partTxt(s.comp, T.comparables)) + "</span>" : ""),
      texte: (s, T) => nb(s.comp) + (T.comparables ? " (" + partTxt(s.comp, T.comparables) + ")" : "") },
    colNombre("tout", "Toutes ses copropriétés de la zone", "Quelles que soient leur taille et leur période de construction.", (s) => s.tout),
    colNombre("lots", "Lots comparables", "Total des lots de ses copropriétés comparables.", (s) => s.lotsComp),
    colTaux("part", "Part des copropriétés comparables", "Sur 100 copropriétés comparables de la zone, combien le déclarent. Les copropriétés à syndic bénévole sont comptées.", (s, T) => [s.comp, T.comparables]),
    { id: "bureau", titre: "Bureau", sansTri: true,
      def: "Le plus proche des bureaux connus, à vol d'oiseau de votre copropriété (ou du centre de la zone). Les autres établissements de la société ne sont pas encore localisés : cette distance ne se trie pas.",
      cle: () => null, html: (s, T, e, lg) => (lg ? bureauHtml(lg.bi) : "—"), texte: (s, T, e, lg) => (lg ? bureauTxt(lg.bi, false) : "—") },
    colNombre("n0", "Déclarées chez lui en 2025", () => "Copropriétés comparables de la zone qui le déclaraient au " + T3 + ". Elles font 100 % de leur devenir.", (s) => s.n0),
    { id: "devenir", titre: "Ce que sont devenues ses copropriétés de 2025", devenir: true,
      def: "Ses copropriétés comparables de 2025 (100 %), selon le registre d'aujourd'hui ; puis le nombre d'aujourd'hui, arrivées comprises. Tri : part toujours chez lui.",
      cle: (s) => (s.n0 >= SEUIL ? s.restees / s.n0 : null), html: devenirHtml, texte: devenirTexte },
    { id: "arrivees", titre: "Arrivées depuis 2025", num: true,
      def: "Copropriétés qui le déclarent aujourd'hui sans le déclarer en 2025 : venues d'un autre syndic professionnel, ou déclarées depuis (absentes du registre, à syndic bénévole, sans SIRET ou de type non connu en 2025).",
      cle: (s) => arrivees(s),
      html: (s) => '<span class="taux">' + esc(arrivees(s) ? solde(arrivees(s)) : "0") + "</span>" + (arrivees(s) ? '<span class="taux-detail">' + esc(nb(arrVenues(s)) + " d'un autre syndic professionnel" + (s.arrGroupe ? " (dont " + nb(s.arrGroupe) + " du même groupe)" : "")) + '</span><span class="taux-detail">' + esc(nb(arrDeclarees(s)) + " déclarée" + (arrDeclarees(s) >= 2 ? "s" : "") + " depuis") + "</span>" : ""),
      texte: arriveesTxt },
  ]
    // les sept devenirs, un à un : comparateur, copies, export, entonnoir
    .concat(DEVENIRS.map((d) => colTaux("d_" + d[0], d[1], majuscule(d[2]) + ".", (s) => [s[d[0]], s.n0], { cache: true })))
    .concat([
      colTaux("autre", "Passées à un autre syndic", "Déclarées chez un autre syndic professionnel, ou avec un syndic bénévole, sans SIRET ou de type non connu.", (s) => [s.concurrent + s.nonPro, s.n0], { cache: true }),
      colTaux("exp", "Mandat expiré sans successeur déclaré", "Parmi ses copropriétés comparables de 2025 : mandat arrivé à sa date de fin, sans nouveau mandat déclaré au registre. Cela ne prouve pas que la copropriété n'a pas de syndic.", (s) => [s.expSans, s.n0]),
      colTaux("maj12", "Fiche non mise à jour depuis plus de 12 mois", "Ses copropriétés comparables dont la fiche au registre n'a pas été mise à jour depuis plus de 12 mois, à la date des données.", (s) => [s.maj12, s.majN]),
      colTaux("maj18", "Fiche non mise à jour depuis plus de 18 mois", "Même chose, au-delà de 18 mois.", (s) => [s.maj18, s.majN]),
      colTaux("fin", "Mandat « en cours » dont la date de fin est passée", "Fiches qui indiquent un mandat en cours alors que sa date de fin déclarée est passée. Le renouvellement a pu avoir lieu sans être encore déclaré au registre.", (s) => [s.finK, s.finN]),
      colSoc("creation", "Création", "Date de création de la société, d'après le répertoire des entreprises. « Non datée » : le répertoire n'indique pas de date.", creationTxt, (e) => annee(dateCreation(e))),
      colSoc("effectif", "Effectifs", "Tranche de salariés déclarée, avec son année. Elle compte tous les salariés de la société, y compris ceux de la location et de la vente.", effectifTxt, (e) => (effectifConnu(e) ? TRANCHES[e.s.tranche][0] : null)),
      colSoc("forme", "Forme juridique", "SAS, SARL, SA… : la forme de la société.", (e) => e.s.forme_courte || "—", (e) => (e.s.forme_courte ? norm(e.s.forme_courte) : null)),
      colSoc("dirigee", "Dirigée par une société", "Quand un dirigeant de ce syndic est une société, son nom apparaît ici. Les dirigeants qui sont des personnes ne sont jamais affichés.", (e) => dirigeeTxt(e, true), (e) => (e.s.dirigee_par ? norm(e.s.dirigee_par[0]) : null)),
      colSoc("bodacc", "Annonces au BODACC de moins de 5 ans", "Procédure collective ou radiation, seulement quand l'annonce porte le numéro et le nom de la société, ou achat de fonds, publiés au Bulletin officiel des annonces civiles et commerciales (BODACC) depuis moins de 5 ans. Les annonces plus anciennes sont dans la fiche.",
        bodaccTxt, (e) => { const f = bodaccFaits(e, false); return f.length ? f.map((x) => x[1]).sort().pop() : null; }),
    ]);
  const colParId = (id) => COLS.find((c) => c.id === id);
  // vues du tableau : la colonne « Syndic » d'abord, la liste courte en dernier
  const VUES = [
    ["ensemble", "Vue d'ensemble", ["compPart", "devenir", "exp", "bureau"]],
    ["presence", "Présence", ["comp", "tout", "lots", "part", "bureau"]],
    ["devenir", "Devenir depuis 2025", ["comp", "n0", "devenir", "arrivees"]],
    ["maj", "Mises à jour du registre", ["comp", "maj12", "maj18", "fin"]],
    ["societe", "Société", ["comp", "creation", "effectif", "forme", "dirigee", "bodacc"]],
  ];
  // groupes du comparateur, de la copie et de l'export
  const GROUPES = [
    ["presence", "Présence", ["comp", "tout", "lots", "part", "bureau"]],
    ["devenir", "Ce que sont devenues ses copropriétés de 2025", ["n0", "devenir"].concat(DEVENIRS.map((d) => "d_" + d[0]), ["arrivees"])],
    ["maj", "Mises à jour du registre", ["maj12", "maj18", "fin"]],
    ["societe", "Société", ["creation", "effectif", "forme", "dirigee", "bodacc"]],
  ];
  function filtreActif() { return etat.taille >= 0 || etat.constr >= 0; }
  function colonnesVue(id) {
    const v = VUES.concat(vuesJustice()).find((x) => x[0] === id) || VUES[0];
    // « Toutes ses copropriétés » répète « comparables » tant qu'aucun critère n'est choisi
    return v[2].filter((c) => c !== "tout" || filtreActif()).map(colParId).filter(Boolean);
  }
  function colonnesGroupe(g) { return g[2].map(colParId).filter(Boolean); }
  // meta.maj (contrat des données) : le registre a pu donner d'un coup la même date à des milliers de fiches,
  // et l'ancienneté d'une fiche n'est alors lisible qu'après cette date
  function majNonMesurables() {
    const mj = M.maj && M.maj.mesurable;
    return mj ? ["12", "18"].filter((k) => mj[k] === false) : [];
  }
  function noteMaj() {
    const mj = M.maj, nm = majNonMesurables();
    if (!nm.length) return "";
    const dm = (mj.dates_de_masse || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const n = dm.reduce((a, x) => a + (x.n || 0), 0), quand = mj.mesurable_a_partir_du || {};
    const t = dm.length ? "Le registre a donné la même date de mise à jour, " + liste(dm.map((x) => "le " + dateLongue(x.date))) + ", à "
      + pl(n, "fiche", "fiches") + " du département : on ne sait donc pas depuis quand elles n'avaient pas été mises à jour. " : "";
    return t + nm.map((k) => "L'ancienneté de plus de " + k + " mois ne " + (quand[k] ? "pourra se mesurer qu'à partir du " + dateLongue(quand[k]) : "peut pas encore se mesurer") + ".").join(" ");
  }
  // journées très chargées qui n'effacent pas le passé : comptées comme des mises à jour, et dites
  function noteMajSignalees() {
    const ds = (M.maj && M.maj.dates_signalees) || [];
    if (!ds.length) return "";
    const top = ds.slice().sort((a, b) => (b.n || 0) - (a.n || 0))[0];
    return "Le registre porte aussi " + pl(ds.length, "journée très chargée", "journées très chargées") + " (la plus forte, le " + dateLongue(top.date) + " : "
      + pl(top.n || 0, "fiche", "fiches") + " du département), qui viennent sans doute d'envois groupés. Elles comptent ici comme des mises à jour"
      // mesure nationale du 28/10/2026 (docs/contrat-des-donnees.md) : à rendre lisible dans meta.maj à la prochaine itération
      + (M.maj && M.maj.date_ref === "2026-10-28" ? " : pour les 3 et 4 octobre 2026, trois fiches sur quatre ont changé de date de fin de mandat ou de nombre de lots depuis le " + T3 + ", autant que les autres fiches mises à jour." : ".");
  }
  // indicateurs de l'entonnoir et des barres de position (taux rapportés à un nombre de copropriétés)
  const INDICATEURS = ["autre", "exp", "d_pasMandat", "maj12", "maj18", "fin"];
  function defCol(c) { return typeof c.def === "function" ? c.def() : c.def || ""; }
  // une ligne de groupe n'a pas de société : ni date de création, ni effectif, ni décisions
  function cleCol(c, lg, T) { return lg.groupe && c.soc ? null : c.cle(lg.s, T, lg.e, lg); }
  function htmlCol(c, s, T, e, lg) { return lg && lg.groupe && c.soc ? "—" : c.html(s, T, e, lg); }
  function texteCol(c, s, T, e, lg) { return lg && lg.groupe && c.soc ? "—" : c.texte(s, T, e, lg); }
  function memeTri(a, b) { const n = (x) => (x === "compPart" ? "comp" : x); return n(a) === n(b); }
  function sensParDefaut(id) { return id === "nom" || id === "forme" || id === "dirigee" ? "asc" : "desc"; }

  // ---------- Bandeau ----------
  function chiffre(n, un, plusieurs) { return "<strong>" + nb(n) + "</strong> " + esc(Math.abs(n) >= 2 ? plusieurs : un); }
  function rendreBandeau(R) {
    const T = R.A.tot, filtre = filtreActif(), zd = etat.mode === "liste" && Z[etat.zone].dep;
    $("plaque-nom").textContent = nomZone();
    $("plaque-sous").textContent = etat.mode === "cercle" && etat.cercle
      ? "Cercle de " + rayonTxt(etat.cercle.r) + " " + autourDe()
      : zd ? "Tout le département (" + M.departement + ")" : (M.nom_departement || DEPARTEMENTS[M.departement] || "Département") + " (" + M.departement + ")";
    $("bandeau").setAttribute("aria-label", "Zone : " + libelleZone());
    let nTout = 0, nComp = 0;
    for (const s of R.A.par.values()) { if (s.tout > 0) nTout++; if (s.comp > 0) nComp++; }
    const ou = etat.mode === "cercle" ? "Dans le cercle" : zd ? "Dans le département" : "Dans la zone";
    const l1 = [chiffre(T.copros, "copropriété", "copropriétés"), chiffre(T.lotsTout, "lot", "lots"), chiffre(nTout, "syndic professionnel", "syndics professionnels")];
    if (!filtre) l1.push(chiffre(T.benevoles, "copropriété à syndic bénévole", "copropriétés à syndic bénévole"));
    let h = '<p class="ligne-chiffres"><span class="ligne-titre">' + esc(ou + " :") + "</span> " + l1.join(" · ") + "</p>";
    if (filtre) {
      h += '<p class="ligne-chiffres"><span class="ligne-titre">' + esc((etat.copro != null ? "Comparables à la vôtre" : "Comparables") + " (" + criteresTxt().replace(/^copropriétés /, "") + ") :") + "</span> "
        + [chiffre(T.comparables, "copropriété", "copropriétés"), chiffre(T.lotsComparables, "lot", "lots"), chiffre(nComp, "syndic professionnel", "syndics professionnels"), chiffre(T.benevoles, "à syndic bénévole", "à syndic bénévole")].join(" · ") + "</p>";
    }
    if (T.comparables >= SEUIL && T.inconnus) {
      h += '<p class="synthese">' + esc("Pour " + pct(T.inconnus / T.comparables, T.inconnus) + " des copropriétés " + (filtre ? "comparables " : "") + (etat.mode === "cercle" ? "du cercle" : zd ? "du département" : "de la zone")
        + ", aucun syndic n'est déclaré au registre, ou son type n'est pas connu.") + "</p>";
    }
    $("chiffres-zone").innerHTML = h;
    const extr = (M.sources && M.sources.extraction_quotidienne && M.sources.extraction_quotidienne.heure) || M.genere_le;
    $("dates-zone").textContent = "Registre des copropriétés : données du " + dateLongue(M.date_reference) + ", comparées au " + T3 + ". Calcul du " + dateLongue(extr) + ".";
    const infos = [];
    const ageDonnees = (Date.now() - Date.parse(String(M.date_reference).slice(0, 10) + "T00:00:00Z")) / 864e5;
    if (ageDonnees > 45) infos.push(esc("Ces chiffres datent du " + dateLongue(M.date_reference) + ". La mise à jour mensuelle n'a pas encore eu lieu."));
    if (etat.copro != null && RET[etat.copro] === 5) {
      const e3 = ENT3[etat.copro];
      infos.push(esc("Au registre du " + dateLongue(M.date_reference) + ", le mandat de votre copropriété est indiqué « expiré sans successeur déclaré ». Au " + T3 + ", le syndic déclaré était " + (e3 >= 0 ? ENTS[e3].nom : "non connu") + ".")
        + (e3 >= 0 ? ' <button type="button" class="btn-lien" data-act="fiche" data-ent="' + e3 + '">Voir la fiche de ce syndic</button>' : ""));
    }
    const ib = $("info-bandeau");
    ib.innerHTML = infos.join("<br>");
    ib.hidden = !infos.length;
  }
  function rendreResumeFiltres() {
    const t = etat.taille >= 0 ? M.tailles[etat.taille][0] : "toutes tailles";
    const c = etat.constr >= 0 ? M.classes_construction[etat.constr][0].replace(/^./, (x) => x.toLowerCase()) : "toutes périodes";
    $("resume-filtres-texte").textContent = (etat.mode === "cercle" ? "Cercle de " + (etat.cercle ? rayonTxt(etat.cercle.r) : "") : nomZone()) + " · " + t + " · " + c;
  }
  function construite(per) {
    if (per == null || per < 0 || !M.periodes[per]) return "période de construction non renseignée";
    return "construite " + M.periodes[per][0];
  }
  function nomRepresentant(e) {
    if (e >= 0) return ENTS[e].nom;
    if (e === BENEVOLE) return "syndic bénévole";
    return (M.representants && M.representants[String(e)]) || "non connu";
  }
  function rendreResumeCopro() {
    const el = $("resume-copro"), aide = $("aide-immat");
    if (etat.copro == null) { el.hidden = true; el.innerHTML = ""; aide.hidden = false; return; }
    const i = etat.copro, e = ENT[i];
    el.innerHTML = "<p>Votre copropriété : " + esc(pl(LOTS[i], "lot", "lots")) + " · " + esc(construite(PER[i])) + " · syndic déclaré : " + esc(nomRepresentant(e)) + "</p>"
      + '<div class="resume-actions"><button type="button" class="btn" data-act="retirer-copro">Retirer</button>'
      + (e >= 0 ? '<button type="button" class="btn" data-act="fiche" data-ent="' + e + '">Voir la fiche de votre syndic</button>' : "") + "</div>";
    el.hidden = false;
    aide.hidden = true;
  }

  // ---------- Tableau des syndics ----------
  function lignesTableau(R) {
    const ref = pointRef(), q = etat.recherche ? norm(etat.recherche) : "";
    let out = [];
    for (const kv of R.A.par) {
      const s = kv[1];
      if (!(s.comp > 0 || s.n0 > 0)) continue;
      const e = ENTS[kv[0]];
      out.push({ ei: kv[0], e, s, bi: bureauInfo(e, ref), cles: {} });
    }
    if (etat.groupes) out = regrouper(out);
    if (q) out = out.filter((lg) => lg.e.cherche.indexOf(q) >= 0);
    return out;
  }
  // « Groupe CITYA », mais « Groupe de 3 sociétés » quand le groupe n'a pas de marque
  function nomGroupe(g) { return /^groupe\s/i.test(g.libelle) ? majuscule(g.libelle) : "Groupe " + g.libelle; }
  // « Regrouper les sociétés d'un même groupe » : une ligne par groupe. Une copropriété passée d'une société du
  // groupe à une autre y reste ; une arrivée venue du même groupe n'en est pas une.
  function regrouper(lignes) {
    const parG = new Map(), out = [];
    for (const lg of lignes) {
      const g = lg.e.groupe;
      if (!g) { out.push(lg); continue; }
      let x = parG.get(g.id);
      if (!x) { x = { g, membres: [], s: nouveauStat() }; parG.set(g.id, x); }
      x.membres.push(lg);
      for (const k of Object.keys(x.s)) x.s[k] += lg.s[k] || 0;
    }
    for (const x of parG.values()) {
      if (x.membres.length < 2) { out.push(x.membres[0]); continue; }
      const s = x.s;
      s.restees += s.groupe; s.internes += s.groupe; s.groupe = 0; s.arrGroupe = 0;
      let bi = null;
      for (const m of x.membres) if (m.bi && (!bi || (m.bi.d != null && (bi.d == null || m.bi.d < bi.d)))) bi = m.bi;
      x.membres.sort((a, b) => a.e.tri.localeCompare(b.e.tri, "fr"));   // ordre alphabétique, jamais la taille
      const nom = nomGroupe(x.g);
      out.push({ ei: -1, groupe: x.g, membres: x.membres, s, bi, cles: {},
        e: { i: -1, nom, tri: norm(nom), masque: true, s: {}, groupe: x.g, cherche: norm(nom) + " " + x.membres.map((m) => m.e.cherche).join(" ") } });
    }
    return out;
  }
  function trierLignes(lignes, colId, dir, T) {
    const c = colId === "nom" ? null : colParId(colId), sgn = dir === "asc" ? 1 : -1;
    if (c) for (const lg of lignes) lg.cles[c.id] = cleCol(c, lg, T);
    lignes.sort((a, b) => {
      const ka = c ? a.cles[c.id] : a.e.tri, kb = c ? b.cles[c.id] : b.e.tri;
      const na = ka == null, nbb = kb == null;
      if (na !== nbb) return na ? 1 : -1;
      if (!na) {
        const d = typeof ka === "string" ? ka.localeCompare(kb, "fr") : ka - kb;
        if (d) return d * sgn;
      }
      return a.e.tri.localeCompare(b.e.tri, "fr");   // à clés égales, le nom départage, jamais la taille
    });
  }
  function etiquettes(ei) {
    const e = ENTS[ei], out = [];
    if (monSyndic() === ei) out.push('<span class="etiquette forte">Votre syndic</span>');
    if (e.groupe) out.push('<span class="etiquette">' + esc(nomGroupe(e.groupe)) + "</span>");
    // une procédure collective n'apparaît ici que si son annonce a moins de 5 ans ; la fiche les garde toutes
    const proc = bodaccFaits(e, false).find((x) => /^Procédure/.test(x[0]));
    if (proc) out.push('<span class="etiquette">' + esc(proc[0]) + "</span>");
    return out.join("");
  }
  function dansListe(ei) { return etat.liste.indexOf(ENTS[ei].ancre) >= 0; }
  // bouton de liste courte : il dit ce qu'il fera, et répond sur place (« Ajouté · 2 sur 3 »)
  function boutonListe(ei, large) {
    const dedans = dansListe(ei), plein = !dedans && etat.liste.length >= MAX_LISTE, nom = ENTS[ei].nom;
    const lib = dedans ? "Retirer de la liste courte" : plein ? "Liste pleine" : "Ajouter à la liste courte";
    const aria = (dedans ? "Retirer " + nom + " de la liste courte" : "Ajouter " + nom + " à la liste courte") + (plein ? " : liste pleine" : "");
    const st = etat.statutListe && etat.statutListe.ei === ei ? etat.statutListe.t : "";
    return '<span class="bloc-liste"><button type="button" class="btn btn-liste' + (large ? "" : " compact") + (dedans ? " dedans" : "") + '" data-act="liste" data-ent="' + ei + '"'
      + (plein ? ' aria-disabled="true"' : "") + ' aria-label="' + esc(aria) + '">' + esc(lib) + "</button>"
      + '<span class="statut-liste" role="status">' + esc(st) + "</span></span>";
  }
  function pastilleCarte(ei) {
    const slot = etat.couleurs.get(ei);
    return slot ? '<span class="pastille c' + slot + '" title="En couleur sur la carte" aria-hidden="true"></span>' : "";
  }
  function attributsLigne(lg) { return (lg.rang != null ? ' data-rang="' + lg.rang + '"' : "") + (lg.s.comp === 0 ? ' data-ancien="1"' : ""); }
  function ligneSyndic(lg, cols, T) {
    const e = lg.e;
    if (lg.groupe) {
      let g = '<tr class="ligne-groupe"' + attributsLigne(lg) + '><th scope="row" class="col-colle"><strong>' + esc(e.nom) + "</strong>"
        + '<div class="sous-ligne"><span>' + esc(pl(lg.membres.length, "société", "sociétés") + " :") + "</span> " + lg.membres.map((m) => '<button type="button" class="nom-syndic" data-ent="' + m.ei + '">' + esc(m.e.nom) + "</button>").join(" · ") + "</div></th>";
      for (const c of cols) g += "<td" + (c.num ? ' class="num"' : "") + ">" + htmlCol(c, lg.s, T, e, lg) + "</td>";
      return g + '<td class="col-actions"><span class="petit muted">Ouvrez une de ses sociétés</span></td></tr>';
    }
    let h = '<tr data-ent="' + lg.ei + '"' + attributsLigne(lg) + '><th scope="row" class="col-colle">' + pastilleCarte(lg.ei) + '<button type="button" class="nom-syndic" data-ent="' + lg.ei + '">' + esc(e.nom) + "</button>"
      + '<div class="sous-ligne">' + (e.s.forme_courte && !e.masque ? "<span>" + esc(e.s.forme_courte) + "</span>" : "") + etiquettes(lg.ei) + "</div></th>";
    for (const c of cols) h += "<td" + (c.num ? ' class="num"' : "") + ">" + htmlCol(c, lg.s, T, e, lg) + "</td>";
    return h + '<td class="col-actions">' + boutonListe(lg.ei, false) + "</td></tr>";
  }
  function niveauxReperes(R) {
    const z = etat.mode === "liste" ? Z[etat.zone] : null;
    if (z && z.dep) return [["Ensemble des syndics professionnels du département", R.A.tot]];
    const niv = [[R.com && R.com.meme ? "Ensemble des syndics professionnels de la commune" : "Ensemble des syndics professionnels de la zone", R.A.tot]];
    if (etat.colonnes !== "presence" && etat.colonnes !== "societe") {
      if (R.C) niv.push(["Ensemble des syndics professionnels de la commune", R.C.tot]);
      niv.push(["Ensemble des syndics professionnels du département", R.Dp.tot]);
    }
    return niv;
  }
  function lignesReperes(R, cols) {
    return niveauxReperes(R).map((x) => '<tr class="repere"><th scope="row" class="col-colle">' + esc(x[0])
      + '<span class="taux-detail">toutes les copropriétés comparables gérées par un syndic professionnel</span></th>'
      + cols.map((c) => "<td" + (c.num ? ' class="num"' : "") + ">" + (c.soc || c.id === "bureau" ? "—" : htmlCol(c, x[1], x[1])) + "</td>").join("") + "<td></td></tr>").join("");
  }
  function lignesAutres(T, ncols) {
    const out = [];
    const ajout = (lab, n) => {
      if (!n) return;
      out.push('<tr class="benevoles"><th scope="row" class="col-colle">' + esc(lab) + '</th><td colspan="' + (ncols + 1) + '">'
        + esc(pl(n, "copropriété comparable", "copropriétés comparables") + ", " + pct(n / T.comparables, n)) + "</td></tr>");
    };
    ajout("Syndics bénévoles (non nommés)", T.benevoles);
    ajout("Syndics professionnels sans numéro d'établissement (SIRET) déclaré", T.sansSiret);
    ajout("Type de syndic non connu, ou aucun syndic déclaré", T.inconnus);
    return out.join("");
  }
  function messageVide(R) {
    const T = R.A.tot, filtre = etat.taille >= 0 || etat.constr >= 0;
    if (!T.comparables) {
      return '<div class="message"><p>Aucune copropriété comparable dans cette zone. Élargissez le cercle, choisissez la commune entière, ou retirez un critère de comparaison.</p>'
        + (filtre ? '<button type="button" class="btn" data-act="retirer-filtres">Retirer les critères de comparaison</button>' : "") + "</div>";
    }
    return '<div class="message"><p>Aucune copropriété comparable de cette zone ne déclare un syndic professionnel. Il n\'y a pas de syndic professionnel à comparer ici.</p>'
      + (peutElargir() ? '<button type="button" class="btn" data-act="elargir">Élargir la zone</button>' : "") + "</div>";
  }
  function peutElargir() {
    if (etat.mode === "cercle") return etat.cercle && etat.cercle.r < 5000;
    return !!Z[etat.zone].p;
  }
  function elargir() {
    if (etat.mode === "cercle" && etat.cercle) {
      const r = [300, 500, 1000, 2000, 5000].find((x) => x > etat.cercle.r) || 5000;
      etat.cercle.r = r;
      const radio = document.querySelector('input[name="rayon"][value="' + r + '"]');
      if (radio) radio.checked = true;
      majTout({ nouvelleZone: true, cadrer: true, annonce: true });
    } else if (Z[etat.zone].p) choisirZone(Z[etat.zone].p.i);
  }

  // ---------- Premier écran : le département sans aucun nom (spécification V3, P0-1) ----------
  // Aucun exemple préchargé : le tableau n'apparaît qu'après un choix (copropriété, adresse, commune, syndic, tout le département).
  const CLASSES_TAILLE = [[1, 9], [10, 49], [50, 199], [200, Infinity]];
  function statsPanorama() {
    return memo("PANO", () => {
      const t = etat.taille, c = etat.constr;
      etat.taille = -1; etat.constr = -1;   // sans critère de comparaison
      let A;
      try { A = agreger(TOUTES); } finally { etat.taille = t; etat.constr = c; }
      const classes = CLASSES_TAILLE.map((b) => ({ min: b[0], max: b[1], syndics: 0, copros: 0 }));
      let syndics = 0, gerees = 0;
      for (const s of A.par.values()) {
        if (!(s.tout > 0)) continue;
        syndics++; gerees += s.tout;
        const k = classes.find((x) => s.tout >= x.min && s.tout <= x.max);
        k.syndics++; k.copros += s.tout;
      }
      return { T: A.tot, syndics, gerees, classes };
    });
  }
  function panoramaHtml() {
    const P = statsPanorama(), T = P.T, dep = (M.nom_departement || DEPARTEMENTS[M.departement] || "Département") + " (" + M.departement + ")";
    const autres = [["syndic bénévole", T.benevoles], ["syndic professionnel sans numéro d'établissement (SIRET) déclaré", T.sansSiret], ["aucun syndic déclaré, ou type de syndic non connu", T.inconnus]]
      .filter((x) => x[1] > 0).map((x) => x[0] + " (" + nb(x[1]) + ")");
    const lib = (x) => (x.max === Infinity ? nb(x.min) + " copropriétés et plus" : nb(x.min) + " à " + nb(x.max) + " copropriétés");
    return '<section class="panorama" aria-labelledby="panorama-titre"><h3 id="panorama-titre">' + esc(dep + ", aujourd'hui") + "</h3>"
      + "<p>" + esc(pl(T.copros, "copropriété est inscrite", "copropriétés sont inscrites") + " au registre. "
        + pl(P.syndics, "syndic professionnel identifié en gère", "syndics professionnels identifiés en gèrent") + " " + nb(P.gerees) + "."
        + (autres.length ? " Pour les autres : " + autres.join(" ; ") + "." : "")) + "</p>"
      + "<p>" + esc("Les syndics n'ont pas tous la même taille :") + "</p>"
      + '<div class="defile" tabindex="0"><table class="simple panorama-tailles"><caption class="sr-only">' + esc("Syndics professionnels du département, selon le nombre de copropriétés qu'ils y gèrent") + "</caption>"
      + '<thead><tr><th scope="col">Taille du syndic dans le département</th><th scope="col">Syndics</th><th scope="col">Copropriétés gérées</th></tr></thead><tbody>'
      + P.classes.map((x) => '<tr><th scope="row">' + esc(lib(x)) + '</th><td class="num">' + nb(x.syndics) + '</td><td class="num">' + nb(x.copros) + "</td></tr>").join("")
      + "</tbody></table></div>"
      + '<p class="petit muted">' + esc("Registre des copropriétés, données du " + dateLongue(M.date_reference) + ".") + "</p>"
      + '<p class="panorama-suite">' + esc("Choisissez votre copropriété, une commune ou un syndic pour commencer.")
      + ' <button type="button" class="btn" data-act="tout-departement">Voir tous les syndics du département, par ordre alphabétique</button></p></section>';
  }
  function rendreTableau(R) {
    const cont = $("tableau-contenu"), T = R.A.tot;
    document.documentElement.classList.toggle("en-panorama", !!etat.panorama);
    if (etat.panorama) {
      $("syndics-titre").textContent = "Syndics du département";
      cont.innerHTML = panoramaHtml();
      majExport(R, []);
      return;
    }
    $("syndics-titre").textContent = etat.mode === "cercle" ? "Syndics du cercle" : Z[etat.zone] && Z[etat.zone].dep ? "Syndics du département" : "Syndics de la zone";
    rendreRecherche(R);
    if (!T.comparables || !T.comp) {
      cont.innerHTML = messageVide(R) + (T.comparables ? '<div class="defile"><table class="syndics"><tbody>' + lignesAutres(T, 1) + "</tbody></table></div>" : "");
      majExport(R, []);
      return;
    }
    const cols = colonnesVue(etat.colonnes);
    let lignes = lignesTableau(R);
    // les syndics de 2025 qui n'ont plus de copropriété comparable déclarée ici sont repliés, sauf pour le devenir
    const replier = etat.colonnes !== "devenir" && !etat.voirAnciens && !etat.recherche;
    const anciens = replier ? lignes.filter((lg) => lg.s.comp === 0).length : 0;
    if (replier) lignes = lignes.filter((lg) => lg.s.comp > 0);
    trierLignes(lignes, etat.tri.col, etat.tri.dir, T);
    majExport(R, lignes);
    const colTri = etat.tri.col === "nom" ? null : colParId(etat.tri.col);
    const visibles = lignes.slice(0, etat.limite);
    lignes.forEach((lg) => { lg.rang = null; });
    visibles.forEach((lg, k) => { lg.rang = k; });
    const mon = monSyndic();
    let epingle = "";
    if (mon != null) {
      const k = lignes.findIndex((lg) => lg.ei === mon);
      if (k >= etat.limite) epingle = ligneSyndic(lignes[k], cols, T);
    }
    // en-tête : titres triables, puis leur définition écrite en dessous
    const th = (c) => {
      if (c.sansTri) return '<th scope="col">' + esc(c.titre) + "</th>";
      const actif = memeTri(etat.tri.col, c.id), sort = actif ? (etat.tri.dir === "asc" ? "ascending" : "descending") : null;
      return '<th scope="col"' + (sort ? ' aria-sort="' + sort + '"' : "") + '><button type="button" class="tri" data-col="' + c.id + '">'
        + esc(c.titre) + ' <span class="fleche" aria-hidden="true">' + (actif ? (etat.tri.dir === "asc" ? "↑" : "↓") : "") + "</span></button></th>";
    };
    const actifNom = etat.tri.col === "nom";
    const parDefaut = etat.tri.col === "nom" && etat.tri.dir === "asc";
    const ou = etat.mode === "cercle" ? "du cercle" : Z[etat.zone] && Z[etat.zone].dep ? "du département" : "de la zone";
    const legende = "Syndics professionnels des copropriétés comparables " + ou
      + (parDefaut ? ", par ordre alphabétique. L'ordre ne dit rien de leur qualité." : ", triés par « " + (colTri ? colTri.titre : "Syndic") + " »");
    let h = '<div class="tableau-ordinateur"><p class="legende-tableau" aria-hidden="true">' + esc(legende) + "</p>"
      + '<div class="defile" tabindex="0" role="region" aria-labelledby="legende-tableau"><table class="syndics vue-' + esc(etat.colonnes) + '">';
    h += '<caption id="legende-tableau" class="sr-only">' + esc(legende) + "</caption>";
    h += '<thead><tr><th scope="col" class="col-colle"' + (actifNom ? ' aria-sort="' + (etat.tri.dir === "asc" ? "ascending" : "descending") + '"' : "")
      + '><button type="button" class="tri" data-col="nom">Syndic <span class="fleche" aria-hidden="true">' + (actifNom ? (etat.tri.dir === "asc" ? "↑" : "↓") : "") + "</span></button></th>"
      + cols.map(th).join("") + '<th scope="col" class="col-actions">Liste courte</th></tr>'
      + '<tr class="definitions"><td class="col-colle">Nom déclaré au répertoire des entreprises.</td>'
      + cols.map((c) => "<td>" + (c.devenir ? legendeDevenirs() : "") + esc(defCol(c)) + "</td>").join("")
      + "<td>" + esc("3 syndics au plus, à comparer. Ils sont en couleur sur la carte, avec votre syndic.") + "</td></tr></thead><tbody>";
    h += lignesReperes(R, cols) + epingle;
    let separe = false;
    for (const lg of visibles) {
      if (colTri && colTri.taux && !separe && lg.cles[colTri.id] == null) {
        h += '<tr class="separateur"><td colspan="' + (cols.length + 2) + '">Moins de 10 copropriétés : pas de pourcentage</td></tr>';
        separe = true;
      }
      h += ligneSyndic(lg, cols, T);
    }
    if (anciens && lignes.length <= etat.limite) {
      h += '<tr class="separateur"><td colspan="' + (cols.length + 2) + '">' + esc(pl(anciens, "syndic déclaré ici en 2025 n'y a", "syndics déclarés ici en 2025 n'y ont") + " plus de copropriété comparable déclarée.")
        + ' <button type="button" class="btn-lien" data-act="anciens">Les afficher</button></td></tr>';
    }
    h += lignesAutres(T, cols.length) + "</tbody></table></div></div>";

    // téléphone : une carte par syndic
    const cChiffre = colParId(etat.chiffreTel) || colParId("devenir");
    let reperesTel = "";
    if (cChiffre.taux) {
      const r = [["zone", R.A.tot]];
      if (R.C) r.push(["commune", R.C.tot]);
      if (R.Dp !== R.A) r.push(["département", R.Dp.tot]);
      reperesTel = '<p class="reperes-tel">Repères, ' + esc(cChiffre.titre.toLowerCase()) + " : " + r.map((x) => esc(x[0] + " " + texteCol(cChiffre, x[1], x[1]))).join(" · ") + "</p>";
    }
    const carteTel = (lg) => {
      const e = lg.e;
      if (lg.groupe) {
        return '<li class="carte-syndic carte-groupe"' + attributsLigne(lg) + '><div class="ligne"><strong>' + esc(e.nom) + "</strong></div>"
          + '<div class="sous-ligne">' + lg.membres.map((m) => '<button type="button" class="nom-syndic" data-ent="' + m.ei + '">' + esc(m.e.nom) + "</button>").join(" · ") + "</div>"
          + '<div class="ligne"><span>' + esc(pl(lg.s.comp, "copropriété comparable", "copropriétés comparables")) + "</span></div>"
          + (cChiffre.id !== "comp" && cChiffre.id !== "compPart" ? '<div class="ligne-chiffre"><span class="petit">' + esc(cChiffre.titre) + "</span>" + (cChiffre.devenir ? htmlCol(cChiffre, lg.s, T, e, lg) : "<span>" + esc(texteCol(cChiffre, lg.s, T, e, lg)) + "</span>") + "</div>" : "") + "</li>";
      }
      return '<li class="carte-syndic" data-ent="' + lg.ei + '"' + attributsLigne(lg) + '><div class="ligne">' + pastilleCarte(lg.ei) + '<button type="button" class="nom-syndic" data-ent="' + lg.ei + '">' + esc(e.nom) + "</button></div>"
        + '<div class="sous-ligne">' + (e.s.forme_courte && !e.masque ? "<span>" + esc(e.s.forme_courte) + "</span>" : "") + etiquettes(lg.ei) + "</div>"
        + '<div class="ligne"><span>' + esc(pl(lg.s.comp, "copropriété comparable", "copropriétés comparables")) + "</span></div>"
        + (cChiffre.id !== "comp" && cChiffre.id !== "compPart" ? '<div class="ligne-chiffre"><span class="petit">' + esc(cChiffre.titre) + "</span>" + (cChiffre.devenir ? htmlCol(cChiffre, lg.s, T, e, lg) : "<span>" + esc(texteCol(cChiffre, lg.s, T, e, lg)) + "</span>") + "</div>" : "")
        + '<p class="petit muted bureau-tel">' + esc(bureauTxt(lg.bi, true)) + "</p>"
        + '<div class="actions"><button type="button" class="btn" data-act="fiche" data-ent="' + lg.ei + '">Voir la fiche</button>' + boutonListe(lg.ei, true) + "</div></li>";
    };
    h += reperesTel + '<ul class="cartes-syndics">';
    if (epingle) h += carteTel(lignes.find((lg) => lg.ei === mon));
    let separeTel = false;
    for (const lg of visibles) {
      if (colTri && colTri.taux && !separeTel && lg.cles[colTri.id] == null) {
        h += '<li class="reperes-tel" role="presentation">Moins de 10 copropriétés : pas de pourcentage</li>';
        separeTel = true;
      }
      h += carteTel(lg);
    }
    h += "</ul>";
    const autresTel = [];
    if (anciens && lignes.length <= etat.limite) autresTel.push(esc(pl(anciens, "syndic déclaré ici en 2025 n'y a", "syndics déclarés ici en 2025 n'y ont") + " plus de copropriété comparable déclarée.") + ' <button type="button" class="btn-lien" data-act="anciens">Les afficher</button>');
    if (T.benevoles) autresTel.push(esc("Syndics bénévoles (non nommés) : " + pl(T.benevoles, "copropriété comparable", "copropriétés comparables") + ", " + pct(T.benevoles / T.comparables, T.benevoles)));
    if (T.inconnus) autresTel.push(esc("Type de syndic non connu, ou aucun syndic déclaré : " + pl(T.inconnus, "copropriété comparable", "copropriétés comparables") + ", " + pct(T.inconnus / T.comparables, T.inconnus)));
    if (autresTel.length) h += '<div class="cartes-syndics"><p class="reperes-tel">' + autresTel.join("<br>") + "</p></div>";
    if (lignes.length > etat.limite) h += '<button type="button" class="btn suite-btn" data-act="suite">Afficher les ' + esc(pl(lignes.length - etat.limite, "syndic suivant", "syndics suivants")) + "</button>";
    cont.innerHTML = h;
    const triTel = $("tri-tel");
    if (triTel && Array.from(triTel.options).some((o) => o.value === etat.tri.col)) triTel.value = etat.tri.col;
  }

  // ---------- Carte ----------
  function lireCouleurs() {
    const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
    COUL = { land: v("--map-land"), out: v("--map-land-out"), border: v("--map-border"), zone: v("--map-zone"), s1: v("--syn-1"), s2: v("--syn-2"), s3: v("--syn-3"),
      other: v("--syn-other"), ring: v("--benevole-ring"), ink: v("--ink"), control: v("--control"), accent: v("--accent"), band: v("--band-998") };
  }
  function rafraichirCouleurs() {
    window.setTimeout(() => {
      lireCouleurs();
      if (!carte) return;
      styleContours();
      if (coucheCercle) coucheCercle.setStyle({ color: COUL.accent, fillColor: COUL.band });
      couchePoints.redessiner();
    }, 0);
  }
  // avec le plan IGN, la zone choisie laisse voir les rues et le reste est voilé ; sans tuiles, le fond est plein
  function styleContours() {
    if (!coucheContours) return;
    const sel = codesSelection();
    coucheContours.eachLayer((l) => {
      const choisi = sel.has(l.feature.properties.code);
      l.setStyle(choisi ? { fillColor: COUL.land, fillOpacity: tuilesOk ? 0 : 1, color: COUL.zone, weight: 2.5 }
        : { fillColor: COUL.out, fillOpacity: tuilesOk ? 0.55 : 1, color: COUL.border, weight: 1 });
      if (choisi) l.bringToFront();
    });
  }
  // Plan IGN de la Géoplateforme, essayé quand la carte devient visible ; en repli, le fond sans tuiles
  const URL_IGN = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
  let coucheTuiles = null, tuilesOk = false, tuilesEssayees = false, attributionFond = "";
  function majAttribution() {
    if (!carte) return;
    if (attributionFond) carte.attributionControl.removeAttribution(attributionFond);
    attributionFond = tuilesOk ? "Fond : Plan IGN, Géoplateforme (licence à vérifier) · Contours : IGN, via geo.api.gouv.fr" : "Contours : IGN, via geo.api.gouv.fr · Fond sans tuiles";
    carte.attributionControl.addAttribution(attributionFond);
  }
  function retirerTuiles() {
    if (coucheTuiles && carte) carte.removeLayer(coucheTuiles);
    coucheTuiles = null; tuilesOk = false;
    styleContours(); majAttribution(); rendreLegende(calculer());
  }
  function essayerTuiles() {
    if (tuilesEssayees || !carte || !window.L) return;
    const el = $("carte");
    if (!el.offsetWidth || !el.offsetHeight) return;
    tuilesEssayees = true;
    let erreurs = 0;
    coucheTuiles = L.tileLayer(URL_IGN, { minZoom: 6, maxZoom: 19, className: "tuiles-ign", crossOrigin: false });
    coucheTuiles.on("tileload", () => { if (!tuilesOk) { tuilesOk = true; styleContours(); majAttribution(); rendreLegende(calculer()); } });
    coucheTuiles.on("tileerror", () => { erreurs++; if (!tuilesOk && erreurs >= 4) retirerTuiles(); });
    coucheTuiles.addTo(carte);
    window.setTimeout(() => { if (!tuilesOk && coucheTuiles) retirerTuiles(); }, 8000);
  }
  const CouchePoints = L.Layer.extend({
    onAdd(map) {
      this._carte = map;
      this._c = L.DomUtil.create("canvas", "couche-points");
      this._c.style.pointerEvents = "none";
      this.getPane().appendChild(this._c);
      map.on("moveend zoomend resize viewreset", this.redessiner, this);
      map.on("zoomstart", this._cacher, this);
      this.redessiner();
    },
    onRemove(map) {
      L.DomUtil.remove(this._c);
      map.off("moveend zoomend resize viewreset", this.redessiner, this);
      map.off("zoomstart", this._cacher, this);
    },
    _cacher() { this._c.style.visibility = "hidden"; },
    redessiner() {
      const map = this._carte;
      if (!map || !map._loaded) return;
      const t = map.getSize(), dpr = window.devicePixelRatio || 1, c = this._c;
      L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
      c.width = Math.max(1, Math.round(t.x * dpr)); c.height = Math.max(1, Math.round(t.y * dpr));
      c.style.width = t.x + "px"; c.style.height = t.y + "px";
      c.style.visibility = "visible";
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, t.x, t.y);
      dessinerPoints(ctx, map, t);
    },
  });
  // catégories de dessin : 0 type non connu, 1 bénévole, 2 autre professionnel, 3 à 5 syndics en couleur
  function categorie(e) {
    if (e === INCONNU) return 0;
    if (e === BENEVOLE) return 1;
    if (e >= 0 && etat.couleurs.has(e)) return 2 + etat.couleurs.get(e);
    return 2;
  }
  function dessinerPoints(ctx, map, t) {
    const n = PTS.length;
    XY = new Float32Array(n * 2);
    for (let j = 0; j < n; j++) {
      const i = PTS[j], p = map.latLngToContainerPoint([LAT[i], LON[i]]);
      XY[2 * j] = p.x; XY[2 * j + 1] = p.y;
    }
    const styles = [
      { r: 3, fill: COUL.land, stroke: COUL.control, w: 1.25 },
      { r: 4.5, fill: COUL.land, stroke: COUL.ring, w: 2 },
      { r: 4, fill: COUL.other, stroke: COUL.land, w: 1.5 },
      { r: 4, fill: COUL.s1, stroke: COUL.land, w: 1.5 },
      { r: 4, fill: COUL.s2, stroke: COUL.land, w: 1.5 },
      { r: 4, fill: COUL.s3, stroke: COUL.land, w: 1.5 },
    ];
    const surb = etat.surb, marge = 8;
    ctx.globalAlpha = surb >= 0 ? 0.35 : 1;
    for (let cat = 0; cat < styles.length; cat++) {
      const st = styles[cat];
      ctx.beginPath();
      let vide = true;
      for (let j = 0; j < n; j++) {
        const e = ENT[PTS[j]];
        if (categorie(e) !== cat) continue;
        const x = XY[2 * j], y = XY[2 * j + 1];
        if (x < -marge || y < -marge || x > t.x + marge || y > t.y + marge) continue;
        ctx.moveTo(x + st.r, y);
        ctx.arc(x, y, st.r, 0, 2 * Math.PI);
        vide = false;
      }
      if (vide) continue;
      ctx.fillStyle = st.fill; ctx.fill();
      ctx.lineWidth = st.w; ctx.strokeStyle = st.stroke; ctx.stroke();
    }
    if (surb >= 0) {
      ctx.globalAlpha = 1;
      const st = styles[categorie(surb)];
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        if (ENT[PTS[j]] !== surb) continue;
        const x = XY[2 * j], y = XY[2 * j + 1];
        ctx.moveTo(x + 5.5, y);
        ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
      }
      ctx.fillStyle = st.fill; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = COUL.ink; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function pointSous(cp) {
    let best = -1, dm = 100;   // 10 px au plus
    for (let j = 0; j < PTS.length; j++) {
      const dx = XY[2 * j] - cp.x, dy = XY[2 * j + 1] - cp.y, d = dx * dx + dy * dy;
      if (d <= dm) { dm = d; best = j; }
    }
    return best >= 0 ? PTS[best] : null;
  }
  // info-bulle d'une copropriété : « C'est ma copropriété », « Voir la fiche de son syndic » (audit P2-5)
  function infoCopro(i) {
    const div = document.createElement("div");
    div.innerHTML = '<strong>Copropriété <span class="immat">' + esc(IMMAT[i]) + "</span></strong><br>" + esc(pl(LOTS[i], "lot", "lots") + " · " + construite(PER[i]))
      + "<br>Syndic déclaré : " + esc(nomRepresentant(ENT[i])) + '<br><span class="muted">Registre du ' + esc(dateLongue(M.date_reference)) + "</span>"
      + '<div class="popup-actions">' + (etat.copro === i ? '<span class="etiquette forte">Votre copropriété</span>' : '<button type="button" class="btn compact" data-act="ma-copro">C\'est ma copropriété</button>')
      + (ENT[i] >= 0 ? '<button type="button" class="btn compact" data-act="fiche" data-ent="' + ENT[i] + '">Voir la fiche de son syndic</button>' : "") + "</div>";
    div.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      carte.closePopup();
      if (b.dataset.act === "ma-copro") definirCopro(i); else ouvrirFiche(Number(b.dataset.ent));
    });
    L.popup({ maxWidth: 300 }).setLatLng([LAT[i], LON[i]]).setContent(div).openOn(carte);
  }
  function surbrillance(ei) {
    if (etat.surb === ei) return;
    etat.surb = ei;
    if (couchePoints) couchePoints.redessiner();
  }
  function initCarte() {
    lireCouleurs();
    const reduit = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    carte = L.map("carte", {
      preferCanvas: true, renderer: L.canvas({ tolerance: 8 }), zoomControl: false, attributionControl: true, keyboard: true,
      minZoom: 6, maxZoom: 17, zoomSnap: 0.25, scrollWheelZoom: false,
      zoomAnimation: !reduit, fadeAnimation: !reduit, markerZoomAnimation: !reduit, inertia: !reduit,
    });
    L.control.zoom({ position: "topright", zoomInTitle: "Zoomer", zoomOutTitle: "Dézoomer" }).addTo(carte);
    carte.attributionControl.setPrefix(false);
    majAttribution();
    const z0 = Z[etat.zone];
    carte.setView([z0.lat || 43.3, z0.lon || 5.4], 12);
    carte.createPane("points");
    carte.getPane("points").style.zIndex = 450;
    carte.getPane("points").style.pointerEvents = "none";
    coucheContours = L.geoJSON({ type: "FeatureCollection", features: FEATS.map((x) => x.f) }, { interactive: false, style: () => ({ fillColor: COUL.out, fillOpacity: 1, color: COUL.border, weight: 1 }) }).addTo(carte);
    couchePoints = new CouchePoints({ pane: "points" }).addTo(carte);
    coucheBureaux = L.layerGroup().addTo(carte);
    coucheCopro = L.layerGroup().addTo(carte);
    const v = document.createElement("div");
    v.className = "viseur-centre"; v.id = "viseur"; v.hidden = true;
    v.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M12 1v9M12 14v9M1 12h9M14 12h9" stroke="currentColor" stroke-width="2.25" fill="none"/></svg>';
    carte.getContainer().appendChild(v);
    carte.on("click", clicCarte);
    carte.getContainer().addEventListener("mouseenter", () => {
      if (!aideMolette && !carte.scrollWheelZoom.enabled() && !etat.choixCentre) { aideMolette = true; $("carte-aide").textContent = "Cliquez dans la carte pour zoomer avec la molette."; }
    });
    if (window.ResizeObserver) new ResizeObserver(() => { carte.invalidateSize(); if (cadragePrevu) cadrer(); couchePoints.redessiner(); essayerTuiles(); }).observe($("carte"));
  }
  function clicCarte(ev) {
    if (!carte.scrollWheelZoom.enabled()) {
      carte.scrollWheelZoom.enable();
      if (!etat.choixCentre) $("carte-aide").textContent = "";
    }
    if (etat.choixCentre) return;
    const i = pointSous(ev.containerPoint);
    if (i != null) { infoCopro(i); return; }
    if (etat.mode === "cercle") { definirCentre(ev.latlng.lat, ev.latlng.lng, "point"); return; }
    const z = zoneSous(ev.latlng.lat, ev.latlng.lng);
    if (z && z.i !== etat.zone) choisirZone(z.i);
  }
  function cadrer() {
    if (!carte) return;
    const el = $("carte");
    if (!el.offsetWidth || !el.offsetHeight) { cadragePrevu = true; return; }
    cadragePrevu = false;
    carte.invalidateSize();
    let b = null;
    if (etat.mode === "cercle" && etat.cercle) b = L.latLng(etat.cercle.lat, etat.cercle.lon).toBounds(etat.cercle.r * 2.3);
    else {
      const sel = codesSelection();
      b = L.latLngBounds([]);
      coucheContours.eachLayer((l) => { if (sel.has(l.feature.properties.code)) b.extend(l.getBounds()); });
    }
    if (b && b.isValid()) carte.fitBounds(b, { padding: [16, 16], maxZoom: 16, animate: false });
  }
  function rendreCarte(R, recadrer) {
    if (!carte) return;
    styleContours();
    // cercle
    if (coucheCercle) { carte.removeLayer(coucheCercle); coucheCercle = null; }
    if (etat.mode === "cercle" && etat.cercle) {
      coucheCercle = L.circle([etat.cercle.lat, etat.cercle.lon], { radius: etat.cercle.r, color: COUL.accent, weight: 2, fillColor: COUL.band, fillOpacity: 1, interactive: false }).addTo(carte);
    }
    // points : les seules copropriétés comparables, présentes au registre aujourd'hui
    const rows = lignesCourantes(), pts = [];
    for (let j = 0; j < rows.length; j++) { const i = rows[j]; if (SYN[i] !== ABSENTE && comparable(i) && isFinite(LAT[i])) pts.push(i); }
    PTS = Int32Array.from(pts);
    // bureaux : le plus proche de chaque syndic en couleur, et de votre syndic
    // (un losange par syndic de la zone couvrait les points de la carte)
    coucheBureaux.clearLayers();
    const ref = pointRef(), aMontrer = new Set(etat.couleurs.keys()), mon = monSyndic();
    if (mon != null) aMontrer.add(mon);
    for (const ei of aMontrer) {
      const e = ENTS[ei], bp = bureauProche(e, ref);
      if (!bp) continue;
      const slot = etat.couleurs.get(ei);
      const icone = L.divIcon({ className: "bureau-icone", iconSize: [14, 14], iconAnchor: [7, 7],
        html: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M7 .9 13.1 7 7 13.1 .9 7Z" style="fill:var(' + (slot ? "--syn-" + slot : "--syn-other") + ');stroke:var(--ink);stroke-width:1.5"/></svg>' });
      L.marker([bp.b.lat, bp.b.lon], { icon: icone, keyboard: false, zIndexOffset: slot ? 500 : 0 })
        .bindTooltip("Bureau de " + esc(e.nom) + (bp.b.precision === "approchee" ? " (position approchée)" : "") + (ref && bp.d != null ? " · à " + esc(distanceTxt(bp.d)) + " " + esc(ref.quoi) : ""))
        .addTo(coucheBureaux);
    }
    // votre copropriété
    coucheCopro.clearLayers();
    if (etat.copro != null) {
      L.marker([LAT[etat.copro], LON[etat.copro]], { interactive: false, keyboard: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: "marqueur-copro", iconSize: [22, 22], iconAnchor: [11, 11],
          html: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="11" cy="11" r="2.5" fill="currentColor"/></svg><span class="etiquette-copro">Votre copropriété</span>' }) }).addTo(coucheCopro);
    }
    $("carte").setAttribute("aria-label", "Carte de la zone " + libelleZone() + ". Flèches pour déplacer la carte, plus et moins pour zoomer. La liste des copropriétés de la carte se trouve sous la légende.");
    couchePoints.redessiner();
    rendreLegende(R);
    rendreJumeau();
    if (recadrer) cadrer();
  }
  function rendreLegende(R) {
    const A = R.A, T = A.tot, items = [];
    const enCouleur = Array.from(etat.couleurs.entries()).sort((a, b) => a[1] - b[1]);
    for (const x of enCouleur) {
      const s = A.par.get(x[0]);
      items.push('<li><span class="symbole"><span class="pastille c' + x[1] + '"></span></span><span>' + esc(ENTS[x[0]].nom + " — " + pl(s ? s.comp : 0, "copropriété comparable", "copropriétés comparables")) + "</span></li>");
    }
    const autres = compterSyndics(A) - enCouleur.filter((x) => (A.par.get(x[0]) || {}).comp > 0).length;
    items.push('<li><span class="symbole"><span class="pastille autre"></span></span><span>' + esc("Autres syndics professionnels — " + pl(autres, "syndic", "syndics")) + "</span></li>");
    items.push('<li><span class="symbole">' + SYMB.anneau + "</span><span>" + esc("Copropriété à syndic bénévole — " + pl(T.benevoles, "copropriété", "copropriétés")) + "</span></li>");
    if (T.inconnus) items.push('<li><span class="symbole">' + SYMB.inconnu + "</span><span>" + esc("Type de syndic non connu, ou aucun syndic déclaré — " + pl(T.inconnus, "copropriété", "copropriétés")) + "</span></li>");
    items.push('<li><span class="symbole">' + SYMB.losange + "</span><span>Bureau d'un syndic en couleur" + (pointRef() ? " (le plus proche)" : " (bureau déclaré au registre)") + "</span></li>");
    if (etat.copro != null) items.push('<li><span class="symbole">' + SYMB.viseur + "</span><span>Votre copropriété</span></li>");
    items.push('<li><span class="symbole">' + (etat.mode === "cercle" ? SYMB.cercle : SYMB.zone) + "</span><span>" + (etat.mode === "cercle" ? "Cercle choisi" : "Zone choisie") + "</span></li>");
    const ouvert = !$("jumeau").hidden;
    $("legende").innerHTML = '<h3 id="legende-titre">Légende</h3><ul>' + items.join("") + '</ul><div class="legende-notes"><p>'
      + esc("Seules les copropriétés comparables sont affichées : " + nb(T.comparables) + " sur " + nb(T.copros) + ".")
      + "</p><p>" + esc(enCouleur.length ? "En couleur : votre syndic et votre liste courte, 3 au plus. Les autres syndics professionnels sont en gris : la couleur sert seulement à les repérer."
        : "Ajoutez des syndics à votre liste courte pour les voir en couleur sur la carte, avec votre syndic.") + "</p>" + (tuilesOk ? "" : "<p>Fond sans tuiles : le plan des rues ne s'est pas chargé. Les contours des communes restent exacts.</p>") + "</div>"
      + '<button type="button" class="btn legende-bouton" data-act="jumeau" aria-expanded="' + ouvert + '" aria-controls="jumeau">'
      + (ouvert ? "Masquer la liste des copropriétés de la carte" : "Voir la liste des copropriétés de la carte") + "</button>";
  }
  function rendreJumeau() {
    const el = $("jumeau");
    if (el.hidden) return;
    const rows = Array.from(PTS).sort((a, b) => (IMMAT[a] < IMMAT[b] ? -1 : 1)), n = rows.length, lim = Math.min(etat.jumeau, n);
    let h = '<div class="defile" tabindex="0" role="region" aria-labelledby="jumeau-titre"><table class="simple"><caption id="jumeau-titre">'
      + esc("Copropriétés comparables de la carte : " + nb(n)) + "</caption><thead><tr><th scope=\"col\">Immatriculation</th><th scope=\"col\">Lots</th><th scope=\"col\">Construction</th><th scope=\"col\">Syndic déclaré</th></tr></thead><tbody>";
    for (let j = 0; j < lim; j++) {
      const i = rows[j];
      h += '<tr><th scope="row"><span class="immat">' + esc(IMMAT[i]) + '</span></th><td class="num">' + nb(LOTS[i]) + "</td><td>"
        + esc(PER[i] >= 0 && M.periodes[PER[i]] ? majuscule(M.periodes[PER[i]][0]) : "Non renseignée") + "</td><td>" + esc(majuscule(nomRepresentant(ENT[i]))) + "</td></tr>";
    }
    h += "</tbody></table></div>";
    if (n > lim) h += '<button type="button" class="btn suite-btn" data-act="jumeau-suite">' + esc("Afficher les " + pl(Math.min(PAGE_JUMEAU, n - lim), "copropriété suivante", "copropriétés suivantes")) + "</button>";
    el.innerHTML = h;
  }
  // En couleur : votre syndic, puis la liste courte dans l'ordre d'ajout, 3 au plus. Une couleur suit son syndic :
  // ajouter ou retirer un autre syndic ne la change pas.
  function attribuerCouleurs() {
    const voulus = [], mon = monSyndic();
    if (mon != null) voulus.push(mon);
    for (const ei of candidats()) if (voulus.indexOf(ei) < 0) voulus.push(ei);
    const garde = new Map(), retenus = voulus.slice(0, MAX_CARTE);
    for (const ei of retenus) if (etat.couleurs.has(ei)) garde.set(ei, etat.couleurs.get(ei));
    for (const ei of retenus) if (!garde.has(ei)) { const pris = Array.from(garde.values()); garde.set(ei, [1, 2, 3].find((k) => pris.indexOf(k) < 0)); }
    etat.couleurs = garde;
  }

  // ---------- Barres de position (§ 4.8, § 6.4) ----------
  function reperesDe(R, col) {
    const out = [];
    const ajout = (nom, T) => { const kn = col.kn(T, T); out.push({ nom, p: kn[1] ? kn[0] / kn[1] : null }); };
    ajout(R.Dp === R.A ? "département" : "zone", R.A.tot);
    if (R.C) ajout("commune", R.C.tot);
    if (R.Dp !== R.A) ajout("département", R.Dp.tot);
    return out;
  }
  function barre(titre, k, n, reperes) {
    const repTxt = "Repères : " + reperes.map((r) => r.nom + " " + (r.p == null ? "—" : pct(r.p))).join(" · ");
    if (n < SEUIL) {
      return '<div class="barre-position"><p class="titre-barre">' + esc(titre) + "</p><p>"
        + esc(n ? nb(k) + " sur " + nb(n) + " : trop peu de copropriétés pour placer un pourcentage." : "Aucune copropriété concernée dans ce périmètre.")
        + '</p><p class="petit muted">' + esc(repTxt) + "</p></div>";
    }
    const p = k / n, ic = wilson(k, n);
    const vmax = 1.1 * Math.max(ic[1], ...reperes.map((r) => r.p || 0));
    const mx = [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.8, 1].find((m) => m >= vmax) || 1;
    const W = 480, x0 = 14, x1 = W - 14, ya = 24, X = (v) => (x0 + (x1 - x0) * Math.min(v, mx) / mx).toFixed(1);
    let g = '<svg viewBox="0 0 ' + W + ' 56" role="img" aria-label="' + esc(titre + " : ce syndic " + pct(p, k) + ", " + nb(k) + " sur " + nb(n) + ". " + repTxt) + '">';
    g += '<line x1="' + x0 + '" y1="' + ya + '" x2="' + x1 + '" y2="' + ya + '" style="stroke:var(--control);stroke-width:1"/>';
    for (const v of [0, mx / 2, mx]) {
      g += '<line x1="' + X(v) + '" y1="' + (ya - 4) + '" x2="' + X(v) + '" y2="' + (ya + 4) + '" style="stroke:var(--control);stroke-width:1"/>'
        + '<text x="' + X(v) + '" y="' + (ya + 24) + '" text-anchor="' + (v === 0 ? "start" : v === mx ? "end" : "middle") + '" style="fill:var(--muted);font-size:13px">' + esc(pctAxe(v)) + "</text>";
    }
    for (const r of reperes) if (r.p != null) g += '<rect x="' + (X(r.p) - 1) + '" y="' + (ya - 7) + '" width="2" height="14" style="fill:var(--ink-2)"><title>' + esc("Repère " + r.nom + " : " + pct(r.p)) + "</title></rect>";
    g += '<line x1="' + X(ic[0]) + '" y1="' + ya + '" x2="' + X(ic[1]) + '" y2="' + ya + '" style="stroke:var(--interval);stroke-width:6;stroke-linecap:round"/>';
    g += '<circle cx="' + X(p) + '" cy="' + ya + '" r="6" style="fill:var(--accent);stroke:var(--surface);stroke-width:2"/></svg>';
    return '<div class="barre-position cadre-graphique"><p class="titre-barre">' + esc(titre) + "</p>" + g
      + "<p>" + esc("Ce syndic : " + pct(p, k) + " (" + nb(k) + " sur " + nb(n) + ")") + "</p>"
      + '<p class="petit" title="Sur peu de copropriétés, un pourcentage change beaucoup pour une seule copropriété de plus ou de moins. Le trait montre les valeurs compatibles avec les chiffres observés, 95 fois sur 100.">'
      + esc("Marge d'incertitude : de " + pct(ic[0]) + " à " + pct(ic[1])) + '</p><p class="petit muted">' + esc(repTxt) + "</p></div>";
  }

  // ---------- Entonnoir (§ 4.7, § 6.3) ----------
  // Quantiles binomiaux exacts interpolés pour q = 0,001 ; 0,025 ; 0,975 ; 0,999
  function limites(n, p0) {
    if (n > 3000 && n * p0 >= 10 && n * (1 - p0) >= 10) {
      const sd = Math.sqrt(p0 * (1 - p0) / n);
      return [p0 - Z998 * sd, p0 - Z95 * sd, p0 + Z95 * sd, p0 + Z998 * sd].map((v) => Math.min(1, Math.max(0, v)));
    }
    const qs = [0.001, 0.025, 0.975, 0.999], out = [1, 1, 1, 1], lp = Math.log(p0), lq = Math.log(1 - p0);
    let lpmf = n * lq, F = 0, j = 0;
    for (let r = 0; r <= n && j < 4; r++) {
      if (r > 0) lpmf += Math.log((n - r + 1) / r) + lp - lq;
      const Fp = F;
      F += Math.exp(lpmf);
      while (j < 4 && F >= qs[j]) {
        const a = F - Fp > 0 ? (F - qs[j]) / (F - Fp) : 0;
        out[j] = Math.min(1, Math.max(0, (r - a) / n));
        j++;
      }
    }
    return out;
  }
  function entonnoir(agg, ei, col, lieu) {
    const titre = col.titre + " : ce syndic parmi les syndics " + lieu;
    const kn0 = col.kn(agg.tot, agg.tot), pts = [];
    for (const kv of agg.par) { const kn = col.kn(kv[1], agg.tot); if (kn[1] >= SEUIL) pts.push({ ei: kv[0], k: kn[0], n: kn[1], p: kn[0] / kn[1] }); }
    const choix = '<div class="entonnoir-choix"><label for="indicateur-entonnoir">Indicateur</label><select id="indicateur-entonnoir" class="champ">'
      + INDICATEURS.map((id) => '<option value="' + id + '"' + (id === col.id ? " selected" : "") + ">" + esc(colParId(id).titre) + "</option>").join("") + "</select></div>";
    const tete = '<h4 class="titre-barre">' + esc(titre) + "</h4>" + choix;
    if (pts.length < 5) {
      return tete + '<div class="message"><p>Trop peu de syndics gèrent au moins 10 copropriétés comparables dans ce périmètre pour tracer l\'entonnoir. Choisissez la commune ou le département.</p>'
        + (etat.perimetre !== "departement" ? '<button type="button" class="btn" data-act="departement">Voir dans tout le département</button>' : "") + "</div>";
    }
    const p0 = kn0[1] ? kn0[0] / kn0[1] : 0;
    if (p0 <= 0 || p0 >= 1) return tete + "<p>Aucun cas (ou tous les cas) dans ce périmètre : l'entonnoir n'a pas de sens ici.</p>";
    const nmax = Math.max(...pts.map((q) => q.n));
    const xmax = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((v) => v >= nmax) || nmax;
    const ech = [];
    for (let j = 0; j <= 80; j++) {
      const n = Math.round(10 * Math.pow(xmax / 10, j / 80));
      if (!ech.length || ech[ech.length - 1].n !== n) ech.push({ n, L: limites(n, p0) });
    }
    // l'axe vertical couvre l'entonnoir, ce syndic et 95 syndics sur 100 : les rares points au-delà sont
    // posés en triangle sur le bord haut, pour ne pas écraser le reste du graphique
    const ps = pts.map((q) => q.p).sort((a, b) => a - b), pMoi = (pts.find((q) => q.ei === ei) || {}).p || 0;
    const pmax = Math.max(limites(10, p0)[3], ps[Math.floor(0.95 * (ps.length - 1))], pMoi);
    const Y = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1].find((v) => v >= 1.05 * pmax) || 1;
    const pas = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25].find((s) => Y / s <= 5.0001 && Math.abs(Math.round(Y / s) - Y / s) < 1e-9) || Y / 4;
    const tel = window.innerWidth < 700, W = tel ? 360 : 640, H = tel ? 300 : 360, ml = 48, mr = tel ? 72 : 96, mt = 16, mb = 56;
    const X = (n) => ml + (W - ml - mr) * Math.log(n / 10) / Math.log(xmax / 10);
    const Yp = (p) => mt + (H - mt - mb) * (1 - Math.min(p, Y) / Y);
    const f = (v) => v.toFixed(1);
    const trace = (k) => ech.map((q, t) => (t ? "L" : "M") + f(X(q.n)) + " " + f(Yp(q.L[k]))).join(" ");
    const bande = (k1, k2) => ech.map((q, t) => (t ? "L" : "M") + f(X(q.n)) + " " + f(Yp(q.L[k2]))).join(" ") + " "
      + ech.slice().reverse().map((q) => "L" + f(X(q.n)) + " " + f(Yp(q.L[k1]))).join(" ") + " Z";
    let g = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(titre) + '">';
    for (let v = 0; v <= Y + 1e-9; v += pas) {
      g += '<line x1="' + ml + '" y1="' + f(Yp(v)) + '" x2="' + (W - mr) + '" y2="' + f(Yp(v)) + '" style="stroke:var(--line);stroke-width:1"/>'
        + '<text x="' + (ml - 6) + '" y="' + f(Yp(v) + 4) + '" text-anchor="end" style="fill:var(--muted);font-size:12px">' + esc(pctAxe(v)) + "</text>";
    }
    g += '<path d="' + bande(0, 1) + '" style="fill:var(--band-998)"/><path d="' + bande(2, 3) + '" style="fill:var(--band-998)"/><path d="' + bande(1, 2) + '" style="fill:var(--band-95)"/>';
    for (let k = 0; k < 4; k++) g += '<path d="' + trace(k) + '" style="fill:none;stroke:var(--muted);stroke-width:1"/>';
    g += '<line x1="' + ml + '" y1="' + f(Yp(p0)) + '" x2="' + (W - mr) + '" y2="' + f(Yp(p0)) + '" style="stroke:var(--ink-2);stroke-width:2"/>';
    // étiquettes de droite : 12 px au moins entre elles, sinon elles se chevauchent quand le repère est bas
    const fin = ech[ech.length - 1].L, yRep = Yp(p0) + 4;
    const y95 = Math.max(mt + 8, Math.min(Yp(fin[2]) - 2, yRep - 12)), y998 = Math.max(mt + 8, Math.min(Yp(fin[3]) - 2, y95 - 12));
    g += '<text x="' + (W - mr + 6) + '" y="' + f(yRep) + '" style="fill:var(--ink-2);font-size:12px">Repère ' + esc(pctAxe(p0)) + "</text>"
      + '<text x="' + (W - mr + 6) + '" y="' + f(y95) + '" style="fill:var(--muted);font-size:11px">95 %</text>'
      + (y998 <= y95 - 10 ? '<text x="' + (W - mr + 6) + '" y="' + f(y998) + '" style="fill:var(--muted);font-size:11px">99,8 %</text>' : "");
    // axe horizontal
    g += '<line x1="' + ml + '" y1="' + (H - mb) + '" x2="' + (W - mr) + '" y2="' + (H - mb) + '" style="stroke:var(--control);stroke-width:1"/>';
    for (const v of [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]) {
      if (v > xmax) break;
      g += '<line x1="' + f(X(v)) + '" y1="' + (H - mb) + '" x2="' + f(X(v)) + '" y2="' + (H - mb + 5) + '" style="stroke:var(--control);stroke-width:1"/>'
        + '<text x="' + f(X(v)) + '" y="' + (H - mb + 19) + '" text-anchor="middle" style="fill:var(--muted);font-size:12px">' + esc(nb(v)) + "</text>";
    }
    g += '<text x="' + ((ml + W - mr) / 2) + '" y="' + (H - 12) + '" text-anchor="middle" style="fill:var(--ink-2);font-size:12px">Nombre de copropriétés</text>';
    let moi = null, hors = 0, horsMax = 0;
    for (const q of pts) {
      if (q.ei === ei) { moi = q; continue; }
      if (q.p > Y) {
        hors++; horsMax = Math.max(horsMax, q.p);
        const x = X(q.n);
        g += '<path d="M' + f(x - 5) + " " + f(mt + 5) + " L" + f(x + 5) + " " + f(mt + 5) + " L" + f(x) + " " + f(mt - 4) + ' Z" style="fill:var(--syn-other);stroke:var(--surface);stroke-width:1"><title>'
          + esc("Un autre syndic : " + pct(q.p, q.k) + " sur " + nb(q.n) + " copropriétés, au-delà du haut de l'axe") + "</title></path>";
        continue;
      }
      g += '<circle cx="' + f(X(q.n)) + '" cy="' + f(Yp(q.p)) + '" r="4" style="fill:var(--syn-other);stroke:var(--surface);stroke-width:1.5"><title>'
        + esc("Un autre syndic : " + pct(q.p, q.k) + " sur " + nb(q.n) + " copropriétés") + "</title></circle>";
    }
    if (moi) {
      const cx = X(moi.n), cy = Yp(moi.p), gauche = cx > (W - mr) - 70;
      g += '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="6" tabindex="0" style="fill:var(--accent);stroke:var(--surface);stroke-width:2" aria-label="'
        + esc("Ce syndic : " + pct(moi.p, moi.k) + " sur " + nb(moi.n) + " copropriétés") + '"><title>' + esc("Ce syndic : " + pct(moi.p, moi.k) + " sur " + nb(moi.n) + " copropriétés") + "</title></circle>"
        + '<text x="' + f(gauche ? cx - 10 : cx + 10) + '" y="' + f(cy - 8) + '" text-anchor="' + (gauche ? "end" : "start") + '" style="fill:var(--ink);font-size:12px;font-weight:600">Ce syndic</text>';
    }
    g += "</svg>";
    // position en mots
    let phrase;
    const kn = col.kn(agg.par.get(ei) || nouveauStat(), agg.tot);
    if (kn[1] < SEUIL) phrase = (kn[1] ? nb(kn[0]) + " sur " + nb(kn[1]) : "Aucune copropriété") + " : trop peu de copropriétés pour placer ce syndic sur l'entonnoir.";
    else {
      const p = kn[0] / kn[1], Ls = limites(kn[1], p0);
      if (p >= Ls[1] && p <= Ls[2]) phrase = "Pour un syndic de cette taille, ce taux est dans les écarts courants autour du repère.";
      else if (p > Ls[2] && p <= Ls[3]) phrase = "Ce taux est plus élevé que le repère, au-delà des écarts courants pour un syndic de cette taille. Par le seul hasard, cela arrive à environ 1 syndic sur 40.";
      else if (p < Ls[1] && p >= Ls[0]) phrase = "Ce taux est plus bas que le repère, au-delà des écarts courants pour un syndic de cette taille. Par le seul hasard, cela arrive à environ 1 syndic sur 40.";
      else if (p > Ls[3]) phrase = "Ce taux est nettement plus élevé que le repère pour un syndic de cette taille. Par le seul hasard, cela arrive à environ 1 syndic sur 1 000.";
      else phrase = "Ce taux est nettement plus bas que le repère pour un syndic de cette taille. Par le seul hasard, cela arrive à environ 1 syndic sur 1 000.";
    }
    const lignes = pts.slice().sort((a, b) => b.n - a.n).map((q) => {
      const Ls = limites(q.n, p0);
      return "<tr><th scope=\"row\">" + (q.ei === ei ? "<strong>Ce syndic</strong>" : "Un autre syndic") + '</th><td class="num">' + nb(q.n) + '</td><td class="num">' + pct(q.p, q.k)
        + '</td><td class="num">' + esc("de " + pct(Ls[1]) + " à " + pct(Ls[2])) + "</td></tr>";
    }).join("");
    const noteHors = hors ? '<p class="petit muted">' + esc(pl(hors, "autre syndic dépasse", "autres syndics dépassent") + " le haut de l'axe (jusqu'à " + pct(horsMax) + ") : " + (hors >= 2 ? "ils sont marqués" : "il est marqué") + " d'un triangle sur le bord haut.") + "</p>" : "";
    return tete + '<div class="cadre-graphique">' + g + noteHors + '<p class="petit muted">L\'axe est gradué 10, 20, 50, 100… pour que petits et grands syndics tiennent sur le même graphique.</p>'
      + '<p class="petit" title="Même sans aucune particularité, un syndic s\'écarte du repère par le seul hasard, d\'autant plus qu\'il gère peu de copropriétés. 95 syndics sur 100 tombent dans la bande foncée, 998 sur 1 000 dans l\'une des deux bandes.">'
      + esc("Ce syndic · Autres syndics (non nommés) · Repère : " + pct(p0) + " · Bande foncée : écarts courants · Bande claire : écarts peu fréquents") + "</p>"
      + '<p class="phrase-graphique">' + esc(phrase) + "</p><p>Un écart peut aussi venir d'une déclaration tardive ou d'une erreur de saisie au registre. Ce n'est pas un jugement sur le syndic.</p>"
      + '<details class="details-jumeau"><summary>Voir les chiffres de l\'entonnoir</summary><div class="defile" tabindex="0"><table class="simple"><thead><tr><th scope="col">Syndic</th><th scope="col">Copropriétés</th><th scope="col">Taux</th><th scope="col">Écarts courants à ce nombre</th></tr></thead><tbody>'
      + lignes + "</tbody></table></div><p class=\"petit\">" + esc("Repère : " + pct(p0) + ".") + "</p></details></div>";
  }

  // ---------- Décisions de justice publiées (jeux complémentaires du département) ----------
  // meta.complements donne les jeux du département ; chacun est dans la page (script#complement-<type>) ou à côté
  // du fragment (complement-<type>.json). Seuls deux types sont lus : « jurisprudence » (lecture systématique) et
  // « revue » (revue ciblée). Une décision se compte une fois (identifiant Judilibre) et dit de quel jeu elle vient.
  // Un syndic des non_renseignes, ou masqué, est « non renseigné » : jamais zéro.
  const JEUX = {
    jurisprudence: { nom: "lecture des décisions de gouvernance de copropriété rendues à Marseille", court: "lecture des décisions de Marseille" },
    revue: { nom: "revue ciblée de décisions civiles nommant un syndic", court: "revue ciblée" },
  };
  let COMPL = {};
  async function chargerComplements() {
    COMPL = {};
    for (const type of (M.complements || []).filter((t) => JEUX[t])) {
      try {
        const el = document.getElementById("complement-" + type);
        let j = null;
        if (el) j = JSON.parse(el.textContent);
        else { const r = await fetch("complement-" + type + ".json"); if (r.ok) j = await r.json(); }
        if (j && j.syndics) { j._periode = calculerPeriode(j); COMPL[type] = j; }
      } catch (err) { /* jeu illisible ou absent : la page marche sans */ }
    }
    if (COMPL.jurisprudence) ajouterColonnesJustice();
  }
  function jeuxCharges() { return Object.keys(JEUX).filter((t) => COMPL[t]); }
  // modèles d'IA nommés près des chiffres (décision de Brice du 28/10/2026), tirés de meta.methode du jeu ; le détail est dans la méthode
  function methodeIA(t) {
    const m = String(((COMPL[t] || {}).meta || {}).methode || "");
    if (t === "revue") return "lecture assistée par IA, codée deux fois et arbitrée : modèles Claude (Anthropic), détail dans la méthode";
    const lu = /lue? par un modèle d['\u2019]IA \(([^)]+)\)/i.exec(m), contre = /contre-lecture par un second modèle \(([^)]+)\)/i.exec(m);
    const humain = /aucune personne n['\u2019]a encore relu|sans relecture humaine|aucune relecture humaine/i.test(m) ? ", sans relecture humaine" : "";
    return (lu && contre ? "lu par IA (" + lu[1] + "), contre-lu par IA (" + contre[1] + ")" : "lu puis contre-lu par IA : modèles Claude (Anthropic), détail dans la méthode") + humain;
  }
  // passe « condamnation » (fond, frais_seuls ou null) : présente si une décision du jeu porte le champ
  function passeCondamnation(t) {
    return memo("PC" + t, () => { for (const x of Object.values(COMPL[t].syndics)) for (const d of x.decisions || []) if (Object.prototype.hasOwnProperty.call(d, "condamnation")) return true; return false; });
  }
  function fraisSeuls(x) { return x.frais_seuls != null ? x.frais_seuls : (x.decisions || []).filter((d) => d.condamnation === "frais_seuls").length; }
  // Des dépens ou des frais irrépétibles seuls ne disent pas qu'une faute a été retenue : jamais lus comme une condamnation au fond
  const FRAIS_SEULS = "Dépens ou frais irrépétibles mis à sa charge, sans condamnation au fond : cela ne dit pas qu'une faute a été retenue contre lui.";
  // publication partielle, dite près de tout chiffre de justice ; l'absence de jeu se dit aussi (spécification V3, P0-3)
  const PHRASE_JUDILIBRE = "Judilibre, la base de décisions de la Cour de cassation, ne publie qu'une partie des décisions rendues. Une décision qui n'y figure pas n'est pas comptée ici.";
  const PAS_DE_JUSTICE = "Pas de données de justice pour ce département. L'absence de chiffre ne veut pas dire absence de décision.";
  const HORS_PERIMETRE = "hors du périmètre lu";
  function calculerPeriode(j) {
    const p = j.meta && j.meta.perimetre && typeof j.meta.perimetre === "object" ? j.meta.perimetre.periode : null;
    if (Array.isArray(p) && p.length === 2) return "de " + String(p[0]).slice(0, 4) + " à " + String(p[1]).slice(0, 4);
    let a = null, b = null;
    for (const x of Object.values(j.syndics)) for (const d of x.decisions || []) { if (!d.date) continue; if (!a || d.date < a) a = d.date; if (!b || d.date > b) b = d.date; }
    return a ? "de " + a.slice(0, 4) + " à " + b.slice(0, 4) : "";
  }
  function periodeJeu(j) { return j._periode || ""; }
  function lienDecision(u) { return /^https:\/\/(www\.courdecassation\.fr|www\.legifrance\.gouv\.fr)\//.test(u || "") ? u : null; }
  // ce que les jeux disent d'un syndic
  function justiceDe(ei) {
    const e = ENTS[ei], types = jeuxCharges();
    if (!types.length) return null;
    if (e.masque || types.some((t) => (COMPL[t].non_renseignes || []).map(String).indexOf(String(e.siren)) >= 0)) return { etat: "non_renseigne", types };
    const parId = new Map(), parJeu = {};
    for (const t of types) {
      const x = COMPL[t].syndics[String(e.siren)];
      parJeu[t] = x || null;
      for (const d of (x && x.decisions) || []) {
        const cle = d.id || d.lien || (d.juridiction + d.date + d.rg);
        const deja = parId.get(cle);
        if (deja) {
          if (deja.sources.indexOf(t) < 0) deja.sources.push(t);
          for (const k of Object.keys(d)) if (deja[k] == null || (Array.isArray(deja[k]) && !deja[k].length)) deja[k] = d[k];
          continue;
        }
        parId.set(cle, Object.assign({ sources: [t], lib: COMPL[t].meta && COMPL[t].meta.libelles || {} }, d));
      }
    }
    const decisions = Array.from(parId.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
    return { etat: decisions.length ? "decisions" : "aucune", types, parJeu, decisions };
  }
  // base des taux « pour 100 copropriétés » : ses copropriétés d'aujourd'hui dans la zone du jeu (Marseille)
  function zoneJustice() {
    return memo("ZJ", () => {
      const P = (COMPL.jurisprudence && COMPL.jurisprudence.meta && COMPL.jurisprudence.meta.perimetre) || {};
      let codes = Array.isArray(P.communes) ? P.communes.map(String) : null, nom = null;
      if (!codes) {
        const lieu = String(P.zone || "").split(/\s*:/)[0].trim();
        const z = Z.find((x) => !x.dep && x.type !== "arrondissement" && norm(x.nom) === norm(lieu));
        if (z) { codes = [z.code].concat(z.enfants.map((c) => c.code)); nom = z.nom; }
      }
      if (!codes) return { codes: null, nom: "le département", dans: "dans le département" };
      return { codes: new Set(codes), nom: nom || "la zone du jeu", dans: "à " + (nom || "la zone du jeu") };
    });
  }
  function baseJustice() {
    return memo("BJ", () => {
      const zj = zoneJustice(), n = new Map();
      for (let i = 0; i < N; i++) {
        if (SYN[i] === ABSENTE || ENT[i] < 0) continue;
        if (zj.codes && !(ZONE[i] >= 0 && zj.codes.has(Z[ZONE[i]].code))) continue;
        n.set(ENT[i], (n.get(ENT[i]) || 0) + 1);
      }
      return n;
    });
  }
  function sur100(k, n) {
    if (!n) return "aucune copropriété gérée " + zoneJustice().dans;
    if (n < SEUIL) return nb(k) + " pour " + pl(n, "copropriété gérée", "copropriétés gérées") + " " + zoneJustice().dans;
    const v = 100 * k / n;
    return (v === 0 ? "0" : v < 0.05 ? "moins de 0,1" : v < 9.95 ? f1.format(v) : fEnt.format(Math.round(v))) + " pour 100 copropriétés gérées " + zoneJustice().dans;
  }
  // colonnes : un compte de décisions, rapporté à 100 copropriétés gérées dans la zone du jeu
  function colJustice(id, titre, def, compte) {
    const jx = (e) => { const x = justiceDe(e.i); return x && x.etat !== "non_renseigne" ? (COMPL.jurisprudence.syndics[String(e.siren)] || null) : undefined; };
    const val = (e) => { const x = jx(e); return x === undefined ? null : x ? compte(x) : 0; };
    return { id, titre, def, soc: true, num: true, justice: true,
      cle: (s, T, e) => { if (!e) return null; const k = val(e), n = baseJustice().get(e.i) || 0; return k == null || n < SEUIL ? null : k / n; },
      // aucune copropriété gérée dans la zone du jeu et aucune décision : hors du périmètre lu, jamais 0
      html: (s, T, e) => { if (!e) return "—"; const k = val(e), n = baseJustice().get(e.i) || 0; if (k == null) return '<span class="muted">non renseigné</span>'; if (!k && !n) return '<span class="muted">' + HORS_PERIMETRE + "</span>"; return '<span class="taux">' + nb(k) + '</span><span class="taux-detail">' + esc(sur100(k, n)) + "</span>"; },
      texte: (s, T, e) => { if (!e) return "—"; const k = val(e), n = baseJustice().get(e.i) || 0; return k == null ? "non renseigné" : !k && !n ? HORS_PERIMETRE : nb(k) + " (" + sur100(k, n) + ")"; } };
  }
  function ajouterColonnesJustice() {
    if (colParId("j_dec")) return;
    const J = COMPL.jurisprudence, lib = (J.meta && J.meta.libelles && J.meta.libelles.drapeaux) || {}, per = periodeJeu(J), zj = zoneJustice();
    const dr = (k) => (x) => (x.drapeaux && x.drapeaux[k]) || 0;
    COLS.push(
      { id: "j_base", titre: "Copropriétés gérées " + zj.dans, def: "Toutes ses copropriétés d'aujourd'hui " + zj.dans + ", toutes tailles : la base des taux de cette vue.", soc: true, num: true, justice: true,
        cle: (s, T, e) => (e ? baseJustice().get(e.i) || 0 : null), html: (s, T, e) => (e ? nb(baseJustice().get(e.i) || 0) : "—"), texte: (s, T, e) => (e ? nb(baseJustice().get(e.i) || 0) : "—") },
      colJustice("j_dec", "Décisions qui le nomment, à tout titre (y compris quand il agit pour la copropriété)", "Décisions publiées " + per + " où ce syndic est nommé et rapproché de son numéro d'entreprise, à tout titre, y compris quand il agit pour la copropriété.", (x) => x.n_decisions || (x.decisions || []).length),
      colJustice("j_cause", "Mis en cause en son nom propre", "Décisions où le syndic est partie en son nom, et pas seulement comme représentant du syndicat.", (x) => x.n_mis_en_cause || 0),
      colJustice("j_ag", lib.ag_annulee || "Assemblée générale annulée", "Décisions qui annulent une assemblée générale, en tout ou en partie, d'une copropriété que ce syndic représentait. Décision rendue contre le syndicat des copropriétaires, pas contre le syndic.", dr("ag_annulee")),
      colJustice("j_resp", lib.responsabilite_syndic_retenue || "Responsabilité du syndic retenue", "Décisions qui retiennent la responsabilité du syndic.", dr("responsabilite_syndic_retenue")),
      passeCondamnation("jurisprudence")
        ? colJustice("j_cond", "Condamné au fond", "Décisions qui condamnent le syndic au fond : dommages-intérêts, restitution, paiement, remise sous astreinte. Des dépens ou frais irrépétibles seuls ne sont pas comptés ici.", dr("syndic_condamne"))
        : colJustice("j_cond", lib.syndic_condamne || "Syndic condamné", "Décisions qui condamnent le syndic, y compris aux seuls dépens ou frais de procédure.", dr("syndic_condamne")),
      colJustice("j_remise", lib.remise_ordonnee_au_syndic || "Remise ordonnée au syndic", "Décisions qui ordonnent au syndic de remettre des pièces, des archives ou des fonds.", dr("remise_ordonnee_au_syndic")),
    );
    // la méthode, écrite près des chiffres
    for (const c of COLS) if (c.justice) c.def += " " + PHRASE_JUDILIBRE + (c.id !== "j_base" ? " Méthode : " + methodeIA("jurisprudence") + "." : "");
  }
  // vue du tableau : la base, puis ce qui vise le syndic lui-même ; « qui le nomment » et « AG annulée » restent dans la fiche et le comparateur
  function vuesJustice() { return COMPL.jurisprudence ? [["justice", "Décisions de justice", ["j_base", "j_cond", "j_resp", "j_cause"]]] : []; }
  function groupesJustice() {
    if (COMPL.jurisprudence) return [["justice", "Décisions de justice publiées (" + JEUX.jurisprudence.court + ", " + periodeJeu(COMPL.jurisprudence) + ") — " + majuscule(methodeIA("jurisprudence")) + ". " + PHRASE_JUDILIBRE,
      ["j_base", "j_cond", "j_resp", "j_cause", "j_remise", "j_dec", "j_ag"]]];
    return jeuxCharges().length ? [] : [["justice", "Décisions de justice publiées — " + PAS_DE_JUSTICE, []]];
  }
  function libelle(lib, groupe, k) { return (lib[groupe] && lib[groupe][k]) || String(k || "").replace(/_/g, " "); }
  function lienTexte(l, t) { return l ? '<a href="' + esc(l) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>" : esc(t); }
  function decisionHtml(d) {
    const lib = d.lib || {}, lien = lienDecision(d.lien), num = d.rg || d.numero;
    const tete = [dateLongue(d.date), d.juridiction, d.degre ? libelle(lib, "degre", d.degre) : null, d.procedure || null, num ? "n° " + num : null].filter(Boolean).join(" · ");
    const quoi = [d.objet ? libelle(lib, "objet", d.objet) : null, d.issue ? libelle(lib, "issue", d.issue) : d.solution || null, d.role_syndic ? libelle(lib, "role", d.role_syndic) : null].filter(Boolean).join(" — ");
    const drap = (d.drapeaux || []).filter((k) => !(k === "syndic_condamne" && d.condamnation === "frais_seuls"));
    // thèmes : les intitulés neutres de la revue, jamais les codes de sa grille
    const themes = Array.isArray(d.themes_selon_la_revue) ? d.themes_selon_la_revue.map((t) => (t && typeof t === "object" ? t.theme : t)).filter(Boolean) : [];
    const formule = d.formule_du_tribunal || d.dispositif_du_tribunal;
    const suite = Array.isArray(d.suite_connue) ? d.suite_connue : [];
    return '<li class="decision"><p class="decision-tete"><strong>' + esc(tete) + "</strong></p>"
      + (quoi ? "<p>" + esc(quoi) + "</p>" : "")
      + (drap.length ? '<p class="petit">' + esc("Relevé dans la décision : " + drap.map((k) => (k === "syndic_condamne" && d.condamnation === "fond" ? libelle(lib, "condamnation", "fond") : libelle(lib, "drapeaux", k))).join(" ; ")) + "</p>" : "")
      + (d.condamnation === "frais_seuls" ? '<p class="petit">' + esc(FRAIS_SEULS) + "</p>" : "")
      + (themes.length ? '<p class="petit">' + esc("Thèmes selon la revue : " + themes.join(" ; ") + ".") + "</p>" : "")
      + (d.statut_des_faits_selon_la_revue ? '<p class="petit">' + esc("Statut des faits selon la revue : " + d.statut_des_faits_selon_la_revue + ".") + "</p>" : "")
      + (formule ? '<blockquote class="formule">' + esc("« " + formule + " »") + '</blockquote><p class="tres-petit muted">'
        + esc(d.formule_du_tribunal ? "Formule du tribunal, reprise du dispositif de la décision." : "Extrait du dispositif, cité tel que la juridiction l'écrit (400 caractères au plus, coupes marquées « […] »).") + "</p>" : "")
      + (suite.length ? '<p class="petit">Dans la même affaire :</p><ul class="liste-texte petit">' + suite.map((x) => "<li>" + lienTexte(lienDecision(x.lien),
          (x.position === "antérieure" ? "Décision antérieure : " : x.position === "postérieure" ? "Décision postérieure : " : "")
          + [x.juridiction, dateLongue(x.date), x.numero ? "n° " + x.numero : null].filter(Boolean).join(", ") + (x.solution ? " — " + x.solution : "")) + "</li>").join("") + "</ul>"
        : typeof d.suite_connue === "string" && d.suite_connue ? '<p class="petit">' + esc("Suite connue : " + d.suite_connue) + "</p>" : "")
      + '<p class="petit">' + (lien ? '<a href="' + esc(lien) + '" target="_blank" rel="noopener noreferrer">Lire la décision</a> <span class="muted">(site de la Cour de cassation)</span> · ' : "")
      + esc("Relevée par : " + d.sources.map((t) => JEUX[t].court).join(" et ")) + "</p></li>";
  }
  // la méthode s'ouvre dès le premier écran : un réseau cité par un jeu y devient « [réseau] », les crochets signalant la retouche de la citation
  function sansNomDeReseau(x) {
    const s = new Set(Object.keys((COMPL.revue && COMPL.revue.reseaux) || {}));
    ENTS.forEach((e) => { if (e.groupe && e.groupe.libelle) s.add(e.groupe.libelle); });
    const noms = [...s].filter((n) => n && n.trim().length >= 3).sort((a, b) => b.length - a.length);
    if (!noms.length) return String(x);
    const L = "0-9A-Za-zÀ-ÖØ-öø-ÿ";
    return String(x).replace(new RegExp("(^|[^" + L + "])(" + noms.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?=$|[^" + L + "])", "gi"), "$1[réseau]");
  }
  function limitesJeux(types, pourMethode) {
    const c = pourMethode ? sansNomDeReseau : String;
    return types.map((t) => {
      const m = COMPL[t].meta || {};
      return '<details class="details-jumeau"><summary>' + esc("Méthode et limites : " + JEUX[t].nom + (periodeJeu(COMPL[t]) ? ", " + periodeJeu(COMPL[t]) : "")) + "</summary>"
        + (typeof m.perimetre === "string" ? '<p class="petit">' + esc(c("Périmètre : " + m.perimetre)) + "</p>"
          : m.zone || (m.perimetre && m.perimetre.zone) ? '<p class="petit">' + esc(c("Périmètre : " + (m.zone || m.perimetre.zone) + ".")) + "</p>" : "")
        + (m.methode ? '<p class="petit">' + esc(c(m.methode)) + "</p>" : "")
        + ((m.limites || []).length ? '<ul class="liste-texte petit">' + m.limites.map((x) => "<li>" + esc(c(x)) + "</li>").join("") + "</ul>" : "")
        + (m.source ? '<p class="tres-petit muted">' + esc(c("Source : " + m.source)) + "</p>" : "") + "</details>";
    }).join("");
  }
  function sectionJustice(ei) {
    const x = justiceDe(ei), titre = "Décisions de justice publiées", partielle = '<p class="petit">' + esc(PHRASE_JUDILIBRE) + "</p>";
    if (!x) return sect(titre, "<p>" + esc(PAS_DE_JUSTICE) + "</p>", "fiche-justice");
    if (x.etat === "non_renseigne") {
      return sect(titre, partielle + "<p><strong>Non renseigné.</strong> " + esc(ENTS[ei].masque ? "Les décisions ne sont pas rapprochées d'un syndic dont le nom et les numéros ne sont pas publiés." : "Les décisions publiées qui nomment ce syndic ne sont pas reprises dans cette version.") + "</p>" + limitesJeux(x.types), "fiche-justice");
    }
    let h = partielle;
    const nBase = COMPL.jurisprudence ? baseJustice().get(ei) || 0 : null;
    for (const t of x.types) {
      const j = x.parJeu[t], J = COMPL[t], per = periodeJeu(J);
      if (!j) {
        h += "<p>" + esc(majuscule(JEUX[t].nom) + (per ? " (" + per + ")" : "") + " : " + (t === "revue"
          ? "aucune décision relevée. La revue ne retient que certaines décisions : cela ne dit pas qu'aucune décision ne le nomme."
          : t === "jurisprudence" && nBase === 0 && zoneJustice().codes
            ? "les décisions lues sont celles rendues " + zoneJustice().dans + ". Ce syndic n'y gère aucune copropriété : elles ne disent rien de lui."
            : "aucune décision publiée nommant ce syndic n'a été relevée. Une décision non publiée n'est pas comptée.")) + "</p>";
        continue;
      }
      const lib = (J.meta && J.meta.libelles && J.meta.libelles.drapeaux) || {};
      const n = j.n_decisions || (j.decisions || []).length, dr = j.drapeaux || {};
      let p = majuscule(JEUX[t].nom) + (per ? " (" + per + ")" : "") + " : " + pl(n, "décision le nomme", "décisions le nomment") + ", à tout titre (y compris quand il agit pour la copropriété)";
      const enSonNom = [j.n_mis_en_cause ? nb(j.n_mis_en_cause) + " où il est mis en cause en son nom propre" : null,
        j.n_demandeur_en_son_nom ? nb(j.n_demandeur_en_son_nom) + " où il est demandeur en son nom propre" : null].filter(Boolean);
      if (enSonNom.length) p += ", dont " + liste(enSonNom);
      h += "<p>" + esc(p + ".") + "</p>";
      const pc = passeCondamnation(t);
      const lignes = Object.keys(dr).filter((k) => dr[k] > 0).map((k) => fait(k === "syndic_condamne" && pc ? "Syndic condamné au fond" : libelle({ drapeaux: lib }, "drapeaux", k),
        nb(dr[k]) + (k === "ag_annulee" ? ' <span class="petit muted">' + esc("(décision rendue contre le syndicat des copropriétaires, pas contre le syndic)") + "</span>" : "")));
      if (lignes.length) h += '<dl class="faits">' + lignes.join("") + "</dl>";
      const fs = pc ? fraisSeuls(j) : 0;
      if (fs > 0) h += '<p class="petit">' + esc((fs >= 2 ? "Dans " + nb(fs) + " décisions" : "Dans une décision") + ", seuls des dépens ou des frais irrépétibles sont mis à sa charge, sans condamnation au fond : cela ne dit pas qu'une faute a été retenue contre lui.") + "</p>";
      if (j.montant_condamnations_euros) h += '<p class="petit">' + esc("Montant mis au principal à sa charge dans ces décisions : " + nb(j.montant_condamnations_euros) + " € (hors intérêts, frais de procédure et dépens ; une affaire jugée deux fois peut compter deux fois).") + "</p>";
      if (t === "jurisprudence") { const nB = baseJustice().get(ei) || 0; h += '<p class="petit muted">' + esc("Rapporté à ses copropriétés d'aujourd'hui : " + sur100(n, nB) + ".") + "</p>"; }
      h += '<p class="petit methode-ia">' + esc("Méthode : " + methodeIA(t) + ".") + "</p>";
    }
    // décisions qui nomment le réseau du syndic sans identifier la société : signalées, repliées, jamais imputées
    for (const r of reseauxDe(ei)) {
      const ds = r.decisions.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      h += '<details class="details-jumeau"><summary>' + esc("Décisions visant le réseau " + r.nom + ", sans société identifiée : " + nb(r.n)) + "</summary>"
        + '<p class="petit">' + esc((r.n >= 2 ? "Ces décisions nomment" : "Cette décision nomme") + " le réseau " + r.nom + " sans identifier la société en cause : "
          + (r.n >= 2 ? "elles ne sont imputées" : "elle n'est imputée") + " ni à ce syndic ni à aucune autre société du registre. Relevé par la revue ciblée.") + "</p>"
        + (ds.length ? '<ul class="liste-texte petit">' + ds.map((d) => "<li>" + lienTexte(lienDecision(d.lien), dateLongue(d.date) + (d.juridiction ? " · " + d.juridiction : "")) + "</li>").join("") + "</ul>" : "")
        + "</details>";
    }
    if (x.decisions.length) {
      const deux = x.decisions.filter((d) => d.sources.length > 1).length;
      h += "<h4>" + esc(pl(x.decisions.length, "décision", "décisions") + ", de la plus récente à la plus ancienne") + "</h4>"
        + (deux ? '<p class="petit muted">' + esc(pl(deux, "décision figure", "décisions figurent") + " dans les deux jeux : " + (deux >= 2 ? "elles ne sont comptées" : "elle n'est comptée") + " qu'une fois ici.") + "</p>" : "")
        + '<ol class="decisions">' + x.decisions.slice(0, etat.decisions || 10).map(decisionHtml).join("") + "</ol>"
        + (x.decisions.length > (etat.decisions || 10) ? '<button type="button" class="btn" data-act="decisions-suite">' + esc("Afficher les " + pl(x.decisions.length - (etat.decisions || 10), "décision suivante", "décisions suivantes")) + "</button>" : "");
    }
    h += '<p class="petit">Une décision se lit avec sa date et son degré : une décision frappée d\'appel a pu être réformée depuis. Le nombre de décisions dépend aussi du nombre de copropriétés gérées et de ce que les juridictions publient.</p>';
    return sect(titre, h + limitesJeux(x.types), "fiche-justice");
  }
  // texte de méthode : ce que la revue a lu sans le rattacher à un syndic
  // meta.regles_contre_ia : un texte, une liste ou un tableau de mesures, rendu tel quel, sans interprétation
  function reglesHtml(v, lib) {
    const k2 = (k) => (lib && lib[k]) || majuscule(String(k).replace(/_/g, " "));
    const val = (x) => (typeof x === "number" ? (x > 0 && x < 1 ? pct(x) : nb(x)) : String(x));
    if (v == null) return "";
    if (typeof v !== "object") return '<p class="petit">' + esc(String(v)) + "</p>";
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === "object" && v[0] !== null && !Array.isArray(v[0])) {
        const cles = Array.from(new Set(v.flatMap((x) => Object.keys(x))));
        return '<div class="defile" tabindex="0"><table class="simple"><thead><tr>' + cles.map((c) => '<th scope="col">' + esc(k2(c)) + "</th>").join("") + "</tr></thead><tbody>"
          + v.map((x) => "<tr>" + cles.map((c, n) => (n ? '<td class="num">' : '<th scope="row">') + esc(x[c] == null ? "—" : typeof x[c] === "object" ? JSON.stringify(x[c]) : val(x[c])) + (n ? "</td>" : "</th>")).join("") + "</tr>").join("") + "</tbody></table></div>";
      }
      return '<ul class="liste-texte petit">' + v.map((x) => "<li>" + esc(typeof x === "object" ? JSON.stringify(x) : String(x)) + "</li>").join("") + "</ul>";
    }
    return Object.keys(v).map((k) => (typeof v[k] === "object" && v[k] !== null ? "<h4>" + esc(k2(k)) + "</h4>" + reglesHtml(v[k], lib) : '<p class="petit">' + esc(k2(k) + " : " + val(v[k])) + "</p>")).join("");
  }
  function reglesContreIa() {
    const J = COMPL.jurisprudence, r = J && J.meta && J.meta.regles_contre_ia;
    if (!r) return "";
    const lib = (J.meta.libelles && J.meta.libelles.drapeaux) || {};
    if (!r.drapeaux || typeof r.drapeaux !== "object") return reglesHtml(r, lib);
    let h = "<p>" + esc("Des règles écrites, sans IA, ont relu les mêmes " + (r.decisions ? nb(r.decisions) + " " : "") + "décisions" + (r.reference ? ", comparées à la " + r.reference : "") + ".") + "</p>"
      + '<div class="defile" tabindex="0"><table class="simple"><caption class="sr-only">Accord entre les règles écrites et la lecture par IA</caption><thead><tr><th scope="col">Drapeau</th><th scope="col">Précision des règles</th><th scope="col">Rappel des règles</th></tr></thead><tbody>'
      + Object.keys(r.drapeaux).map((k) => '<tr><th scope="row">' + esc(lib[k] || k) + '</th><td class="num">' + esc(pct(r.drapeaux[k].precision)) + '</td><td class="num">' + esc(pct(r.drapeaux[k].rappel)) + "</td></tr>").join("")
      + "</tbody></table></div>";
    const acc = (x, quoi) => (x && x.sur ? "<li>" + esc(quoi + " : accord sur " + nb(x.accord) + " décisions sur " + nb(x.sur) + " (" + pct(x.taux != null ? x.taux : x.accord / x.sur) + ").") + "</li>" : "");
    h += '<ul class="liste-texte petit">' + acc(r.role, "Rôle du syndic") + acc(r.issue, "Issue de la décision") + "</ul>";
    if (r.avertissement) h += '<p class="petit"><strong>Avertissement :</strong> ' + esc(r.avertissement) + "</p>";
    return h;
  }
  // SIREN d'un jeu sans syndic au registre actuel : sociétés fermées ou hors du département. Jamais mêlés aux syndics.
  function absentsDuRegistre(t) {
    return memo("AR" + t, () => {
      const connus = new Set(ENTS.map((e) => String(e.siren)));
      return Object.keys(COMPL[t].syndics).filter((k) => !connus.has(String(k))).sort();
    });
  }
  // comptes seulement : la méthode s'ouvre dès le premier écran, aucune société n'y est nommée ni numérotée
  function blocAbsents() {
    const h = [];
    for (const t of jeuxCharges()) {
      const abs = absentsDuRegistre(t);
      if (!abs.length) continue;
      const ids = new Set();   // une décision qui vise deux de ces sociétés ne compte qu'une fois
      abs.forEach((k) => (COMPL[t].syndics[k].decisions || []).forEach((d) => ids.add(d.id || d.lien || [d.date, d.juridiction, d.rg || d.numero].join("|"))));
      const un = abs.length < 2;
      h.push('<p class="petit">' + esc("Décisions visant des sociétés absentes du registre actuel du " + M.departement + " (" + JEUX[t].court + ") : "
        + pl(abs.length, "société", "sociétés") + ", " + pl(ids.size, "décision", "décisions distinctes") + ". "
        + (un ? "C'est un ancien syndic ou un syndic établi hors du " + M.departement + " : il n'a pas de fiche sur cette page, ses décisions ne s'y affichent donc pas. "
          : "Ce sont d'anciens syndics ou des syndics établis hors du " + M.departement + " : ils n'ont pas de fiche sur cette page, leurs décisions ne s'y affichent donc pas. ")
        + (ids.size < 2 ? "Elle reste" : "Elles restent") + " dans les données publiées avec la page.") + "</p>");
    }
    return h.join("");
  }
  // décisions de la revue qui nomment un réseau (marque) sans identifier la société : signalées aux seuls syndics de ce réseau
  function reseauxDe(ei) {
    const R = COMPL.revue && COMPL.revue.reseaux, e = ENTS[ei];
    if (!R || typeof R !== "object" || e.masque) return [];
    const s0 = e.s || {}, noms = [s0.nom, s0.sigle].concat(Array.isArray(s0.enseignes) ? s0.enseignes : []).filter(Boolean).map((x) => " " + norm(x) + " ");
    const g = e.groupe && e.groupe.libelle ? norm(e.groupe.libelle) : null;
    return Object.keys(R).filter((k) => { const nk = norm(k); return nk && (g === nk || noms.some((x) => x.indexOf(" " + nk + " ") >= 0)); })
      .map((k) => ({ nom: k, n: (R[k] && (R[k].n || (R[k].decisions || []).length)) || 0, decisions: (R[k] && R[k].decisions) || [] })).filter((r) => r.n > 0);
  }
  // la phrase de la revue sur les décisions pénales, reprise telle quelle de sa méthode
  function phrasePenale(m) {
    const x = String(m || "").match(/[^.]*aucune décision pénale publiée[^.]*\./i);
    return x ? x[0].trim() : null;
  }
  function methodeJustice() {
    if (!jeuxCharges().length) return [PAS_DE_JUSTICE];
    const out = [PHRASE_JUDILIBRE];
    for (const t of jeuxCharges()) {
      const J = COMPL[t], m = J.meta || {}, c = m.comptes || {}, abs = absentsDuRegistre(t).length;
      const pen = t === "revue" ? phrasePenale(m.methode) : null, meth = pen ? String(m.methode).replace(pen, "").trim() : m.methode || "";
      out.push(majuscule(JEUX[t].nom) + (periodeJeu(J) ? ", " + periodeJeu(J) : "") + " : " + (c.decisions_retenues ? pl(c.decisions_retenues, "décision retenue", "décisions retenues") + ", " : "")
        + pl(Object.keys(J.syndics).length, "société rapprochée de son numéro d'entreprise", "sociétés rapprochées de leur numéro d'entreprise")
        + (abs ? ", dont " + nb(abs) + (abs >= 2 ? " absentes" : " absente") + " du registre actuel du " + M.departement : "") + ". " + sansNomDeReseau(meth));
    }
    const R = COMPL.revue;
    if (R) {
      const pen = phrasePenale(R.meta && R.meta.methode), n = Array.isArray(R.decisions_penales) ? R.decisions_penales.length : 0;
      if (pen || n) out.push((pen || "Aucune décision pénale publiée ne nomme un syndic du registre actuel du " + M.departement + ".")
        + (n ? " " + (n >= 2 ? "Les " + nb(n) + " décisions pénales citées pour mémoire par la revue ne sont rattachées" : "La décision pénale citée pour mémoire par la revue n'est rattachée") + " à aucun syndic de cette page." : ""));
      const av = Array.isArray(R.a_verifier) ? R.a_verifier.length : 0;
      if (av) out.push(pl(av, "décision", "décisions") + " de la revue dont le rattachement à une société reste à vérifier " + (av >= 2 ? "ne sont comptées" : "n'est comptée") + " pour aucun syndic.");
      const rs = R.reseaux && typeof R.reseaux === "object" ? Object.keys(R.reseaux) : [];
      const nr = rs.reduce((a, k) => a + ((R.reseaux[k] && (R.reseaux[k].n || (R.reseaux[k].decisions || []).length)) || 0), 0);
      // la méthode s'ouvre dès le premier écran : les réseaux y sont comptés, jamais nommés (la fiche d'un syndic du réseau les nomme)
      const nrs = rs.filter((k) => ((R.reseaux[k] && (R.reseaux[k].n || (R.reseaux[k].decisions || []).length)) || 0) > 0).length;
      if (nr) out.push("La revue relève aussi " + pl(nr, "décision qui nomme", "décisions qui nomment") + " un réseau"
        + (nrs >= 2 ? " (" + nb(nrs) + " réseaux en tout)" : nr >= 2 ? " (le même pour toutes)" : "") + " sans identifier la société en cause : "
        + (nr >= 2 ? "elles ne sont imputées" : "elle n'est imputée") + " à aucune société du registre. La fiche d'un syndic de ce réseau les signale, repliées.");
    }
    return out;
  }

  // ---------- Fiche syndic (§ 4.6, textes du § 5.4) ----------
  function sect(titre, corps, id) { return '<section class="section-fiche"' + (id ? ' id="' + id + '"' : "") + "><h3>" + esc(titre) + "</h3>" + corps + "</section>"; }
  function fait(dt, dd) { return "<dt>" + esc(dt) + "</dt><dd>" + dd + "</dd>"; }
  function rendreFiche(focaliser) {
    const ei = etat.fiche, e = ENTS[ei], s0 = e.s, R = calculer();
    if (etat.perimetre === "commune" && !R.C) etat.perimetre = "zone";
    const agg = etat.perimetre === "commune" ? R.C : etat.perimetre === "departement" ? R.Dp : R.A;
    const lieu = { zone: "de la zone", commune: "de la commune", departement: "du département" }[etat.perimetre];
    const dans = { zone: "dans la zone", commune: "dans la commune", departement: "dans le département" }[etat.perimetre];
    const s = agg.par.get(ei) || nouveauStat(), T = agg.tot, slot = etat.couleurs.get(ei), ref = pointRef(), bi = bureauInfo(e, ref);
    const h = [];
    h.push('<button type="button" class="btn retour" data-act="retour">← Retour au tableau</button>');
    // 1. en-tête : le syndic, et la zone et les critères dont parlent les chiffres
    const etq = [];
    if (monSyndic() === ei) etq.push('<span class="etiquette forte">Votre syndic</span>');
    if (e.groupe) etq.push('<span class="etiquette">' + esc(nomGroupe(e.groupe)) + "</span>");
    if (s0.dirigee_par && s0.dirigee_par.length) etq.push('<span class="etiquette">' + esc(dirigeeTxt(e, false)) + "</span>");
    h.push('<div class="fiche-tete"><h2 id="fiche-titre" tabindex="-1">' + (slot ? '<span class="pastille c' + slot + '" aria-hidden="true"></span>' : "") + esc(e.nom) + "</h2>"
      + '<p class="muted">' + esc(identite(e)) + "</p>" + (etq.length ? '<div class="sous-ligne">' + etq.join("") + "</div>" : "")
      + '<p class="contexte-fiche">' + esc("Zone : " + libelleZone() + " · " + criteresTxt() + " · registre du " + dateLongue(M.date_reference) + ".") + "</p>"
      + '<div class="fiche-actions">' + boutonListe(ei, true)
      + '<button type="button" class="btn" data-act="copier" data-ent="' + ei + '">' + (monSyndic() === ei ? "Copier les questions pour mon syndic" : "Copier les questions pour ce syndic") + "</button></div>"
      + '<textarea class="texte-copie" id="repli-fiche" readonly hidden aria-label="Questions à copier"></textarea></div>');
    // 2. périmètre
    const choix = [["zone", "Dans la zone"]];
    if (R.C) choix.push(["commune", "Dans la commune"]);
    if (R.Dp !== R.A) choix.push(["departement", "Dans tout le département"]);
    h.push('<fieldset class="section-fiche"><legend id="fiche-perimetre" tabindex="-1">Chiffres calculés</legend><div class="segments">'
      + choix.map((x) => '<label><input type="radio" name="perimetre" value="' + x[0] + '"' + (etat.perimetre === x[0] ? " checked" : "") + "><span>" + x[1] + "</span></label>").join("") + "</div>"
      + (etat.notePerimetre ? '<p class="note-perimetre">' + esc(etat.notePerimetre) + "</p>" : "") + "</fieldset>");
    if (s.comp < SEUIL && etat.perimetre !== "departement" && R.Dp !== R.A) {
      h.push('<div class="message"><p>' + esc("Ce syndic gère " + pl(s.comp, "copropriété comparable", "copropriétés comparables") + " " + dans + ". C'est trop peu pour un pourcentage fiable.")
        + '</p><button type="button" class="btn" data-act="departement">Voir dans tout le département</button></div>');
    }
    if (T.comp && s.comp / T.comp > 0.2) h.push("<p>" + esc("Ce syndic gère " + pct(s.comp / T.comp) + " des copropriétés du repère. Il se compare donc en partie à lui-même.") + "</p>");
    // 3. présence
    h.push(sect("Présence", '<dl class="faits">' + fait("Copropriétés comparables", nb(s.comp)) + fait("Toutes ses copropriétés " + dans, nb(s.tout))
      + fait("Lots comparables", nb(s.lotsComp)) + fait("Part des copropriétés comparables", esc(txtTaux(s.comp, T.comparables)))
      + fait("Bureau", esc(bureauTxt(bi, false)))
      + fait("Établissements ouverts au répertoire des entreprises", s0.etab_ouverts != null ? nb(s0.etab_ouverts) : "—") + "</dl>"
      + (bi ? '<p class="petit muted">' + esc((ref ? "Distance à vol d'oiseau " + ref.quoi + ". " : "") + "Seuls le bureau déclaré au registre et le siège sont localisés ; les autres établissements de la société ne le sont pas encore.") + "</p>" : "")));
    // 4. devenir des copropriétés de 2025 : sept devenirs qui font 100 %, puis les arrivées
    let dev = "<p>" + esc("Au " + T3 + ", ce syndic était déclaré pour " + pl(s.n0, "copropriété comparable", "copropriétés comparables") + " " + dans + ". Au registre du " + dateLongue(M.date_reference) + ", elles sont :") + "</p>";
    if (s.n0) {
      dev += '<div class="cadre-devenir">' + barreDevenir(s, true) + legendeDevenirs() + "</div>";
      dev += '<div class="defile"><table class="simple"><caption class="sr-only">Ce que sont devenues ses copropriétés de 2025</caption><thead><tr><th scope="col">Devenir au registre d\'aujourd\'hui</th><th scope="col">Copropriétés</th><th scope="col">Part</th></tr></thead><tbody>'
        + DEVENIRS.map((d, k) => '<tr><th scope="row"><i class="pastille-d d' + (k + 1) + '" aria-hidden="true"></i>' + esc(d[1]) + '<span class="taux-detail">' + esc(d[2] + (d[0] === "restees" && s.internes ? " (dont " + nb(s.internes) + " dans un autre établissement de la même société)" : "")) + "</span></th>"
          + '<td class="num">' + nb(s[d[0]]) + '</td><td class="num">' + esc(s.n0 >= SEUIL ? pct(s[d[0]] / s.n0, s[d[0]]) : nb(s[d[0]]) + " sur " + nb(s.n0)) + "</td></tr>").join("")
        + '<tr class="total"><th scope="row">Ensemble</th><td class="num">' + nb(s.n0) + '</td><td class="num">100 %</td></tr></tbody></table></div>';
    }
    const parties = s.n0 - s.restees, a = arrivees(s);
    dev += '<p class="evol-fiche"><strong>' + esc("Évolution : " + evolTxt(s)) + "</strong> " + esc("— " + nb(s.n0) + " en 2025, moins " + pl(parties, "partie", "parties") + " (même groupe compris), plus " + pl(a, "arrivée", "arrivées") + " : " + nb(s.n0 - parties + a) + " aujourd'hui.") + "</p>";
    dev += "<p>" + esc(a ? "Arrivées depuis le " + T3 + " : " + arriveesTxt(s) + ". « Déclarées depuis » : copropriétés absentes du registre, ou déclarées avec un syndic bénévole, sans SIRET ou de type non connu au " + T3 + " ; ce sont souvent des déclarations tardives plutôt que des changements de syndic."
      : "Aucune copropriété comparable n'est déclarée chez lui aujourd'hui qui ne l'était pas au " + T3 + ".") + "</p>";
    dev += barre("Passées à un autre syndic", s.concurrent + s.nonPro, s.n0, reperesDe(R, colParId("autre")));
    h.push(sect("Ce que sont devenues ses copropriétés de 2025", dev, "fiche-devenir"));
    // 5. mises à jour du registre
    const nMaj = [noteMaj(), noteMajSignalees()].filter(Boolean).join(" ");
    h.push(sect("Mises à jour au registre", ["maj12", "maj18", "fin"].filter(colParId).map((id) => { const c = colParId(id), kn = c.kn(s, T); return barre(c.titre, kn[0], kn[1], reperesDe(R, c)); }).join("")
      + (nMaj ? '<p class="petit muted">' + esc(nMaj) + "</p>" : "")));
    // 6. entonnoir
    h.push(sect("Ce syndic parmi les autres", '<div id="bloc-entonnoir">' + entonnoir(agg, ei, colParId(etat.indicateur) || colParId("autre"), lieu) + "</div>"));
    // 7. décisions de justice publiées (jeux complémentaires du département)
    h.push(sectionJustice(ei));
    // 8. la société
    const bo = s0.bodacc || {};
    const soc = ['<dl class="faits">'];
    const dc = dateCreation(e);
    soc.push(fait("Création", esc(dc ? "Créée en " + annee(dc) + " (" + pl(age(dc), "an", "ans") + ")" : s0.creation ? "Non datée au répertoire des entreprises" : "—")));
    soc.push(fait("Effectif déclaré", esc(effectifTxt(e))));
    soc.push(fait("Forme juridique", esc(s0.forme || s0.forme_courte || "—")));
    if (s0.naf) soc.push(fait("Activité déclarée", esc((NAF[s0.naf] ? majuscule(NAF[s0.naf]) + " (" + s0.naf + ")" : "code " + s0.naf))));
    if (s0.dirigee_par && s0.dirigee_par.length) soc.push(fait("Société dirigeante", esc(dirigeeTxt(e, false))));
    if (e.groupe) soc.push(fait("Groupe", esc(e.groupe.libelle + (e.groupe.preuves && e.groupe.preuves.length ? " (" + e.groupe.preuves.join(" ; ") + ")" : ""))));
    if (s0.etat === "C") soc.push(fait("Situation au répertoire des entreprises", "Cessée"));
    const nat = s0.national;
    if (nat && !e.masque) soc.push(fait("Au registre, dans toute la France, sous ce numéro", esc(pl(nat.copros_siren, "copropriété", "copropriétés") + ", " + pl(nat.lots_siren, "lot", "lots"))));
    soc.push("</dl>");
    soc.push('<p class="petit muted">Le nombre de lots par salarié n\'est pas calculé : les salariés d\'un groupe peuvent être employés par une autre société du groupe, et l\'effectif compte aussi la location et la vente.</p>');
    const ans = (iso) => { const n = age(iso); return n >= 1 ? " (il y a " + pl(n, "an", "ans") + ")" : ""; };
    const annonces = [];
    const al = alertesBodacc(s0), controle = bodaccControle();
    for (const p of al.procedures.slice().sort((x, y) => (x.date < y.date ? 1 : -1))) {
      annonces.push("<li>" + esc("Procédure collective : " + (p.nature || p.type || "annonce") + ", publiée le " + dateCourte(p.date) + ans(p.date)) + "</li>");
    }
    for (const d of al.radiations.slice().sort().reverse()) annonces.push("<li>" + esc("Radiation, publiée le " + dateCourte(d) + ans(d)) + "</li>");
    if (bo.achats) annonces.push("<li>" + esc("Achat de fonds : " + pl(bo.achats, "annonce", "annonces") + (bo.dernier_achat ? ", la dernière publiée le " + dateCourte(bo.dernier_achat) + ans(bo.dernier_achat) : "")) + "</li>");
    const depots = bo.familles && bo.familles["Dépôts des comptes"];
    let bod = "<h4>Annonces au Bulletin officiel des annonces civiles et commerciales (BODACC)</h4>";
    if (annonces.length) bod += '<ul class="liste-texte">' + annonces.join("") + "</ul>";
    else if (controle) bod += "<p>" + esc("Aucune annonce de procédure collective, de radiation ni d'achat de fonds dans les annonces consultées" + (bo.premiere ? " (publiées depuis le " + dateCourte(bo.premiere) + ")" : "") + ".") + "</p>";
    if (!controle) bod += '<p class="petit">' + esc("Procédures collectives et radiations : non affichées. Dans cette version des données, leur rattachement à la société (numéro au registre et nom) n'a pas été contrôlé annonce par annonce.") + "</p>";
    if (al.procedures.length) bod += '<p class="petit">Une annonce de procédure collective dit qu\'une procédure a été ouverte ou a évolué à la date indiquée. Elle ne dit pas où elle en est aujourd\'hui. Le tableau ne montre que les annonces de moins de 5 ans.</p>';
    if (!e.masque) bod += '<p><a href="' + urlBodacc(e.siren) + '" target="_blank" rel="noopener noreferrer">Voir les annonces au BODACC</a> <span class="muted">(site externe)</span></p>';
    h.push(sect("La société", soc.join("") + bod));
    // 9. dépôt des comptes
    h.push(sect("Dépôt des comptes", "<p>" + esc((depots ? "Le BODACC compte " + pl(depots, "avis de dépôt des comptes", "avis de dépôt des comptes") + " pour cette société. " : "")
      + "Le délai entre la clôture d'un exercice et la publication de ses comptes n'est pas encore calculé.") + "</p>"));
    // 10. liens sortants
    const liens = [];
    if (!e.masque) {
      liens.push('<li><a href="' + urlAnnuaire(e.siren) + '" target="_blank" rel="noopener noreferrer">Voir la fiche au répertoire des entreprises</a> <span class="muted">(site externe)</span></li>');
    }
    liens.push('<li><a href="' + URL_CARTES_PRO + '" target="_blank" rel="noopener noreferrer">Vérifier la carte professionnelle d\'agent immobilier</a> <span class="muted">(délivrée par les chambres de commerce et d\'industrie ; site externe)</span></li>');
    h.push(sect("Pour aller plus loin", '<ul class="liste-texte">' + liens.join("") + "</ul>"));
    // 11. ce que dit le registre
    h.push(sect("Ce que dit le registre, ce qu'il ne dit pas", '<ol class="registre-dit"><li>Le registre contient ce que les syndics y déclarent, à la date où ils le déclarent.</li>'
      + "<li>« Mandat expiré sans successeur déclaré » veut dire qu'aucun nouveau mandat n'a été déclaré au registre. Cela ne prouve pas que la copropriété n'a pas de syndic.</li>"
      + "<li>Un chiffre de cette page sert à poser une question. Il ne suffit pas à conclure.</li></ol>"));
    // 12. sources
    const S = M.sources || {};
    h.push(sect("Sources de cette fiche", '<p class="sources-fiche">' + esc("Registre des copropriétés : données du " + dateLongue(M.date_reference) + ", comparées au " + T3
      + " (fichier du " + dateLongue((S.rnic_t3 || {}).date_fichier || M.date_t3) + "). Répertoire des entreprises : consulté le " + dateLongue((S.dinum || {}).dernier)
      + ". BODACC : consulté le " + dateLongue((S.bodacc || {}).dernier) + ".") + "</p>"));
    // 13. retours
    h.push(sect("Une erreur sur cette fiche ?", "<p>Un chiffre ou une information vous paraît faux, ou une fonction vous manque : dites-le-nous. Le signalement indique le syndic de cette fiche, jamais le numéro de votre copropriété.</p>"
      + '<div><button type="button" class="btn" data-act="retours">Signaler un problème ou proposer une idée</button></div>'));
    h.push('<button type="button" class="btn retour" data-act="retour">← Retour au tableau</button>');
    $("vue-fiche").innerHTML = h.join("");
    if (focaliser) {
      const t = $("fiche-titre");
      $("vue-fiche").scrollIntoView({ block: "start" });
      if (t) t.focus({ preventScroll: true });
    }
  }
  // Le plus petit périmètre où ce syndic gère au moins 10 copropriétés comparables, et la phrase qui le dit
  function perimetreUtile(ei) {
    const R = calculer(), n = (A) => ((A && A.par.get(ei)) || {}).comp || 0;
    const nz = n(R.A);
    if (nz >= SEUIL || R.Dp === R.A) return ["zone", ""];
    const seul = pl(nz, "copropriété comparable", "copropriétés comparables") + " seulement dans la zone";
    if (R.C && n(R.C) >= SEUIL) return ["commune", "Chiffres sur la commune : " + seul + "."];
    return ["departement", "Chiffres sur tout le département : " + seul + (R.C ? ", " + nb(n(R.C)) + " dans la commune" : "") + "."];
  }
  function criteresTxt() {
    const t = etat.taille >= 0 ? M.tailles[etat.taille][0] : null, c = etat.constr >= 0 ? M.classes_construction[etat.constr][0] : null;
    if (!t && !c) return "copropriétés de toutes tailles et de toutes périodes de construction";
    return "copropriétés" + (t ? " de " + t : " de toutes tailles") + (c ? " construites " + c.charAt(0).toLowerCase() + c.slice(1) : ", toutes périodes de construction");
  }

  // ---------- Questions à poser (§ 8 ; audit P2-8) ----------
  // Un indicateur s'écarte-t-il du repère au-delà des écarts courants pour un syndic de cette taille ?
  // Calcul au périmètre où la fiche s'ouvre (au moins 10 copropriétés comparables).
  function ecartRepere(ei, id, R) {
    const c = colParId(id);
    if (!c) return null;
    const per = perimetreUtile(ei)[0], A = per === "commune" ? R.C : per === "departement" ? R.Dp : R.A;
    const s = A.par.get(ei) || nouveauStat(), kn = c.kn(s, A.tot), k0 = c.kn(A.tot, A.tot);
    if (kn[1] < SEUIL || !k0[1]) return null;
    const p0 = k0[0] / k0[1], p = kn[0] / kn[1];
    if (p0 <= 0 || p0 >= 1) return null;
    const Ls = limites(kn[1], p0);
    return { p, p0, k: kn[0], n: kn[1], haut: p > Ls[2], lieu: { zone: "dans la zone", commune: "dans la commune", departement: "dans le département" }[per] };
  }
  function questions(ei) {
    const e = ENTS[ei], s0 = e.s, R = calculer(), s = R.A.par.get(ei) || nouveauStat(), ref = pointRef(), bi = bureauInfo(e, ref);
    const enPlace = monSyndic() === ei, nous = etat.copro;
    const d = new Date(), jour = (d.getDate() === 1 ? "1er" : d.getDate()) + " " + MOIS[d.getMonth()] + " " + d.getFullYear();
    const S = M.sources || {}, out = [], q = [];
    out.push((enPlace ? "Questions pour notre syndic, " : "Questions pour ") + e.nom + " (" + (e.masque ? (e.ei ? "entreprise individuelle" : "syndic non identifié au répertoire des entreprises") : (s0.forme_courte || s0.forme || "forme non renseignée") + ", numéro d'entreprise " + sirenGroupe(e.siren)) + ")");
    out.push("Préparées avec SyndicoScope le " + jour + ". Zone : " + libelleZone() + " ; " + criteresTxt() + ".");
    out.push("Sources : registre des copropriétés (données du " + dateLongue(M.date_reference) + ", comparées au " + T3 + ") ; répertoire des entreprises ("
      + dateLongue((S.dinum || {}).dernier) + ") ; BODACC (" + dateLongue((S.bodacc || {}).dernier) + "). Ce sont des déclarations publiques, à leur date.");
    out.push("");
    const ouBureau = bi ? (bi.b.registre ? "Le registre déclare votre bureau à " : "Votre siège est à ") + bi.commune + (bi.d != null ? ", à " + distanceTxt(bi.d) + " " + (nous != null ? "de chez nous" : "du centre de notre secteur") : "") + ". " : "";
    if (enPlace) q.push("Qui est notre gestionnaire attitré, combien de copropriétés suit-il, et depuis quel bureau ? " + ouBureau.trim());
    else q.push(ouBureau + "Vous gérez " + pl(s.comp, "copropriété comparable", "copropriétés comparables") + " à la nôtre dans notre secteur. Qui serait notre gestionnaire attitré, combien de copropriétés suit-il, et depuis quel bureau ?");
    // la fiche de notre copropriété elle-même
    if (enPlace && nous != null) {
      if (DR[nous] & (B.fin_passee || 8) && DR[nous] & (B.en_cours_datee || 32)) q.push("La fiche de notre copropriété au registre indique un mandat en cours dont la date de fin est passée. Le renouvellement a-t-il été voté, et quand sera-t-il déclaré au registre ?");
      if (DR[nous] & (B.maj_12 || 64) && DR[nous] & (B.maj_connue || 256) && colParId("maj12")) q.push("La fiche de notre copropriété n'a pas été mise à jour au registre depuis plus de 12 mois. Pouvez-vous la mettre à jour ?");
    }
    const nat = s0.national;
    if (effectifConnu(e) && nat && nat.lots_siren) q.push("Votre société déclare un effectif de " + s0.effectif + (s0.effectif_annee ? " (" + s0.effectif_annee + ")" : "") + " et " + nb(nat.lots_siren) + " lots au registre. Combien de personnes travaillent au service de syndic, et combien de lots chaque gestionnaire suit-il ?");
    // indicateurs : le chiffre, le repère quand il s'écarte au-delà des écarts courants, la question
    const rep = (x) => (x && x.haut ? ", contre " + pct(x.p0) + " pour l'ensemble des syndics professionnels " + x.lieu : "");
    const surN = (k, n) => nb(k) + " sur les " + nb(n);
    const c = s.concurrent + s.nonPro, xa = ecartRepere(ei, "autre", R);
    if (c >= 1 && (!enPlace || (xa && xa.haut))) {
      q.push((s.n0 >= 2 ? surN(c, s.n0) + " copropriétés de notre secteur que vous gériez au " + T3 + (c >= 2 ? " déclarent" : " déclare") : "La copropriété de notre secteur que vous gériez au " + T3 + " déclare")
        + " aujourd'hui un autre syndic au registre" + rep(xa) + ". " + (c >= 2 ? "Comment expliquez-vous ces changements ?" : "Comment expliquez-vous ce changement ?"));
    }
    const xe = ecartRepere(ei, "exp", R);
    if (s.expSans >= 1 && (!enPlace || (xe && xe.haut))) q.push("Pour " + pl(s.expSans, "copropriété", "copropriétés") + " que vous gériez au " + T3 + ", le registre indique un mandat expiré sans nouveau mandat déclaré" + rep(xe) + ". Comment organisez-vous la fin et le renouvellement d'un mandat, et sa déclaration au registre ?");
    const xp = ecartRepere(ei, "d_pasMandat", R);
    if (s.pasMandat >= 1 && (!enPlace || (xp && xp.haut))) q.push("Pour " + pl(s.pasMandat, "copropriété", "copropriétés") + " que vous gériez au " + T3 + ", le registre indique aujourd'hui « pas de mandat en cours »" + rep(xp) + ". Ces copropriétés ont-elles toujours un syndic, et quand leur fiche sera-t-elle mise à jour ?");
    if (arrVenues(s) >= 3 && !enPlace) q.push(nb(arrVenues(s)) + " copropriétés de notre secteur, déclarées chez un autre syndic professionnel au " + T3 + ", le sont aujourd'hui chez vous. Comment avez-vous adapté votre équipe ?");
    const xm = ecartRepere(ei, "maj12", R);
    if (colParId("maj12") && s.maj12 >= 1 && (!enPlace || (xm && xm.haut))) q.push(nb(s.maj12) + " de vos fiches au registre " + (s.maj12 >= 2 ? "n'ont pas été mises" : "n'a pas été mise") + " à jour depuis plus de 12 mois" + rep(xm) + ". Comment tenez-vous vos fiches à jour, et à quel rythme ?");
    const xf = ecartRepere(ei, "fin", R);
    if (s.finK >= 1 && (!enPlace || (xf && xf.haut))) q.push(nb(s.finK) + " de vos fiches " + (s.finK >= 2 ? "indiquent" : "indique") + " un mandat en cours dont la date de fin est passée" + rep(xf) + ". " + (s.finK >= 2 ? "Ces renouvellements ont-ils été votés, et quand seront-ils déclarés" : "Ce renouvellement a-t-il été voté, et quand sera-t-il déclaré") + " au registre ?");
    if (s0.dirigee_par && s0.dirigee_par.length) {
      const plus = s0.dirigee_par.length > 1;
      q.push("Votre société est dirigée par " + (plus ? "les sociétés " + liste(s0.dirigee_par) : "la société " + s0.dirigee_par[0]) + ". Qui décide de l'organisation de la gestion de notre copropriété : votre agence ou " + (plus ? "ces sociétés" : "cette société") + " ?");
    }
    // annonces de moins de 5 ans seulement
    const bo = s0.bodacc || {}, proc = dernier(alertesBodacc(s0).procedures.map((x) => x.date));
    if (proc && recente(proc)) q.push("Le BODACC a publié le " + dateLongue(proc) + " une annonce de procédure collective vous concernant. Où en est cette procédure aujourd'hui, et comment les fonds des copropriétés que vous gérez sont-ils protégés ?");
    if (bo.dernier_achat && recente(bo.dernier_achat)) q.push("Le BODACC a publié le " + dateLongue(bo.dernier_achat) + " un achat de fonds vous concernant. Qu'a-t-il changé pour les copropriétés gérées : équipe, bureau, contrat ?");
    q.push("Pouvez-vous nous indiquer le numéro de votre carte professionnelle, l'organisme qui délivre votre garantie financière et le montant de celle-ci ?");
    q.forEach((t, n) => out.push((n + 1) + ". " + t));
    return out.join("\n");
  }
  async function copier(texte, bouton, repli, msg) {
    msg = msg || "Questions copiées. Collez-les dans un courriel ou un document.";
    try {
      await navigator.clipboard.writeText(texte);
      annoncer(msg);
      if (bouton) {
        const lib = bouton.innerHTML;
        bouton.innerHTML = SVG_COCHE + " Copié";
        window.setTimeout(() => { bouton.innerHTML = lib; }, 3000);
      }
    } catch (err) {
      // dans une page intégrée, l'accès au presse-papiers est souvent refusé : on copie depuis la zone de texte
      if (repli) {
        repli.value = texte; repli.hidden = false; repli.focus(); repli.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        if (ok) { annoncer(msg); return; }
      }
      annoncer("La copie automatique n'a pas fonctionné. Le texte est sélectionné : copiez-le avec Ctrl + C, ou par un appui long sur téléphone.");
    }
  }

  // ---------- Liste courte, comparateur, dossier (§ 4.9 ; audit, changements n° 4 et 5) ----------
  function cleListe() { return "syndicoscope.liste." + M.departement; }
  // la barre du bas se signale quand la liste est pleine (sans animation : un liseré, une seconde et demie)
  function signalerBarre() {
    const b = $("barre-liste");
    if (!b || b.hidden) return;
    b.classList.add("signal");
    window.setTimeout(() => b.classList.remove("signal"), 1500);
  }
  // Le bouton répond sur place (« Ajouté · 2 sur 3 ») et garde le focus, sur la même ligne (audit P2-4, P2-9).
  function basculerListe(ei, bouton) {
    const a = ENTS[ei].ancre, k = etat.liste.indexOf(a);
    if (k >= 0) {
      etat.liste.splice(k, 1);
      etat.statutListe = { ei, t: "Retiré · " + nb(etat.liste.length) + " sur " + MAX_LISTE };
      annoncer(ENTS[ei].nom + " retiré de la liste courte. " + pl(etat.liste.length, "syndic", "syndics") + " sur " + MAX_LISTE + ".");
    } else if (etat.liste.length >= MAX_LISTE) {
      etat.statutListe = { ei, t: "Liste pleine (" + MAX_LISTE + " sur " + MAX_LISTE + ") : retirez d'abord un syndic" };
      annoncer("Votre liste courte compte déjà 3 syndics. Retirez-en un pour ajouter celui-ci.");
      signalerBarre();
    } else {
      etat.liste.push(a);
      etat.statutListe = { ei, t: "Ajouté · " + nb(etat.liste.length) + " sur " + MAX_LISTE };
      annoncer(ENTS[ei].nom + " ajouté à la liste courte. " + nb(etat.liste.length) + " sur " + MAX_LISTE + ".");
    }
    stock.ecrire(cleListe(), etat.liste);
    etat.confirmerVider = false;
    attribuerCouleurs();
    rendreBarre();
    const R = calculer();
    rendreTableau(R);
    rendreCarte(R, false);
    if (etat.vue === "fiche") rendreFiche(false);
    if (etat.vue === "comparateur") { if (etat.liste.length) rendreComparateur(); else fermerComparateur(); }
    ecrireHash(false);
    rendreFocus(bouton, '[data-act="liste"][data-ent="' + ei + '"]');
  }
  // rend le focus à l'élément équivalent, dans la même partie de la page, après un nouveau rendu
  function rendreFocus(ancien, selecteur) {
    if (!ancien) return;
    const zones = ["#vue-fiche", "#vue-comparateur", "#vue-dossier", "#tableau-contenu .cartes-syndics", "#tableau-contenu .tableau-ordinateur"];
    const z = zones.find((x) => ancien.closest && ancien.closest(x)) || zones[4];
    const b = document.querySelector(z + " " + selecteur);
    if (b && b.offsetParent) b.focus();
  }
  function rendreBarre() {
    const bar = $("barre-liste"), corps = $("barre-liste-corps"), n = etat.liste.length;
    if (!n) { bar.hidden = true; corps.innerHTML = ""; return; }
    bar.hidden = false;
    if (etat.confirmerVider) {
      corps.innerHTML = '<span>Vider la liste courte ?</span><div class="barre-liste-actions"><button type="button" class="btn btn-plein" data-act="vider-oui">Vider</button><button type="button" class="btn" data-act="vider-non">Garder</button></div>';
      return;
    }
    corps.innerHTML = "<span>" + esc("Liste courte : " + nb(n) + " sur " + MAX_LISTE) + '</span><div class="barre-liste-actions"><button type="button" class="btn btn-plein" data-act="comparer">Comparer</button><button type="button" class="btn" data-act="vider">Vider</button></div>';
  }
  function candidats() { return etat.liste.map((a) => ENT_PAR_ANCRE.get(a)).filter((x) => x != null); }
  function syndicsCompares() {
    const cands = candidats(), mon = monSyndic(), colsE = cands.slice();
    if (mon != null && cands.indexOf(mon) < 0) colsE.push(mon);
    return { cands, colsE };
  }
  function ouvrirComparateur(focaliser) {
    if (etat.vue === "tableau") etat.defilement = window.scrollY;
    afficherVue("comparateur");
    basculerOnglet("syndics");
    rendreComparateur();
    document.title = "Comparer " + pl(candidats().length, "syndic", "syndics") + " — SyndicoScope";
    if (focaliser !== false) {
      ecrireHash(true);
      const t = $("comparateur-titre");
      $("vue-comparateur").scrollIntoView({ block: "start" });
      if (t) t.focus({ preventScroll: true });
    }
  }
  function fermerComparateur() {
    afficherVue("tableau");
    ecrireHash(true);
    window.scrollTo(0, etat.defilement);
  }
  // repères d'une ligne : zone, commune, département
  function niveauxCompares(R) {
    const r = [["zone", R.A.tot]];
    if (R.C) r.push(["commune", R.C.tot]);
    if (R.Dp !== R.A) r.push(["département", R.Dp.tot]);
    return r;
  }
  function repereTxt(c, R) {
    if (!c.taux) return c.devenir ? niveauxCompares(R).map((x) => x[0] + " " + (x[1].n0 >= SEUIL ? pct(x[1].restees / x[1].n0) : nb(x[1].restees) + " sur " + nb(x[1].n0)) + " toujours chez le même syndic").join(" · ") : "—";
    return niveauxCompares(R).map((x) => { const kn = c.kn(x[1], x[1]); return x[0] + " " + (kn[1] ? pct(kn[0] / kn[1], kn[0]) : "—"); }).join(" · ");
  }
  function repereHtml(c, R) {
    if (!c.devenir) return esc(repereTxt(c, R));
    return niveauxCompares(R).map((x) => '<span class="repere-devenir"><span class="petit">' + esc(majuscule(x[0])) + "</span>" + barreDevenir(x[1]) + "</span>").join("");
  }
  // le tableau comparatif, en HTML (comparateur, dossier) ; le même en texte tabulé (copie)
  function tableauComparatif(R, colsE, cands, pourDossier) {
    const A = R.A, T = A.tot, ref = pointRef();
    const cell = (c, ei) => { const s = A.par.get(ei) || nouveauStat(), e = ENTS[ei], lg = { bi: bureauInfo(e, ref) }; return c.devenir ? htmlCol(c, s, T, e, lg) : esc(texteCol(c, s, T, e, lg)); };
    let h = '<div class="comparateur-table defile" tabindex="0"><table class="simple comparatif"><caption class="sr-only">Comparaison des syndics de la liste courte</caption><thead><tr><th scope="col">Indicateur</th><th scope="col">Repères</th>'
      + colsE.map((ei) => '<th scope="col">' + esc(ENTS[ei].nom) + (cands.indexOf(ei) < 0 ? '<span class="taux-detail">Votre syndic actuel</span>'
        : pourDossier ? "" : '<br><button type="button" class="btn compact" data-act="liste" data-ent="' + ei + '" aria-label="' + esc("Retirer " + ENTS[ei].nom + " de la liste courte") + '">Retirer</button>') + "</th>").join("")
      + "</tr></thead><tbody>";
    for (const gr of GROUPES.concat(groupesJustice())) {
      h += '<tr class="groupe"><th scope="rowgroup" colspan="' + (colsE.length + 2) + '">' + esc(gr[1]) + "</th></tr>";
      for (const c of colonnesGroupe(gr)) h += '<tr><th scope="row">' + esc(c.titre) + '</th><td class="petit">' + repereHtml(c, R) + "</td>" + colsE.map((ei) => "<td>" + cell(c, ei) + "</td>").join("") + "</tr>";
    }
    return h + "</tbody></table></div>";
  }
  function enteteDossier(cands) {
    return pl(cands.length, "syndic comparé", "syndics comparés") + " — zone : " + libelleZone() + " — " + criteresTxt() + " — registre du " + dateLongue(M.date_reference);
  }
  function tsvComparatif() {
    const R = calculer(), A = R.A, T = A.tot, ref = pointRef(), x = syndicsCompares();
    const net = (v) => String(v).replace(/[\t\r\n]+/g, " ");
    const lignes = [["SyndicoScope", enteteDossier(x.cands)], ["Indicateur", "Repères (zone · commune · département)"].concat(x.colsE.map((ei) => ENTS[ei].nom + (x.cands.indexOf(ei) < 0 ? " (votre syndic actuel)" : "")))];
    for (const gr of GROUPES.concat(groupesJustice())) {
      lignes.push([gr[1]]);
      for (const c of colonnesGroupe(gr)) {
        lignes.push([c.titre, repereTxt(c, R)].concat(x.colsE.map((ei) => { const s = A.par.get(ei) || nouveauStat(), e = ENTS[ei]; return texteCol(c, s, T, e, { bi: bureauInfo(e, ref) }); })));
      }
    }
    lignes.push(["Aucun écart n'est calculé et aucune valeur n'est mise en avant : ces chiffres servent à préparer vos questions."]);
    lignes.push(["Sources", sourcesTxt()]);
    return lignes.map((l) => l.map(net).join("\t")).join("\n");
  }
  function sourcesTxt() {
    const S = M.sources || {};
    return "registre des copropriétés (données du " + dateLongue(M.date_reference) + ", comparées au " + T3 + ") ; répertoire des entreprises (consulté le "
      + dateLongue((S.dinum || {}).dernier) + ") ; BODACC (consulté le " + dateLongue((S.bodacc || {}).dernier) + ")"
      + jeuxCharges().map((t) => " ; décisions de justice, " + JEUX[t].nom + " — " + methodeIA(t)).join("")
      + (jeuxCharges().length ? ". " + PHRASE_JUDILIBRE : ". Décisions de justice : " + PAS_DE_JUSTICE).replace(/\.$/, "");
  }
  function actionsExport(pourDossier) {
    const h = [];
    if (!pourDossier) h.push('<button type="button" class="btn btn-plein" data-act="dossier">Préparer le dossier pour le conseil syndical</button>');
    if (pourDossier && !integree()) h.push('<button type="button" class="btn btn-plein" data-act="imprimer">Imprimer ou enregistrer en PDF</button>');
    h.push('<button type="button" class="btn" data-act="copier-tableau">Copier le tableau</button>');
    if (!integree()) h.push('<button type="button" class="btn" data-act="copier-lien">Copier le lien</button>');
    h.push('<button type="button" class="btn" data-act="copier-tous">' + esc("Copier les questions") + "</button>");
    return '<div class="fiche-actions">' + h.join("") + "</div>";
  }
  function rendreComparateur() {
    const R = calculer(), x = syndicsCompares();
    let h = '<button type="button" class="btn retour" data-act="retour-comparateur">← Retour au tableau</button>'
      + '<div class="fiche-tete"><h2 id="comparateur-titre" tabindex="-1">' + esc("Comparer " + pl(x.cands.length, "syndic", "syndics")) + "</h2>"
      + '<p class="contexte-fiche">' + esc("Zone : " + libelleZone() + " · " + criteresTxt() + " · registre du " + dateLongue(M.date_reference) + ".") + "</p>"
      + actionsExport(false) + '<p class="petit muted">Le lien garde la zone, les critères et la liste courte ; jamais le numéro de votre copropriété ni votre adresse.</p>'
      + '<textarea class="texte-copie" id="repli-comparateur" readonly hidden aria-label="Texte à copier"></textarea></div>';
    h += tableauComparatif(R, x.colsE, x.cands, false);
    // téléphone : une carte par indicateur
    const A = R.A, T = A.tot, ref = pointRef();
    h += '<ul class="comparateur-cartes">';
    for (const gr of GROUPES.concat(groupesJustice())) for (const c of colonnesGroupe(gr)) {
      h += "<li><strong>" + esc(c.titre) + "</strong><br>" + (c.taux || c.devenir ? esc("Repères : " + repereTxt(c, R)) + "<br>" : "")
        + x.colsE.map((ei) => { const s = A.par.get(ei) || nouveauStat(), e = ENTS[ei]; return esc(e.nom + (x.cands.indexOf(ei) < 0 ? " (votre syndic actuel)" : "") + " : ") + (c.devenir ? htmlCol(c, s, T, e, null) : esc(texteCol(c, s, T, e, { bi: bureauInfo(e, ref) }))); }).join("<br>") + "</li>";
    }
    h += "</ul>";
    h += '<p class="petit muted">Aucun écart n\'est calculé et aucune valeur n\'est mise en avant : ces chiffres servent à préparer vos questions.</p>';
    h += '<button type="button" class="btn retour" data-act="retour-comparateur">← Retour au tableau</button>';
    $("vue-comparateur").innerHTML = h;
  }
  // dossier imprimable (A4) : en-tête, tableau comparatif, une page de questions par candidat, sources
  function ouvrirDossier(focaliser) {
    if (etat.vue === "tableau") etat.defilement = window.scrollY;
    afficherVue("dossier");
    basculerOnglet("syndics");
    rendreDossier();
    document.title = "Dossier pour le conseil syndical — SyndicoScope";
    if (focaliser !== false) {
      ecrireHash(true);
      const t = $("dossier-titre");
      $("vue-dossier").scrollIntoView({ block: "start" });
      if (t) t.focus({ preventScroll: true });
    }
  }
  function rendreDossier() {
    const R = calculer(), x = syndicsCompares();
    let h = '<div class="dossier-ecran"><button type="button" class="btn retour" data-act="retour-dossier">← Retour au comparateur</button>' + actionsExport(true)
      + '<textarea class="texte-copie" id="repli-dossier" readonly hidden aria-label="Texte à copier"></textarea></div>';
    h += '<article class="dossier"><h2 id="dossier-titre" tabindex="-1">Syndics comparés, pour le conseil syndical</h2>'
      + '<p class="dossier-contexte">' + esc(majuscule(enteteDossier(x.cands)) + ".") + "</p>"
      + tableauComparatif(R, x.colsE, x.cands, true)
      + "<p>Aucun écart n'est calculé et aucune valeur n'est mise en avant : ces chiffres servent à préparer vos questions.</p>"
      + '<ol class="registre-dit"><li>Le registre contient ce que les syndics y déclarent, à la date où ils le déclarent.</li><li>« Mandat expiré sans successeur déclaré » veut dire qu\'aucun nouveau mandat n\'a été déclaré au registre. Cela ne prouve pas que la copropriété n\'a pas de syndic.</li><li>Un chiffre sert à poser une question. Il ne suffit pas à conclure.</li></ol>';
    for (const ei of x.colsE) h += '<section class="dossier-questions"><h3>' + esc((x.cands.indexOf(ei) < 0 ? "Questions pour notre syndic actuel, " : "Questions pour ") + ENTS[ei].nom) + '</h3><pre class="questions-texte">' + esc(questions(ei)) + "</pre></section>";
    h += '<section class="dossier-sources"><h3>Sources</h3><p>' + esc(majuscule(sourcesTxt()) + ". Préparé avec SyndicoScope, outil indépendant qui ne note ni ne classe aucun syndic.") + "</p></section></article>";
    $("vue-dossier").innerHTML = h;
  }
  function lienPartage(vue) {
    return location.href.split("#")[0] + "#" + etatVersParams({ vue, fiche: null });
  }

  // ---------- Retours : signaler un problème, proposer une idée ----------
  // Le contexte joint au ticket sert à reproduire. Il ne porte jamais le numéro de la copropriété saisie,
  // ni une adresse, ni le centre d'un cercle, qui diraient où habite la personne ; ni les numéros d'un syndic masqué.
  let declencheurRetours = null;
  function integree() { try { return window.self !== window.top; } catch (err) { return true; } }
  function navigateurTxt() {
    const ua = navigator.userAgent || "", v = (re) => { const r = ua.match(re); return r ? r[1] : null; };
    let nom = "navigateur non reconnu", x;
    if ((x = v(/Edg\/(\d+)/))) nom = "Edge " + x;
    else if ((x = v(/OPR\/(\d+)/))) nom = "Opera " + x;
    else if ((x = v(/(?:Firefox|FxiOS)\/(\d+)/))) nom = "Firefox " + x;
    else if ((x = v(/(?:Chrome|CriOS)\/(\d+)/))) nom = "Chrome " + x;
    else if ((x = v(/Version\/(\d+)[\d.]* .*Safari/))) nom = "Safari " + x;
    const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "système non reconnu";
    return nom + " · " + os;
  }
  function contexteRetour() {
    const L = [];
    let zone;
    if (etat.mode === "cercle" && etat.cercle) {
      const zc = zoneDuCentre();
      zone = "cercle de " + rayonTxt(etat.cercle.r) + (etat.cercle.source === "zone" ? " autour du centre de " + (Z[etat.zone] ? Z[etat.zone].nom : "la zone") : ", centre non transmis")
        + (zc && etat.cercle.source !== "zone" ? " (commune du centre : " + (zc.p || zc).nom + ")" : "");
    } else zone = Z[etat.zone].nom + " (code " + Z[etat.zone].code + ")";
    const heure = /T(\d{2}):(\d{2})/.test(M.genere_le || "") ? " à " + M.genere_le.slice(11, 13) + " h " + M.genere_le.slice(14, 16) : "";
    L.push("Version : " + (M.version || "non précisée"));
    L.push("Données : registre du " + dateCourte(M.date_reference) + ", comparé au " + T3 + " ; calcul du " + dateCourte(M.genere_le) + heure);
    L.push("Département : " + M.departement);
    L.push("Zone : " + zone);
    L.push("Filtres : taille « " + (etat.taille >= 0 ? M.tailles[etat.taille][0] : "toutes") + " », construction « "
      + (etat.constr >= 0 ? M.classes_construction[etat.constr][0] : "toutes") + " »");
    const vue = etat.vue === "fiche" ? "fiche d'un syndic" : etat.vue === "comparateur" ? "comparateur (" + pl(etat.liste.length, "syndic", "syndics") + ")"
      : etat.vue === "dossier" ? "dossier pour le conseil syndical" : "tableau";
    const grp = (VUES.find((g) => g[0] === etat.colonnes) || [null, etat.colonnes])[1];
    const tri = etat.tri.col === "nom" ? "Syndic" : (colParId(etat.tri.col) || { titre: etat.tri.col }).titre;
    L.push("Vue : " + vue + " · colonnes « " + grp + " » · tri « " + tri + " » (" + (etat.tri.dir === "asc" ? "croissant" : "décroissant") + ")");
    if (etat.vue === "fiche" && etat.fiche != null) {
      const e = ENTS[etat.fiche], per = { zone: "dans la zone", commune: "dans la commune", departement: "dans tout le département" }[etat.perimetre];
      L.push("Fiche ouverte : " + (e.masque ? "syndic professionnel masqué (" + (e.ei ? "entreprise individuelle" : "non identifié au répertoire") + ", non nommé)" : e.nom + " (SIREN " + sirenGroupe(e.siren) + ")") + " · chiffres " + per);
    }
    const sombre = document.documentElement.getAttribute("data-theme") === "dark"
      || (!document.documentElement.getAttribute("data-theme") && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    L.push("Écran : fenêtre de " + window.innerWidth + " × " + window.innerHeight + " px · thème " + (sombre ? "sombre" : "clair"));
    L.push("Navigateur : " + navigateurTxt());
    L.push("Variante : " + ($("donnees-json") ? "page complète" : "page légère, données chargées à côté") + (integree() ? ", intégrée dans une autre page" : ""));
    return L.join("\n");
  }
  function urlTicket(type) {
    const r = RETOURS[type], ctx = contexteRetour();
    let titre = r.titre;
    if (type === "donnees" && etat.vue === "fiche" && etat.fiche != null && !ENTS[etat.fiche].masque) titre += ENTS[etat.fiche].nom;
    // « contexte » remplit le champ de même identifiant du formulaire ; « body » ne sert que si le formulaire manque
    return URL_TICKET + "?template=" + encodeURIComponent(r.modele) + "&title=" + encodeURIComponent(titre)
      + "&contexte=" + encodeURIComponent(ctx) + "&body=" + encodeURIComponent("Contexte (rempli par la page) :\n" + ctx);
  }
  function ouvrirRetours(declencheur) {
    const d = $("retours");
    if (!d) return;
    for (const type of Object.keys(RETOURS)) { const a = $("retour-" + type); if (a) a.href = urlTicket(type); }
    declencheurRetours = declencheur || null;
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else { d.setAttribute("open", ""); $("btn-fermer-retours").focus(); }
  }
  function rendreFocusRetours() {
    if (declencheurRetours && declencheurRetours.isConnected) declencheurRetours.focus();
    declencheurRetours = null;
  }
  function fermerRetours() {
    const d = $("retours");
    if (!d) return;
    if (typeof d.close === "function") { if (d.open) d.close(); } else d.removeAttribute("open");
    // sans attendre l'évènement « close », que certains navigateurs retardent jusqu'au prochain affichage
    rendreFocusRetours();
  }

  // ---------- Adresse de la page : zone, critères, liste courte, vue (audit P2-7) ----------
  // Forme : #z=13206&t=1&c=1&lc=067803916,ei-2&f=067803916&p=zone. L'ancienne forme #s-<SIREN> ouvre la fiche.
  // Jamais le numéro d'une copropriété, ni une adresse, ni le centre d'un cercle qui n'est pas celui d'une commune :
  // ces cercles s'inscrivent comme la commune ou l'arrondissement de leur centre.
  let dernierHash = null;
  function etatVersParams(o) {
    o = o || {};
    const p = [];
    if (etat.mode === "cercle" && etat.cercle) {
      const c = etat.cercle;
      // un cercle autour d'un point, d'une adresse ou d'une copropriété s'écrit comme la commune de son centre
      if (c.source === "zone") p.push("cz=" + Z[etat.zone].code, "r=" + c.r);
      else { const zc = zoneDuCentre(); p.push("z=" + (zc ? zc.code : Z[etat.zone].code)); }
    } else if (!etat.panorama) p.push("z=" + Z[etat.zone].code);
    if (etat.taille >= 0) p.push("t=" + etat.taille);
    if (etat.constr >= 0) p.push("c=" + etat.constr);
    if (etat.liste.length) p.push("lc=" + etat.liste.map((a) => a.slice(2)).join(","));
    if (etat.colonnes !== "ensemble") p.push("col=" + etat.colonnes);
    const fiche = o.fiche !== undefined ? o.fiche : etat.vue === "fiche" ? etat.fiche : null;
    if (fiche != null) p.push("f=" + ENTS[fiche].ancre.slice(2), "p=" + etat.perimetre);
    const vue = o.vue !== undefined ? o.vue : etat.vue;
    if (fiche == null && (vue === "comparateur" || vue === "dossier")) p.push("v=" + (vue === "dossier" ? "dossier" : "comparer"));
    return p.join("&");
  }
  function lireParams(h) {
    const out = {};
    if (/^s-[^=&]+$/.test(h)) { out.f = h.slice(2); return out; }
    if (h.indexOf("=") < 0) return null;   // ancre interne (#comment-lire…) : rien à appliquer
    for (const kv of h.split("&")) { const i = kv.indexOf("="); if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1); }
    return out;
  }
  function hashCourant() { try { return decodeURIComponent(location.hash.slice(1)); } catch (err) { return location.hash.slice(1); } }
  function ecrireHash(pousser) {
    const h = etatVersParams();
    if (h === dernierHash) return;
    dernierHash = h;
    try { history[pousser ? "pushState" : "replaceState"](null, "", location.pathname + location.search + (h ? "#" + h : "")); } catch (err) { /* sans historique : rien */ }
  }
  // Applique zone, critères, liste courte et colonnes lus dans l'adresse. Rend vrai si la zone ou les critères changent.
  function appliquerParams(P) {
    let change = false;
    const zi = (code) => (code && ZC.has(code) ? ZC.get(code).i : null);
    if (P.z && zi(P.z) != null) {
      if (etat.mode !== "liste" || etat.zone !== zi(P.z)) { etat.mode = "liste"; etat.zone = zi(P.z); etat.cercle = null; change = true; }
    } else if (P.cz && Number(P.r) > 0) {
      const r = [300, 500, 1000, 2000, 5000].indexOf(Number(P.r)) >= 0 ? Number(P.r) : 1000;
      let c = null;
      if (zi(P.cz) != null) { const z = Z[zi(P.cz)]; etat.zone = z.i; c = { lat: z.lat, lon: z.lon, r, source: "zone" }; }
      if (c && (!etat.cercle || etat.mode !== "cercle" || etat.cercle.lat !== c.lat || etat.cercle.lon !== c.lon || etat.cercle.r !== c.r)) { etat.mode = "cercle"; etat.cercle = c; change = true; }
    }
    const t = P.t != null && M.tailles[Number(P.t)] ? Number(P.t) : -1, cc = P.c != null && M.classes_construction[Number(P.c)] ? Number(P.c) : -1;
    if (t !== etat.taille || cc !== etat.constr) { etat.taille = t; etat.constr = cc; etat.regle = { taille: false, constr: false }; change = true; }
    if (P.lc != null) {
      const l = P.lc.split(",").filter(Boolean).map((id) => "s-" + id).filter((a) => ENT_PAR_ANCRE.has(a)).slice(0, MAX_LISTE);
      if (l.join() !== etat.liste.join()) { etat.liste = l; stock.ecrire(cleListe(), l); rendreBarre(); }
    }
    if (P.col && VUES.concat(vuesJustice()).some((v) => v[0] === P.col)) etat.colonnes = P.col;
    if (P.p && ["zone", "commune", "departement"].indexOf(P.p) >= 0) { etat.perimetre = P.p; etat.notePerimetre = ""; }
    return change;
  }
  // remet les contrôles de la page d'accord avec l'état (après lecture de l'adresse)
  function synchroniserControles() {
    const mz = document.querySelector('input[name="mode-zone"][value="' + etat.mode + '"]');
    if (mz) mz.checked = true;
    $("zone-liste").hidden = etat.mode !== "liste";
    $("zone-cercle").hidden = etat.mode !== "cercle";
    if (etat.cercle) { const rr = document.querySelector('input[name="rayon"][value="' + etat.cercle.r + '"]'); if (rr) rr.checked = true; }
    $("champ-commune").value = Z[etat.zone].nom;
    $("filtre-taille").value = String(etat.taille);
    $("filtre-construction").value = String(etat.constr);
    $("regle-taille").hidden = !etat.regle.taille;
    $("regle-construction").hidden = !etat.regle.constr;
    const col = document.querySelector('input[name="colonnes"][value="' + etat.colonnes + '"]');
    if (col) col.checked = true;
  }
  // retour, avance, ou adresse modifiée à la main
  function router() {
    const h = hashCourant();
    if (h === dernierHash) return;
    const P = lireParams(h);
    if (!P) return;
    dernierHash = h;
    if (appliquerParams(P)) { quitterPanorama(); synchroniserControles(); majTout({ nouvelleZone: true, cadrer: true, hash: false }); }
    ouvrirVueParams(P);
  }
  function ouvrirVueParams(P) {
    const f = P.f ? ENT_PAR_ANCRE.get("s-" + P.f) : null;
    if (f != null) { montrerFiche(f, !P.p); return; }
    if (P.v === "comparer" && candidats().length) { ouvrirComparateur(false); return; }
    if (P.v === "dossier" && candidats().length) { ouvrirDossier(false); return; }
    if (etat.vue !== "tableau") retourTableau(false);
  }

  // ---------- Vues et navigation ----------
  function afficherVue(v) {
    etat.vue = v;
    $("vue-tableau").hidden = v !== "tableau";
    $("vue-fiche").hidden = v !== "fiche";
    $("vue-comparateur").hidden = v !== "comparateur";
    $("vue-dossier").hidden = v !== "dossier";
    document.body.classList.toggle("impression-dossier", v === "dossier");
    if (v === "tableau") document.title = nomZone() + " — SyndicoScope";
  }
  function basculerOnglet(o) {
    $("disposition").setAttribute("data-onglet", o);
    $("onglet-syndics").setAttribute("aria-pressed", String(o === "syndics"));
    $("onglet-carte").setAttribute("aria-pressed", String(o === "carte"));
    if (o === "carte" && carte) window.setTimeout(() => { carte.invalidateSize(); cadrer(); couchePoints.redessiner(); essayerTuiles(); }, 0);
  }
  function ouvrirFiche(ei) {
    if (etat.vue === "tableau") { etat.defilement = window.scrollY; etat.retourFoyer = ei; }
    montrerFiche(ei, true);
    ecrireHash(true);
  }
  // auto : la fiche s'ouvre sur le plus petit périmètre où ce syndic gère au moins 10 copropriétés comparables
  function montrerFiche(ei, auto) {
    etat.fiche = ei;
    etat.decisions = 10;
    if (auto) { const p = perimetreUtile(ei); etat.perimetre = p[0]; etat.notePerimetre = p[1]; }
    afficherVue("fiche");
    basculerOnglet("syndics");
    rendreFiche(true);
    document.title = ENTS[ei].nom + " — SyndicoScope";
    etat.surb = -1;
    surbrillance(ei);
  }
  function retourTableau(nettoyer) {
    etat.fiche = null;
    afficherVue("tableau");
    if (nettoyer) ecrireHash(true);
    surbrillance(-1);
    window.scrollTo(0, etat.defilement);
    const b = document.querySelector('#tableau-contenu .tableau-ordinateur button.nom-syndic[data-ent="' + etat.retourFoyer + '"]')
      || document.querySelector('#tableau-contenu .cartes-syndics button.nom-syndic[data-ent="' + etat.retourFoyer + '"]');
    if (b && b.offsetParent) b.focus({ preventScroll: true });
  }

  // ---------- Changements de zone, de filtre, de copropriété ----------
  function quitterPanorama() { etat.panorama = false; }
  function choisirZone(zi) {
    etat.mode = "liste";
    etat.cercle = null;
    const r = document.querySelector('input[name="mode-zone"][value="liste"]');
    if (r) r.checked = true;
    $("zone-liste").hidden = false;
    $("zone-cercle").hidden = true;
    finChoix();
    etat.zone = zi;
    quitterPanorama();
    $("champ-commune").value = Z[zi].nom;
    majTout({ nouvelleZone: true, cadrer: true, annonce: true });
  }
  function definirCentre(lat, lon, source, rayon) {
    etat.mode = "cercle";
    const r = document.querySelector('input[name="mode-zone"][value="cercle"]');
    if (r) r.checked = true;
    $("zone-liste").hidden = true;
    $("zone-cercle").hidden = false;
    if (rayon) { const rr = document.querySelector('input[name="rayon"][value="' + rayon + '"]'); if (rr) rr.checked = true; }
    const ray = rayon || Number((document.querySelector('input[name="rayon"]:checked') || {}).value || 1000);
    etat.cercle = { lat, lon, r: ray, source };
    // la zone suit le centre (commune ou arrondissement), pour « Voir toute la commune » et les repères
    if (source !== "zone") { const zc = zoneDuCentre(); if (zc) { etat.zone = zc.i; $("champ-commune").value = zc.nom; } }
    quitterPanorama();
    majTout({ nouvelleZone: true, cadrer: true, annonce: true });
  }
  function texteCentre() {
    const c = etat.cercle;
    if (!c) return "";
    const quoi = { copro: "votre copropriété", adresse: "l'adresse choisie (elle n'est ni gardée ni écrite dans un lien)", point: "point choisi sur la carte" }[c.source];
    return "Centre du cercle : " + (quoi || "centre de " + (Z[etat.zone] ? Z[etat.zone].nom : "la zone")) + ".";
  }
  function finChoix() {
    etat.choixCentre = false;
    const v = $("viseur");
    if (v) v.hidden = true;
    $("viseur-actions").hidden = true;
    $("viseur-depart").hidden = false;
    $("carte-aide").textContent = "";
  }
  // La copropriété choisie règle les critères et place un cercle d'1 km autour d'elle (audit, changement n° 3).
  // Son numéro et son centre ne sortent jamais de la page : ni lien, ni ticket, ni stockage.
  function definirCopro(i) {
    etat.copro = i;
    if (TAILLE[i] >= 0) { etat.taille = TAILLE[i]; etat.regle.taille = true; }
    if (CLASSE[i] >= 0) { etat.constr = CLASSE[i]; etat.regle.constr = true; }
    $("filtre-taille").value = String(etat.taille);
    $("filtre-construction").value = String(etat.constr);
    $("regle-taille").hidden = !etat.regle.taille;
    $("regle-construction").hidden = !etat.regle.constr;
    $("copros-proches").hidden = true;
    quitterPanorama();
    if (ZONE[i] >= 0) etat.zone = ZONE[i];
    $("champ-commune").value = Z[etat.zone].nom;
    if (isFinite(LAT[i]) && isFinite(LON[i])) { definirCentre(LAT[i], LON[i], "copro", etat.mode === "cercle" && etat.cercle ? etat.cercle.r : 1000); return; }
    majTout({ nouvelleZone: true, cadrer: true, annonce: true });
  }
  function retirerCopro() {
    etat.copro = null;
    etat.regle = { taille: false, constr: false };
    $("regle-taille").hidden = true;
    $("regle-construction").hidden = true;
    $("champ-immat").value = "";
    effacerErreur();
    // un cercle centré sur la copropriété ou sur l'adresse ne reste pas : la commune prend sa place
    if (etat.mode === "cercle" && etat.cercle && etat.cercle.source !== "zone") { choisirZone(etat.zone); return; }
    majTout({ cadrer: false });
  }
  function effacerErreur() {
    const champ = $("champ-immat"), err = $("erreur-immat");
    err.hidden = true; err.innerHTML = "";
    champ.removeAttribute("aria-invalid");
    champ.setAttribute("aria-describedby", "aide-immat");
  }
  function erreurImmat(t) {
    const champ = $("champ-immat"), err = $("erreur-immat");
    err.innerHTML = SVG_ALERTE + "<span>" + esc(t) + "</span>";
    err.hidden = false;
    champ.setAttribute("aria-invalid", "true");
    champ.setAttribute("aria-describedby", "aide-immat erreur-immat");
    annoncer(t);
  }
  function chercherImmat() {
    const champ = $("champ-immat"), v = champ.value.toUpperCase().replace(/[\s\-.]/g, "");
    champ.value = v;
    effacerErreur();
    if (!v) return;
    if (!RE_IMMAT.test(v)) { erreurImmat("Ce numéro n'a pas le format attendu : 2 lettres puis 7 chiffres (les espaces sont acceptés)."); return; }
    const i = INDEX_IMMAT.get(v);
    if (i != null && SYN[i] === ABSENTE) {
      erreurImmat("La copropriété " + v + " figurait au registre au " + T3 + ", mais elle n'y figure plus au registre du " + dateLongue(M.date_reference) + ". Elle a pu être radiée ou renumérotée : vérifiez le numéro auprès de votre syndic.");
      return;
    }
    if (i == null) {
      erreurImmat("Nous ne trouvons pas le numéro " + v + " dans le registre du " + dateLongue(M.date_reference) + ". Vérifiez-le auprès de votre syndic ou de votre conseil syndical. Une copropriété immatriculée récemment peut ne pas encore figurer dans nos données.");
      return;
    }
    definirCopro(i);
  }
  function majTout(o) {
    o = o || {};
    $("panneau-principal").setAttribute("aria-busy", "true");
    window.setTimeout(() => {
      try {
        const R = calculer();
        if (o.nouvelleZone) { etat.limite = PAGE; etat.jumeau = PAGE_JUMEAU; etat.voirAnciens = false; }
        if (o.filtres) { etat.limite = PAGE; etat.jumeau = PAGE_JUMEAU; }
        etat.statutListe = null;
        attribuerCouleurs();
        rendreBandeau(R);
        rendreResumeCopro();
        rendreResumeFiltres();
        $("centre-texte").textContent = texteCentre();
        rendreTableau(R);
        if (etat.vue === "fiche" && etat.fiche != null) rendreFiche(false);
        if (etat.vue === "comparateur") rendreComparateur();
        if (etat.vue === "dossier") rendreDossier();
        rendreCarte(R, !!o.cadrer);
        if (etat.vue === "tableau") document.title = nomZone() + " — SyndicoScope";
        if (o.annonce) annoncer("Zone : " + libelleZone() + ". " + pl(R.A.tot.comparables, "copropriété comparable", "copropriétés comparables") + ", " + pl(compterSyndics(R.A), "syndic professionnel", "syndics professionnels") + ".");
        if (o.hash !== false) ecrireHash(false);
        if (o.ensuite) o.ensuite();
      } finally {
        $("panneau-principal").setAttribute("aria-busy", "false");
      }
    }, 0);
  }

  // ---------- Partir de sa copropriété : par son numéro ou par son adresse (audit, changement n° 3) ----------
  // L'adresse tapée part à la Base adresse nationale (service public) pour la retrouver, et nulle part ailleurs :
  // ni dans un lien, ni dans un ticket, ni dans le stockage du navigateur.
  const URL_BAN = "https://api-adresse.data.gouv.fr/search/";
  let banCtrl = null, banMinuteur = 0;
  function erreurAdresse(t) {
    const err = $("erreur-adresse");
    err.innerHTML = SVG_ALERTE + "<span>" + esc(t) + "</span>";
    err.hidden = false;
    annoncer(t);
  }
  function effacerErreurAdresse() { const err = $("erreur-adresse"); err.hidden = true; err.innerHTML = ""; }
  function initAdresse() {
    const champ = $("champ-adresse"), boite = $("liste-adresses");
    let options = [], actif = -1;
    const fermer = () => { boite.hidden = true; champ.setAttribute("aria-expanded", "false"); champ.removeAttribute("aria-activedescendant"); actif = -1; };
    const montrer = (h) => { boite.innerHTML = h; boite.hidden = false; champ.setAttribute("aria-expanded", "true"); };
    const chercher = async () => {
      const q = champ.value.trim();
      if (q.length < 3) { fermer(); return; }
      if (banCtrl) banCtrl.abort();
      banCtrl = window.AbortController ? new AbortController() : null;
      try {
        const r = await fetch(URL_BAN + "?q=" + encodeURIComponent(q) + "&limit=6&autocomplete=1", banCtrl ? { signal: banCtrl.signal } : {});
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        options = (j.features || []).filter((f) => f.geometry && String((f.properties || {}).citycode || "").indexOf(String(M.departement)) === 0);
        actif = -1;
        if (!options.length) { montrer('<li class="combo-vide" role="option" aria-disabled="true" aria-selected="false">' + esc("Aucune adresse trouvée dans le département " + M.departement + ". Vérifiez l'orthographe, ou ajoutez la commune.") + "</li>"); return; }
        montrer(options.map((f, k) => '<li id="opt-adr-' + k + '" role="option" aria-selected="false" data-k="' + k + '">' + esc(f.properties.label) + "</li>").join(""));
      } catch (err) {
        if (err && err.name === "AbortError") return;
        fermer();
        erreurAdresse("La recherche d'adresse n'a pas pu joindre la Base adresse nationale" + (integree() ? " : cette page est intégrée dans une autre, qui bloque l'appel." : ", peut-être faute de réseau.")
          + " Utilisez le numéro d'immatriculation, ou choisissez votre commune puis cliquez sur la carte près de votre immeuble.");
      }
    };
    const marquer = (k) => {
      actif = k;
      boite.querySelectorAll("li[data-k]").forEach((li) => li.setAttribute("aria-selected", String(Number(li.dataset.k) === k)));
      const li = $("opt-adr-" + k);
      if (li) { champ.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
    };
    const valider = (k) => {
      const f = options[k];
      if (!f) return;
      fermer();
      champ.value = f.properties.label;
      choisirAdresse(f.geometry.coordinates[1], f.geometry.coordinates[0]);
    };
    champ.addEventListener("input", () => { effacerErreurAdresse(); window.clearTimeout(banMinuteur); banMinuteur = window.setTimeout(chercher, 300); });
    champ.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); if (options.length) { if (boite.hidden) { boite.hidden = false; champ.setAttribute("aria-expanded", "true"); } marquer(Math.min(actif + 1, options.length - 1)); } }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); if (options.length) marquer(Math.max(actif - 1, 0)); }
      else if (ev.key === "Enter") { ev.preventDefault(); if (!boite.hidden && options.length) valider(actif >= 0 ? actif : 0); }
      else if (ev.key === "Escape") { if (!boite.hidden) { ev.preventDefault(); fermer(); } }
    });
    boite.addEventListener("mousedown", (ev) => { const li = ev.target.closest("li[data-k]"); if (li) { ev.preventDefault(); valider(Number(li.dataset.k)); } });
    champ.addEventListener("blur", () => window.setTimeout(fermer, 150));
  }
  // les copropriétés du registre à moins de 50 m de l'adresse (sinon les trois plus proches à moins de 200 m),
  // puis un cercle d'1 km centré sur l'adresse
  function choisirAdresse(lat, lon) {
    const proches = [];
    for (let i = 0; i < N; i++) {
      if (SYN[i] === ABSENTE || !isFinite(LAT[i])) continue;
      if (Math.abs(LAT[i] - lat) > 0.002 || Math.abs(LON[i] - lon) > 0.003) continue;
      const d = metres(lat, lon, LAT[i], LON[i]);
      if (d <= 200) proches.push({ i, d });
    }
    proches.sort((a, b) => a.d - b.d);
    let l = proches.filter((x) => x.d <= 50);
    const loin = !l.length;
    if (loin) l = proches.slice(0, 3);
    const el = $("copros-proches");
    if (!l.length) el.innerHTML = "<p>" + esc("Aucune copropriété du registre à moins de 200 m de cette adresse. Le cercle d'1 km est centré sur l'adresse.") + "</p>";
    else {
      el.innerHTML = "<p>" + esc(loin ? "Aucune copropriété du registre à moins de 50 m de cette adresse. Les plus proches :" : "Copropriétés du registre à moins de 50 m de cette adresse :") + '</p><ul class="proches">'
        + l.slice(0, 8).map((x) => '<li><span><span class="immat">' + esc(IMMAT[x.i]) + "</span> · " + esc(pl(LOTS[x.i], "lot", "lots") + " · " + construite(PER[x.i]) + " · syndic déclaré : " + nomRepresentant(ENT[x.i]) + " · à " + distanceTxt(x.d))
          + '</span><button type="button" class="btn compact" data-act="ma-copro" data-i="' + x.i + '">C\'est la mienne</button></li>').join("") + "</ul>";
    }
    el.hidden = false;
    definirCentre(lat, lon, "adresse", 1000);
  }
  function rendreResumeCopro() {
    const el = $("resume-copro"), aide = $("aide-immat");
    if (etat.copro == null) { el.hidden = true; el.innerHTML = ""; aide.hidden = false; return; }
    const i = etat.copro, e = ENT[i];
    el.innerHTML = "<p>Votre copropriété : " + esc(pl(LOTS[i], "lot", "lots")) + " · " + esc(construite(PER[i])) + " · syndic déclaré : " + esc(nomRepresentant(e)) + "</p>"
      + '<div class="resume-actions">' + (e >= 0 ? '<button type="button" class="btn btn-plein" data-act="fiche" data-ent="' + e + '">' + esc("Voir la fiche de " + ENTS[e].nom) + "</button>" : "")
      + (etat.mode === "cercle" ? '<button type="button" class="btn" data-act="voir-commune">' + esc("Voir toute la commune (" + Z[etat.zone].nom + ")") + "</button>" : "")
      + '<button type="button" class="btn" data-act="retirer-copro">Retirer</button></div>';
    el.hidden = false;
    aide.hidden = true;
  }

  // ---------- Trouver un syndic par son nom (audit P2-16) ----------
  function rendreRecherche(R) {
    const el = $("recherche-etat"), q = etat.recherche ? norm(etat.recherche) : "";
    if (!el) return;
    if (!q) { el.innerHTML = ""; return; }
    const ici = new Set();
    for (const kv of R.A.par) { const s = kv[1]; if ((s.comp > 0 || s.n0 > 0) && ENTS[kv[0]].cherche.indexOf(q) >= 0) ici.add(kv[0]); }
    const ailleurs = ENTS.filter((e) => !ici.has(e.i) && e.cherche.indexOf(q) >= 0);
    let h = esc(ici.size ? pl(ici.size, "syndic de la zone porte ce nom.", "syndics de la zone portent ce nom.") : "Aucun syndic de la zone ne porte ce nom.");
    if (ailleurs.length > 6) h += " " + esc(pl(ailleurs.length, "autre syndic du département le porte", "autres syndics du département le portent") + " : précisez le nom.");
    else if (ailleurs.length) h += " " + esc(ailleurs.length >= 2 ? "Ailleurs dans le département :" : "Ailleurs dans le département :") + " "
      + ailleurs.map((e) => '<button type="button" class="btn-lien" data-act="fiche" data-ent="' + e.i + '">' + esc(e.nom) + "</button>").join(" ");
    el.innerHTML = h;
  }

  // ---------- Export du tableau (audit P2-14) : un fichier CSV fabriqué dans le navigateur ----------
  let urlExport = null, texteExport = "";
  function majExport(R, lignes) {
    const a = $("lien-export"), b = $("btn-copier-export");
    if (!a) return;
    if (urlExport) { try { URL.revokeObjectURL(urlExport); } catch (err) { /* rien */ } urlExport = null; }
    if (!lignes.length || typeof Blob === "undefined" || !window.URL || !URL.createObjectURL) { a.hidden = true; if (b) b.hidden = true; texteExport = ""; return; }
    const T = R.A.tot, cols = GROUPES.concat(groupesJustice()).flatMap(colonnesGroupe);
    const cel = (v) => { const t = String(v == null ? "" : v); return /[";\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const rows = [["SyndicoScope : syndics professionnels des copropriétés comparables — zone : " + libelleZone() + " — " + criteresTxt() + " — registre du " + dateLongue(M.date_reference)],
      ["Sources : " + sourcesTxt()], ["Les chiffres reprennent des déclarations publiques, à leur date. Rien n'est noté ni classé."], []];
    rows.push(["Syndic", "Numéro d'entreprise (SIREN)"].concat(cols.map((c) => c.titre)));
    for (const lg of lignes) {
      rows.push([lg.e.nom, lg.groupe ? pl(lg.membres.length, "société", "sociétés") : lg.e.masque ? "non publié" : String(lg.e.siren)]
        .concat(cols.map((c) => texteCol(c, lg.s, T, lg.e, lg))));
    }
    const csv = "\uFEFF" + rows.map((r) => r.map(cel).join(";")).join("\r\n");
    urlExport = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.href = urlExport;
    a.download = "syndicoscope-" + (norm(nomZone()).replace(/[^a-z0-9]+/g, "-") || "zone") + "-" + String(M.date_reference).slice(0, 10) + ".csv";
    a.hidden = false;
    // page intégrée : le téléchargement y est parfois bloqué ; le même tableau se copie, colonnes séparées par des tabulations, pour un tableur
    texteExport = rows.map((r) => r.map((v) => String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
    if (b) b.hidden = !integree();
  }

  // ---------- Sélecteur de zone (§ 4.1) ----------
  function chercherZones(q) {
    const res = [];
    for (const z of Z) {
      let rang = -1;
      for (const c of z.cles) {
        if (c.indexOf(q) === 0) { rang = 0; break; }
        if (c.indexOf(" " + q) >= 0) rang = 1;
      }
      if (rang >= 0) res.push({ z, rang });
    }
    res.sort((a, b) => a.rang - b.rang || a.z.cles[0].localeCompare(b.z.cles[0], "fr", { numeric: true }));
    return res.slice(0, 25).map((x) => x.z);
  }
  function initCombo() {
    const champ = $("champ-commune"), boite = $("liste-communes");
    let options = [], actif = -1;
    const fermer = () => { boite.hidden = true; champ.setAttribute("aria-expanded", "false"); champ.removeAttribute("aria-activedescendant"); actif = -1; };
    const ouvrir = () => { boite.hidden = false; champ.setAttribute("aria-expanded", "true"); };
    const proposer = () => {
      const q = norm(champ.value);
      if (q.length < 2) { fermer(); return; }
      options = chercherZones(q);
      actif = -1;
      if (!options.length) {
        boite.innerHTML = '<li class="combo-vide" role="option" aria-disabled="true" aria-selected="false">' + esc("Aucune commune ne commence par « " + champ.value.trim() + " ». Vérifiez l'orthographe.") + "</li>";
      } else {
        boite.innerHTML = options.map((z, k) => '<li id="opt-zone-' + k + '" role="option" aria-selected="false" data-k="' + k + '">' + esc(z.dep ? z.nom + " : tout le département (" + M.departement + ")" : z.nom + " (" + M.departement + ")") + "</li>").join("");
      }
      ouvrir();
    };
    const marquer = (k) => {
      actif = k;
      boite.querySelectorAll("li[data-k]").forEach((li) => li.setAttribute("aria-selected", String(Number(li.dataset.k) === k)));
      const li = $("opt-zone-" + k);
      if (li) { champ.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
    };
    const valider = (k) => { const z = options[k]; if (!z) return; fermer(); champ.value = z.nom; choisirZone(z.i); };
    champ.addEventListener("input", proposer);
    champ.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); if (boite.hidden) proposer(); if (options.length) marquer(Math.min(actif + 1, options.length - 1)); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); if (options.length) marquer(Math.max(actif - 1, 0)); }
      else if (ev.key === "Enter") { if (!boite.hidden && options.length) { ev.preventDefault(); valider(actif >= 0 ? actif : 0); } }
      else if (ev.key === "Escape") { if (!boite.hidden) { ev.preventDefault(); fermer(); } }
    });
    boite.addEventListener("mousedown", (ev) => { const li = ev.target.closest("li[data-k]"); if (li) { ev.preventDefault(); valider(Number(li.dataset.k)); } });
    champ.addEventListener("blur", () => window.setTimeout(fermer, 150));
  }

  // ---------- Pied de page et méthode ----------
  function rendrePied() {
    const S = M.sources || {}, q = S.rnic_quotidienne || {}, t = S.rnic_t3 || {};
    const lien = (url, txt) => '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + "</a> (site externe)";
    $("liste-sources").innerHTML = [
      esc("Registre national d'immatriculation des copropriétés (Agence nationale de l'habitat) : mise à jour quotidienne du " + dateLongue(q.date_fichier || M.date_reference)
        + (q.total_lignes ? " (fichier national de " + nb(q.total_lignes) + " lignes)" : "") + " et extraction du " + T3 + " (fichier du " + dateLongue(t.date_fichier || M.date_t3) + "), publiées sur ")
        + lien(URL_REGISTRE, "data.gouv.fr") + ". Licence Ouverte 2.0.",
      esc("Répertoire des entreprises : base « Recherche d'entreprises » de la direction interministérielle du numérique, consultée le " + dateLongue((S.dinum || {}).dernier) + ". Licence à préciser."),
      esc("BODACC (Direction de l'information légale et administrative) : procédures collectives, radiations, ventes de fonds et dépôts des comptes, consultés le " + dateLongue((S.bodacc || {}).dernier) + ". Licence à préciser."),
      esc("Contours des communes et arrondissements : IGN, via l'API Découpage administratif (geo.api.gouv.fr), consultés le " + dateLongue((S.contours || {}).heure) + ". Licence à préciser."),
      esc("Fond de carte, quand il se charge : Plan IGN, Géoplateforme (data.geopf.fr). Licence à vérifier."),
      esc("Recherche d'adresse : Base adresse nationale (api-adresse.data.gouv.fr), interrogée seulement quand vous tapez une adresse."),
    ].concat(jeuxCharges().map((tp) => esc("Décisions de justice : " + JEUX[tp].nom + (periodeJeu(COMPL[tp]) ? ", " + periodeJeu(COMPL[tp]) : "") + ". " + ((COMPL[tp].meta || {}).source || "") + " Méthode : " + methodeIA(tp) + ".")))
      .concat([esc("Carte : Leaflet 1.9.4. Polices : Atkinson Hyperlegible, Archivo.")])
      .map((x) => "<li>" + x + "</li>").join("");
    $("liste-limites").innerHTML = [
      "Le registre contient ce que les syndics y déclarent, à la date où ils le déclarent.",
      "« Mandat expiré sans successeur déclaré » veut dire qu'aucun nouveau mandat n'a été déclaré au registre. Cela ne prouve pas que la copropriété n'a pas de syndic.",
      "Un chiffre de cette page sert à poser une question. Il ne suffit pas à conclure.",
      "Seules les copropriétés du département " + M.departement + " sont chargées : un cercle qui déborde du département ne compte pas les copropriétés voisines.",
      "Premier jet : le délai de dépôt des comptes, les honoraires de base et les signalements ne sont pas encore repris.",
      noteMaj(),
      noteMajSignalees(),
    ].filter(Boolean).map((x) => "<li>" + esc(x) + "</li>").join("");
    $("pied-version").textContent = "Version " + (M.version || "") + ", premier jet. Données calculées le " + dateLongue(M.genere_le) + (/T(\d{2}):(\d{2})/.test(M.genere_le || "") ? " à " + M.genere_le.slice(11, 13) + " h " + M.genere_le.slice(14, 16) : "") + ".";
  }
  function rendreMethode() {
    const el = $("methode-corps");
    if (!el) return;
    const h = [];
    h.push("<h3>Les données</h3><p>" + esc("Le registre des copropriétés est lu à deux dates : au " + T3 + " et au " + dateLongue(M.date_reference) + ". Une copropriété est « comparable » quand elle a la taille et la période de construction choisies. Les établissements d'une même société sont réunis sous son numéro d'entreprise (SIREN). Un syndic professionnel en entreprise individuelle, ou introuvable au répertoire des entreprises, n'est jamais nommé.") + "</p>");
    h.push("<h3>Ce que sont devenues les copropriétés de 2025</h3><p>" + esc("Pour chaque syndic, ses copropriétés comparables déclarées au " + T3 + " font 100 %. Chacune a l'un des sept devenirs suivants au registre d'aujourd'hui :") + '</p><ol class="liste-texte">'
      + DEVENIRS.map((d, k) => '<li><i class="pastille-d d' + (k + 1) + '" aria-hidden="true"></i><strong>' + esc(d[1]) + "</strong> : " + esc(d[2]) + ".</li>").join("") + "</ol><p>"
      + esc("L'évolution s'écrit « 15 → 10 (−5) » : 15 en 2025, 10 aujourd'hui. Aujourd'hui = 2025 − départs (même groupe compris) + arrivées. Les arrivées se partagent entre celles venues d'un autre syndic professionnel et celles déclarées depuis : copropriétés absentes du registre, ou déclarées avec un syndic bénévole, sans SIRET ou de type non connu au " + T3 + ".") + "</p>");
    h.push("<h3>Repères, entonnoir, marge d'incertitude</h3><p>" + esc("Un repère est le taux de l'ensemble des syndics professionnels de la zone, de la commune ou du département. Sur moins de 10 copropriétés, la page écrit « 2 sur 7 » plutôt qu'un pourcentage. La marge d'incertitude d'un taux est un intervalle de Wilson à 95 %. L'entonnoir trace, pour chaque nombre de copropriétés, les écarts au repère que le seul hasard produit 95 fois sur 100 (bande foncée, écarts courants) et 998 fois sur 1 000 (bande claire, écarts peu fréquents), par la loi binomiale exacte.") + "</p>");
    h.push("<h3>Bureaux</h3><p>" + esc("Seuls le bureau déclaré au registre et le siège sont localisés. Quand la société a d'autres établissements ouverts au répertoire, la page le dit sans les placer : la distance au bureau ne se trie donc pas. « Gestion à distance » : tous les établissements connus sont localisés, et le plus proche est à plus de 50 km.") + "</p>");
    const bc = (M.sources || {}).bodacc || {};
    h.push("<h3>Annonces au BODACC</h3><p>" + esc("Le tableau montre les annonces de moins de " + HORIZON_ANNONCES + " ans à la date des données ; la fiche les garde toutes, datées, avec le lien vers le BODACC. "
      + "Une annonce de procédure collective ou de radiation n'est rattachée à un syndic que si elle porte son numéro SIREN au registre du commerce et si le nom de société inscrit dans l'annonce concorde avec celui du répertoire des entreprises : le BODACC peut lui-même porter un numéro erroné. "
      + (bodaccControle() ? "Annonces écartées pour les syndics de ce département : " + nb(bc.ecartees_nom_discordant || 0) + " dont le nom ne concorde pas, " + nb(bc.ecartees_avant_creation || 0) + " antérieures à la création de la société, " + nb(bc.non_controlees || 0) + " qui n'ont pas pu être contrôlées. Une annonce écartée n'apparaît nulle part sur la page."
        : "Dans cette version des données, ce contrôle n'a pas été fait : aucune procédure collective ni radiation n'est affichée.")) + "</p>");
    const mj = methodeJustice();
    if (mj.length) {
      h.push("<h3>Décisions de justice publiées</h3>" + mj.map((x) => "<p>" + esc(x) + "</p>").join("")
        + (COMPL.jurisprudence ? "<p>" + esc("Méthode de la " + JEUX.jurisprudence.court + " : " + methodeIA("jurisprudence") + ".") + "</p>" : ""));
      const rg = reglesContreIa();
      if (rg) h.push("<h4>Règles écrites contre la lecture par IA</h4>" + rg);
      h.push(blocAbsents());
      h.push(limitesJeux(jeuxCharges(), true));
    }
    h.push("<h3>Ce que la page ne fait pas</h3><p>Elle ne note ni ne classe aucun syndic. Aucune personne n'est nommée : ni dirigeant, ni syndic bénévole, ni copropriétaire. Le numéro de votre copropriété et le centre d'un cercle autour d'elle n'entrent jamais dans un lien, un ticket ou la mémoire du navigateur. L'adresse que vous tapez n'est envoyée qu'au service public de la Base adresse nationale, pour la retrouver ; la page ne la garde pas.</p>");
    el.innerHTML = h.join("");
  }

  // ---------- Thème (§ 4.11) ----------
  function appliquerTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
    rafraichirCouleurs();
  }
  function initTheme() {
    if (!integree()) {
      $("theme-bloc").hidden = false;
      const t = stock.lire("syndicoscope.theme", "");
      $("theme").value = t || "";
      if (t) document.documentElement.setAttribute("data-theme", t);
      $("theme").addEventListener("change", (ev) => { appliquerTheme(ev.target.value); stock.ecrire("syndicoscope.theme", ev.target.value); });
    }
    try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rafraichirCouleurs); } catch (err) { /* navigateur ancien */ }
  }

  // ---------- Branchements ----------
  function toutesVues() { return VUES.concat(vuesJustice()); }
  function rendreChoixColonnes() {
    $("choix-colonnes-segments").innerHTML = toutesVues().map((v) => '<label><input type="radio" name="colonnes" value="' + v[0] + '"' + (v[0] === etat.colonnes ? " checked" : "") + "><span>" + esc(v[1]) + "</span></label>").join("");
    // sans jeu de justice, la vue manque : la page le dit au lieu de se taire
    const nj = $("choix-colonnes-justice");
    if (nj) { nj.hidden = jeuxCharges().length > 0; nj.textContent = "Décisions de justice : " + PAS_DE_JUSTICE; }
  }
  function remplirSelects() {
    $("filtre-taille").innerHTML = '<option value="-1">Toutes les tailles</option>' + M.tailles.map((t, k) => '<option value="' + k + '">' + esc(t[0]) + "</option>").join("");
    $("filtre-construction").innerHTML = '<option value="-1">Toutes les périodes</option>' + M.classes_construction.map((c, k) => '<option value="' + k + '">' + esc(c[0]) + "</option>").join("");
    const vus = new Set(), triOpts = [["nom", "Syndic (ordre alphabétique)"], ["compPart", "Copropriétés comparables"]];
    for (const v of toutesVues()) for (const id of v[2]) {
      const c = colParId(id);
      if (!c || c.sansTri || id === "comp" || id === "compPart" || vus.has(id)) continue;
      vus.add(id);
      triOpts.push([id, c.devenir ? "Toujours chez lui depuis 2025 (part)" : c.titre]);
    }
    $("tri-tel").innerHTML = triOpts.map((x) => '<option value="' + x[0] + '">' + esc(x[1]) + "</option>").join("");
    const deja = new Set();
    $("chiffre-tel").innerHTML = toutesVues().map((v) => {
      const o = v[2].filter((id) => colParId(id) && id !== "comp" && id !== "compPart" && !deja.has(id)).map((id) => { deja.add(id); return '<option value="' + id + '"' + (id === etat.chiffreTel ? " selected" : "") + ">" + esc(colParId(id).titre) + "</option>"; }).join("");
      return o ? '<optgroup label="' + esc(v[1]) + '">' + o + "</optgroup>" : "";
    }).join("");
  }
  // focus : la carte ou le bouton qui suit, sur la même variante (tableau ou cartes du téléphone)
  function focaliserLigne(sel) {
    const t = document.querySelector("#tableau-contenu .tableau-ordinateur " + sel), c = document.querySelector("#tableau-contenu .cartes-syndics " + sel);
    const b = t && t.offsetParent ? t : c && c.offsetParent ? c : null;
    if (b) b.focus();
  }
  function retourVueTableau() {
    if (etat.vue === "tableau") return;
    etat.fiche = null;
    afficherVue("tableau");
    surbrillance(-1);
    ecrireHash(true);
  }
  function appliquerCarte() {
    const d = $("disposition"), b = $("btn-carte");
    d.setAttribute("data-carte", etat.carte ? "oui" : "non");
    if (b) { b.setAttribute("aria-expanded", String(etat.carte)); b.textContent = etat.carte ? "Masquer la carte" : "Afficher la carte"; }
    if (etat.carte && carte) window.setTimeout(() => { carte.invalidateSize(); cadrer(); couchePoints.redessiner(); essayerTuiles(); }, 0);
  }
  function montrerCarte() {
    if (window.innerWidth < 700) { basculerOnglet("carte"); return; }
    if (!etat.carte) { etat.carte = true; stock.ecrire("syndicoscope.carte", true); appliquerCarte(); }
  }
  function brancher() {
    // en-tête et encadré « Comment lire »
    $("btn-en-savoir-plus").addEventListener("click", (ev) => {
      const s = $("accueil-suite"), ouvert = s.getAttribute("data-ouvert") !== "true";
      s.setAttribute("data-ouvert", String(ouvert));
      ev.currentTarget.setAttribute("aria-expanded", String(ouvert));
      ev.currentTarget.textContent = ouvert ? "Moins" : "En savoir plus";
    });
    $("btn-masquer-lire").addEventListener("click", () => { $("comment-lire").hidden = true; stock.ecrire("syndicoscope.lire", "masque"); $("lien-comment-lire").focus(); });
    $("lien-comment-lire").addEventListener("click", (ev) => {
      ev.preventDefault();
      const s = $("comment-lire");
      s.hidden = false;
      stock.ecrire("syndicoscope.lire", "");
      retourVueTableau();
      basculerOnglet("syndics");
      s.scrollIntoView({ block: "start" });
      s.focus({ preventScroll: true });
    });
    $("lien-methode").addEventListener("click", (ev) => {
      ev.preventDefault();
      const s = $("methode");
      s.scrollIntoView({ block: "start" });
      s.focus({ preventScroll: true });
    });
    document.querySelector(".evitement").addEventListener("click", (ev) => {
      ev.preventDefault();
      retourVueTableau();
      basculerOnglet("syndics");
      const t = $("syndics-titre");
      t.scrollIntoView({ block: "start" });
      t.focus({ preventScroll: true });
    });
    // filtres repliés (téléphone)
    $("resume-filtres").addEventListener("click", (ev) => {
      const f = $("filtres"), replie = f.getAttribute("data-replie") === "true";
      f.setAttribute("data-replie", String(!replie));
      ev.currentTarget.setAttribute("aria-expanded", String(replie));
    });
    $("btn-voir-resultats").addEventListener("click", () => {
      $("filtres").setAttribute("data-replie", "true");
      $("resume-filtres").setAttribute("aria-expanded", "false");
      const t = $("syndics-titre");
      t.scrollIntoView({ block: "start" });
      t.focus({ preventScroll: true });
    });
    $("onglet-syndics").addEventListener("click", () => basculerOnglet("syndics"));
    $("onglet-carte").addEventListener("click", () => basculerOnglet("carte"));
    $("btn-carte").addEventListener("click", () => { etat.carte = !etat.carte; stock.ecrire("syndicoscope.carte", etat.carte); appliquerCarte(); });
    // point de départ : numéro ou adresse
    document.querySelectorAll('input[name="depart-mode"]').forEach((r) => r.addEventListener("change", () => {
      if (!r.checked) return;
      $("depart-numero").hidden = r.value !== "numero";
      $("depart-adresse").hidden = r.value !== "adresse";
    }));
    $("form-immat").addEventListener("submit", (ev) => { ev.preventDefault(); chercherImmat(); });
    $("depart").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      if (a === "ma-copro") definirCopro(Number(b.dataset.i));
      else if (a === "retirer-copro") retirerCopro();
      else if (a === "fiche") ouvrirFiche(Number(b.dataset.ent));
      else if (a === "voir-commune") choisirZone(etat.zone);
    });
    $("btn-voir-commune").addEventListener("click", () => {
      const f = $("filtres");
      f.setAttribute("data-replie", "false");
      $("resume-filtres").setAttribute("aria-expanded", "true");
      const r = document.querySelector('input[name="mode-zone"][value="liste"]');
      if (etat.mode !== "liste" && r) { r.checked = true; $("zone-liste").hidden = false; $("zone-cercle").hidden = true; }
      $("champ-commune").scrollIntoView({ block: "center" });
      $("champ-commune").focus();
    });
    // zone
    document.querySelectorAll('input[name="mode-zone"]').forEach((r) => r.addEventListener("change", () => {
      if (!r.checked) return;
      if (r.value === "liste") { choisirZone(etat.zone); return; }
      if (etat.copro != null) definirCentre(LAT[etat.copro], LON[etat.copro], "copro");
      else { const z = Z[etat.zone]; definirCentre(z.lat, z.lon, "zone"); }
    }));
    document.querySelectorAll('input[name="rayon"]').forEach((r) => r.addEventListener("change", () => {
      if (!r.checked || !etat.cercle) return;
      etat.cercle.r = Number(r.value);
      majTout({ nouvelleZone: true, cadrer: true, annonce: true });
    }));
    $("btn-departement").addEventListener("click", () => { const z = Z.find((x) => x.dep); if (z) choisirZone(z.i); });
    $("btn-choisir-centre").addEventListener("click", () => {
      montrerCarte();
      etat.choixCentre = true;
      $("viseur").hidden = false;
      $("viseur-actions").hidden = false;
      $("viseur-depart").hidden = true;
      $("carte-aide").textContent = "Déplacez la carte pour placer le viseur, puis validez.";
      basculerOnglet(window.innerWidth < 700 ? "carte" : "syndics");
      window.setTimeout(() => { carte.invalidateSize(); carte.getContainer().focus(); }, 0);
    });
    $("btn-valider-centre").addEventListener("click", () => { const c = carte.getCenter(); finChoix(); definirCentre(c.lat, c.lng, "point"); });
    $("btn-annuler-centre").addEventListener("click", finChoix);
    $("info-bandeau").addEventListener("click", (ev) => { const b = ev.target.closest('[data-act="fiche"]'); if (b) ouvrirFiche(Number(b.dataset.ent)); });
    // comparables
    $("filtre-taille").addEventListener("change", (ev) => { etat.taille = Number(ev.target.value); etat.regle.taille = false; $("regle-taille").hidden = true; majTout({ filtres: true, annonce: true }); });
    $("filtre-construction").addEventListener("change", (ev) => { etat.constr = Number(ev.target.value); etat.regle.constr = false; $("regle-construction").hidden = true; majTout({ filtres: true, annonce: true }); });
    $("btn-reinitialiser").addEventListener("click", () => {
      etat.taille = -1; etat.constr = -1; etat.copro = null; etat.regle = { taille: false, constr: false };
      $("filtre-taille").value = "-1"; $("filtre-construction").value = "-1";
      $("regle-taille").hidden = true; $("regle-construction").hidden = true;
      $("champ-immat").value = "";
      effacerErreur();
      if (etat.mode === "cercle") choisirZone(etat.zone); else majTout({ filtres: true, annonce: true });
    });
    // tableau : colonnes, recherche, regroupement, téléphone
    $("choix-colonnes").addEventListener("change", (ev) => {
      const r = ev.target;
      if (r.name !== "colonnes" || !r.checked) return;
      etat.colonnes = r.value;
      // un tri sur une colonne qui disparaît revient à l'ordre alphabétique, jamais à un classement choisi par la page
      const cols = colonnesVue(r.value).filter((c) => !c.sansTri);
      if (etat.tri.col !== "nom" && !cols.some((c) => memeTri(c.id, etat.tri.col))) etat.tri = { col: "nom", dir: "asc" };
      rendreTableau(calculer());
      ecrireHash(false);
    });
    let minuterie = 0;
    $("champ-recherche").addEventListener("input", (ev) => {
      window.clearTimeout(minuterie);
      minuterie = window.setTimeout(() => {
        etat.recherche = ev.target.value.trim(); etat.limite = PAGE;
        // chercher un syndic par son nom est un choix : le tableau du département remplace le panorama
        if (etat.recherche && etat.panorama) { quitterPanorama(); ecrireHash(false); }
        rendreTableau(calculer());
      }, 200);
    });
    $("recherche-etat").addEventListener("click", (ev) => { const b = ev.target.closest('[data-act="fiche"]'); if (b) ouvrirFiche(Number(b.dataset.ent)); });
    $("chk-groupes").addEventListener("change", (ev) => { etat.groupes = ev.target.checked; etat.limite = PAGE; rendreTableau(calculer()); });
    $("btn-copier-export").addEventListener("click", (ev) => { if (texteExport) copier(texteExport, ev.currentTarget, $("repli-export"), "Tableau copié. Collez-le dans un tableur ou un document."); });
    $("tri-tel").addEventListener("change", (ev) => {
      const v = ev.target.value, c = colParId(v);
      etat.tri = { col: v, dir: sensParDefaut(v) };
      // sur téléphone, la carte montre le chiffre qui sert au tri
      if (c) { etat.chiffreTel = v; $("chiffre-tel").value = v; }
      rendreTableau(calculer());
    });
    $("chiffre-tel").addEventListener("change", (ev) => { etat.chiffreTel = ev.target.value; rendreTableau(calculer()); });
    const cont = $("tableau-contenu");
    cont.addEventListener("click", (ev) => {
      const t = ev.target;
      const tri = t.closest("button.tri");
      if (tri) {
        const c = tri.dataset.col;
        etat.tri = memeTri(etat.tri.col, c) ? { col: c, dir: etat.tri.dir === "asc" ? "desc" : "asc" } : { col: c, dir: sensParDefaut(c) };
        etat.statutListe = null;
        rendreTableau(calculer());
        const b = cont.querySelector('button.tri[data-col="' + c + '"]');
        if (b) b.focus();
        return;
      }
      const nom = t.closest("button.nom-syndic");
      if (nom) { ouvrirFiche(Number(nom.dataset.ent)); return; }
      const act = t.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "fiche") ouvrirFiche(Number(act.dataset.ent));
      else if (a === "liste") basculerListe(Number(act.dataset.ent), act);
      else if (a === "suite") {
        const k = Math.min(etat.limite, PAGE);
        etat.limite = Infinity;
        rendreTableau(calculer());
        focaliserLigne('[data-rang="' + k + '"] button.nom-syndic');
      }
      else if (a === "anciens") { etat.voirAnciens = true; rendreTableau(calculer()); focaliserLigne('[data-ancien="1"] button.nom-syndic'); }
      else if (a === "retirer-filtres") $("btn-reinitialiser").click();
      else if (a === "elargir") elargir();
      else if (a === "tout-departement") { const d = Z.findIndex((z) => z.dep); if (d >= 0) choisirZone(d); }
    });
    const survol = (ev) => { const tr = ev.target.closest("[data-ent]"); if (tr && tr.dataset.ent !== undefined) surbrillance(Number(tr.dataset.ent)); };
    cont.addEventListener("mouseover", survol);
    cont.addEventListener("focusin", survol);
    cont.addEventListener("mouseleave", () => surbrillance(etat.vue === "fiche" ? etat.fiche : -1));
    // fiche
    const fiche = $("vue-fiche");
    fiche.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      if (a === "retour") retourTableau(true);
      else if (a === "liste") basculerListe(Number(b.dataset.ent), b);
      else if (a === "copier") copier(questions(Number(b.dataset.ent)), b, $("repli-fiche"));
      else if (a === "departement") {
        etat.perimetre = "departement"; etat.notePerimetre = "";
        rendreFiche(false);
        ecrireHash(false);
        const l = $("fiche-perimetre");
        if (l) { l.scrollIntoView({ block: "start" }); l.focus({ preventScroll: true }); }
      }
      else if (a === "decisions-suite") { etat.decisions = Infinity; rendreFiche(false); const s = $("fiche-justice"); if (s) { const li = s.querySelectorAll("li.decision")[10]; if (li) { li.setAttribute("tabindex", "-1"); li.focus(); } } }
    });
    fiche.addEventListener("change", (ev) => {
      if (ev.target.name === "perimetre") {
        etat.perimetre = ev.target.value;
        etat.notePerimetre = "";
        rendreFiche(false);
        ecrireHash(false);
        const r = fiche.querySelector('input[name="perimetre"][value="' + etat.perimetre + '"]');
        if (r) r.focus();
      } else if (ev.target.id === "indicateur-entonnoir") {
        etat.indicateur = ev.target.value;
        rendreFiche(false);
        const s = $("indicateur-entonnoir");
        if (s) s.focus();
      }
    });
    // comparateur et dossier
    const actionsComparees = (ev, repli) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      if (a === "retour-comparateur") fermerComparateur();
      else if (a === "retour-dossier") ouvrirComparateur();
      else if (a === "liste") basculerListe(Number(b.dataset.ent), b);
      else if (a === "dossier") ouvrirDossier();
      else if (a === "imprimer") { if (!integree()) window.print(); }
      else if (a === "copier-tableau") copier(tsvComparatif(), b, $(repli), "Tableau copié. Collez-le dans un tableur ou un document.");
      else if (a === "copier-lien") copier(lienPartage(etat.vue === "dossier" ? "dossier" : "comparateur"), b, $(repli), "Lien copié. Il garde la zone, les critères et la liste courte, jamais votre copropriété ni votre adresse.");
      else if (a === "copier-tous") copier(syndicsCompares().colsE.map(questions).join("\n\n————\n\n"), b, $(repli));
    };
    $("vue-comparateur").addEventListener("click", (ev) => actionsComparees(ev, "repli-comparateur"));
    $("vue-dossier").addEventListener("click", (ev) => actionsComparees(ev, "repli-dossier"));
    $("barre-liste").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      if (a === "comparer") ouvrirComparateur();
      else if (a === "vider") { etat.confirmerVider = true; rendreBarre(); const o = $("barre-liste-corps").querySelector('[data-act="vider-non"]'); if (o) o.focus(); }
      else if (a === "vider-non") { etat.confirmerVider = false; rendreBarre(); const o = $("barre-liste-corps").querySelector('[data-act="vider"]'); if (o) o.focus(); }
      else if (a === "vider-oui") {
        etat.liste = []; etat.confirmerVider = false; etat.statutListe = null; stock.ecrire(cleListe(), []);
        attribuerCouleurs(); rendreBarre();
        const R = calculer();
        rendreTableau(R); rendreCarte(R, false);
        if (etat.vue === "comparateur" || etat.vue === "dossier") fermerComparateur();
        if (etat.vue === "fiche") rendreFiche(false);
        ecrireHash(false);
        annoncer("Liste courte vidée.");
      }
    });
    // légende et tableau jumeau
    $("legende").addEventListener("click", (ev) => {
      const b = ev.target.closest('[data-act="jumeau"]');
      if (!b) return;
      const j = $("jumeau");
      j.hidden = !j.hidden;
      etat.jumeau = PAGE_JUMEAU;
      rendreJumeau();
      rendreLegende(calculer());
      const nb2 = $("legende").querySelector('[data-act="jumeau"]');
      if (nb2) nb2.focus();
    });
    $("jumeau").addEventListener("click", (ev) => { if (ev.target.closest('[data-act="jumeau-suite"]')) { etat.jumeau += PAGE_JUMEAU; rendreJumeau(); } });
    // retours : un seul panneau, ouvert depuis le pied de page ou depuis la fiche d'un syndic
    document.addEventListener("click", (ev) => { const b = ev.target.closest('[data-act="retours"]'); if (b) ouvrirRetours(b); });
    const dlg = $("retours");
    if (dlg) {
      $("btn-fermer-retours").addEventListener("click", fermerRetours);
      dlg.addEventListener("close", rendreFocusRetours);
      dlg.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); fermerRetours(); } });
      dlg.addEventListener("click", (ev) => {
        if (ev.target === dlg) fermerRetours();   // clic sur le fond, hors du panneau
        else if (ev.target.closest("a[href]")) window.setTimeout(fermerRetours, 0);
      });
    }
    window.addEventListener("popstate", router);
    window.addEventListener("hashchange", router);
  }

  // ---------- Démarrage ----------
  async function demarrer() {
    initTheme();
    const ch = $("chargement");
    if (ch) ch.textContent = "Chargement des données du département…";
    let res;
    try {
      res = await charger();
    } catch (err) {
      $("tableau-contenu").innerHTML = '<div class="message"><p>Les données du département n\'ont pas pu être chargées. Vérifiez votre connexion, puis réessayez.</p><button type="button" class="btn" id="btn-reessayer">Réessayer</button></div>';
      $("plaque-nom").textContent = "SyndicoScope";
      $("btn-reessayer").addEventListener("click", () => { $("tableau-contenu").innerHTML = '<p class="chargement" id="chargement">Chargement des données du département…</p>'; demarrer(); }, { once: true });
      $("panneau-principal").setAttribute("aria-busy", "false");
      return;
    }
    if (ch) ch.textContent = "Calcul des chiffres de la zone…";
    preparer(res.donnees, res.contours);
    await chargerComplements();
    // pas d'exemple préchargé : le premier écran est le panorama du département, sans aucun nom
    const dep = Z.findIndex((z) => z.dep);
    etat.zone = dep >= 0 ? dep : 0;
    etat.liste = (stock.lire(cleListe(), []) || []).filter((a) => ENT_PAR_ANCRE.has(a)).slice(0, MAX_LISTE);
    etat.carte = !!stock.lire("syndicoscope.carte", false);
    remplirSelects();
    rendreChoixColonnes();
    $("champ-commune").value = "";
    initCombo();
    initAdresse();
    brancher();
    rendrePied();
    rendreMethode();
    // « Comment lire » : ouvert à la première visite, replié ensuite (le lien de l'en-tête le rouvre)
    if (stock.lire("syndicoscope.lire", "") === "masque" || stock.lire("syndicoscope.visite", 0)) $("comment-lire").hidden = true;
    stock.ecrire("syndicoscope.visite", 1);
    // l'adresse de la page : zone, critères, liste courte, vue
    const P = lireParams(hashCourant());
    if (P) { if (appliquerParams(P) || P.z || P.cz) quitterPanorama(); synchroniserControles(); }
    // panorama : champ de commune vide, carte repliée quelle que soit la préférence gardée
    if (etat.panorama) { $("champ-commune").value = ""; etat.carte = false; }
    rendreBarre();
    appliquerCarte();
    if (window.L) initCarte();
    majTout({ nouvelleZone: true, cadrer: true, hash: false, ensuite: () => { if (P) ouvrirVueParams(P); dernierHash = null; ecrireHash(false); } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer); else demarrer();
})();
