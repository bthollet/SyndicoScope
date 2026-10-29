(function () {
  "use strict";
  const D = window.SYNDICO_D;
  // La page publique, construite à part : sans les outils de revue ni le formulaire factice, et sans ce qui n'est pas encore publié.
  const PUBLIC = !!D.meta.public;
  // La page nationale : une coquille, dont l'amorce charge le département du lieu choisi et pose window.SYNDICO_MANIFESTE.
  // Les contours y viennent en direct de l'IGN (meta.direct), à la première ouverture de la carte.
  const NATIONAL = !!window.SYNDICO_MANIFESTE, DIRECT = !!D.meta.direct;

  // ---------- outils
  const $ = (id) => document.getElementById(id);
  window.addEventListener("error", (ev) => {
    const el = $("erreur");
    if (el) { el.hidden = false; el.textContent = "Erreur de la page : " + (ev.message || "inconnue") + ". Signalez-la avec « Donner mon avis », en haut de la page, en disant le geste qui l'a provoquée."; }
  });
  const fEnt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const f1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nb = (n) => fEnt.format(n);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-'’]/g, " ").replace(/\s+/g, " ").trim();
  const accord = (n, un, plusieurs) => (n >= 2 ? plusieurs : un);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const court = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const dateFr = (iso) => { const p = String(iso).slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; };
  const heureFr = (iso) => { const m = String(iso).match(/T(\d\d):(\d\d)/); return m ? Number(m[1]) + " h " + m[2] : ""; };
  function distTxt(m) {
    if (m == null) return "—";
    if (m < 25) return "moins de 50 m";
    if (m < 975) return nb(Math.round(m / 50) * 50) + " m";
    if (m < 9950) return f1.format(m / 1000) + " km";
    return nb(Math.round(m / 1000)) + " km";
  }
  function lotsTxt(v) {
    if (v >= 1000) return nb(Math.round(v / 100) * 100);
    if (v >= 100) return nb(Math.round(v / 10) * 10);
    if (v >= 10) return nb(Math.round(v));
    return f1.format(v);
  }
  const tickTxt = (v) => (v >= 1 ? nb(v) : String(v).replace(".", ","));
  function pctNb(k, n) { const p = (100 * k) / n; return p > 0 && p < 0.5 ? "moins de 1" : nb(Math.round(p)); }
  function partTxt(k, n) { return n < 10 ? nb(k) + " sur " + nb(n) : pctNb(k, n) + " % (" + nb(k) + " sur " + nb(n) + ")"; }
  function dist(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
  }

  // ---------- données
  const M = D.meta, Z = M.zones, ENTS = D.ents, NE = ENTS.length, BUR = D.bureaux, C = D.copros, N = C.la.length;
  const LAT = new Float64Array(N), LON = new Float64Array(N);
  // les coordonnées se comptent depuis le coin sud-ouest du département, en dix-millièmes de degré (en millièmes pour les contours)
  const ORIG = M.origine || [43, 4];
  for (let i = 0; i < N; i++) { LAT[i] = ORIG[0] + C.la[i] / 1e4; LON[i] = ORIG[1] + C.lo[i] / 1e4; }
  const ZONE = Int16Array.from(C.z), LOTS = Int32Array.from(C.l), CLASSE = Int8Array.from(C.c), ENT = Int16Array.from(C.e);
  const TRANCHES = [[2, 5], [6, 10], [11, 20], [21, 49], [50, 99], [100, 199], [200, 499], [500, Infinity]];
  const trancheDe = (n) => (n >= 2 ? TRANCHES.findIndex((t) => n >= t[0] && n <= t[1]) : -1);
  const libTranche = (t) => (TRANCHES[t][1] === Infinity ? nb(TRANCHES[t][0]) + " lots et plus" : nb(TRANCHES[t][0]) + " à " + nb(TRANCHES[t][1]) + " lots");
  const TF = new Int8Array(N);
  for (let i = 0; i < N; i++) TF[i] = trancheDe(LOTS[i]);
  // Les numéros restent une liste de chaînes entre guillemets, comme dans les données publiées : la seule forme que permet le contrôle des motifs.
  const IMMAT = new Map(D.immat.map((s, i) => [s, i]));
  const immatDe = (i) => D.immat[i];
  // Le devenir depuis le 3e trimestre 2025 : la société d'alors, le code de devenir, et quatre bits de tenue de la fiche
  // (1 date de mise à jour connue, 2 plus de 12 mois, 4 mandat en cours daté, 8 date de fin passée).
  const E3 = Int16Array.from(C.e3), RET = Int8Array.from(C.r), DRB = Uint8Array.from(C.d), T3ABS = C.t3abs;
  // La tranche large de la copropriété : celle de la base des pairs quand la jauge est réglée.
  const LIB_TL = ["2 à 10 lots", "11 à 49 lots", "50 à 199 lots", "200 lots et plus"];
  const tlDe = (n) => (n >= 200 ? 3 : n >= 50 ? 2 : n >= 11 ? 1 : n >= 2 ? 0 : -1);
  const TL = new Int8Array(N);
  for (let i = 0; i < N; i++) TL[i] = tlDe(LOTS[i]);
  const tlDeTf = (tf) => (tf < 0 ? -1 : tf >> 1);
  const CLASSES = M.classes;
  const minuscule = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const construitesTxt = (c, n) => (n >= 2 ? "construites " : "construite ") + minuscule(CLASSES[c]);

  // la commune découpée en arrondissements : Marseille dans le 13, Paris dans le 75, Lyon dans le 69 ; aucune ailleurs
  const MARS = Z.findIndex((z) => Z.some((y) => y[2] === "arrondissement" && y[3] === z[0]));
  const ARR = [];
  if (MARS >= 0) Z.forEach((z, i) => { if (z[3] === Z[MARS][0]) ARR.push(i); });
  const VILLE = MARS >= 0 ? Z[MARS][1] : "";
  const nomZ = (i) => (Z[i][2] === "arrondissement" ? Z[i][1].replace(/ Arrondissement$/i, "") : Z[i][1]);
  const PAR_ZONE = Z.map(() => []);
  for (let i = 0; i < N; i++) if (PAR_ZONE[ZONE[i]]) PAR_ZONE[ZONE[i]].push(i);
  // Les lieux : { k: "z", i } une commune ou un arrondissement ; « mars » tout Marseille ; « dept » le département chargé ;
  // « dep » un autre département ; « reg » une région ; « fr » la France ; « multi » plusieurs lieux à la fois, réunis.
  // Le découpage administratif (geo.api.gouv.fr) donne les départements et les régions, chargés ou non.
  const DEC = D.decoupage, DEPS = new Map(DEC.deps.map(([c, n, r]) => [c, { nom: n, reg: r }])), REGS = new Map(DEC.regs);
  const REG_CH = DEPS.get(M.dept).reg, NOM_CH = M.nomDept + " (" + M.dept + ")";
  const depsDe = (r) => DEC.deps.filter((d) => d[2] === r).length;
  const liste = (t) => (t.length < 2 ? t.join("") : t.slice(0, -1).join(", ") + " et " + t[t.length - 1]);
  const membres = (zn) => (zn.k === "multi" ? zn.zones : [zn]);
  // chargé : dans les données de la page ; une région ou la France ne le sont qu'en partie, par le département chargé
  const charge = (zn) => zn.k !== "dep" && (zn.k !== "reg" || zn.code === REG_CH);
  const charges = (zn) => membres(zn).filter(charge);
  // étendue : tout le département chargé, sans lieu plus fin ; un seul lieu chargé, commune ou arrondissement, a un centre
  const etendue = (zn) => membres(zn).some((m) => m.k === "dept" || m.k === "fr" || (m.k === "reg" && m.code === REG_CH));
  const pointDe = (zn) => { const m = charges(zn); return m.length === 1 && (m[0].k === "z" || m[0].k === "mars") ? m[0] : null; };
  const memeLieu = (a, b) => a.k === b.k && a.i === b.i && a.code === b.code;
  // a contient-il b ? Le département chargé, ses communes ; Marseille, ses arrondissements ; une région, ses départements.
  function contient(a, b) {
    if (memeLieu(a, b) || a.k === "fr") return true;
    const dedans = b.k === "dept" || b.k === "mars" || b.k === "z";
    if (a.k === "reg") return (b.k === "dep" && DEPS.get(b.code).reg === a.code) || (dedans && a.code === REG_CH);
    if (a.k === "dept") return b.k === "mars" || b.k === "z";
    if (a.k === "mars") return b.k === "z" && (b.i === MARS || ARR.includes(b.i));
    return false;
  }
  const nomDeZone = (zn) => (zn.k === "mars" ? VILLE : nomZ(zn.i));
  function libZone(zn) {
    if (zn.k === "multi") return zn.zones.map(libZone).join(" · ");
    if (zn.k === "dept") return NOM_CH + ", tout le département";
    if (zn.k === "dep") return DEPS.get(zn.code).nom + " (" + zn.code + ")";
    if (zn.k === "reg") return "Région " + REGS.get(zn.code);
    if (zn.k === "fr") return "France entière";
    return zn.k === "mars" ? VILLE + ", toute la commune" : nomZ(zn.i);
  }
  function iciUn(zn) {
    const n = nomDeZone(zn);
    if (/^Les /.test(n)) return "aux " + n.slice(4);
    if (/^Le /.test(n)) return "au " + n.slice(3);
    return "à " + n;
  }
  // Une région ou la France ne se comptent que par leur partie chargée : la phrase le dit. Un lieu non chargé n'y figure pas.
  function iciZone(zn) {
    const ms = charges(zn);
    if (ms.some((m) => m.k === "fr")) return "en France, pour sa partie chargée (" + M.nomDept + ")";
    const rg = ms.find((m) => m.k === "reg");
    if (rg) return "dans la région " + REGS.get(rg.code) + ", pour sa partie chargée (" + M.nomDept + ")";
    if (ms.some((m) => m.k === "dept")) return "dans le département";
    // un arrondissement que « Marseille » contient déjà ne se répète pas
    const pts = ms.filter((m) => !ms.some((x) => x !== m && contient(x, m)));
    return pts.length <= 3 ? liste(pts.map(iciUn)) : "dans " + nb(pts.length) + " lieux (" + liste(pts.map(nomDeZone)) + ")";
  }
  function deZone(zn) {
    const n = nomDeZone(zn);
    if (/^Les /.test(n)) return "des " + n.slice(4);
    if (/^Le /.test(n)) return "du " + n.slice(3);
    return (/^[aeiouyéèêâîô]/i.test(n) ? "d'" : "de ") + n;
  }
  // Les copropriétés des lieux chargés, réunies sans doublon ; null : tout le département.
  function lignesZone(zn) {
    if (etendue(zn)) return null;
    const ms = charges(zn), un = (m) => (m.k === "mars" ? ARR.concat([MARS]).flatMap((i) => PAR_ZONE[i]) : PAR_ZONE[m.i]);
    if (ms.length === 1) return un(ms[0]);
    const vu = new Uint8Array(N), a = [];
    for (const m of ms) for (const i of un(m)) if (!vu[i]) { vu[i] = 1; a.push(i); }
    return a;
  }
  function centreZone(zn) { const m = zn && pointDe(zn); if (!m) return null; const i = m.k === "mars" ? MARS : m.i; return [Z[i][4], Z[i][5]]; }
  // Ce qui n'est pas chargé : un département, une région, ou le reste d'une région ou de la France. La note nomme chacun.
  function noteCharge(zn) {
    const p = [];
    for (const m of membres(zn)) {
      const n = m.k === "reg" ? depsDe(m.code) : 0;
      if (m.k === "dep") p.push(libZone(m) + " : pas encore chargé.");
      else if (m.k === "reg" && m.code !== REG_CH) p.push(libZone(m) + (n < 2 ? " : son département n'est pas encore chargé." : " : aucun de ses " + nb(n) + " départements n'est encore chargé."));
      else if (m.k === "reg") p.push(libZone(m) + " : un seul de ses " + nb(n) + " départements est chargé, " + NOM_CH + " ; les chiffres ne portent que sur lui.");
      else if (m.k === "fr") p.push("France entière : un seul des " + nb(DEC.deps.length) + " départements est chargé, " + NOM_CH + " ; les chiffres ne portent que sur lui.");
    }
    return p.join(" ");
  }

  const TOUT_DEPT = new Int32Array(NE);
  const TYPES_DEPT = { pro: 0, ben: 0, inc: 0, ssiret: 0 };
  for (let i = 0; i < N; i++) {
    const e = ENT[i];
    if (e >= 0) { TOUT_DEPT[e]++; TYPES_DEPT.pro++; } else if (e === -1) TYPES_DEPT.ben++; else if (e === -4) TYPES_DEPT.ssiret++; else TYPES_DEPT.inc++;
  }
  const classeTaille = (n) => (n >= 200 ? 3 : n >= 50 ? 2 : n >= 10 ? 1 : n >= 1 ? 0 : -1);
  const BORNES_CLASSE = [[1, 9], [10, 49], [50, 199], [200, Infinity]];
  const LIB_CLASSE = ["1 à 9 copropriétés", "10 à 49 copropriétés", "50 à 199 copropriétés", "200 copropriétés et plus"];
  function libClasses(cls) {
    const a = BORNES_CLASSE[Math.min(...cls)][0], b = BORNES_CLASSE[Math.max(...cls)][1];
    return b === Infinity ? nb(a) + " copropriétés et plus" : nb(a) + " à " + nb(b) + " copropriétés";
  }
  const SYN_PAR_CLASSE = [0, 0, 0, 0];
  for (let e = 0; e < NE; e++) { const c = classeTaille(TOUT_DEPT[e]); if (c >= 0) SYN_PAR_CLASSE[c]++; }
  const NB_SYN_DEPT = SYN_PAR_CLASSE.reduce((a, b) => a + b, 0);
  // Le vivier de chaque tranche : combien de syndics gèrent au moins une copropriété de cette taille dans le département.
  const POOL_DEPT = TRANCHES.map(() => new Uint8Array(NE));
  for (let i = 0; i < N; i++) if (ENT[i] >= 0 && TF[i] >= 0) POOL_DEPT[TF[i]][ENT[i]] = 1;
  const POOL_DEPT_N = POOL_DEPT.map((a) => a.reduce((s, v) => s + v, 0));
  const CACHE_FINE = new Map();
  function fineDept(tf) {
    if (!CACHE_FINE.has(tf)) {
      const a = new Int32Array(NE);
      for (let i = 0; i < N; i++) if (TF[i] === tf && ENT[i] >= 0) a[ENT[i]]++;
      CACHE_FINE.set(tf, a);
    }
    return CACHE_FINE.get(tf);
  }
  const BUR_DE = Array.from({ length: NE }, () => []);
  BUR.forEach((b, k) => BUR_DE[b[0]].push(k));

  // ---------- la justice : les décisions rendues à Marseille. Un département sans relevé n'en montre aucune :
  // ses cases de justice portent la note de méthode, pour qui voudra faire le relevé chez lui.
  const JU = D.justice || null, JM = JU ? JU.meta : null, AVEC_J = !!JU;
  const JUS = new Map(JU ? Object.keys(JU.par).map((k) => [Number(k), JU.par[k]]) : []);
  // sans relevé, aucune base : les axes de justice du nuage de points ne sont alors jamais offerts
  const MARS_Z = new Set(AVEC_J && MARS >= 0 ? ARR.concat([MARS]) : []);
  // la base des taux : ses copropriétés d'aujourd'hui à Marseille, toutes tailles
  const BASE_MARS = new Int32Array(NE);
  for (let i = 0; i < N; i++) if (ENT[i] >= 0 && MARS_Z.has(ZONE[i])) BASE_MARS[ENT[i]]++;
  const PERIODE_J = JM ? "de " + JM.periode[0].slice(0, 4) + " à " + JM.periode[1].slice(0, 4) : "";
  const PHRASE_JUDILIBRE = "Judilibre, la base de décisions de la Cour de cassation, ne publie qu'une partie des décisions rendues. Une décision qui n'y figure pas n'est pas comptée ici.";
  const MENTION_J = JM ? `Décisions publiées ${PERIODE_J} : ${JM.zone}. Méthode : ${JM.methode}. ${PHRASE_JUDILIBRE}` : "";
  // La note de méthode : comment le relevé de Marseille a été fait, en étapes qu'un autre département peut reprendre.
  const NOTE_J = "Aucune décision de justice n'est relevée pour ce département : le relevé n'a été fait que pour les juridictions de Marseille.";
  const ETAPES_J = [
    "Réunir sur Judilibre, la base de décisions de la Cour de cassation, les décisions du contentieux de la copropriété (nomenclature des affaires civiles, code 71 et voisins) des tribunaux du département et de leur cour d'appel.",
    "Lire chaque décision, son en-tête et son dispositif, pour y trouver le syndic, son rôle, l'objet du litige, l'issue, et ce qui est mis à sa charge. À Marseille, cette lecture est faite par IA, contre-lue par IA, sans relecture humaine : chaque chiffre le dit.",
    "Rattacher chaque syndic à son numéro d'entreprise (SIREN), par le numéro du registre du commerce écrit dans la décision, sinon par son nom. Ne rattacher aucune décision à un entrepreneur individuel.",
    "Rapporter les décisions de chaque syndic aux copropriétés qu'il gère là où siègent les tribunaux lus, pour 100 copropriétés ; sous 10 copropriétés, écrire le compte, pas de taux.",
    "Ne publier ni le nom d'une personne, ni le numéro de rôle d'une affaire, ni une adresse.",
  ];
  const noteJustice = () => `<p>${esc(NOTE_J)}</p><details class="note-methode"><summary>Refaire ce relevé pour ce département</summary><ol>${ETAPES_J.map((t) => `<li>${esc(t)}</li>`).join("")}</ol><p>Pour proposer un relevé : « Donner mon avis », en haut de la page.</p></details>`;
  // ---------- les avocats des syndicats et les délais : le relevé par règles du 28/10, rattaché aux sociétés par leur SIREN.
  // Tant qu'il n'est pas publié, les données ne le portent pas, et la page se passe du réseau des avocats et des délais.
  const AV = D.avocats || null, AVM = AV ? AV.meta : null, DL = D.delais || null;
  const AVP = new Map(AV ? Object.keys(AV.par).map((k) => [Number(k), AV.par[k]]) : []);
  const MENTION_AV = !AV ? "" : `Relevé par règles du 28/10/2026, sans lecture par IA ni relecture humaine, sur les exports Judilibre du 13/10/2026 : les décisions publiées depuis le ${dateFr(AVM.depuis)} où un syndicat de copropriétaires est partie, au tribunal judiciaire de Marseille et à la cour d'appel d'Aix-en-Provence. Avocats et cabinets nommés tels que Judilibre les publie, lus dans l'en-tête des parties. ${PHRASE_JUDILIBRE}`;
  const MENTION_DL = !DL ? "" : `Relevé par règles du 28/10/2026, sur les exports Judilibre du 13/10/2026 : les décisions du contentieux des copropriétés que ce relevé a réunies, rendues depuis le ${dateFr(DL.meta.depuis)}. ${PHRASE_JUDILIBRE}`;
  const FRAIS_SEULS = "Dépens ou frais irrépétibles mis à sa charge, sans condamnation au fond : cela ne dit pas qu'une faute a été retenue contre lui.";
  // J1 à J6 : le titre, le compte, ce que le chiffre ne permet pas de conclure, et la mention propre à J5
  const JIND = {
    j3: { titre: "Mis en cause en son nom propre", k: (x) => x.c, limite: "Ne permet pas de conclure à une faute : être partie n'est pas être condamné." },
    j1: { titre: "Condamné au fond", k: (x) => x.dr[0], limite: "Ne permet pas de conclure que la décision est définitive : une décision frappée d'appel a pu être réformée." },
    j2: { titre: "Responsabilité du syndic retenue", k: (x) => x.dr[1], limite: "Ne dit ni le montant ni la gravité." },
    j6: { titre: "Remise de pièces, d'archives ou de fonds ordonnée", k: (x) => x.dr[3], limite: "Ne permet pas de conclure que la remise n'a pas eu lieu depuis." },
    j5: { titre: "Assemblée générale annulée, en tout ou en partie", k: (x) => x.dr[2], mention: "Décision rendue contre le syndicat des copropriétaires, pas contre le syndic.",
      limite: "Ne permet pas de conclure à une faute du syndic : l'annulation est attribuée au syndic qui représente le syndicat dans la décision, qui n'a pas toujours convoqué l'assemblée." },
    j4: { titre: "Décisions qui le nomment, à tout titre", k: (x) => x.n, limite: "Ne permet de rien conclure sur sa qualité : il agit le plus souvent pour la copropriété." },
  };
  // null : non renseigné (entrepreneur individuel, jamais rapproché) ; 0 : aucune décision du jeu ne le nomme
  const jCompte = (e, id) => (ENTS[e].ei ? null : JUS.has(e) ? JIND[id].k(JUS.get(e)) : 0);
  function sur100(k, n) {
    if (!n) return "aucune copropriété gérée à Marseille";
    if (n < 10) return nb(k) + " pour " + nb(n) + " " + accord(n, "copropriété gérée", "copropriétés gérées") + " à Marseille";
    const v = (100 * k) / n;
    return (v === 0 ? "0" : v < 0.05 ? "moins de 0,1" : v < 9.95 ? f1.format(v) : nb(Math.round(v))) + " pour 100 copropriétés gérées à Marseille";
  }
  // Pas de distribution pour la justice, les comptes sont petits : une phrase de contexte parmi les syndics de sa taille.
  function phraseJustice(e, id) {
    const c = classeTaille(TOUT_DEPT[e]);
    let n = 0, m = 0;
    for (let j = 0; j < NE; j++) if (!ENTS[j].ei && classeTaille(TOUT_DEPT[j]) === c && BASE_MARS[j] >= 10) { n++; if (jCompte(j, id) > 0) m++; }
    if (!n) return "Aucun syndic de sa taille ne gère au moins 10 copropriétés à Marseille.";
    return `Parmi les syndics de sa taille qui gèrent au moins 10 copropriétés à Marseille (${nb(n)}), ${m ? nb(m) + " " + accord(m, "a", "ont") : "aucun n'a"} au moins une décision de ce type.`;
  }

  // Encadrement : lots gérés en France ÷ tranche d'effectif, en fourchette ; milieu = moyenne géométrique des bornes.
  const ENC = ENTS.map((x) => (x.ef && x.ln > 0 ? { lo: x.ln / x.ef[1], hi: x.ln / x.ef[0], mid: x.ln / Math.sqrt(x.ef[0] * x.ef[1]) } : null));
  let encMin = Infinity, encMax = 0;
  ENC.forEach((c) => { if (c) { encMin = Math.min(encMin, c.lo); encMax = Math.max(encMax, c.hi); } });
  const LOG0 = Math.floor(Math.log10(encMin)), LOG1 = Math.max(LOG0 + 1, Math.ceil(Math.log10(encMax)));
  const posLog = (v) => (100 * (Math.log10(v) - LOG0)) / (LOG1 - LOG0);
  const TICKS = [];
  for (let p = LOG0; p <= LOG1; p++) TICKS.push(Number((10 ** p).toPrecision(1)));
  const axeHtml = (cls) => `<div class="${cls}">${TICKS.map((v) => `<span style="left:${posLog(v).toFixed(2)}%">${tickTxt(v)}</span>`).join("")}</div>`;
  function quantile(v, p) { const h = (v.length - 1) * p, f = Math.floor(h); return v[f] + (h - f) * (v[Math.min(f + 1, v.length - 1)] - v[f]); }

  // ---------- le devenir et la tenue du registre, au département, avec les critères en cours (le syndic et ses pairs sur la même base)
  const DEV = ["rest", "rest", "grp", "conc", "nonPro", "exp", "pasM", "abs"];
  const CHAMPS_DEV = ["n0", "rest", "grp", "conc", "nonPro", "exp", "pasM", "abs", "arrV", "majN", "maj12", "finN", "finK"];
  const CACHE_DEV = new Map();
  function devenir(tl, cs) {
    const cle = tl + ":" + cs;
    if (CACHE_DEV.has(cle)) return CACHE_DEV.get(cle);
    const S = {}, T = {};
    for (const k of CHAMPS_DEV) { S[k] = new Int32Array(NE); T[k] = 0; }
    const ok = (t, c) => (tl < 0 || t === tl) && (cs < 0 || c === cs);
    const en2025 = (e3, r) => { S.n0[e3]++; T.n0++; const k = DEV[r]; if (k) { S[k][e3]++; T[k]++; } };
    for (let i = 0; i < N; i++) {
      if (!ok(TL[i], CLASSE[i])) continue;
      const e = ENT[i], e3 = E3[i], d = DRB[i];
      if (e3 >= 0) en2025(e3, RET[i]);
      if (e < 0) continue;
      if (d & 1) { S.majN[e]++; T.majN++; if (d & 2) { S.maj12[e]++; T.maj12++; } }
      if (d & 4) { S.finN[e]++; T.finN++; if (d & 8) { S.finK[e]++; T.finK++; } }
      if (e3 >= 0 && e3 !== e) { S.arrV[e]++; T.arrV++; }
    }
    // les copropriétés sorties du registre depuis 2025 comptent dans la base de leur syndic d'alors
    for (const [e3, r, lots, c] of T3ABS) if (ok(tlDe(lots), c)) en2025(e3, r);
    const v = { S, T };
    CACHE_DEV.set(cle, v);
    return v;
  }
  const devCourant = () => devenir(tlDeTf(etat.tf), etat.constr);
  // Les indicateurs du registre : un compte k sur une base n, pris dans les champs du devenir.
  const IND = {
    i1: { titre: "Toujours chez lui un an après", k: "rest", n: "n0", def: "Ses copropriétés de 2025 qui le déclarent encore, y compris dans un autre établissement de la société.",
      limite: "Ne permet pas de conclure à une satisfaction : une sortie peut venir d'une fusion d'immeubles, d'une déclaration tardive, d'un rachat." },
    i2: { titre: "Passées chez un concurrent", k: "conc", n: "n0", def: "Ses copropriétés de 2025 déclarées aujourd'hui chez un autre syndic professionnel, hors de son groupe.",
      limite: "Ne permet pas de conclure à la cause : vote d'assemblée, prix, déménagement de l'agence." },
    i3: { titre: "Mandat expiré sans successeur déclaré", k: "exp", n: "n0", def: "Ses copropriétés de 2025 dont le mandat est arrivé à sa date de fin, sans nouveau mandat déclaré.",
      limite: "Ne permet pas de conclure que la copropriété n'a pas de syndic." },
    i4: { titre: "« Pas de mandat en cours »", k: "pasM", n: "n0", def: "Ses copropriétés de 2025 dont la fiche dit aujourd'hui « pas de mandat en cours ».",
      limite: "Ne permet pas de conclure à une gestion défaillante : la part est forte partout, à cause des déclarations groupées." },
    i5: { titre: "Arrivées venues d'un autre syndic professionnel", k: "arrV", n: "n0", def: "Copropriétés qu'il déclare aujourd'hui et qu'un autre syndic professionnel déclarait en 2025, pour 100 de ses copropriétés de 2025.",
      limite: "Ne permet pas de conclure à une qualité : une croissance rapide peut aussi charger les équipes." },
    i6: { titre: "Fiche non mise à jour depuis plus de 12 mois", k: "maj12", n: "majN", def: "Ses mandats en cours dont la date de mise à jour est connue et remonte à plus de 12 mois.",
      limite: "Ne dit rien de la gestion de l'immeuble : c'est la tenue du registre." },
    i7: { titre: "Mandat « en cours » dont la date de fin est passée", k: "finK", n: "finN", def: "Ses mandats déclarés en cours et datés dont la date de fin est passée, en nombre seulement : la médiane est nulle dans toutes les tailles.",
      limite: "Ne permet pas de conclure que le mandat n'a pas été renouvelé." },
  };
  const Z95 = 1.959964;
  function wilson(k, n) {
    const p = k / n, z2 = Z95 * Z95, q = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / q, h = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / q;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  const pctF = (v) => { const x = 100 * v; return (x === 0 ? "0" : x < 0.05 ? "moins de 0,1" : x < 9.95 ? f1.format(x) : nb(Math.round(x))) + " %"; };
  // Les pairs : les sociétés de sa taille dont la base vaut au moins 10, lui compris ; s'il y en a moins de 10, la classe voisine plus grande s'ajoute.
  function pairs(e, id, S) { return pairsDeClasse(classeTaille(TOUT_DEPT[e]), id, S); }
  // La même règle pour une taille de syndic : la fiche et la « bande des pairs » des graphiques disent la même chose.
  function pairsDeClasse(c, id, S) {
    if (c < 0) return null;
    const I = IND[id];
    const taux = (cls) => { const v = []; for (let j = 0; j < NE; j++) if (cls.includes(classeTaille(TOUT_DEPT[j])) && S[I.n][j] >= 10) v.push(S[I.k][j] / S[I.n][j]); return v.sort((a, b) => a - b); };
    let cls = [c], v = taux(cls), elargi = false;
    if (v.length < 10) { cls = [c, c === 3 ? 2 : c + 1]; v = taux(cls); elargi = true; }
    if (v.length < 10) return { insuffisant: true, cls, elargi };
    return { cls, elargi, v, q1: quantile(v, 0.25), med: quantile(v, 0.5), q3: quantile(v, 0.75) };
  }
  // Les six phrases de position : le taux, sa marge à 95 % et les quartiles des pairs ; jamais de rang.
  function position(k, n, P) {
    if (n < 10) return nb(k) + " sur " + nb(n) + " : trop peu de copropriétés pour le situer parmi ses pairs";
    if (!P || P.insuffisant) return "Trop peu de syndics de cette taille dans le département pour le situer.";
    const p = k / n, [b, h] = wilson(k, n);
    if (p >= P.q1 && p <= P.q3) return "Dans la moitié centrale de ses pairs";
    if (p > P.q3) return "Au-dessus de la moitié centrale de ses pairs" + (b <= P.q3 ? " ; l'écart peut venir du hasard" : "");
    return "Au-dessous de la moitié centrale de ses pairs" + (h >= P.q1 ? " ; l'écart peut venir du hasard" : "");
  }
  function pairsEnc(e) {
    const c = classeTaille(TOUT_DEPT[e]);
    if (c < 0) return null;
    const membres = (cls) => { const a = []; for (let j = 0; j < NE; j++) if (cls.includes(classeTaille(TOUT_DEPT[j]))) a.push(j); return a; };
    let cls = [c], m = membres(cls), avec = m.filter((j) => ENC[j]), elargi = false;
    if (avec.length < 10) { cls = [c, c === 3 ? 2 : c + 1]; m = membres(cls); avec = m.filter((j) => ENC[j]); elargi = true; }
    if (avec.length < 10) return { insuffisant: true };
    const mids = avec.map((j) => ENC[j].mid).sort((a, b) => a - b);
    return { cls, elargi, n: m.length, nAvec: avec.length, avec, q1: quantile(mids, 0.25), q3: quantile(mids, 0.75) };
  }

  // ---------- lieux et numéros
  const LIEUX = MARS < 0 ? [] : [{ lib: VILLE + ", toute la commune", sous: "ses " + ARR.length + " arrondissements", zone: { k: "mars" } }];
  // un arrondissement se dit de sa commune : Marseille ici, Paris ou Lyon ailleurs
  const communeDe = (z) => (Z.find((y) => y[0] === z[3]) || [])[1];
  Z.forEach((z, i) => { if (i !== MARS) LIEUX.push({ lib: nomZ(i), sous: z[2] !== "arrondissement" ? "commune" : communeDe(z) ? "arrondissement de " + communeDe(z) : "arrondissement", zone: { k: "z", i } }); });
  LIEUX.forEach((l) => { l.cle = norm(l.lib); l.mot = (l.zone.k === "mars" ? norm(VILLE) : l.cle).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); });
  // Les lieux plus larges, chargés ou non : les départements, les régions, la France. Une adresse ne s'y ramène jamais.
  const LARGES = DEC.deps.map(([c, n]) => ({ lib: n + " (" + c + ")", sous: c === M.dept ? "département, tout entier" : NATIONAL ? "département, à charger" : "département, pas encore chargé", zone: c === M.dept ? { k: "dept" } : { k: "dep", code: c } }))
    .concat(DEC.regs.map(([c, n]) => ({ lib: "Région " + n, sous: c === REG_CH ? "un seul de ses départements est chargé" : "pas encore chargée", zone: { k: "reg", code: c } })),
      [{ lib: "France entière", sous: "un seul département chargé", zone: { k: "fr" } }]);
  LARGES.forEach((l) => { l.cle = norm(l.lib); });
  // Dans la page nationale, les communes et arrondissements des autres départements, d'après l'index des communes : en choisir un
  // charge son département à la place de celui-ci.
  const AILLEURS = [];
  if (NATIONAL) {
    const X = window.SYNDICO_COMMUNES, deDep = (c) => DEPS.get(c).nom + " (" + c + ")";
    X.code.forEach((code, j) => {
      const dep = X.dep[j];
      if (dep === M.dept || !DEPS.has(dep)) return;
      const nom = X.nom[j].replace(/ Arrondissement$/, "");
      AILLEURS.push(X.decoupee[j] ? { lib: nom + ", toute la commune", sous: "ses arrondissements · " + deDep(dep), zone: { k: "ailleurs", code, dep } }
        : { lib: nom, sous: (X.type[j] === "a" ? "arrondissement · " : "commune · ") + deDep(dep), zone: { k: "ailleurs", code, dep } });
    });
    AILLEURS.forEach((l) => { l.cle = norm(l.lib); });
  }
  // le département d'un code postal : ses deux premiers chiffres, trois outre-mer, 2A ou 2B en Corse (20000 à 20199 : Corse-du-Sud)
  const depDuCodePostal = (cp) => (/^97/.test(cp) ? cp.slice(0, 3) : /^20/.test(cp) ? (Number(cp) < 20200 ? "2A" : "2B") : cp.slice(0, 2));
  // Code postal d'un arrondissement : le département, puis le numéro sur trois chiffres (13001 à 13016 à Marseille, 75001 à
  // 75020 à Paris, et 75116 pour le 16e ; 69001 à 69009 à Lyon). Les autres codes ne se rattachent pas sans table.
  const CP_ARR = new Map();
  ARR.forEach((i) => { const n = /^\D*(\d+)/.exec(nomZ(i).slice(VILLE.length)); if (n) CP_ARR.set(M.dept + n[1].padStart(3, "0"), i); });
  if (M.dept === "75" && CP_ARR.has("75016")) CP_ARR.set("75116", CP_ARR.get("75016"));
  function lieuDuCodePostal(cp) {
    const i = CP_ARR.get(cp);
    return i == null ? null : LIEUX.find((l) => l.zone.k === "z" && l.zone.i === i) || null;
  }
  // Une adresse n'est pas localisée : on y cherche le code postal d'un arrondissement, sinon le dernier nom de lieu qu'elle contient.
  function lieuDansAdresse(q) {
    const cp = (q.match(/\b\d{5}\b/g) || []).find((c) => CP_ARR.has(c));
    if (cp) { const l = lieuDuCodePostal(cp); if (l) return l; }
    const n = " " + norm(q).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + " ";
    let best = null, pos = -1;
    for (const l of LIEUX) {
      const p = n.lastIndexOf(" " + l.mot + " ");
      if (p > pos || (p >= 0 && p === pos && l.mot.length > best.mot.length)) { best = l; pos = p; }
    }
    return best;
  }
  // Les communes et arrondissements chargés d'abord, puis les lieux plus larges ; un code de département tapé seul vient en tête.
  function chercherLieux(q) {
    const n = norm(q), code = String(q).trim().toUpperCase();
    if (!n) return [];
    const parCode = DEPS.has(code) ? LARGES.filter((l) => (l.zone.k === "dept" ? code === M.dept : l.zone.k === "dep" && l.zone.code === code)) : [];
    // le nom exact (Toulon avant Toulon-sur-Allier), puis le nom qui commence par la frappe, puis un de ses mots (« France » avant
    // « Île-de-France »), puis le reste
    const rangs = [[], [], [], []];
    for (const l of LIEUX.concat(LARGES, AILLEURS)) {
      if (parCode.includes(l)) continue;
      const r = l.cle === n ? 0 : l.cle.startsWith(n) ? 1 : l.cle.includes(" " + n) ? 2 : l.cle.includes(n) ? 3 : -1;
      if (r >= 0) rangs[r].push(l);
    }
    return parCode.concat(...rangs).slice(0, 8);
  }
  const RE_NUM = /^[A-Z]{2}\d{7}$/;
  const commeNumero = (q) => { const s = String(q).toUpperCase().replace(/[\s.\-]/g, ""); return RE_NUM.test(s) ? s : null; };
  const ressembleAdresse = (q) => /^\d{1,4}\s*(bis|ter)?[\s,]+[a-zà-ÿ]{2,}/i.test(q) || /\b(rue|avenue|bd|boulevard|chemin|place|impasse|all[ée]e|traverse|cours|quai|route|mont[ée]e|square)\b/i.test(q);

  // ---------- état
  const etat = {
    triDefaut: "ici", format: "large",
    // Les lieux choisis, dans leur ordre ; « zone » les réunit. La copropriété, ou l'adresse et le lieu où la page la ramène.
    lieux: [], zone: null, tf: -1, constr: -1, copro: null, adresse: null, adresseLieu: null, rayon: 0,
    tri: "ici", sens: "desc", groupe: "portefeuille", triChoisi: false, sel: null, fiche: null, cadrage: "bureaux",
    // La page s'ouvre sur « Ensemble », qui ne nomme personne ; le premier lieu choisi ouvre le tableau, sauf si le visiteur a déjà choisi un onglet.
    onglet: "ensemble", ongletChoisi: false, filtresOuverts: false,
    // Les étiquettes posées d'un clic dans « Ensemble » ; le mode du tableau (syndics ou décisions) ; les listes dépliées.
    filtres: {}, modeTab: "syndics", filtreDec: null, tout: {},
    // Les colonnes du visiteur, dans son ordre (« Mes colonnes ») ; le panneau qui les choisit ; la définition ouverte par un « ? ».
    perso: null, choixCol: false, aideCol: null,
    // La carte : sa couche (les syndics ou les copropriétés) et la couleur de ses points.
    couche: "syndics", couleur: "type",
    // Les images de l'IGN sous la carte, éteintes par défaut : un fond (le plan ou les photographies aériennes) et les parcelles du cadastre.
    fond: "", parcelles: false,
    // Les graphiques : la forme choisie, et l'axe vertical du nuage de points.
    // « noms » : les noms des syndics sur le nuage de points, éteints par défaut (seul le syndic choisi y est nommé).
    forme: "proposee", nuageY: "taille", noms: false,
  };

  // ---------- les étiquettes : un filtre posé d'un clic dans « Ensemble », retiré d'un clic sur sa croix
  const formeDe = (e) => (ENTS[e].ei ? "Entrepreneur individuel" : ENTS[e].f || "");
  const decennieDe = (x) => { const a = Number(x.cr); return !a ? -1 : a < 1970 ? 1960 : Math.floor(a / 10) * 10; };
  const libDecennie = (d) => (d < 0 ? "date de création non connue" : d === 1960 ? "créées avant 1970" : "créées dans les années " + d);
  const BORNES_EFF = [[1, 9], [10, 49], [50, 249], [250, Infinity]];
  const LIB_EFF = ["1 à 9 salariés", "10 à 49 salariés", "50 à 249 salariés", "250 salariés et plus"];
  const effDe = (x) => (!x.ef ? -1 : BORNES_EFF.findIndex(([a, b]) => x.ef[0] >= a && x.ef[0] <= b));
  // Société locale ou réseau : gère-t-elle des copropriétés hors du département ?
  const reseauDe = (e) => (!ENTS[e].cn ? -1 : ENTS[e].cn > TOUT_DEPT[e] ? 1 : 0);
  const LIB_RESEAU = ["Toutes ses copropriétés de France sont dans le département", "Il gère aussi des copropriétés hors du département"];
  const FILTRES = {
    classe: { lib: (v) => "Taille du syndic : " + LIB_CLASSE[v], passe: (e, v) => classeTaille(TOUT_DEPT[e]) === v },
    top: { lib: (v) => "Les " + nb(v) + " syndics les plus présents", passe: (e, v) => R.rang.get(e) < v },
    forme: { lib: (v) => "Forme : " + (v || "non renseignée"), passe: (e, v) => formeDe(e) === v },
    decennie: { lib: (v) => cap(libDecennie(v)), passe: (e, v) => decennieDe(ENTS[e]) === v },
    effectif: { lib: (v) => "Effectif : " + (v < 0 ? "aucun salarié déclaré, ou non connu" : LIB_EFF[v]), passe: (e, v) => effDe(ENTS[e]) === v },
    reseau: { lib: (v) => (v < 0 ? "Copropriétés en France non connues" : LIB_RESEAU[v]), passe: (e, v) => reseauDe(e) === v },
  };
  const passeFiltres = (r) => Object.keys(etat.filtres).every((k) => FILTRES[k].passe(r.e, etat.filtres[k]));
  // Le filtre des décisions : « e:12;annee:2024 » → { e: 12, annee: 2024 }
  const lireFiltreDec = (v) => Object.fromEntries(String(v).split(";").filter(Boolean).map((p) => { const [k, x] = p.split(":"); return [k, Number(x)]; }));
  const FILTRES_DEC = {
    annee: { lib: (v) => "année " + v, passe: (d, v) => Number(d[0].slice(0, 4)) === v },
    obj: { lib: (v) => minuscule(JM.obj[v]), passe: (d, v) => d[3] === v },
    jur: { lib: (v) => JM.jur[v >> 1] + (v & 1 ? ", appel" : ", première instance"), passe: (d, v) => ((d[1] << 1) | d[2]) === v },
    iss: { lib: (v) => minuscule(JM.iss[v]), passe: (d, v) => d[4] === v },
    e: { lib: (v) => ENTS[v].n, passe: () => true },
  };
  const libFiltreDec = (f) => Object.keys(f).map((k) => FILTRES_DEC[k].lib(f[k])).join(" · ");

  // Le premier sens de chaque tri : du plus fort au plus faible, sauf le nom, l'encadrement et la distance ; et le groupe de colonnes qui montre chaque tri.
  const SENS = { nom: "asc", enc: "asc", dist: "asc" };
  const GROUPE_DE = { part: "portefeuille", taille: "portefeuille", enc: "portefeuille", dist: "portefeuille", n0: "devenir", i1: "devenir", i2: "devenir", i5: "devenir",
    i3: "registre", i4: "registre", i6: "registre", i7: "registre", jbase: "justice", j1: "justice", j2: "justice", j3: "justice" };
  const GROUPES = [["portefeuille", "Portefeuille"], ["devenir", "Devenir depuis 2025"], ["registre", "Tenue du registre"], ["justice", "Justice à Marseille"]].filter((g) => AVEC_J || g[0] !== "justice");
  // L'ordre du menu « Trier par » : les tris proposés à la décision d'abord, puis les autres colonnes.
  const PROPOSES = ["ici", "i1", "i2", "i3", "i6", "j3", "enc", "dist", "taille", "nom"];
  // Les jeux de colonnes : « Proposées » mêle les groupes ; « Mes colonnes », la liste du visiteur, apparaît dès qu'il en compose une.
  const PROPOSEES = ["taille", "i1", "i2", "i6", "dist"];
  const JEUX = [["proposees", "Proposées"], ...GROUPES];
  const idsDuJeu = (g) => (g === "perso" ? etat.perso || [] : g === "proposees" ? PROPOSEES : Object.keys(GROUPE_DE).filter((id) => GROUPE_DE[id] === g));
  const visible = (id) => !GROUPE_DE[id] || idsDuJeu(etat.groupe).includes(id);
  // Un tri sur une colonne cachée la montre : dans « Mes colonnes », elle s'ajoute à la fin ; sinon, son groupe s'ouvre.
  function montrerColonne(id) {
    if (visible(id)) return;
    if (etat.groupe === "perso") { etat.perso = etat.perso.concat([id]); garderPerso(); }
    else etat.groupe = GROUPE_DE[id];
  }
  // Les deux colonnes fixes, puis celles du jeu : un groupe dans son ordre établi, ou une liste dans l'ordre du visiteur.
  function colonnesVisibles(cols) {
    const g = etat.groupe, fixes = cols.filter((x) => !x.g);
    if (g !== "perso" && g !== "proposees") return fixes.concat(cols.filter((x) => x.g === g));
    const par = new Map(cols.map((x) => [x.id, x]));
    return fixes.concat(idsDuJeu(g).map((id) => par.get(id)).filter(Boolean));
  }
  // « Mes colonnes » reste dans ce navigateur d'une visite à l'autre, sans s'imposer : la page s'ouvre toujours sur le jeu par défaut.
  const CLE_PERSO = "syndicoscope.v4.colonnes";
  function garderPerso() { try { localStorage.setItem(CLE_PERSO, JSON.stringify(etat.perso)); } catch (e) { /* stockage refusé : le choix vaut pour la visite */ } }
  try { const v = JSON.parse(localStorage.getItem(CLE_PERSO) || "null"); if (Array.isArray(v) && v.length && v.every((id) => GROUPE_DE[id])) etat.perso = v; } catch (e) { /* rien de gardé */ }
  // Ce que dit chaque colonne : la bulle « ? » et la liste sous le tableau. Les taux prennent leur définition dans IND.
  const DEF_COL = {
    ici: "Copropriétés du lieu, ou du cercle, de la taille et de la construction choisies, pour lesquelles ce syndic est déclaré au registre aujourd'hui.",
    part: "Ses copropriétés de votre tranche, sur toutes celles qu'il gère dans le département.",
    taille: "Toutes ses copropriétés du département, sans critère. Elles le rangent dans l'une des quatre tailles : 1 à 9, 10 à 49, 50 à 199, 200 copropriétés et plus.",
    enc: "Fourchette tirée des lots déclarés au registre et de la tranche d'effectif. L'effectif compte aussi la location et la vente.",
    dist: "Distance à vol d'oiseau entre votre copropriété, ou le centre du lieu, et le bureau de ce syndic le plus proche, d'après le répertoire des entreprises. Sans cercle ni copropriété, la colonne montre son siège, ou à défaut l'un de ses bureaux.",
    j3: "Décisions publiées où il est partie pour son propre compte, et non pour représenter le syndicat des copropriétaires, pour 100 copropriétés qu'il gère à Marseille.",
    j1: "Décisions publiées qui le condamnent sur le fond du litige, et non aux seuls dépens ou frais, pour 100 copropriétés qu'il gère à Marseille.",
    j2: "Décisions publiées qui retiennent sa responsabilité, pour 100 copropriétés qu'il gère à Marseille.",
  };
  const LIMITE_COL = { part: "Ne permet pas de conclure qu'il accepte un nouveau mandat.", taille: "Être très présent ne dit rien de la qualité d'un syndic, ni de ses prix." };
  const defCol = (x) => x.def || DEF_COL[x.id] || "";
  const limiteCol = (x) => (IND[x.id] ? IND[x.id].limite : JIND[x.id] ? JIND[x.id].limite : LIMITE_COL[x.id] || "");
  let R = null;
  const RAYONS = [1000, 2000, 5000, 10000, 20000];
  const kmTxt = (m) => nb(m / 1000) + " km";

  // Le repère des distances et du cercle : la copropriété si elle est connue, sinon le centre d'un lieu,
  // celui de l'adresse tapée, ou le lieu choisi s'il est seul. Sans repère, pas de cercle.
  const refZone = () => etat.adresseLieu || (etat.zone && pointDe(etat.zone));
  function pointRef() {
    if (etat.copro != null) return [LAT[etat.copro], LON[etat.copro]];
    const z = refZone();
    return z ? centreZone(z) : null;
  }
  const rayonEffectif = () => (etat.zone && pointRef() ? etat.rayon : 0);
  const centreTxt = () => (etat.copro != null ? "de votre copropriété" : "du centre " + deZone(refZone()));
  function lignesCercle(ref, r) {
    const a = [], dLa = r / 111320, dLo = r / (111320 * Math.cos((ref[0] * Math.PI) / 180));
    for (let i = 0; i < N; i++) {
      if (Math.abs(LAT[i] - ref[0]) > dLa || Math.abs(LON[i] - ref[1]) > dLo) continue;
      if (dist(ref[0], ref[1], LAT[i], LON[i]) <= r) a.push(i);
    }
    return a;
  }
  // Une passe sur les copropriétés du lieu, ou du cercle ; « auDept » : tout le département, sans cercle (l'onglet « Ensemble » sans lieu).
  // « Retenues » : celles de la tranche et de la période réglées, ou toutes.
  function calculer(auDept) {
    const tf = etat.tf, cs = etat.constr, ref = auDept ? null : pointRef(), rayon = auDept ? 0 : rayonEffectif();
    const rows = rayon > 0 && ref ? lignesCercle(ref, rayon) : auDept ? null : lignesZone(etat.zone);
    const ici = new Int32Array(NE), tout = new Int32Array(NE), parT = TRANCHES.map(() => new Uint8Array(NE));
    const tot = { copros: 0, pro: 0, ret: 0, retPro: 0 }, retenues = [];
    const voir = (i) => {
      const e = ENT[i];
      tot.copros++;
      if (e >= 0) { tout[e]++; tot.pro++; if (TF[i] >= 0) parT[TF[i]][e] = 1; }
      if ((tf < 0 || TF[i] === tf) && (cs < 0 || CLASSE[i] === cs)) {
        retenues.push(i); tot.ret++;
        if (e >= 0) { ici[e]++; tot.retPro++; }
      }
    };
    if (rows) for (const i of rows) voir(i);
    else for (let i = 0; i < N; i++) voir(i);
    const fd = tf >= 0 ? fineDept(tf) : null, liste = [];
    for (let e = 0; e < NE; e++) {
      if (!ici[e]) continue;
      let d = null, bk = -1;
      for (const k of BUR_DE[e]) {
        if (ref) { const m = dist(ref[0], ref[1], BUR[k][1], BUR[k][2]); if (d === null || m < d) { d = m; bk = k; } }
        else if (bk < 0 || BUR[k][4]) bk = k;
      }
      liste.push({ e, ici: ici[e], tout: tout[e], part: fd ? [fd[e], TOUT_DEPT[e]] : null, d, bk });
    }
    const pool = parT.map((a) => a.reduce((s, v) => s + v, 0));
    return { liste, tot, retenues, ref, rayon, pool, rows, ordre: [] };
  }
  const parNom = (a, b) => ENTS[a.e].n.localeCompare(ENTS[b.e].n, "fr") || a.e - b.e;
  // Une clé nulle (base sous 10, valeur absente) va en fin de liste, quel que soit le sens ; les copropriétés ici, puis le nom, départagent.
  function trier(liste, col, sens) {
    const L = liste.slice(), s = sens === "asc" ? 1 : -1;
    if (col.id === "nom") return L.sort((a, b) => s * parNom(a, b));
    const v = new Map(L.map((r) => [r.e, col.cle(r)]));
    return L.sort((a, b) => {
      const x = v.get(a.e), y = v.get(b.e);
      if (x == null || y == null) return (x == null) - (y == null) || b.ici - a.ici || parNom(a, b);
      return s * (x - y) || b.ici - a.ici || parNom(a, b);
    });
  }
  const ech = (v) => [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.8, 1].find((m) => m >= v) || 1;
  // La base du devenir et de la tenue des fiches, telle que les phrases doivent la dire.
  function critDevTxt() { const tl = tlDeTf(etat.tf); return (tl >= 0 ? " de " + LIB_TL[tl] : "") + (etat.constr >= 0 ? " " + construitesTxt(etat.constr, 2) : ""); }
  const baseDev = () => "ses copropriétés du département" + critDevTxt() + " déclarées chez lui au 3e trimestre 2025 (" + dateFr(M.t3) + ")";
  const baseMaj = () => "ses mandats en cours du département" + critDevTxt() + ", au " + dateFr(M.fichier);
  // Les colonnes : deux toujours là (g null), puis celles d'un groupe. cle(r) : nombre, ou null ; cel(r) : la cellule ; taux : point et marge.
  function colonnes() {
    const { S, T } = devCourant(), avecDist = !!(R && R.ref), L = R ? R.liste : [];
    const colTaux = (id, g) => {
      const I = IND[id];
      return { id, g, titre: I.titre, def: I.def, sens: "desc", taux: true, ref: T[I.n] ? T[I.k] / T[I.n] : null,
        kn: (r) => [S[I.k][r.e], S[I.n][r.e]], cle: (r) => (S[I.n][r.e] >= 10 ? S[I.k][r.e] / S[I.n][r.e] : null) };
    };
    const colJustice = (id) => ({ id, g: "justice", titre: JIND[id].titre, sens: "desc", justice: true,
      cle: (r) => { const k = jCompte(r.e, id), n = BASE_MARS[r.e]; return k == null || n < 10 ? null : k / n; },
      cel: (r) => {
        const k = jCompte(r.e, id), n = BASE_MARS[r.e];
        if (k == null) return `<span class="sans">non renseigné</span>`;
        if (!k && !n) return `<span class="sans">hors du périmètre lu</span>`;
        return `<span class="val">${nb(k)}</span><span class="sous">${esc(sur100(k, n))}</span>`;
      } });
    const cols = [
      { id: "nom", g: null, titre: "Syndic", sens: "asc", cle: () => 0 },
      { id: "ici", g: null, titre: titreIci(false), sens: "desc", cle: (r) => r.ici },
    ];
    if (etat.tf >= 0) cols.push({ id: "part", g: "portefeuille", titre: "Part de son portefeuille dans le département", sens: "desc", cle: (r) => (r.part[1] >= 10 ? r.part[0] / r.part[1] : null), cel: (r) => celPart(r.part) });
    cols.push(
      { id: "taille", g: "portefeuille", titre: "Taille du syndic dans le département", sens: "desc", cle: (r) => TOUT_DEPT[r.e],
        cel: (r) => `<span class="val">${LIB_CLASSE[classeTaille(TOUT_DEPT[r.e])]}</span><span class="sous">${nb(TOUT_DEPT[r.e])} ${accord(TOUT_DEPT[r.e], "copropriété", "copropriétés")}</span>` },
      { id: "enc", g: "portefeuille", titre: "Lots par salarié déclaré", sens: "asc", cle: (r) => (ENC[r.e] ? ENC[r.e].mid : null), cel: (r) => celEnc(r.e) },
      { id: "dist", g: "portefeuille", titre: avecDist ? "Bureau le plus proche" : "Bureau", sens: "asc", triable: avecDist, cle: (r) => r.d, cel: celBureau },
      { id: "n0", g: "devenir", titre: "Ses copropriétés de 2025", def: "Copropriétés du département qui le déclaraient au 3e trimestre 2025, avec les critères en cours : la base du devenir.", sens: "desc",
        cle: (r) => S.n0[r.e], cel: (r) => `<span class="val">${nb(S.n0[r.e])}</span>` },
      colTaux("i1", "devenir"), colTaux("i2", "devenir"),
      { id: "i5", g: "devenir", titre: IND.i5.titre, def: IND.i5.def, sens: "desc", cle: (r) => (S.n0[r.e] >= 10 ? S.arrV[r.e] / S.n0[r.e] : null), cel: (r) => celPour100(S.arrV[r.e], S.n0[r.e]) },
      colTaux("i3", "registre"), colTaux("i4", "registre"), colTaux("i6", "registre"),
      { id: "i7", g: "registre", titre: IND.i7.titre, def: IND.i7.def, sens: "desc", cle: (r) => S.finK[r.e],
        cel: (r) => `<span class="val">${nb(S.finK[r.e])}</span><span class="sous">sur ${nb(S.finN[r.e])} ${accord(S.finN[r.e], "mandat daté", "mandats datés")}</span>` },
    );
    // un département sans relevé de justice n'a pas ces colonnes
    if (AVEC_J) cols.push(
      { id: "jbase", g: "justice", titre: "Copropriétés gérées à Marseille", def: "Toutes ses copropriétés d'aujourd'hui à Marseille, toutes tailles : la base des taux de justice.", sens: "desc",
        cle: (r) => BASE_MARS[r.e], cel: (r) => `<span class="val">${nb(BASE_MARS[r.e])}</span>` },
      colJustice("j3"), colJustice("j1"), colJustice("j2"),
    );
    // l'échelle d'une colonne de taux : la plus haute marge de la liste, ou le repère du département
    for (const c of cols) if (c.taux) { let m = c.ref || 0; for (const r of L) { const [k, n] = c.kn(r); if (n >= 10) m = Math.max(m, wilson(k, n)[1]); } c.mx = ech(m); }
    return cols;
  }
  const colCourante = (cols) => cols.find((x) => x.id === etat.tri) || cols.find((x) => x.id === "ici");
  function titreIci(avecConstr) {
    let s = "Copropriétés";
    if (etat.tf >= 0) s += " de " + libTranche(etat.tf);
    if (avecConstr && etat.constr >= 0) s += " " + construitesTxt(etat.constr, 2);
    return s + " ici";
  }
  // La base réelle, telle que les phrases doivent la dire : le lieu, ou le cercle et son centre.
  function iciTxt() {
    const r = rayonEffectif();
    if (r > 0) return "dans un rayon de " + kmTxt(r) + " autour " + centreTxt();
    return iciZone(etat.zone);
  }

  // ---------- actions
  function nouveauxCriteres() {
    // Un tri choisi par le visiteur survit aux réglages, sauf si sa colonne disparaît.
    if (!etat.triChoisi || (etat.tri === "part" && etat.tf < 0) || (etat.tri === "dist" && !pointRef())) { etat.tri = etat.triDefaut; etat.sens = SENS[etat.tri] || "desc"; etat.triChoisi = false; }
    montrerColonne(etat.tri);
    // des lieux tous hors des données chargées ne donnent pas « 0 copropriété » : la page dit qu'ils ne sont pas chargés
    R = etat.zone && charges(etat.zone).length ? calculer() : null;
    // Les étiquettes ne retiennent que les syndics qui y répondent ; R.tous garde la liste entière, et R.rang l'ordre des plus présents.
    if (R) {
      R.tous = R.liste;
      R.rang = new Map(R.tous.slice().sort((a, b) => b.ici - a.ici || parNom(a, b)).map((r, k) => [r.e, k]));
      R.liste = R.tous.filter(passeFiltres);
    }
    if (!R || (etat.sel != null && !R.liste.some((r) => r.e === etat.sel))) etat.sel = null;
    if (!R || (etat.fiche != null && !R.liste.some((r) => r.e === etat.fiche))) etat.fiche = null;
    if (etat.sel == null && etat.cadrage === "syndic") etat.cadrage = "bureaux";
    rendre();
  }
  // Sans lieu choisi, « Ensemble » compte sur tout le département, avec la jauge et la construction réglées.
  let RD = null, cleRD = "";
  function rDept() {
    const cle = etat.tf + ":" + etat.constr;
    if (cle !== cleRD) { RD = calculer(true); RD.tous = RD.liste; cleRD = cle; }
    return RD;
  }
  // Un tri choisi au menu prend son premier sens ; un clic sur l'en-tête du tri en cours l'inverse. Le groupe qui montre la colonne s'ouvre.
  function choisirTri(id, duMenu) {
    if (etat.tri === id && !duMenu) etat.sens = etat.sens === "asc" ? "desc" : "asc";
    else { etat.tri = id; etat.sens = SENS[id] || "desc"; }
    etat.triChoisi = true;
    montrerColonne(id);
    garderFocus(() => { rendreTableau(); rendreGraphiques(); });
  }
  // Le tri d'une colonne qui disparaît revient au tri par défaut s'il reste visible, sinon aux copropriétés ici.
  function triVisible() {
    if (!visible(etat.tri)) { etat.tri = visible(etat.triDefaut) ? etat.triDefaut : "ici"; etat.sens = SENS[etat.tri] || "desc"; etat.triChoisi = false; }
  }
  function choisirGroupe(g) {
    etat.groupe = g;
    triVisible();
    garderFocus(() => { rendreTableau(); rendreGraphiques(); });
  }
  // Toute retouche part des colonnes montrées et devient « Mes colonnes » : ajouter, retirer, monter, descendre.
  function modifierColonnes(act, id) {
    const L = colonnesVisibles(colonnes()).filter((x) => x.g).map((x) => x.id), k = L.indexOf(id);
    if (act === "col-ajouter" && k < 0) L.push(id);
    else if (act === "col-retirer" && k >= 0) L.splice(k, 1);
    else if ((act === "col-haut" && k > 0) || (act === "col-bas" && k >= 0 && k < L.length - 1)) { const j = act === "col-haut" ? k - 1 : k + 1; [L[k], L[j]] = [L[j], L[k]]; }
    else return;
    Object.assign(etat, { perso: L, groupe: "perso" });
    garderPerso();
    triVisible();
    garderFocus(() => { rendreTableau(); rendreGraphiques(); });
    // une colonne retirée emporte son bouton : le focus passe à la voisine, ou au bouton du panneau
    if (act === "col-retirer") { const b = document.querySelector(L.length ? `#choix-col [data-act="col-retirer"][data-v="${L[Math.min(k, L.length - 1)]}"]` : `#groupes-col [data-act="choix-col"]`); if (b) b.focus({ preventScroll: true }); }
  }
  // Un syndic choisi ailleurs que sur la carte : la carte se cadre sur ses copropriétés, sauf si le visiteur a demandé le lieu seul.
  function choisir(e, depuisCarte) {
    etat.sel = e == null || etat.sel === e ? null : e;
    if (etat.fiche != null && etat.sel != null) etat.fiche = etat.sel;
    if (etat.sel == null) { if (etat.cadrage === "syndic") etat.cadrage = "bureaux"; }
    else if (!depuisCarte && etat.cadrage !== "zone" && !ENTS[etat.sel].ei) etat.cadrage = "syndic";
    majSelection();
  }
  function ouvrirFiche(e) {
    etat.fiche = e; etat.sel = e;
    if (etat.cadrage !== "zone" && !ENTS[e].ei) etat.cadrage = "syndic";
    majSelection();
    placerVues();
    const f = $("fiche");
    if ($("app").clientWidth < 900) f.scrollIntoView({ block: "start" });
    const h = $("fiche-nom");
    if (h) h.focus({ preventScroll: true });
  }
  function fermerFiche() {
    const e = etat.fiche;
    etat.fiche = null;
    rendreFiche(); placerVues(); rendreSelMobile(); dessinerBientot();
    const b = document.querySelector(`#tab-corps [data-act="fiche"][data-e="${e}"]`);
    if (b && b.offsetParent) b.focus({ preventScroll: false });
  }
  function garderFocus(fn) {
    const a = document.activeElement, cont = a && a.closest ? a.closest("[id]") : null;
    const sig = a && a.dataset && (a.dataset.act || a.dataset.tri) ? { ...a.dataset } : null;
    fn();
    if (!sig || !cont) return;
    let q = sig.tri ? `[data-tri="${sig.tri}"]` : `[data-act="${sig.act}"]`;
    if (sig.v != null) q += `[data-v="${sig.v}"]`;
    if (sig.e != null) q += `[data-e="${sig.e}"]`;
    const b = ($(cont.id) || document).querySelector(q);
    if (b && b !== document.activeElement) b.focus({ preventScroll: true });
  }

  // ---------- rendu
  const puce = (act, v, lib, on, cls) => `<button type="button" class="puce${cls ? " " + cls : ""}" data-act="${act}" data-v="${v}" aria-pressed="${on}">${esc(lib)}</button>`;
  function rendre() {
    rendreEntree();
    rendreResultat();
  }
  const libJauge = () => (etat.tf >= 0 ? libTranche(etat.tf) : "toutes tailles");
  function rendreEntree() {
    const t = $("taille"), v = etat.tf + 1;
    if (Number(t.value) !== v) t.value = String(v);
    $("taille-val").textContent = libJauge();
    t.setAttribute("aria-valuetext", libJauge());
    const ry = $("rayon");
    ry.disabled = !etat.zone || !pointRef();
    if (Number(ry.value) !== etat.rayon) ry.value = String(etat.rayon);
    const cs = $("constr");
    if (Number(cs.value) !== etat.constr) cs.value = String(etat.constr);
    $("dept-tout").setAttribute("aria-pressed", String(etat.lieux.length === 1 && etat.lieux[0].k === "dept"));
    // les lieux choisis, chacun retiré d'un clic sur sa croix ; un lieu non chargé le dit dans son étiquette
    $("lieux-choisis").innerHTML = !etat.lieux.length ? "" : `<span class="trier">Lieux</span>` + etat.lieux.map((m, k) => chip("lieu", k, libZone(m) + (charge(m) ? "" : " · pas encore chargé"))).join("");
  }
  function rendreResultat() {
    rendreFiltres(); rendreEtiquettes(); rendreCriteres(); rendreResume(); placerVues(); rendreTableau(); rendreGraphiques(); rendreEnsemble(); rendreFiche(); rendreSelMobile(); rendreActionsCarte(); dessinerCarte();
  }
  // La barre de recherche porte les réglages ; ce bloc ne dit que ce qu'elle ne montre pas : la copropriété reconnue, l'adresse non localisée.
  function rendreCriteres() {
    const el = $("criteres"), p = [];
    if (R && etat.copro != null) {
      const i = etat.copro;
      p.push(`<p class="crit-copro">Votre copropriété n° ${immatDe(i)} : ${nb(LOTS[i])} lots${CLASSE[i] >= 0 ? ", " + construitesTxt(CLASSE[i], 1) : ""}, ${esc(nomZ(ZONE[i]))}. La jauge et la construction ont pris ses valeurs ; vous pouvez les changer.</p>`);
    }
    if (R && etat.adresse) p.push(`<p class="crit-copro">Adresse tapée : « ${esc(etat.adresse)} ». La page ne localise pas les adresses : elle la ramène à ${esc(libZone(etat.adresseLieu))}, dont le centre sert de repère aux distances${rayonEffectif() > 0 ? " et au cercle" : ""}.</p>`);
    const nc = R && etat.zone ? noteCharge(etat.zone) : "";
    if (nc) p.push(`<p class="crit-copro">${esc(nc)}</p>`);
    el.hidden = !p.length;
    el.innerHTML = p.join("");
  }
  function rendreResume() {
    const el = $("resume");
    if (!R && etat.zone) {
      el.innerHTML = `${esc(noteCharge(etat.zone))} Cette page ne charge encore qu'un département : ${esc(NOM_CH)}. <strong>Tapez l'un de ses lieux</strong>, ou le département lui-même.`;
      return;
    }
    if (!R) {
      el.innerHTML = `${esc(M.nomDept)} : ${nb(N)} copropriétés au registre, dont ${nb(TYPES_DEPT.pro)} déclarent un syndic professionnel ; ${nb(NB_SYN_DEPT)} syndics professionnels en gèrent. <strong>Tapez un lieu</strong> pour voir lesquels y gèrent des copropriétés ; « Ensemble » donne les chiffres sans nom.`;
      return;
    }
    const t = R.tot, n = R.tous.length, crit = etat.tf >= 0 || etat.constr >= 0, k = crit ? t.ret : t.copros, pro = crit ? t.retPro : t.pro;
    let quoi = nb(k) + " " + accord(k, "copropriété", "copropriétés");
    if (etat.tf >= 0) quoi += " de " + libTranche(etat.tf);
    if (etat.constr >= 0) quoi += " " + construitesTxt(etat.constr, k);
    const ret = R.liste.length < n ? ` Les étiquettes en retiennent ${nb(R.liste.length)}.` : "";
    el.innerHTML = `${esc(cap(iciTxt()))}, ${quoi} au registre, dont ${nb(pro)} ${accord(pro, "déclare", "déclarent")} un syndic professionnel. <strong>${nb(n)} ${accord(n, "syndic professionnel en gère", "syndics professionnels en gèrent")} au moins une.</strong>${ret}`;
  }
  // Les filtres du bandeau : repliés sous un bouton qui dit combien sont posés.
  function rendreFiltres() {
    const b = $("btn-filtres"), n = (rayonEffectif() > 0 ? 1 : 0) + (etat.constr >= 0 ? 1 : 0);
    b.setAttribute("aria-expanded", String(etat.filtresOuverts));
    b.textContent = "Filtres" + (n ? " (" + n + ")" : "");
    $("filtres").hidden = !etat.filtresOuverts;
  }
  const chip = (act, v, lib) => `<span class="chip">${esc(lib)}<button type="button" data-act="retirer-${act}" data-v="${esc(v)}" aria-label="Retirer : ${esc(lib)}">×</button></span>`;
  function rendreEtiquettes() {
    const p = [];
    if (R) for (const k of Object.keys(etat.filtres)) p.push(chip("filtre", k, FILTRES[k].lib(etat.filtres[k])));
    if (R && etat.modeTab === "decisions" && etat.filtreDec && Object.keys(etat.filtreDec).length) p.push(chip("dec", "", "Décisions : " + libFiltreDec(etat.filtreDec)));
    $("etiquettes").innerHTML = p.join("");
  }
  // Une vue à la fois. Sur ordinateur, la fiche s'ouvre à côté de la vue ; sur téléphone, elle la remplace.
  const VUES = ["tableau", "carte", "graphiques", "ensemble"];
  function placerVues() {
    VUES.forEach((v) => {
      const on = v === etat.onglet;
      $("vue-" + v).classList.toggle("active", on);
      $("og-" + v).setAttribute("aria-selected", String(on));
      $("og-" + v).tabIndex = on ? 0 : -1;
    });
    $("onglets").hidden = etat.fiche != null && $("app").clientWidth < 900;
  }
  function legendeTri(c) {
    const monte = etat.sens === "asc";
    let s;
    if (c.id === "nom") s = monte ? "Ordre alphabétique." : "Ordre alphabétique inverse.";
    else if (c.id === "ici") s = "Ordre : " + (monte ? "du plus petit au plus grand" : "du plus grand au plus petit") + " nombre de " + minuscule(titreIci(true)) + ".";
    else if (c.id === "enc") s = "Ordre : " + (monte ? "du plus petit au plus grand" : "du plus grand au plus petit") + " nombre de lots par salarié déclaré, pris au milieu de la fourchette (moyenne géométrique de ses deux bornes). Les fourchettes se chevauchent souvent : entre deux voisins, l'ordre est alors indéterminé. Les sociétés sans salarié déclaré sont en fin de liste.";
    else if (c.id === "dist") s = monte ? "Ordre : du bureau le plus proche au plus lointain, à vol d'oiseau." : "Ordre : du bureau le plus lointain au plus proche, à vol d'oiseau.";
    else s = "Ordre : « " + c.titre + " », " + (monte ? "de la plus faible à la plus forte valeur." : "de la plus forte à la plus faible valeur.");
    if (c.taux || c.justice || c.id === "i5" || c.id === "part") s += " Sous une base de 10 copropriétés, pas de pourcentage : ces syndics sont en fin de liste, écrits « k sur n ».";
    if (c.id !== "nom") s += " À égalité, les copropriétés ici, puis le nom, départagent.";
    return "<strong>Trier n'est pas classer</strong> : l'ordre ne dit rien de la qualité d'un syndic. " + esc(s) + " Un clic sur l'en-tête du tri en cours inverse le sens.";
  }
  // Sous le tableau : ce que disent les colonnes du groupe ouvert, leur base et leurs mentions.
  function limiteGroupe() {
    const gs = new Set(idsDuJeu(etat.groupe).map((id) => GROUPE_DE[id])), p = [];
    if (gs.has("devenir") || gs.has("registre")) p.push(`Base des taux : ${baseDev()} ; pour la tenue des fiches, ${baseMaj()}. Point : son taux ; trait gris : sa marge à 95 % ; trait vertical : tout le département sur la même base. Le registre est déclaratif : il dit ce que le syndic a déclaré, et quand. Sa position parmi ses pairs est dans sa fiche.`);
    if (gs.has("justice")) p.push(`Taux pour 100 copropriétés gérées à Marseille aujourd'hui, toutes tailles. ${MENTION_J}`);
    return p.length ? p.join(" ") : "La liste dit qui gère déjà des copropriétés comme la vôtre ici. Elle ne dit rien de la qualité de cette gestion, ni de ses prix.";
  }
  function celPour100(k, n) {
    if (!n) return `<span class="sans">aucune copropriété en 2025</span>`;
    if (n < 10) return `<span class="val">${nb(k)} pour ${nb(n)}</span><span class="sous">trop peu pour un taux</span>`;
    return `<span class="val">${nb(Math.round((100 * k) / n))} pour 100</span><span class="sous">${nb(k)} ${accord(k, "arrivée", "arrivées")} pour ${nb(n)}</span>`;
  }
  // Un taux : la valeur, « k sur n », puis le point, sa marge à 95 % et le repère du département, sur l'échelle commune de la colonne.
  function celTaux(k, n, ref, mx) {
    if (!n) return `<span class="sans">aucune</span>`;
    if (n < 10) return `<span class="val">${nb(k)} sur ${nb(n)}</span><span class="sous">trop peu pour un pourcentage</span>`;
    const p = k / n, [b, h] = wilson(k, n), X = (v) => (100 * Math.min(v, mx)) / mx;
    return `<span class="val">${pctNb(k, n)} %</span><span class="sous">${nb(k)} sur ${nb(n)}</span><span class="piste taux">${ref != null ? `<span class="ref" style="left:${X(ref).toFixed(1)}%"></span>` : ""}<span class="marge" style="left:${X(b).toFixed(1)}%;width:${Math.max(0.8, X(h) - X(b)).toFixed(1)}%"></span><span class="pt" style="left:${X(p).toFixed(1)}%"></span></span>`;
  }
  function rendreChoixTri(cols) {
    for (const id of ["tri-choix", "tri-choix-g"]) {
      const sel = $(id);
      if (!cols) { sel.innerHTML = ""; sel.disabled = true; continue; }
      sel.disabled = false;
      const ok = cols.filter((x) => x.triable !== false), opt = (x) => `<option value="${x.id}"${x.id === etat.tri ? " selected" : ""}>${esc(x.titre)}</option>`;
      const prop = PROPOSES.map((p) => ok.find((x) => x.id === p)).filter(Boolean), autres = ok.filter((x) => !PROPOSES.includes(x.id));
      sel.innerHTML = `<optgroup label="Tris proposés">${prop.map(opt).join("")}</optgroup>` + (autres.length ? `<optgroup label="Autres colonnes">${autres.map(opt).join("")}</optgroup>` : "");
    }
  }
  function celPart(p) {
    const k = p[0], n = p[1];
    if (n < 10) return `<span class="val">${nb(k)} sur ${nb(n)}</span>`;
    return `<span class="val">${pctNb(k, n)} %</span><span class="sous">${nb(k)} sur ${nb(n)}</span><span class="piste"><span class="plein" style="width:${((100 * k) / n).toFixed(1)}%"></span></span>`;
  }
  function celEnc(e) {
    const c = ENC[e];
    if (!c) return `<span class="sans">${ENTS[e].ln > 0 ? "aucun salarié déclaré" : "lots en France non connus"}</span>`;
    return `<span class="val">entre ${lotsTxt(c.lo)} et ${lotsTxt(c.hi)}</span><span class="piste"><span class="seg-enc" style="left:${posLog(c.lo).toFixed(1)}%;width:${Math.max(0.8, posLog(c.hi) - posLog(c.lo)).toFixed(1)}%"></span></span>`;
  }
  function celBureau(r) {
    if (ENTS[r.e].ei) return `<span class="sans">adresse masquée</span>`;
    if (r.bk < 0) return `<span class="sans">non localisé</span>`;
    const b = BUR[r.bk];
    return (r.d != null ? `<span class="val">${distTxt(r.d)}</span>` : "") + `<span class="sous">${esc(b[5])}${b[4] ? " · siège" : ""}</span>`;
  }
  // Les listes montrent leurs premières lignes, puis « Tout afficher » ; la ligne choisie reste visible au-delà, après « … ».
  const LIM_TAB = 25;
  const boutonTout = (cle, n, lim) => (n <= lim ? "" : `<button type="button" class="lien plus" data-act="tout" data-v="${cle}" aria-expanded="${!!etat.tout[cle]}">${etat.tout[cle] ? "Réduire aux " + nb(lim) + " premiers" : "Tout afficher (" + nb(n) + ")"}</button>`);
  function premieres(L, cle, lim, sel) {
    if (etat.tout[cle] || L.length <= lim) return L;
    const t = L.slice(0, lim), hors = sel != null && !t.some((r) => r.e === sel) ? L.find((r) => r.e === sel) : null;
    return hors ? t.concat([null, hors]) : t;
  }
  function rendreTableau() {
    const tete = $("tab-tete"), corps = $("tab-corps"), vide = $("tab-vide");
    if (!R) {
      tete.innerHTML = ""; corps.innerHTML = ""; rendreChoixTri(null); $("groupes-col").hidden = true; $("modes-tab").hidden = true; $("tab-plus").innerHTML = "";
      $("choix-col").hidden = true; $("tab-bulle").hidden = true; $("tab-defs").hidden = true;
      vide.hidden = false; vide.textContent = etat.zone ? "Aucun des lieux choisis n'est chargé sur cette page : il n'y a pas de syndic à montrer." : "Aucun syndic n'est nommé avant le choix d'un lieu. Tapez-le : ceux qui y gèrent des copropriétés s'afficheront ici. Les chiffres sans nom sont dans « Ensemble ».";
      $("tab-legende").innerHTML = ""; $("tab-limite").hidden = true;
      return;
    }
    $("modes-tab").hidden = !AVEC_J;
    $("modes-tab").innerHTML = !AVEC_J ? "" : `<span class="trier">Lignes</span>` + puce("mode", "syndics", "Syndics", etat.modeTab === "syndics", "petite") + puce("mode", "decisions", "Décisions de justice", etat.modeTab === "decisions", "petite");
    if (AVEC_J && etat.modeTab === "decisions") return rendreDecisions();
    const cols = colonnes(), c = colCourante(cols), L = trier(R.liste, c, etat.sens);
    R.ordre = L;
    const vis = colonnesVisibles(cols);
    $("groupes-col").hidden = false;
    $("groupes-col").innerHTML = `<span class="trier">Colonnes</span>` + JEUX.map(([v, l]) => puce("groupe", v, l, etat.groupe === v, "petite")).join("") +
      (etat.perso ? puce("groupe", "perso", "Mes colonnes", etat.groupe === "perso", "petite") : "") +
      `<button type="button" class="lien petit" data-act="choix-col" aria-expanded="${etat.choixCol}" aria-controls="choix-col">${etat.choixCol ? "Fermer le choix des colonnes" : "Choisir et ordonner les colonnes"}</button>`;
    rendreChoixTri(cols);
    vide.hidden = L.length > 0;
    vide.textContent = R.tous.length && !L.length ? "Aucun syndic de la liste ne répond aux étiquettes posées : retirez-en une." : "Aucun syndic professionnel ne déclare de copropriété de ce type ici. Essayez la tranche voisine, ou un cercle plus large.";
    $("tab-limite").hidden = false;
    $("tab-limite").textContent = limiteGroupe();
    const maxIci = L.reduce((m, r) => Math.max(m, r.ici), 1);
    tete.innerHTML = "<tr>" + vis.map((x) => {
      const sous = x.taux ? `<span class="th-sous">échelle de 0 à ${nb(Math.round(100 * x.mx))} %</span>` : "";
      const tri = x.triable === false ? esc(x.titre) : `<button type="button" data-tri="${x.id}">${esc(x.titre)}</button>`;
      const aide = defCol(x) ? `<button type="button" class="aide-col" data-act="aide-col" data-v="${x.id}" aria-expanded="${etat.aideCol === x.id}" aria-controls="tab-bulle" aria-label="Ce que dit la colonne : ${esc(x.titre)}" title="${esc(defCol(x))}">?</button>` : "";
      return `<th scope="col"${x.id === c.id ? ` aria-sort="${etat.sens === "asc" ? "ascending" : "descending"}"` : ""}>${tri}${aide}${sous}</th>`;
    }).join("") + `<th scope="col"><span class="vh">Fiche</span></th></tr>`;
    corps.innerHTML = premieres(L, "tab", LIM_TAB, etat.sel).map((r) => {
      if (!r) return `<tr class="sep"><td colspan="${vis.length + 1}"><span class="sans">…</span></td></tr>`;
      const x = ENTS[r.e], on = etat.sel === r.e, etiq = [];
      if (x.ei) etiq.push("nom masqué");
      if (etat.copro != null && ENT[etat.copro] === r.e) etiq.push("votre syndic déclaré");
      let h = "";
      for (const k of vis) {
        let cel;
        if (k.id === "nom") cel = `<button type="button" class="nom" data-act="sel" data-e="${r.e}" aria-pressed="${on}">${esc(x.n)}</button>${x.f ? `<span class="forme">${esc(x.f)}</span>` : ""}${etiq.map((t) => `<span class="etiq">${t}</span>`).join("")}`;
        else if (k.id === "ici") cel = `<span class="val">${nb(r.ici)}</span><span class="piste"><span class="plein" style="width:${((100 * r.ici) / maxIci).toFixed(1)}%"></span></span>`;
        else if (k.taux) { const [a, n] = k.kn(r); cel = celTaux(a, n, k.ref, k.mx); }
        else cel = k.cel(r);
        h += `<td data-label="${esc(k.titre)}">${cel}</td>`;
      }
      h += `<td class="td-fiche"><button type="button" class="btn-fiche" data-act="fiche" data-e="${r.e}" aria-label="${esc(ENTS[r.e].ei ? "Fiche de l'entrepreneur individuel" : "Fiche de " + ENTS[r.e].n)}">Fiche</button></td>`;
      return `<tr data-e="${r.e}"${on ? ' class="choisi"' : ""}>${h}</tr>`;
    }).join("");
    $("tab-plus").innerHTML = boutonTout("tab", L.length, LIM_TAB);
    $("tab-legende").innerHTML = legendeTri(c);
    rendreBulle(vis); rendreChoixCol(cols, vis); rendreDefs(vis);
  }
  // La bulle d'un « ? » : la définition et ce qu'elle ne permet pas de conclure, au-dessus du tableau, où rien ne la coupe.
  function rendreBulle(vis) {
    const b = $("tab-bulle"), x = vis.find((k) => k.id === etat.aideCol);
    if (!x) { etat.aideCol = null; b.hidden = true; b.innerHTML = ""; return; }
    b.hidden = false;
    b.innerHTML = `<strong>${esc(x.titre)}</strong> : ${esc(defCol(x))}${limiteCol(x) ? ` <span class="sous">${esc(limiteCol(x))}</span>` : ""} <button type="button" class="lien petit" data-act="aide-col" data-v="${x.id}">Fermer</button>`;
  }
  // Le choix des colonnes : celles qui sont montrées, dans leur ordre, qu'on monte, descend ou retire ; puis celles qu'on peut ajouter, par groupe.
  function rendreChoixCol(cols, vis) {
    const p = $("choix-col");
    p.hidden = !etat.choixCol;
    if (!etat.choixCol) { p.innerHTML = ""; return; }
    const mob = vis.filter((x) => x.g), n = mob.length;
    const bouton = (act, x, lib, quoi, inerte) => `<button type="button" class="lien cc-bouton" data-act="${act}" data-v="${x.id}"${inerte ? ' aria-disabled="true"' : ""} aria-label="${quoi} : ${esc(x.titre)}">${lib}</button>`;
    const ligne = (x, k) => `<li><span class="cc-nom">${esc(x.titre)}</span><span class="cc-actions">${bouton("col-haut", x, "↑", "Monter", k === 0)}${bouton("col-bas", x, "↓", "Descendre", k === n - 1)}${bouton("col-retirer", x, "Retirer", "Retirer", false)}</span></li>`;
    const caches = cols.filter((x) => x.g && !mob.includes(x));
    const ajout = GROUPES.map(([g, l]) => { const a = caches.filter((x) => x.g === g); return a.length ? `<div class="cc-groupe"><span class="cc-titre">${esc(l)}</span>${a.map((x) => `<button type="button" class="puce petite" data-act="col-ajouter" data-v="${x.id}">+ ${esc(x.titre)}</button>`).join("")}</div>` : ""; }).join("");
    p.innerHTML = `<p class="cc-aide">« Syndic » et « ${esc(titreIci(false))} » restent en tête. Les autres se montent, se descendent ou se retirent ; toute retouche compose « Mes colonnes », que ce navigateur garde pour la prochaine visite.</p>` +
      (n ? `<ol class="cc-liste" aria-label="Colonnes montrées, dans l'ordre">${mob.map(ligne).join("")}</ol>` : `<p class="cc-aide">Aucune autre colonne n'est montrée.</p>`) +
      (ajout ? `<div class="cc-ajout"><span class="trier">Ajouter une colonne</span>${ajout}</div>` : "");
  }
  // Sous le tableau, les mêmes définitions en liste : la bulle aide, elle ne cache rien.
  function rendreDefs(vis) {
    const d = vis.filter((x) => defCol(x));
    $("tab-defs").hidden = !d.length;
    $("tab-defs-liste").innerHTML = d.map((x) => `<div><dt>${esc(x.titre)}</dt><dd>${esc(defCol(x))}${limiteCol(x) ? " " + esc(limiteCol(x)) : ""}</dd></div>`).join("");
  }
  // Le mode « Décisions » : les décisions du jeu de J qui nomment un syndic de la liste, une ligne par décision et par syndic ; colonnes fixes.
  function lignesDecisions() {
    const f = etat.filtreDec || {}, a = [];
    for (const r of R.liste) {
      if (ENTS[r.e].ei || (f.e != null && r.e !== f.e)) continue;
      const x = JUS.get(r.e);
      if (!x) continue;
      for (const d of x.d) if (Object.keys(f).every((k) => FILTRES_DEC[k].passe(d, f[k]))) a.push({ e: r.e, d });
    }
    return a.sort((p, q) => (p.d[0] < q.d[0] ? 1 : p.d[0] > q.d[0] ? -1 : parNom(p, q)));
  }
  function rendreDecisions() {
    const tete = $("tab-tete"), corps = $("tab-corps"), vide = $("tab-vide");
    $("groupes-col").hidden = true; $("choix-col").hidden = true; $("tab-bulle").hidden = true; $("tab-defs").hidden = true;
    rendreChoixTri(null);
    const L = lignesDecisions(), vis = etat.tout.dec ? L : L.slice(0, LIM_TAB);
    tete.innerHTML = `<tr>${["Date", "Juridiction", "Objet", "Issue", "Syndic", "Son rôle", "Décision"].map((t) => `<th scope="col">${t}</th>`).join("")}</tr>`;
    corps.innerHTML = vis.map(({ e, d }) => {
      const [date, jur, deg, obj, iss, role, bits, cond, lien] = d;
      const dr = JM.drap.filter((t, k) => bits & (1 << k));
      if (cond === 2) dr.push("dépens ou frais seuls");
      return `<tr data-e="${e}"${e === etat.sel ? ' class="choisi"' : ""}><td data-label="Date">${dateFr(date)}</td><td data-label="Juridiction">${esc(JM.jur[jur])}<span class="sous">${deg ? "appel" : "première instance"}</span></td><td data-label="Objet">${esc(JM.obj[obj])}</td><td data-label="Issue">${esc(JM.iss[iss])}${dr.length ? `<span class="sous">${dr.map((t) => `<span class="etiq">${esc(t)}</span>`).join("")}</span>` : ""}</td><td data-label="Syndic"><button type="button" class="nom" data-act="sel" data-e="${e}" aria-pressed="${e === etat.sel}">${esc(ENTS[e].n)}</button></td><td data-label="Son rôle">${esc(JM.role[role])}</td><td data-label="Décision">${lien ? `<a class="lien-dec" href="${JM.prefixe}${lien}" target="_blank" rel="noopener noreferrer">Lire sur Judilibre</a>` : `<span class="sans">lien absent</span>`}</td></tr>`;
    }).join("");
    vide.hidden = L.length > 0;
    vide.textContent = "Aucune décision du jeu ne répond à ces critères pour les syndics de la liste.";
    $("tab-plus").innerHTML = boutonTout("dec", L.length, LIM_TAB);
    const n = new Set(L.map((x) => x.e)).size;
    $("tab-legende").innerHTML = `<strong>${nb(L.length)} ${accord(L.length, "ligne", "lignes")}</strong>, pour ${nb(n)} ${accord(n, "syndic", "syndics")} de la liste, de la plus récente à la plus ancienne. Une décision qui nomme deux syndics de la liste y figure deux fois. Dans ce mode, les colonnes sont fixes.`;
    $("tab-limite").hidden = false;
    $("tab-limite").textContent = `Une décision frappée d'appel a pu être réformée depuis : chacune se lit avec sa date et son degré. ${MENTION_J}`;
  }
  function ligneBarre(r, val, max, txt) {
    return `<button type="button" class="g-ligne${r.e === etat.sel ? " choisi" : ""}" data-act="sel" data-e="${r.e}"><span class="g-nom" title="${esc(ENTS[r.e].n)}">${esc(ENTS[r.e].n)}</span><span class="g-piste"><span class="g-plein" style="width:${((100 * val) / max).toFixed(1)}%"></span></span><span class="g-val">${txt}</span></button>`;
  }
  const ligneFixe = (lib, n, max, on) => `<div class="g-ligne g-fixe${on ? " choisi" : ""}"><span class="g-nom">${esc(lib)}</span><span class="g-piste"><span class="g-plein" style="width:${((100 * n) / Math.max(1, max)).toFixed(1)}%"></span></span><span class="g-val">${nb(n)}</span></div>`;
  // ---------- Graphiques : les seuls syndics de la liste, nommés. Les chiffres sans nom vont dans « Ensemble ».
  function rendreGraphiques() {
    const el = $("graph-corps");
    $("graph-bulle").hidden = true;
    if (!R) { el.innerHTML = etat.zone ? `<p class="vide">Aucun des lieux choisis n'est chargé sur cette page : il n'y a pas de graphique à montrer.</p>` : `<p class="vide">Les graphiques de cet onglet nomment les syndics : choisissez d'abord un lieu. Les chiffres sans nom sont dans l'onglet « Ensemble ».</p>`; return; }
    const cols = colonnes(), c = colCourante(cols), L = trier(R.liste, c, etat.sens), LIM = 15;
    if (!L.length) { el.innerHTML = `<p class="vide">Aucun syndic à représenter.</p>`; return; }
    const lignes = premieres(L, "g1", LIM, etat.sel);
    const quoi = etat.tout.g1 || L.length <= LIM ? "Dans l'ordre du tableau." : `Dans l'ordre du tableau : les ${LIM} premiers sur ${nb(L.length)}.`;
    // La forme se choisit au-dessus du graphique ; la première est la forme proposée pour cet indicateur.
    const formes = [["proposee", c.taux ? "Points et marges" : c.id === "enc" ? "Fourchettes" : "Barres"]].concat(c.taux ? [["barres", "Barres"]] : [], [["tableau", "Tableau"], ["nuage", "Nuage de points"]], c.taux ? [["bande", "Bande des pairs"]] : []);
    if (!formes.some(([v]) => v === etat.forme)) etat.forme = "proposee";
    let h = `<div class="formes" role="group" aria-label="Forme du graphique"><span class="trier">Forme</span>${formes.map(([v, l]) => puce("forme", v, l, etat.forme === v, "petite")).join("")}${etat.forme === "nuage" ? choixAxeY(c) + puce("noms", "1", "Noms des syndics", etat.noms, "petite") : ""}</div>`;
    const plus = (s) => s.replace(/<\/div>$/, boutonTout("g1", L.length, LIM) + "</div>");
    if (etat.forme === "tableau") h += plus(tableauDuTri(c, lignes, quoi));
    else if (etat.forme === "nuage") h += nuage(c, L);
    else if (etat.forme === "bande") h += bandePairs(c, L);
    else h += plus(grapheDuTri(c, lignes, L, quoi, etat.forme === "barres"));
    h += (AVEC_J ? grilleDecisions(L) : "") + (AV ? reseauAvocats(L) : "");
    el.innerHTML = h;
  }
  // Les grandeurs d'un nuage de points : une valeur par syndic (ou null sous une base de 10), son échelle et ses graduations.
  const num1 = (x) => (Math.abs(x - Math.round(x)) < 1e-6 ? nb(Math.round(x)) : f1.format(x));
  function grandeurs() {
    const { S, T } = devCourant(), g = {}, compte = (v) => nb(Math.round(v)), cop = (v) => nb(v) + " " + accord(v, "copropriété", "copropriétés");
    g.ici = { lib: titreIci(true), v: (r) => r.ici, ech: "racine", fmt: cop, tic: compte };
    g.taille = { lib: "Taille du syndic dans le département", v: (r) => TOUT_DEPT[r.e], ech: "racine", fmt: cop, tic: compte };
    if (etat.tf >= 0) g.part = { lib: "Part de son portefeuille dans le département", v: (r) => (r.part[1] >= 10 ? r.part[0] / r.part[1] : null), ech: "lin", fmt: pctF, tic: pctF };
    g.enc = { lib: "Lots par salarié déclaré, milieu de la fourchette", v: (r) => (ENC[r.e] ? ENC[r.e].mid : null), ech: "log", fmt: lotsTxt, tic: compte };
    if (R && R.ref) g.dist = { lib: "Bureau le plus proche", v: (r) => r.d, ech: "lin", fmt: distTxt, tic: (v) => num1(v / 1000) + " km" };
    g.n0 = { lib: "Ses copropriétés de 2025", v: (r) => S.n0[r.e], ech: "racine", fmt: cop, tic: compte };
    for (const id of ["i1", "i2", "i3", "i4", "i6"]) { const I = IND[id]; g[id] = { lib: I.titre, v: (r) => (S[I.n][r.e] >= 10 ? S[I.k][r.e] / S[I.n][r.e] : null), ech: "lin", fmt: pctF, tic: pctF, ref: T[I.n] ? T[I.k] / T[I.n] : null }; }
    g.i5 = { lib: IND.i5.titre + ", pour 100 de ses copropriétés de 2025", v: (r) => (S.n0[r.e] >= 10 ? S.arrV[r.e] / S.n0[r.e] : null), ech: "lin", fmt: (v) => nb(Math.round(100 * v)) + " pour 100", tic: (v) => num1(100 * v), ref: T.n0 ? T.arrV / T.n0 : null };
    g.i7 = { lib: IND.i7.titre, v: (r) => S.finK[r.e], ech: "racine", fmt: compte, tic: compte };
    // la justice ne se lit qu'à Marseille : ces axes ne sont offerts que si la liste y gère des copropriétés
    g.jbase = { lib: "Copropriétés gérées à Marseille", v: (r) => BASE_MARS[r.e], ech: "racine", fmt: cop, tic: compte, marseille: true };
    for (const id of ["j3", "j1", "j2"]) g[id] = { lib: JIND[id].titre + ", pour 100 copropriétés gérées à Marseille", v: (r) => { const k = jCompte(r.e, id), n = BASE_MARS[r.e]; return k == null || n < 10 ? null : k / n; }, ech: "lin", fmt: (v) => f1.format(100 * v) + " pour 100", tic: (v) => num1(100 * v), marseille: true };
    return g;
  }
  // Une échelle : linéaire (taux, distances), racine carrée (comptes, très étalés) ou logarithmique (lots par salarié) ; des graduations rondes.
  const pas = (v, n) => { const brut = v / n, e = 10 ** Math.floor(Math.log10(brut)), f = brut / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  function echelle(g, vals, a, b) {
    const max = Math.max(g.ref || 0, ...vals);
    if (g.ech === "log") {
      const lo = Math.floor(Math.log10(Math.max(0.1, Math.min(...vals)))), hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(0.1, max))));
      const ticks = [];
      for (let k = lo; k <= hi; k++) ticks.push(10 ** k);
      return { p: (v) => a + ((Math.log10(Math.max(10 ** lo, v)) - lo) / (hi - lo)) * (b - a), ticks };
    }
    // en racine carrée, les graduations sont des carrés : régulières à l'œil (0, 25, 100, 225…)
    const rac = g.ech === "racine", M = (rac ? Math.sqrt(max) : max) || 1, s = pas(M, 4), haut = Math.ceil(M / s - 1e-9) * s, ticks = [];
    for (let k = 0; k * s <= haut + 1e-9; k++) ticks.push(rac ? (k * s) ** 2 : k * s);
    return { p: (v) => a + (Math.min(rac ? Math.sqrt(Math.max(0, v)) : Math.max(0, v), haut) / haut) * (b - a), ticks };
  }
  function choixAxeY(c) {
    const G = grandeurs(), idX = G[c.id] ? c.id : "ici", mars = R.liste.some((r) => BASE_MARS[r.e] >= 10);
    const offerts = Object.keys(G).filter((id) => id !== idX && (mars || !G[id].marseille));
    if (!offerts.includes(etat.nuageY)) etat.nuageY = offerts.includes("taille") ? "taille" : offerts[0];
    return `<label class="trier" for="nuage-y">Axe vertical <select id="nuage-y">${offerts.map((id) => `<option value="${id}"${id === etat.nuageY ? " selected" : ""}>${esc(G[id].lib)}</option>`).join("")}</select></label>`;
  }
  let largeurNuage = 0;
  // La forme « Nuage de points » : l'indicateur du tri en abscisse, un autre au choix en ordonnée ; un point par syndic de la liste.
  // Seul le syndic choisi porte son nom ; les autres le donnent au survol, et la forme « Tableau » les donne tous.
  function nuage(c, L) {
    const G = grandeurs(), idX = G[c.id] ? c.id : "ici", gx = G[idX], gy = G[etat.nuageY] || G.taille;
    const pts = [];
    for (const r of L) { const x = gx.v(r), y = gy.v(r); if (x != null && y != null && isFinite(x) && isFinite(y) && (gx.ech !== "log" || x > 0) && (gy.ech !== "log" || y > 0)) pts.push({ r, x, y }); }
    const manque = L.length - pts.length, echs = [gx.ech, gy.ech];
    let h = `<div class="graph"><h3 id="nuage-titre">${esc(gy.lib)}, selon ${esc(minuscule(gx.lib))}</h3>`;
    h += `<p class="sous-titre" id="nuage-desc">Un point par syndic de la liste : ${nb(pts.length)} sur ${nb(L.length)}${manque ? ` ; ${nb(manque)} ${accord(manque, "n'a", "n'ont")} pas de valeur sur l'un des deux axes (base sous 10, ou valeur absente)` : ""}. En abscisse, l'indicateur du tri ; en ordonnée, celui que vous choisissez. ${gx.ref != null || gy.ref != null ? "Tirets : tout le département sur la même base. " : ""}${echs.includes("racine") ? "Les comptes sont sur une échelle en racine carrée, qui sépare les petits sans écraser les grands. " : ""}${echs.includes("log") ? "Les lots par salarié sont sur une échelle logarithmique. " : ""}Un point choisit son syndic ; la forme « Tableau » donne les valeurs.</p>`;
    if (!pts.length) return h + `<p class="vide">Aucun syndic de la liste n'a de valeur sur les deux axes.</p></div>`;
    // le dessin prend la largeur de son cadre : ses textes gardent leur taille, sur un téléphone comme sur un grand écran
    const cw = $("graph-corps").clientWidth || 0;
    largeurNuage = cw;
    const W = Math.round(Math.max(300, Math.min(960, cw || 640))), H = Math.round(Math.max(260, Math.min(400, W * 0.62))), m = { g: 62, d: 14, h: 14, b: 50 };
    const sx = echelle(gx, pts.map((p) => p.x), m.g, W - m.d), sy = echelle(gy, pts.map((p) => p.y), H - m.b, m.h);
    let s = `<svg class="nuage" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="nuage-titre nuage-desc">`;
    for (const t of sx.ticks) { const x = sx.p(t).toFixed(1); s += `<line class="n-grille" x1="${x}" x2="${x}" y1="${m.h}" y2="${H - m.b}"/><text class="n-tic" x="${x}" y="${H - m.b + 16}" text-anchor="middle">${esc(gx.tic(t))}</text>`; }
    for (const t of sy.ticks) { const y = sy.p(t); s += `<line class="n-grille" x1="${m.g}" x2="${W - m.d}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="n-tic" x="${m.g - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(gy.tic(t))}</text>`; }
    if (gx.ref != null) { const x = sx.p(gx.ref).toFixed(1); s += `<line class="n-ref" x1="${x}" x2="${x}" y1="${m.h}" y2="${H - m.b}"/>`; }
    if (gy.ref != null) { const y = sy.p(gy.ref).toFixed(1); s += `<line class="n-ref" x1="${m.g}" x2="${W - m.d}" y1="${y}" y2="${y}"/>`; }
    s += `<text class="n-axe" x="${((m.g + W - m.d) / 2).toFixed(0)}" y="${H - 12}" text-anchor="middle">${esc(court(gx.lib, Math.floor((W - m.g - m.d) / 6.4)))}</text>`;
    s += `<text class="n-axe" transform="translate(16 ${((m.h + H - m.b) / 2).toFixed(0)}) rotate(-90)" text-anchor="middle">${esc(court(gy.lib, Math.floor((H - m.h - m.b) / 6.4)))}</text>`;
    let etiq = "";
    // le syndic choisi passe en dernier, au-dessus des autres
    for (const p of pts.slice().sort((a, b) => (a.r.e === etat.sel) - (b.r.e === etat.sel))) {
      const on = p.r.e === etat.sel, X = sx.p(p.x), Y = sy.p(p.y);
      const bulle = ENTS[p.r.e].n + "\n" + gx.lib + " : " + gx.fmt(p.x) + "\n" + gy.lib + " : " + gy.fmt(p.y);
      s += `<g class="n-pt${on ? " choisi" : ""}" data-act="sel" data-e="${p.r.e}" data-bulle="${esc(bulle)}"><circle class="n-cible" cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="14"/><circle class="n-point" cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${on ? 6.5 : 4.5}"/></g>`;
      if (on) { const gauche = X > W * 0.62; etiq = `<text class="n-etiq" x="${(gauche ? X - 10 : X + 10).toFixed(1)}" y="${(Y < m.h + 20 ? Y + 20 : Y - 9).toFixed(1)}" text-anchor="${gauche ? "end" : "start"}">${esc(court(ENTS[p.r.e].n, 30))}</text>`; }
    }
    if (!etat.noms) return h + `<div class="defile-x">${s}${etiq}</svg></div></div>`;
    // « Noms des syndics » : un nom par point tant qu'il ne chevauche ni un autre nom, ni un point, ni le bord ; le choisi d'abord,
    // puis du syndic qui a le plus de copropriétés ici au plus petit. Les autres restent dans la bulle du point.
    const boites = pts.map((p) => { const X = sx.p(p.x), Y = sy.p(p.y); return [X - 5, Y - 5, X + 5, Y + 5]; });
    const libre = (b) => b[0] >= 2 && b[2] <= W - 2 && b[1] >= m.h - 12 && b[3] <= H - m.b && !boites.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
    let poses = 0;
    etiq = "";
    for (const p of pts.slice().sort((a, b) => (b.r.e === etat.sel) - (a.r.e === etat.sel) || b.r.ici - a.r.ici || parNom(a.r, b.r))) {
      const on = p.r.e === etat.sel, nom = court(ENTS[p.r.e].n, on ? 30 : 24), X = sx.p(p.x), Y = sy.p(p.y), w = nom.length * (on ? 7.2 : 6.4) + 2;
      // à droite du point, à gauche, au-dessus, au-dessous
      for (const [x, y, ta] of [[X + 9, Y + 4, "start"], [X - 9, Y + 4, "end"], [X, Y - 10, "middle"], [X, Y + 18, "middle"]]) {
        const x1 = ta === "start" ? x : ta === "end" ? x - w : x - w / 2, b = [x1, y - 11, x1 + w, y + 3];
        if (!libre(b)) continue;
        boites.push(b); poses++;
        etiq += `<text class="n-etiq${on ? "" : " n-nom"}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${ta}">${esc(nom)}</text>`;
        break;
      }
    }
    const reste = pts.length - poses;
    return h + `<div class="defile-x">${s}${etiq}</svg></div><p class="sous-titre">Noms : ${nb(poses)} sur ${nb(pts.length)} ${accord(pts.length, "point", "points")}${reste ? ` ; ${accord(reste, "l'autre se chevaucherait", "les autres se chevaucheraient")} : la bulle d'un point le nomme` : ""}.</p></div>`;
  }
  // La forme « Tableau » : les valeurs du graphique, ligne à ligne et dans le même ordre ; le jumeau lisible sans le dessin.
  function tableauDuTri(c, lignes, quoi) {
    let titre, tetes, det, note = "", limite = "";
    if (c.taux) {
      const I = IND[c.id];
      titre = I.titre; tetes = ["Taux", "Base", "Marge à 95 %"]; limite = I.limite;
      note = ` Base : ${c.id === "i6" ? baseMaj() : baseDev()}. Tout le département sur la même base : ${c.ref != null ? pctF(c.ref) : "—"}.`;
      det = (r) => { const [k, n] = c.kn(r); if (n < 10) return [n ? nb(k) + " sur " + nb(n) : "aucune base", n ? "sous 10 : pas de taux" : "", ""]; const [b, hh] = wilson(k, n); return [pctNb(k, n) + " %", nb(k) + " sur " + nb(n), "de " + pctF(b) + " à " + pctF(hh)]; };
    } else if (c.justice) {
      titre = JIND[c.id].titre + ", pour 100 copropriétés gérées à Marseille"; tetes = ["Pour 100", "Décisions", "Copropriétés à Marseille"]; limite = JIND[c.id].limite;
      det = (r) => { const k = jCompte(r.e, c.id), n = BASE_MARS[r.e]; if (k == null) return ["non renseigné", "", ""]; if (!k && !n) return ["hors du périmètre lu", "", ""]; return [n >= 10 ? f1.format((100 * k) / n) : "sous 10 : pas de taux", nb(k), nb(n)]; };
    } else if (c.id === "enc") {
      titre = "Lots par salarié déclaré"; tetes = ["Fourchette", "Milieu"];
      note = " Fourchette tirée de la tranche d'effectif de 2024 et des lots gérés en France.";
      det = (r) => { const x = ENC[r.e]; return x ? ["de " + lotsTxt(x.lo) + " à " + lotsTxt(x.hi), lotsTxt(x.mid)] : [ENTS[r.e].ln > 0 ? "aucun salarié déclaré" : "lots en France non connus", ""]; };
    } else {
      const [, txt, t, n] = defBarres(c);
      titre = t.replace(/, par syndic$/, ""); tetes = ["Valeur"]; det = (r) => [txt(r)]; note = n ? " " + n : "";
    }
    let h = `<div class="graph"><h3>${esc(titre)}, par syndic, en tableau</h3><p class="sous-titre">${esc(quoi + note)}</p>`;
    h += `<div class="defile-x"><table class="matrice"><thead><tr><th scope="col">Syndic</th>${tetes.map((t) => `<th scope="col">${esc(t)}</th>`).join("")}</tr></thead><tbody>`;
    h += lignes.map((r) => {
      if (!r) return `<tr><td colspan="${tetes.length + 1}"><span class="sans">…</span></td></tr>`;
      return `<tr${r.e === etat.sel ? ' class="choisi"' : ""}><th scope="row"><button type="button" class="nom" data-act="sel" data-e="${r.e}" aria-pressed="${r.e === etat.sel}">${esc(ENTS[r.e].n)}</button></th>${det(r).map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`;
    }).join("");
    return h + `</tbody></table></div>${limite ? `<p class="limite">${esc(limite)}</p>` : ""}${c.justice ? `<p class="source">${esc(MENTION_J)}</p>` : ""}</div>`;
  }
  // La forme « Bande des pairs » : pour chaque taille de syndic, la moitié centrale de ses pairs du département et leur médiane ;
  // les syndics de la liste en points, sur la même échelle. Ni rang ni note.
  function bandePairs(c, L) {
    const { S } = devCourant(), I = IND[c.id], P4 = [0, 1, 2, 3].map((k) => pairsDeClasse(k, c.id, S));
    const taux = (r) => (S[I.n][r.e] >= 10 ? S[I.k][r.e] / S[I.n][r.e] : null);
    const mx = ech(Math.max(c.mx || 0, ...P4.map((P) => (P && !P.insuffisant ? P.q3 : 0)), ...L.map((r) => taux(r) || 0)));
    const X = (v) => (100 * Math.min(v, mx)) / mx;
    let h = `<div class="graph g-large g-bandes"><h3>${esc(I.titre)} : les syndics de la liste parmi leurs pairs</h3><p class="sous-titre">Pour chaque taille de syndic, la bande grise couvre la moitié centrale de ses pairs du département, du premier au troisième quartile ; le trait foncé marque leur médiane, le trait fin tout le département. Les points sont les syndics de la liste dont la base atteint 10. Les pairs : les syndics de cette taille dont la base atteint 10 ; sous 10 pairs, la classe voisine s'ajoute. Base : ${esc(c.id === "i6" ? baseMaj() : baseDev())}.</p>`;
    for (let k = 0; k < 4; k++) {
      const P = P4[k], miens = L.filter((r) => classeTaille(TOUT_DEPT[r.e]) === k && taux(r) != null), ok = P && !P.insuffisant;
      let dessin = c.ref != null ? `<span class="g-ref" style="left:${X(c.ref).toFixed(2)}%"></span>` : "";
      if (ok) dessin += `<span class="g-bande" style="left:${X(P.q1).toFixed(2)}%;width:${Math.max(0.6, X(P.q3) - X(P.q1)).toFixed(2)}%"></span><span class="g-med" style="left:${X(P.med).toFixed(2)}%"></span>`;
      dessin += miens.map((r, j) => { const lib = ENTS[r.e].n + " : " + pctNb(S[I.k][r.e], S[I.n][r.e]) + " %"; return `<button type="button" class="g-pt-b${r.e === etat.sel ? " choisi" : ""}" data-act="sel" data-e="${r.e}" style="left:${X(taux(r)).toFixed(2)}%;top:${18 + ((j * 37) % 64)}%" aria-label="${esc(lib)}" aria-pressed="${r.e === etat.sel}" data-bulle="${esc(lib)}"><i></i></button>`; }).join("");
      const note = (ok ? nb(P.v.length) + " pairs" + (P.elargi ? ", classe élargie" : "") : "trop peu de pairs") + " · " + nb(miens.length) + " de la liste";
      h += `<div class="g-ligne g-fixe g-bande-ligne"><span class="g-nom">${esc(LIB_CLASSE[k])}<span class="sous">${esc(note)}</span></span><span class="g-piste">${dessin}</span><span class="g-val">${ok ? esc(pctF(P.med)) + `<span class="sous">médiane</span>` : "—"}</span></div>`;
    }
    h += axeTaux(mx);
    const r = etat.sel != null ? L.find((y) => y.e === etat.sel) : null;
    if (r) { const ph = position(S[I.k][r.e], S[I.n][r.e], pairs(r.e, c.id, S)); h += `<p class="sous-titre"><strong>${esc(ENTS[r.e].n)}</strong> : ${esc(minuscule(ph))}${ph.endsWith(".") ? "" : "."}</p>`; }
    return h + `<p class="limite">${esc(I.limite)} La bande ne classe personne : sur une petite base, sortir de la moitié centrale peut venir du hasard.</p></div>`;
  }

  // ---------- Ensemble : des comptes, aucun nom. Chaque barre est un bouton : elle ouvre la vue nominative qu'elle compte.
  const barreClic = (act, v, lib, n, max, txt, on, aide) => `<button type="button" class="g-ligne g-fixe g-clic${on ? " choisi" : ""}" data-act="${act}" data-v="${esc(v)}"${aide ? ` title="${esc(aide)}"` : ""}><span class="g-nom">${esc(lib)}</span><span class="g-piste"><span class="g-plein" style="width:${((100 * n) / Math.max(1, max)).toFixed(1)}%"></span></span><span class="g-val">${txt}</span></button>`;
  const carteG = (titre, sous, corps, source, fin) => `<div class="carte-g"><h4>${esc(titre)}</h4><p class="sous-titre">${sous}</p>${corps}${fin || ""}<p class="source">${source}</p></div>`;
  const srcRegistre = () => `Registre des copropriétés, fichier du ${dateFr(M.fichier)}.`;
  const srcEntreprises = () => `Répertoire des entreprises : consulté le ${dateFr(M.repertoire)} ; effectifs de 2024. Copropriétés en France : registre, fichier du ${dateFr(M.fichier)}.`;
  function rendreEnsemble() {
    const X = R || rDept(), ou = R ? esc(cap(iciTxt())) : "Dans le département";
    let h = `<p class="aide">Aucun nom dans cet onglet. ${R ? "Les chiffres portent sur le lieu choisi, sauf mention contraire." : "Sans lieu choisi, ils portent sur tout le département."} Une barre, une case ou une tuile ouvre, au tableau ou sur la carte, les syndics ou les décisions qu'elle compte.</p>`;
    h += blocMarche(X, ou) + blocDevenir() + (PUBLIC ? "" : blocEvolution()) + blocTenue() + blocSocietes(X, ou) + blocJusticeEns() + (DL ? blocDelais() : "");
    $("ens-corps").innerHTML = h;
  }
  function blocMarche(X, ou) {
    const mx = Math.max(...SYN_PAR_CLASSE), v = X.pool, mp = Math.max(1, ...v);
    let h = `<section class="ens-bloc" aria-labelledby="ens-marche"><h3 id="ens-marche">Le marché des syndics</h3><div class="ens-grille">`;
    // Le vivier : il se lit au département, le marché d'un syndic.
    h += carteG("Syndics professionnels du département, par taille du syndic", `Taille : nombre de copropriétés qu'il gère dans le département. ${nb(NB_SYN_DEPT)} syndics en tout ; le vivier se lit au département, quel que soit le lieu. Une barre ouvre les syndics de cette taille ${R ? esc(iciTxt()) : "dans tout le département"}.`,
      SYN_PAR_CLASSE.map((n, c) => barreClic("voir-classe", c, LIB_CLASSE[c], n, mx, nb(n), etat.filtres.classe === c)).join(""), srcRegistre());
    h += carteG("Combien de syndics professionnels gèrent une copropriété de chaque taille", `${ou} : nombre de syndics qui gèrent au moins une copropriété de la tranche ; une société compte dans chaque tranche où elle en gère une.${etat.constr >= 0 ? " Toutes constructions confondues." : ""} Une barre règle la jauge sur sa tranche et ouvre la liste.`,
      TRANCHES.map((t, k) => barreClic("voir-tranche", k, libTranche(k), v[k], mp, nb(v[k]), k === etat.tf)).join(""), srcRegistre());
    h += carteConcentration(X, ou) + carteTypes(X, ou);
    return h + `</div></section>`;
  }
  function carteConcentration(X, ou) {
    const v = X.tous.map((r) => r.ici).sort((a, b) => b - a), tot = v.reduce((s, x) => s + x, 0);
    if (!tot) return "";
    const cum = [];
    v.reduce((s, x, k) => (cum[k] = s + x), 0);
    const moitie = cum.findIndex((s) => s >= tot / 2) + 1;
    const t = [5, 10].filter((k) => v.length > k).map((k) => `<button type="button" class="tuile" data-act="voir-top" data-v="${k}"><strong>${pctNb(cum[k - 1], tot)} %</strong><span>des copropriétés à syndic professionnel, gérées par les ${k} syndics les plus présents</span></button>`);
    t.push(`<button type="button" class="tuile" data-act="voir-top" data-v="${moitie}"><strong>${nb(moitie)} sur ${nb(v.length)}</strong><span>${moitie >= 2 ? "syndics gèrent à eux seuls" : "syndic gère à lui seul"} la moitié de ces copropriétés</span></button>`);
    const crit = etat.tf >= 0 || etat.constr >= 0 ? " retenues par la jauge et la construction" : "";
    return carteG("La concentration", `${ou} : ${nb(tot)} copropriétés${crit} déclarent un syndic professionnel ; ${nb(v.length)} syndics se les partagent. Une tuile ouvre ces syndics au tableau, du plus présent au moins présent.`, `<div class="tuiles">${t.join("")}</div>`, srcRegistre(), `<p class="limite">Être très présent ne dit rien de la qualité d'un syndic, ni de ses prix.</p>`);
  }
  const LIB_TYPES = ["Syndic professionnel", "Syndic bénévole", "Aucun syndic déclaré, ou type inconnu", "Syndic professionnel sans SIRET"];
  function typesParTranche(X) {
    const t = TRANCHES.map(() => [0, 0, 0, 0]);
    const voir = (i) => { if (TF[i] < 0 || (etat.constr >= 0 && CLASSE[i] !== etat.constr)) return; const e = ENT[i]; t[TF[i]][e >= 0 ? 0 : e === -1 ? 1 : e === -4 ? 3 : 2]++; };
    if (X.rows) for (const i of X.rows) voir(i); else for (let i = 0; i < N; i++) voir(i);
    return t;
  }
  function carteTypes(X, ou) {
    const t = typesParTranche(X);
    const lignes = TRANCHES.map((tr, k) => {
      const n = t[k].reduce((a, b) => a + b, 0);
      return barreClic("voir-type", k, libTranche(k), n ? t[k][0] : 0, n, n ? pctNb(t[k][0], n) + " %" : "—", k === etat.tf, LIB_TYPES.map((l, j) => l + " : " + nb(t[k][j])).join(" · "));
    }).join("");
    const tab = `<details class="jumeau"><summary>Les quatre types, en tableau</summary><div class="defile-x"><table class="matrice"><thead><tr><th scope="col">Tranche</th>${LIB_TYPES.map((l) => `<th scope="col">${esc(l)}</th>`).join("")}</tr></thead><tbody>${TRANCHES.map((tr, k) => `<tr><th scope="row">${esc(libTranche(k))}</th>${t[k].map((x) => `<td>${nb(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
    return carteG("Part des copropriétés qui déclarent un syndic professionnel, par tranche de lots", `${ou}${etat.constr >= 0 ? ", " + esc(construitesTxt(etat.constr, 2)) : ""}. Barre : la part de la tranche, sur 100 %. Une barre ouvre la carte de ces copropriétés.`, lignes, srcRegistre() + " Le type est celui que déclare la fiche.", tab);
  }
  // Le devenir des copropriétés d'un syndic professionnel, par taille du syndic d'aujourd'hui : au département, sur la même base que les indicateurs.
  const ISSUES = [["rest", "Toujours chez lui", "i1"], ["grp", "Passées dans le même groupe", null], ["conc", "Passées à un autre syndic professionnel", "i2"],
    ["nonPro", "Déclarées bénévoles, sans SIRET ou de type inconnu", null], ["exp", "Mandat expiré sans successeur déclaré", "i3"], ["pasM", "« Pas de mandat en cours »", "i4"], ["abs", "Absentes du fichier d'aujourd'hui", null]];
  // Une somme par taille du syndic ; la cinquième case : les syndics de 2025 qui ne gèrent plus aucune copropriété aujourd'hui.
  function parClasse(S, champs) {
    const a = [0, 1, 2, 3, 4].map(() => Object.fromEntries(champs.map((k) => [k, 0])));
    for (let e = 0; e < NE; e++) { const c = classeTaille(TOUT_DEPT[e]), j = c < 0 ? 4 : c; for (const k of champs) a[j][k] += S[k][e]; }
    return a;
  }
  const baseDevEns = () => "les copropriétés du département" + critDevTxt() + " qui déclaraient un syndic professionnel au 3e trimestre 2025 (" + dateFr(M.t3) + "), et ce qu'en dit le registre au " + dateFr(M.fichier);
  function blocDevenir() {
    const { S, T } = devCourant(), a = parClasse(S, ["n0"].concat(ISSUES.map((x) => x[0])));
    const cols = [["Tous les syndics", T, -1]].concat(LIB_CLASSE.map((l, c) => [l, a[c], c]));
    if (a[4].n0) cols.push(["Ne gèrent plus aucune copropriété", a[4], -2]);
    const cel = (k, b, c, id) => {
      const n = b.n0, v = b[k];
      if (!n) return `<td><span class="sans">—</span></td>`;
      const lib = `${n >= 10 ? pctNb(v, n) + " %" : nb(v) + " sur " + nb(n)}<span class="sous">${nb(v)} sur ${nb(n)}</span>${n >= 10 ? `<span class="niv"><i style="width:${((100 * v) / n).toFixed(1)}%"></i></span>` : ""}`;
      return id && c > -2 ? `<td><button type="button" data-act="voir-dev" data-v="${id}:${c}">${lib}</button></td>` : `<td>${lib}</td>`;
    };
    const corps = `<div class="defile-x"><table class="matrice"><thead><tr><th scope="col">Au registre aujourd'hui</th>${cols.map((x) => `<th scope="col">${esc(x[0])}</th>`).join("")}</tr></thead><tbody>`
      + ISSUES.map(([k, lib, id]) => `<tr><th scope="row">${esc(lib)}</th>${cols.map((x) => cel(k, x[1], x[2], id)).join("")}</tr>`).join("")
      + `<tr><th scope="row">Base : copropriétés suivies</th>${cols.map((x) => `<td>${nb(x[1].n0)}</td>`).join("")}</tr></tbody></table></div>`;
    return `<section class="ens-bloc" aria-labelledby="ens-devenir"><h3 id="ens-devenir">Le devenir des mandats</h3>` + carteG("Ce que sont devenues, au registre, les copropriétés d'un syndic professionnel",
      `Base : ${esc(baseDevEns())}. Colonnes : la taille du syndic d'aujourd'hui dans le département. Période : du 3e trimestre 2025 à aujourd'hui ; les autres périodes attendent l'historique du registre. Une case ouvre au tableau les syndics de cette taille, triés sur l'indicateur de la ligne.`,
      corps, `Registre des copropriétés : fichier du 3e trimestre 2025 (${dateFr(M.t3)}) et fichier du ${dateFr(M.fichier)} ; devenir calculé le 28/10/2026.`,
      `<p class="limite">Le registre est déclaratif : il dit ce que le syndic a déclaré, et quand. Une copropriété absente du fichier a pu être radiée, fusionnée ou renumérotée ; une déclaration incomplète n'est pas un départ.</p>`) + `</section>`;
  }
  function blocEvolution() {
  }
  function blocTenue() {
    const { S, T } = devCourant(), a = parClasse(S, ["majN", "maj12", "finN", "finK"]);
    const lignes = (id, k, n) => [["Tous les syndics", T, -1]].concat(LIB_CLASSE.map((l, c) => [l, a[c], c])).map(([l, b, c]) => {
      const nn = b[n], kk = b[k];
      return barreClic("voir-reg", id + ":" + c, l, nn ? kk : 0, nn || 1, nn >= 10 ? pctNb(kk, nn) + " %" : nb(kk) + " sur " + nb(nn), c >= 0 && etat.filtres.classe === c, nb(kk) + " sur " + nb(nn));
    }).join("");
    let h = `<section class="ens-bloc" aria-labelledby="ens-tenue"><h3 id="ens-tenue">La tenue du registre, par taille du syndic</h3><div class="ens-grille">`;
    h += carteG(IND.i6.titre, `Base : les mandats en cours du département${esc(critDevTxt())} dont la date de mise à jour est connue, au ${dateFr(M.fichier)}. Barre : leur part, sur 100 %. Une barre ouvre ces syndics, triés sur cet indicateur.`, lignes("i6", "maj12", "majN"), srcRegistre(), `<p class="limite">${esc(IND.i6.limite)}</p>`);
    h += carteG(IND.i7.titre, `Base : les mandats déclarés en cours et datés du département${esc(critDevTxt())}. Barre : leur part, sur 100 %.`, lignes("i7", "finK", "finN"), srcRegistre(), `<p class="limite">${esc(IND.i7.limite)}</p>`);
    return h + `</div></section>`;
  }
  // Les sociétés, réfléchi pour « Ensemble » : âge, forme, effectif, réseau. Chaque barre compte des syndics.
  function blocSocietes(X, ou) {
    const L = X.tous;
    const compte = (f, ordre) => {
      const m = new Map();
      for (const r of L) { const k = f(r.e); m.set(k, (m.get(k) || 0) + 1); }
      return (ordre ? ordre.filter((k) => m.has(k)) : [...m.keys()].sort((a, b) => m.get(b) - m.get(a))).map((k) => [k, m.get(k)]);
    };
    const carte = (titre, sous, cle, paires, lib, note) => {
      const mx = Math.max(1, ...paires.map((p) => p[1]));
      return carteG(titre, sous, paires.map(([k, n]) => barreClic("voir-soc", cle + ":" + k, lib(k), n, mx, nb(n), etat.filtres[cle] === k)).join(""), srcEntreprises(), note ? `<p class="limite">${esc(note)}</p>` : "");
    };
    let h = `<section class="ens-bloc" aria-labelledby="ens-soc"><h3 id="ens-soc">Les sociétés</h3><p class="aide">${ou} : ${nb(L.length)} ${accord(L.length, "syndic professionnel gère", "syndics professionnels gèrent")} au moins une copropriété${etat.tf >= 0 || etat.constr >= 0 ? " retenue par la jauge et la construction" : ""}. Chaque barre compte des syndics et ouvre la liste de ceux qu'elle compte. La forme, l'âge et l'effectif décrivent la société, pas la qualité de sa gestion.</p><div class="ens-grille">`;
    h += carte("Âge de la société", "Décennie de création, d'après le répertoire des entreprises.", "decennie", compte((e) => decennieDe(ENTS[e]), [1960, 1970, 1980, 1990, 2000, 2010, 2020, -1]), (k) => cap(libDecennie(k)));
    h += carte("Forme juridique", "La forme de la société.", "forme", compte(formeDe), (k) => k || "Non renseignée");
    h += carte("Effectif salarié déclaré", "Tranche d'effectif de 2024 : tous les salariés de la société, y compris ceux de la location et de la vente.", "effectif", compte((e) => effDe(ENTS[e]), [0, 1, 2, 3, -1]), (k) => (k < 0 ? "Aucun salarié déclaré, ou non connu" : LIB_EFF[k]));
    h += carte("Société locale ou réseau", "Ses copropriétés en France, comparées à celles qu'elle gère dans le département.", "reseau", compte(reseauDe, [0, 1, -1]), (k) => (k < 0 ? "Copropriétés en France non connues" : LIB_RESEAU[k]), "Un réseau ne dit rien des moyens de l'agence locale.");
    return h + `</div></section>`;
  }
  // Les décisions du jeu de J, chacune une fois, avec les syndics non masqués qu'elle nomme.
  const DEC_UNIQUES = (() => {
    const m = new Map();
    for (const [e, x] of JUS) {
      if (ENTS[e].ei) continue;
      x.d.forEach((d, k) => { const cle = d[8] || "e" + e + ":" + k; if (!m.has(cle)) m.set(cle, { d, ents: [] }); m.get(cle).ents.push(e); });
    }
    return [...m.values()];
  })();
  function blocJusticeEns() {
    if (!AVEC_J) return `<section class="ens-bloc" aria-labelledby="ens-justice"><h3 id="ens-justice">La justice</h3>${noteJustice()}</section>`;
    const dans = R ? new Set(R.tous.map((r) => r.e)) : null;
    const decs = dans ? DEC_UNIQUES.filter((u) => u.ents.some((e) => dans.has(e))) : DEC_UNIQUES;
    let h = `<section class="ens-bloc" aria-labelledby="ens-justice"><h3 id="ens-justice">La justice à Marseille</h3>`;
    h += `<p class="aide">${nb(decs.length)} ${accord(decs.length, "décision publiée nomme", "décisions publiées nomment")} au moins un syndic professionnel ${R ? "de la liste" : "du département"}, ${PERIODE_J} ; chacune compte une fois. Une barre ouvre ces décisions au tableau, syndic par syndic.</p>`;
    if (!decs.length) return h + `<p class="source">${esc(MENTION_J)}</p></section>`;
    const compte = (f, n) => { const a = Array.from({ length: n }, () => 0); for (const u of decs) a[f(u.d)]++; return a; };
    const carte = (titre, sous, cle, a, lib, ordre) => {
      const mx = Math.max(1, ...a), ks = ordre || a.map((v, k) => k).filter((k) => a[k]).sort((p, q) => a[q] - a[p]);
      return carteG(titre, sous, ks.map((k) => barreClic("voir-dec", cle(k), lib(k), a[k], mx, nb(a[k]))).join(""), esc(MENTION_J));
    };
    h += `<div class="ens-grille">`;
    h += carte("Décisions par année", `${ANNEES_J[ANNEES_J.length - 1]} : jusqu'au ${dateFr(JM.periode[1])}. D'une année à l'autre, la hausse peut venir de la publication, qui s'étend, plutôt que du contentieux.`, (k) => "annee:" + ANNEES_J[k], compte((d) => Math.max(0, ANNEES_J.indexOf(Number(d[0].slice(0, 4)))), ANNEES_J.length), (k) => String(ANNEES_J[k]), ANNEES_J.map((a, k) => k));
    h += carte("Décisions par objet", "L'objet du litige, tel que la lecture l'a classé.", (k) => "obj:" + k, compte((d) => d[3], JM.obj.length), (k) => JM.obj[k]);
    h += carte("Décisions par juridiction et degré", "Première instance ou appel.", (k) => "jur:" + k, compte((d) => (d[1] << 1) | d[2], JM.jur.length * 2), (k) => JM.jur[k >> 1] + (k & 1 ? ", appel" : ", première instance"));
    h += carte("Décisions par issue", "Ce que la décision a tranché, tel que la lecture l'a classé.", (k) => "iss:" + k, compte((d) => d[4], JM.iss.length), (k) => JM.iss[k]);
    return h + `</div><p class="limite">Une décision qui nomme un syndic ne dit rien de sa qualité : il agit le plus souvent pour la copropriété. Une décision frappée d'appel a pu être réformée.</p></section>`;
  }
  // Les délais de la justice : de l'acte dont le relevé lit la date à la décision. Sans nom ; ils portent sur
  // tout le relevé, quel que soit le lieu. Les graphiques ne montrent que deux mesures nettes : le tribunal, depuis son premier
  // acte, et la cour d'appel, depuis la déclaration d'appel ; les autres délais de la cour partent d'un acte qui peut dater de la
  // première instance, et ne vont qu'au tableau jumeau, avec leur explication.
  const MOIS = 30.4375;
  const moisTxt = (j) => { const m = j / MOIS; return (m < 9.95 ? f1.format(m) : nb(Math.round(m))) + " mois"; };
  const LIB_FAM = { recouvrement: "Recouvrement", gouvernance: "Gouvernance", saisie: "Saisie", autre: "Autre" };
  const APPEL = "déclaration d'appel";
  function blocDelais() {
    const L = DL.l, ligneDe = (axe, j, cle) => L.find((l) => l[0] === axe && l[1] === j && l[2] === cle);
    const tj = ligneDe("siège", 0, ""), ca = ligneDe("acte", 1, APPEL);
    const montrees = [tj, ca].concat(L.filter((l) => l[1] === 0 && (l[0] === "famille" || l[0] === "année"))).filter(Boolean);
    const mx = Math.max(1, ...montrees.map((l) => l[6])) / MOIS, s = pas(mx, 4), haut = Math.ceil(mx / s - 1e-9) * s;
    const X = (j) => (100 * Math.min(j / MOIS, haut)) / haut;
    const axe = `<div class="g-axe">${Array.from({ length: Math.round(haut / s) + 1 }, (_, k) => `<span style="left:${((100 * k * s) / haut).toFixed(1)}%">${nb(k * s)}</span>`).join("")}</div>`;
    const ligne = (lib, l) => `<div class="g-ligne g-fixe g-empile" title="${esc(`${lib} : ${nb(l[3])} délais ; 1er quartile ${moisTxt(l[4])}, médiane ${moisTxt(l[5])}, 3e quartile ${moisTxt(l[6])}`)}"><span class="g-nom">${esc(lib)}<span class="sous">${nb(l[3])} délais</span></span><span class="g-piste"><span class="g-seg" style="left:${X(l[4]).toFixed(2)}%;width:${Math.max(0.6, X(l[6]) - X(l[4])).toFixed(2)}%"></span><span class="g-mil" style="left:${X(l[5]).toFixed(2)}%"></span></span><span class="g-val">${moisTxt(l[5])}</span></div>`;
    const lecture = "Barre : la moitié centrale des délais, du 1er au 3e quartile ; trait : la médiane, écrite à droite ; échelle en mois.";
    const b = DL.base, ac = DL.actes[1] || {}, nCa = b[1] ? b[1][1] : 0;
    let h = `<section class="ens-bloc" aria-labelledby="ens-delais"><h3 id="ens-delais">Les délais de la justice à Marseille</h3>`;
    h += `<p class="aide">De l'acte dont la décision donne la date (assignation, acte d'huissier, requête, déclaration d'appel) à la décision elle-même. Le relevé lit cette date dans le texte, par règles. Il porte sur toutes ses décisions rendues depuis le ${dateFr(DL.meta.depuis)}, quel que soit le lieu choisi ; aucun syndic n'y est nommé. Décisions dont le texte donne une date d'acte : ${Object.keys(b).map((j) => `${esc(JM.jur[j])}, ${nb(b[j][1])} sur ${nb(b[j][0])}`).join(" ; ")}.</p><div class="ens-grille">`;
    if (tj || ca) h += carteG("Délai, par juridiction", `${lecture} À la cour d'appel, seuls ${nb(ac[APPEL] || 0)} des ${nb(nCa)} délais partent d'une déclaration d'appel ; les autres partent d'un acte qui peut dater de la première instance : ils ne sont que dans le tableau.`, `<div class="delais">${[tj && ligne(JM.jur[0] + ", depuis son premier acte", tj), ca && ligne(JM.jur[1] + ", depuis la déclaration d'appel", ca)].filter(Boolean).join("")}${axe}</div>`, esc(MENTION_DL));
    const fam = L.filter((l) => l[0] === "famille" && l[1] === 0).sort((p, q) => AVM.fam.indexOf(p[2]) - AVM.fam.indexOf(q[2]));
    if (fam.length) h += carteG(`Au ${minuscule(JM.jur[0])}, par famille de litige`, `${lecture} Les familles sont celles du relevé.`, `<div class="delais">${fam.map((l) => ligne(LIB_FAM[l[2]] || l[2], l)).join("")}${axe}</div>`, esc(MENTION_DL));
    const ans = L.filter((l) => l[0] === "année" && l[1] === 0).sort((p, q) => p[2].localeCompare(q[2]));
    if (ans.length) h += carteG(`Au ${minuscule(JM.jur[0])}, par année de la décision`, `${lecture} ${ans[ans.length - 1][2]} : l'année en cours.`, `<div class="delais">${ans.map((l) => ligne(l[2], l)).join("")}${axe}</div>`, esc(MENTION_DL), `<p class="limite">Le délai d'une année est celui des affaires jugées cette année-là, commencées parfois bien avant : il ne mesure pas les affaires nouvelles. Une année où Judilibre publie peu de décisions en donne peu.</p>`);
    h += `</div>`;
    // le jumeau : tous les délais, par juridiction, puis par acte de départ, famille et année
    const ORD = { "siège": 0, acte: 1, famille: 2, "année": 3 }, libG = (l) => (l[0] === "siège" ? "Toutes ses décisions" : l[0] === "acte" ? "Depuis : " + l[2] : l[0] === "famille" ? "Famille : " + (LIB_FAM[l[2]] || l[2]) : "Année " + l[2]);
    const tri = L.slice().sort((p, q) => p[1] - q[1] || ORD[p[0]] - ORD[q[0]] || (p[0] === "famille" ? AVM.fam.indexOf(p[2]) - AVM.fam.indexOf(q[2]) : String(p[2]).localeCompare(String(q[2]))));
    h += `<details class="jumeau"><summary>Tous les délais en tableau, en mois et en jours</summary><p class="sous-titre">À la cour d'appel, un délai qui part d'une assignation, d'un acte d'huissier ou d'une requête peut couvrir l'affaire entière, première instance comprise : le relevé retient le premier de ces actes que le texte cite. Un délai de 0 jour : la décision porte la même date que l'acte lu.</p><div class="defile-x"><table class="matrice"><thead><tr><th scope="col">Juridiction</th><th scope="col">Délais</th><th scope="col" class="c">Nombre</th><th scope="col" class="c">1er quartile</th><th scope="col" class="c">Médiane</th><th scope="col" class="c">3e quartile</th></tr></thead><tbody>`
      + tri.map((l) => `<tr><th scope="row">${esc(JM.jur[l[1]])}</th><td>${esc(libG(l))}</td><td class="c">${nb(l[3])}</td>${[4, 5, 6].map((i) => `<td class="c">${moisTxt(l[i])}<span class="sous">${nb(l[i])} ${accord(l[i], "jour", "jours")}</span></td>`).join("")}</tr>`).join("")
      + `</tbody></table></div></details>`;
    const peu = Object.keys(b).filter((j) => !L.some((l) => l[1] === Number(j)));
    if (peu.length) h += `<p class="limite">${peu.map((j) => `${esc(JM.jur[j])} : ${nb(b[j][0])} ${accord(b[j][0], "décision", "décisions")}, ${nb(b[j][1])} ${accord(b[j][1], "délai relevé", "délais relevés")}, trop peu pour des quartiles (il en faut ${nb(DL.meta.seuil)}).`).join(" ")}</p>`;
    return h + `<p class="limite">Un délai médian ne dit rien d'une affaire en particulier, ni de la diligence d'un syndic ou d'un avocat. La date lue par règles peut être celle d'un autre acte que celui qui a ouvert l'instance.</p></section>`;
  }
  const sep = `<p class="g-sep">…</p>`;
  // Une ligne de taux : son point, sa marge à 95 % et le repère du département ; sous une base de 10, « k sur n » sans tracé.
  // En barres, la marge devient une moustache sur le bout de la barre, et le repère du département passe par-dessus.
  function ligneTaux(r, k, n, ref, mx, barres) {
    const X = (v) => (100 * Math.min(v, mx)) / mx, repere = ref != null ? `<span class="g-ref" style="left:${X(ref).toFixed(2)}%"></span>` : "";
    let dessin = barres ? "" : repere, val;
    if (n >= 10) {
      const p = k / n, [b, hh] = wilson(k, n), marge = `left:${X(b).toFixed(2)}%;width:${Math.max(0.6, X(hh) - X(b)).toFixed(2)}%`;
      dessin += barres ? `<span class="g-plein" style="width:${X(p).toFixed(2)}%"></span><span class="g-moust" style="${marge}"></span>` : `<span class="g-marge" style="${marge}"></span><span class="g-pt" style="left:${X(p).toFixed(2)}%"></span>`;
      val = pctNb(k, n) + " %";
    } else val = n ? nb(k) + " sur " + nb(n) : "—";
    if (barres) dessin += repere;
    return `<button type="button" class="g-ligne${r.e === etat.sel ? " choisi" : ""}" data-act="sel" data-e="${r.e}"><span class="g-nom" title="${esc(ENTS[r.e].n)}">${esc(ENTS[r.e].n)}</span><span class="g-piste">${dessin}</span><span class="g-val">${val}</span></button>`;
  }
  // Une ligne de valeur : une barre, ou un texte quand la valeur manque (base sous 10, non renseigné).
  function ligneValeur(r, v, max, txt) {
    if (v == null) return `<button type="button" class="g-ligne${r.e === etat.sel ? " choisi" : ""}" data-act="sel" data-e="${r.e}"><span class="g-nom" title="${esc(ENTS[r.e].n)}">${esc(ENTS[r.e].n)}</span><span class="g-piste"></span><span class="g-val">${txt}</span></button>`;
    return ligneBarre(r, v, max, txt);
  }
  const axeTaux = (mx) => `<div class="g-axe">${[0, mx / 2, mx].map((v) => `<span style="left:${((100 * v) / mx).toFixed(1)}%">${nb(Math.round(100 * v))} %</span>`).join("")}</div>`;
  // Les nombres et les parts : la valeur, son texte, le titre et la note ; le graphique en barres et sa forme « Tableau » les partagent.
  function defBarres(c) {
    const { S, T } = devCourant();
    return {
      ici: [(r) => r.ici, (r) => nb(r.ici), titreIci(true) + ", par syndic", ""],
      nom: [(r) => r.ici, (r) => nb(r.ici), titreIci(true) + ", par syndic", "Ordre alphabétique : l'ordre ne dit rien."],
      taille: [(r) => TOUT_DEPT[r.e], (r) => nb(TOUT_DEPT[r.e]), "Taille du syndic dans le département, par syndic", "Toutes ses copropriétés du département, sans critère."],
      dist: [(r) => r.d, (r) => distTxt(r.d), "Bureau le plus proche, par syndic", "Distance à vol d'oiseau jusqu'à son bureau déclaré le plus proche."],
      part: [(r) => (r.part[1] >= 10 ? (100 * r.part[0]) / r.part[1] : null), (r) => (r.part[1] >= 10 ? pctNb(r.part[0], r.part[1]) + " %" : nb(r.part[0]) + " sur " + nb(r.part[1])), "Part de son portefeuille dans le département, par syndic", "Ses copropriétés de votre tranche, sur toutes celles qu'il gère dans le département."],
      n0: [(r) => S.n0[r.e], (r) => nb(S.n0[r.e]), "Ses copropriétés de 2025, par syndic", "La base du devenir : " + baseDev() + "."],
      i5: [(r) => (S.n0[r.e] >= 10 ? (100 * S.arrV[r.e]) / S.n0[r.e] : null), (r) => (S.n0[r.e] >= 10 ? nb(Math.round((100 * S.arrV[r.e]) / S.n0[r.e])) : nb(S.arrV[r.e]) + " pour " + nb(S.n0[r.e])), IND.i5.titre + ", pour 100 de ses copropriétés de 2025, par syndic", IND.i5.def + " Département : " + (T.n0 ? nb(Math.round((100 * T.arrV) / T.n0)) : "—") + " pour 100."],
      i7: [(r) => S.finK[r.e], (r) => nb(S.finK[r.e]), IND.i7.titre + ", par syndic", IND.i7.def],
      jbase: [(r) => BASE_MARS[r.e], (r) => nb(BASE_MARS[r.e]), "Copropriétés gérées à Marseille, par syndic", "La base des taux de justice."],
    }[c.id] || [(r) => r.ici, (r) => nb(r.ici), titreIci(true) + ", par syndic", ""];
  }
  // Le graphique du tri en cours : le même indicateur que la colonne triée, dans le même ordre ; « barres » dessine les taux en barres.
  function grapheDuTri(c, lignes, L, quoi, barres) {
    if (c.id === "enc") {
      const sansSal = L.filter((r) => !ENC[r.e]).length;
      let h = `<div class="graph"><h3>Lots par salarié déclaré, par syndic</h3><p class="sous-titre">Fourchette tirée de la tranche d'effectif de 2024 et des lots gérés en France ; trait vertical au milieu ; échelle logarithmique. ${quoi}${sansSal ? ` ${nb(sansSal)} ${accord(sansSal, "société de la liste ne déclare", "sociétés de la liste ne déclarent")} aucun salarié.` : ""}</p>`;
      h += lignes.map((r) => {
        if (!r) return sep;
        const x = ENC[r.e];
        const dessin = x ? `<span class="g-seg" style="left:${posLog(x.lo).toFixed(2)}%;width:${Math.max(0.6, posLog(x.hi) - posLog(x.lo)).toFixed(2)}%"></span><span class="g-mil" style="left:${posLog(x.mid).toFixed(2)}%"></span>` : "";
        return `<button type="button" class="g-ligne${r.e === etat.sel ? " choisi" : ""}" data-act="sel" data-e="${r.e}"><span class="g-nom" title="${esc(ENTS[r.e].n)}">${esc(ENTS[r.e].n)}</span><span class="g-piste">${dessin}</span><span class="g-val">${x ? lotsTxt(x.mid) : "—"}</span></button>`;
      }).join("");
      return h + axeHtml("g-axe") + `</div>`;
    }
    if (c.taux) {
      const I = IND[c.id];
      const lecture = barres ? "Barre : son taux ; moustache : sa marge à 95 %" : "Point : son taux ; trait gris : sa marge à 95 %";
      let h = `<div class="graph g-large"><h3>${esc(I.titre)}, par syndic</h3><p class="sous-titre">${esc(I.def)} Base : ${esc(c.id === "i6" ? baseMaj() : baseDev())}. ${lecture} ; trait vertical : tout le département sur la même base, ${esc(c.ref != null ? pctF(c.ref) : "—")}. ${quoi} Sous une base de 10 : « k sur n », sans tracé.</p>`;
      h += lignes.map((r) => (r ? ligneTaux(r, ...c.kn(r), c.ref, c.mx, barres) : sep)).join("");
      return h + axeTaux(c.mx) + `<p class="limite">${esc(I.limite)}</p></div>`;
    }
    if (c.justice) {
      const v = (r) => { const k = jCompte(r.e, c.id), n = BASE_MARS[r.e]; return { k, n, p: k != null && n >= 10 ? (100 * k) / n : null }; };
      const max = Math.max(0.1, ...L.map((r) => v(r).p || 0));
      let h = `<div class="graph g-large"><h3>${esc(JIND[c.id].titre)}, pour 100 copropriétés gérées à Marseille, par syndic</h3><p class="sous-titre">Décisions où ce syndic est ${c.id === "j3" ? "partie en son nom" : c.id === "j1" ? "condamné au fond" : "tenu pour responsable"}, rapportées à ses copropriétés d'aujourd'hui à Marseille. ${quoi} Sous une base de 10 : « k sur n », sans barre.</p>`;
      h += lignes.map((r) => {
        if (!r) return sep;
        const x = v(r);
        const txt = x.k == null ? "non renseigné" : x.p != null ? (x.p === 0 ? "0" : f1.format(x.p)) : x.n ? nb(x.k) + " sur " + nb(x.n) : "hors";
        return ligneValeur(r, x.p, max, txt);
      }).join("");
      return h + `<p class="limite">${esc(JIND[c.id].limite)}</p><p class="source">${esc(MENTION_J)}</p></div>`;
    }
    // les nombres et les parts : une barre par syndic
    const [val, txt, titre, note] = defBarres(c), max = Math.max(1e-9, ...L.map((r) => val(r) || 0));
    let h = `<div class="graph${c.id === "part" || c.id === "i5" || c.id === "dist" ? " g-large" : ""}"><h3>${esc(titre)}</h3><p class="sous-titre">${esc(note ? note + " " : "")}${quoi}</p>`;
    h += lignes.map((r) => (r ? ligneValeur(r, val(r), max, txt(r)) : sep)).join("");
    return h + `</div>`;
  }
  // L'histoire des décisions : par année, les décisions publiées qui nomment un syndic de la liste, selon son rôle.
  const ANNEES_J = [];
  if (JM) for (let a = Number(JM.periode[0].slice(0, 4)); a <= Number(JM.periode[1].slice(0, 4)); a++) ANNEES_J.push(a);
  const ORDRE_ROLES = [1, 2, 0];
  function parAnnee(decisions) {
    const par = ANNEES_J.map(() => [0, 0, 0]);
    for (const d of decisions) { const a = ANNEES_J.indexOf(Number(d[0].slice(0, 4))); if (a >= 0) par[a][d[5]]++; }
    return par;
  }
  function lignesAnnees(par) {
    const max = Math.max(1, ...par.map((p) => p[0] + p[1] + p[2]));
    return par.map((p, k) => {
      const t = p[0] + p[1] + p[2];
      return `<div class="h-ligne"><span>${ANNEES_J[k]}</span><span class="h-piste" title="${esc(ORDRE_ROLES.map((r) => JM.role[r] + " : " + nb(p[r])).join(" · "))}">${ORDRE_ROLES.map((r) => (p[r] ? `<span class="h-r${r}" style="width:${((100 * p[r]) / max).toFixed(2)}%"></span>` : "")).join("")}</span><span class="h-val">${nb(t)}</span></div>`;
    }).join("") + `<div class="h-cles">${ORDRE_ROLES.map((r) => `<span class="h-cle"><i class="h-r${r}"></i>${esc(JM.role[r])}</span>`).join("")}</div>`;
  }
  // Les décisions par année, syndic par syndic : chaque ligne nomme un syndic de la liste ; une case ouvre ces décisions au tableau.
  function grilleDecisions(L) {
    const rows = [];
    for (const r of L) {
      const x = ENTS[r.e].ei ? null : JUS.get(r.e);
      if (!x) continue;
      const par = ANNEES_J.map(() => 0);
      for (const d of x.d) { const a = ANNEES_J.indexOf(Number(d[0].slice(0, 4))); if (a >= 0) par[a]++; }
      rows.push({ e: r.e, par, t: x.d.length });
    }
    const titre = "Décisions publiées qui nomment chaque syndic de la liste, par année";
    if (!rows.length) return `<div class="graph"><h3>${titre}</h3><p class="sous-titre">Aucune décision du jeu ne nomme un syndic de la liste. ${esc(PHRASE_JUDILIBRE)}</p></div>`;
    rows.sort((a, b) => b.t - a.t || parNom(a, b));
    const LIM = 15, vis = etat.tout.g2 ? rows : rows.slice(0, LIM), max = Math.max(1, ...rows.flatMap((x) => x.par));
    let h = `<div class="graph"><h3>${titre}</h3><p class="sous-titre">${nb(rows.length)} ${accord(rows.length, "syndic de la liste est nommé", "syndics de la liste sont nommés")} dans au moins une décision du jeu, du plus nommé au moins nommé. Dans chaque case, le nombre de décisions de l'année ; la barre suit ce nombre. ${ANNEES_J[ANNEES_J.length - 1]} : jusqu'au ${dateFr(JM.periode[1])}. Une case ouvre ces décisions au tableau.</p>`;
    h += `<div class="defile-x"><table class="matrice grille"><thead><tr><th scope="col">Syndic</th>${ANNEES_J.map((a) => `<th scope="col" class="c">${a}</th>`).join("")}<th scope="col" class="c">Total</th></tr></thead><tbody>`;
    h += vis.map(({ e, par, t }) => `<tr${e === etat.sel ? ' class="choisi"' : ""}><th scope="row"><button type="button" class="nom" data-act="sel" data-e="${e}" aria-pressed="${e === etat.sel}">${esc(ENTS[e].n)}</button></th>${par.map((v, k) => `<td class="c">${v ? `<button type="button" data-act="voir-dec" data-v="e:${e};annee:${ANNEES_J[k]}" aria-label="${nb(v)} ${accord(v, "décision", "décisions")} en ${ANNEES_J[k]}">${nb(v)}<span class="niv"><i style="width:${((100 * v) / max).toFixed(0)}%"></i></span></button>` : `<span class="sans">·</span>`}</td>`).join("")}<td class="c"><button type="button" data-act="voir-dec" data-v="e:${e}">${nb(t)}</button></td></tr>`).join("");
    h += `</tbody></table></div>` + boutonTout("g2", rows.length, LIM);
    return h + `<p class="limite">Ne permet de rien conclure sur la qualité d'un syndic : il agit le plus souvent pour la copropriété. D'une année à l'autre, la hausse peut venir de la publication, qui s'étend, plutôt que du contentieux.</p><p class="source">${esc(MENTION_J)}</p></div>`;
  }
  // Les avocats des syndicats : le graphe des avocats des syndics de la zone choisie.
  // À gauche les syndics de la liste, du plus présent au moins présent ; à droite les cabinets et avocats qui ont représenté
  // leurs syndicats dans une décision du relevé ; un trait s'épaissit avec le nombre de ces décisions. Au-delà des
  // premiers, « Tout afficher » pour les syndics et un nœud « autres » pour les cabinets ; le tableau jumeau donne tous les liens.
  let largeurReseau = 0;
  function reseauAvocats(L) {
    const cov = L.filter((r) => AVP.has(r.e)).map((r) => ({ e: r.e, x: AVP.get(r.e) })).sort((a, b) => b.x[0] - a.x[0] || parNom(a, b));
    const sans = L.length - cov.length, selHors = etat.sel != null && L.some((r) => r.e === etat.sel) && !AVP.has(etat.sel);
    let h = `<div class="graph g-reseau"><h3 id="reseau-titre">Avocats des syndicats de copropriétaires, syndic par syndic</h3>`;
    if (!cov.length) return h + `<p class="sous-titre">Aucun syndic de la liste n'a de décision dans ce relevé, qui ne couvre que le tribunal judiciaire de Marseille et la cour d'appel d'Aix-en-Provence.</p><p class="source">${esc(MENTION_AV)}</p></div>`;
    const LIM = 12, LIMC = 14, vis = premieres(cov, "g3", LIM, etat.sel).filter(Boolean);
    // les cabinets des syndics montrés, du plus fréquent au moins fréquent avec eux ; au-delà des 14 premiers, un seul nœud
    const poids = new Map(), nSyn = new Map();
    for (const s of vis) for (const [c, n] of s.x[2]) { poids.set(c, (poids.get(c) || 0) + n); nSyn.set(c, (nSyn.get(c) || 0) + 1); }
    const cabs = [...poids.keys()].sort((a, b) => poids.get(b) - poids.get(a) || AV.cab[a][0].localeCompare(AV.cab[b][0], "fr"));
    const montres = cabs.slice(0, LIMC), autres = cabs.length - montres.length, place = new Map(montres.map((c, k) => [c, k]));
    const poidsAutres = cabs.slice(LIMC).reduce((s, c) => s + poids.get(c), 0), nC = Math.max(1, montres.length + (autres ? 1 : 0));
    h += `<p class="sous-titre" id="reseau-desc">${nb(cov.length)} des ${nb(L.length)} syndics de la liste ont au moins une décision dans ce relevé ; ${nb(sans)} n'en ${accord(sans, "a", "ont")} aucune${selHors ? ", dont le syndic choisi" : ""}. À gauche, ${vis.length < cov.length ? `les ${nb(LIM)} syndics les plus présents` : "ces syndics"}, du plus présent au moins présent ; à droite, les cabinets et avocats de leurs syndicats${autres ? `, les ${nb(LIMC)} plus fréquents puis les ${nb(autres)} autres, regroupés` : ""}. Un trait : au moins une décision où ce cabinet représente un syndicat que ce syndic représente ; il s'épaissit avec leur nombre, écrit à côté de chaque nom. Un syndic se choisit d'un clic ; le tableau jumeau donne tous les liens.</p>`;
    // le dessin prend la largeur de son cadre ; les noms se coupent à la place qu'ils ont, la bulle les donne en entier
    const cw = $("graph-corps").clientWidth || 0;
    largeurReseau = cw;
    const W = Math.round(Math.max(320, Math.min(960, cw || 640))), H = Math.max(vis.length, nC) * 28 + 8;
    const lab = Math.floor((W - Math.max(64, Math.round(W * 0.2))) / 2) - 12, xS = lab + 10, xC = W - lab - 10, car = Math.max(12, Math.floor(lab / 6.6));
    const yS = (k) => 4 + ((H - 8) * (k + 0.5)) / vis.length, yC = (k) => 4 + ((H - 8) * (k + 0.5)) / nC;
    const liens = [];
    vis.forEach((s, k) => {
      let reste = 0;
      for (const [c, n] of s.x[2]) if (place.has(c)) liens.push([k, place.get(c), n, s.e, c]); else reste += n;
      if (reste) liens.push([k, montres.length, reste, s.e, -1]);
    });
    const mxL = Math.max(1, ...liens.map((l) => l[2])), mi = ((xS + xC) / 2).toFixed(1), dec = (n) => nb(n) + " " + accord(n, "décision", "décisions");
    let s = `<svg class="reseau" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="reseau-titre reseau-desc">`;
    // les traits du syndic choisi passent en dernier, au-dessus des autres
    for (const [k, j, n, e, c] of liens.sort((a, b) => (a[3] === etat.sel) - (b[3] === etat.sel))) {
      const y1 = yS(k).toFixed(1), y2 = yC(j).toFixed(1);
      s += `<path class="r-lien${e === etat.sel ? " choisi" : ""}" data-le="${e}" data-lc="${c}" d="M${xS + 5} ${y1} C${mi} ${y1} ${mi} ${y2} ${xC - 5} ${y2}" stroke-width="${(1 + 4 * Math.sqrt(n / mxL)).toFixed(2)}"/>`;
    }
    vis.forEach((x, k) => {
      const y = yS(k), on = x.e === etat.sel, nom = ENTS[x.e].n, n = x.x[0], cl = x.x[2], t = nb(n);
      const bulle = `${nom}\n${dec(n)} du relevé · ${nb(cl.length)} ${accord(cl.length, "cabinet ou avocat", "cabinets ou avocats")}${cl.length ? `\nLe plus fréquent : ${AV.cab[cl[0][0]][0]}, ${dec(cl[0][1])}` : ""}`;
      s += `<g class="r-noeud r-syn${on ? " choisi" : ""}" data-act="sel" data-e="${x.e}" data-le="${x.e}" data-bulle="${esc(bulle)}"><rect class="r-cible" x="0" y="${(y - 12).toFixed(1)}" width="${xS + 8}" height="24"/><circle class="r-pt" cx="${xS}" cy="${y.toFixed(1)}" r="${on ? 5.5 : 4}"/><text class="r-etiq" x="${xS - 9}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(court(nom, car - t.length - 1))}<tspan class="r-n"> ${t}</tspan></text></g>`;
    });
    montres.forEach((c, k) => {
      const y = yC(k), [nom, typ, pour, contre] = AV.cab[c], n = poids.get(c), t = nb(n), ns = nSyn.get(c);
      const bulle = `${nom}\n${typ ? "Avocat" : "Cabinet"} · avec ${ns === 1 ? "ce syndic" : `ces ${nb(ns)} syndics`} : ${dec(n)}\nDans tout le relevé : pour un syndicat ${nb(pour)}, contre un syndicat ${nb(contre)}`;
      s += `<g class="r-noeud r-cab" data-lc="${c}" data-bulle="${esc(bulle)}"><rect class="r-cible" x="${xC - 8}" y="${(y - 12).toFixed(1)}" width="${W - xC + 8}" height="24"/><circle class="r-pt" cx="${xC}" cy="${y.toFixed(1)}" r="4"/><text class="r-etiq" x="${xC + 9}" y="${(y + 4).toFixed(1)}"><tspan class="r-n">${t} </tspan>${esc(court(nom, car - t.length - 1))}</text></g>`;
    });
    if (autres) {
      const y = yC(montres.length), t = nb(poidsAutres);
      s += `<g class="r-noeud r-cab r-autres" data-lc="-1" data-bulle="${esc(`${nb(autres)} autres cabinets ou avocats : ${dec(poidsAutres)} avec les syndics montrés. Le tableau jumeau les nomme.`)}"><rect class="r-cible" x="${xC - 8}" y="${(y - 12).toFixed(1)}" width="${W - xC + 8}" height="24"/><circle class="r-pt" cx="${xC}" cy="${y.toFixed(1)}" r="4"/><text class="r-etiq" x="${xC + 9}" y="${(y + 4).toFixed(1)}">${esc(court(nb(autres) + " autres", car - t.length - 3))}<tspan class="r-n"> (${t})</tspan></text></g>`;
    }
    h += `<div class="defile-x">${s}</svg></div>` + boutonTout("g3", cov.length, LIM);
    // le jumeau : tous les syndics de la liste qui ont une décision dans le relevé, puis tous leurs cabinets et avocats
    const tousC = new Map();
    for (const { x } of cov) for (const [c, n] of x[2]) { const t = tousC.get(c) || [0, 0]; t[0] += n; t[1]++; tousC.set(c, t); }
    const ordC = [...tousC.keys()].sort((a, b) => tousC.get(b)[0] - tousC.get(a)[0] || AV.cab[a][0].localeCompare(AV.cab[b][0], "fr"));
    h += `<details class="jumeau"><summary>Le réseau en tableau : ${nb(cov.length)} ${accord(cov.length, "syndic", "syndics")}, puis ${nb(ordC.length)} ${accord(ordC.length, "cabinet ou avocat", "cabinets ou avocats")}</summary><p class="sous-titre">Une décision qui nomme deux syndics de la liste compte pour chacun.</p>`;
    h += `<div class="defile-x"><table class="matrice"><thead><tr><th scope="col">Syndic</th><th scope="col" class="c">Décisions du relevé</th><th scope="col" class="c">Cabinets ou avocats</th><th scope="col">Le plus fréquent</th></tr></thead><tbody>`
      + cov.map(({ e, x }) => `<tr${e === etat.sel ? ' class="choisi"' : ""}><th scope="row"><button type="button" class="nom" data-act="sel" data-e="${e}" aria-pressed="${e === etat.sel}">${esc(ENTS[e].n)}</button></th><td class="c">${nb(x[0])}</td><td class="c">${nb(x[2].length)}</td><td>${x[2].length ? `${esc(AV.cab[x[2][0][0]][0])}<span class="sous">${dec(x[2][0][1])} sur ${nb(x[0])}</span>` : "—"}</td></tr>`).join("")
      + `</tbody></table></div>`;
    h += `<div class="defile-x"><table class="matrice"><thead><tr><th scope="col">Cabinet ou avocat</th><th scope="col" class="c">Syndics de la liste</th><th scope="col" class="c">Décisions avec eux</th><th scope="col" class="c">Tout le relevé : pour un syndicat</th><th scope="col" class="c">Contre un syndicat</th></tr></thead><tbody>`
      + ordC.map((c) => `<tr><th scope="row">${esc(AV.cab[c][0])}<span class="sous">${AV.cab[c][1] ? "avocat" : "cabinet"}</span></th><td class="c">${nb(tousC.get(c)[1])}</td><td class="c">${nb(tousC.get(c)[0])}</td><td class="c">${nb(AV.cab[c][2])}</td><td class="c">${nb(AV.cab[c][3])}</td></tr>`).join("")
      + `</tbody></table></div></details>`;
    return h + `<p class="limite">Un lien ne dit rien de la qualité du syndic ni de celle du cabinet. Le relevé se fait par règles : un nom mal découpé peut scinder un cabinet en deux, ou séparer un avocat de son cabinet. Ce n'est pas le jeu de décisions de la grille précédente : il ne retient que les décisions où le syndic représente un syndicat partie, et ses comptes en diffèrent.</p><p class="source">${esc(MENTION_AV)}</p></div>`;
  }
  function rendreFiche() {
    const f = $("fiche"), vues = $("vues"), e = etat.fiche;
    const r = R && e != null ? R.liste.find((y) => y.e === e) : null;
    if (!r) { etat.fiche = null; f.hidden = true; f.innerHTML = ""; vues.classList.remove("avec-fiche"); return; }
    const x = ENTS[e], c = ENC[e];
    vues.classList.add("avec-fiche"); f.hidden = false;
    const ident = x.ei ? "Entrepreneur individuel : nom, SIREN et adresse masqués." : [x.f, x.s ? "SIREN " + x.s.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") : "", x.cr ? "création : " + x.cr : ""].filter(Boolean).join(" · ");
    let h = `<button type="button" class="retour" data-act="fermer">← Retour à la liste</button>`;
    h += `<div class="fiche-tete"><h2 id="fiche-nom" tabindex="-1">${esc(x.n)}</h2><p class="fiche-id">${esc(ident)}</p>${etat.copro != null && ENT[etat.copro] === e ? `<p><span class="etiq">votre syndic déclaré</span></p>` : ""}</div>`;
    h += `<section class="bloc"><h3>Pour votre copropriété</h3><dl class="chiffres">`;
    h += `<div><dt>${esc(titreIci(true).replace(/ ici$/, " " + iciTxt()))}</dt><dd>${nb(r.ici)}</dd></div>`;
    if (r.part) h += `<div><dt>Part de son portefeuille dans le département</dt><dd>${partTxt(r.part[0], r.part[1])}</dd><dd class="limite">Ses copropriétés de ${libTranche(etat.tf)}, sur toutes celles qu'il gère dans le département. Ne permet pas de conclure qu'il accepte un nouveau mandat.</dd></div>`;
    let bur;
    if (x.ei) bur = "adresse masquée";
    else if (r.bk < 0) bur = "non localisé";
    else bur = (r.d != null ? distTxt(r.d) + " à vol d'oiseau " + centreTxt() + " · " : "") + esc(BUR[r.bk][5]) + (BUR[r.bk][4] ? " (siège)" : "");
    h += `<div><dt>${R.ref ? "Bureau le plus proche" : "Bureau"}</dt><dd>${bur}</dd><dd class="limite">Bureau déclaré au répertoire des entreprises ; ses autres établissements ne sont pas localisés.</dd></div>`;
    h += `<div><dt>Taille du syndic</dt><dd>${nb(TOUT_DEPT[e])} ${accord(TOUT_DEPT[e], "copropriété", "copropriétés")} dans le département (${LIB_CLASSE[classeTaille(TOUT_DEPT[e])]})${x.cn ? " · " + nb(x.cn) + " en France" : ""}${x.et ? " · " + nb(x.et) + " " + accord(x.et, "établissement", "établissements") : ""}</dd><dd class="limite">La taille n'est ni un gage ni un défaut.</dd></div>`;
    h += `</dl></section>`;
    h += blocPairs(e);
    h += `<section class="bloc"><h3>Encadrement</h3>`;
    if (!c) h += `<p class="grand">${x.ln > 0 ? "Aucun salarié déclaré" : "Lots en France non connus"}</p><p class="source">Répertoire des entreprises, 2024.</p>`;
    else h += `<p class="grand">Entre ${lotsTxt(c.lo)} et ${lotsTxt(c.hi)} lots par salarié déclaré</p><p class="calcul">${nb(x.ln)} lots gérés en France, divisés par sa tranche d'effectif : ${esc(x.el)} (${esc(x.ea || "année non connue")}).</p>`;
    const P = pairsEnc(e);
    if (P && !P.insuffisant) {
      h += `<div class="bande" aria-hidden="true"><div class="bande-piste"><span class="bande-q" style="left:${posLog(P.q1).toFixed(2)}%;width:${(posLog(P.q3) - posLog(P.q1)).toFixed(2)}%"></span>`;
      h += P.avec.map((j, k) => (j === e ? "" : `<span class="bande-pt" style="left:${posLog(ENC[j].mid).toFixed(2)}%;top:${18 + ((k * 37) % 64)}%"></span>`)).join("");
      if (c) h += `<span class="bande-f" style="left:${posLog(c.lo).toFixed(2)}%;width:${Math.max(0.6, posLog(c.hi) - posLog(c.lo)).toFixed(2)}%"></span>`;
      h += `</div>${axeHtml("bande-axe")}</div>`;
      h += `<p class="pairs">Pairs${P.elargi ? " élargis" : ""} : ${nb(P.n)} syndics de ${libClasses(P.cls)} dans le département, dont ${nb(P.nAvec)} déclarent des salariés (points gris, au milieu de leur fourchette ; bande claire : leur moitié centrale, de ${lotsTxt(P.q1)} à ${lotsTxt(P.q3)} lots par salarié). Échelle logarithmique.</p>`;
    } else if (P) h += `<p class="pairs">Trop peu de syndics de cette taille dans le département pour le situer.</p>`;
    h += `<p class="limite">Ne permet pas de conclure : ni le nombre de gestionnaires de copropriété, ni leur charge. L'effectif compte aussi la location, la vente et la comptabilité, et un groupe peut employer ses salariés dans une autre de ses sociétés.</p>`;
    h += `<p class="source">Lots : registre des copropriétés, toutes ses copropriétés en France, fichier du ${dateFr(M.fichier)}. Effectif : répertoire des entreprises, tranche de 2024.</p></section>`;
    h += blocJustice(e);
    f.innerHTML = h;
  }
  // T2 : chaque indicateur du registre sur la bande de ses pairs, avec sa phrase de position.
  function blocPairs(e) {
    const { S, T } = devCourant(), tl = tlDeTf(etat.tf), c = classeTaille(TOUT_DEPT[e]);
    let h = `<section class="bloc"><h3>Parmi ses pairs</h3>`;
    h += `<p class="pairs">Base : ${esc(baseDev())}, et ce qu'en dit le registre au ${dateFr(M.fichier)} ; pour la tenue des fiches, ${esc(baseMaj())}.${tl >= 0 ? ` La taille retenue est la tranche large qui contient la vôtre.` : ""} Pairs : les syndics de sa taille (${esc(LIB_CLASSE[c])} dans le département), mesurés sur la même base quand elle compte au moins 10 copropriétés.</p>`;
    for (const id of ["i1", "i2", "i3", "i4", "i6"]) h += ligneInd(e, id, S, T);
    const a = S.arrV[e], n0 = S.n0[e];
    h += `<div class="ind"><div class="ind-tete"><span>${esc(IND.i5.titre)}</span><span class="ind-val">${nb(a)}</span></div><p class="pairs">${n0 >= 10 ? nb(Math.round((100 * a) / n0)) + " pour 100 de ses copropriétés de 2025" : nb(a) + " pour " + nb(n0) + " copropriétés de 2025 : trop peu pour un taux"} ; département : ${T.n0 ? nb(Math.round((100 * T.arrV) / T.n0)) : "—"} pour 100. Sans bande à ce stade : un compte d'arrivées peut dépasser la base.</p><p class="limite">${esc(IND.i5.limite)}</p></div>`;
    h += `<div class="ind"><div class="ind-tete"><span>${esc(IND.i7.titre)}</span><span class="ind-val">${nb(S.finK[e])}</span></div><p class="pairs">Sur ${nb(S.finN[e])} ${accord(S.finN[e], "mandat en cours daté", "mandats en cours datés")}, en nombre seulement : la médiane est nulle dans toutes les tailles.</p><p class="limite">${esc(IND.i7.limite)}</p></div>`;
    h += `<p class="limite">Le registre est déclaratif : il dit ce que le syndic a déclaré, et quand. Un syndic qui prend des copropriétés difficiles peut afficher des taux moins bons.</p>`;
    return h + `<p class="source">Registre des copropriétés : fichier du 3e trimestre 2025 (${dateFr(M.t3)}) et fichier du ${dateFr(M.fichier)} ; devenir calculé le 28/10/2026.</p></section>`;
  }
  function ligneInd(e, id, S, T) {
    const I = IND[id], k = S[I.k][e], n = S[I.n][e], P = pairs(e, id, S), ref = T[I.n] ? T[I.k] / T[I.n] : null;
    let h = `<div class="ind"><div class="ind-tete"><span>${esc(I.titre)}</span><span class="ind-val">${n >= 10 ? pctF(k / n) : n ? nb(k) + " sur " + nb(n) : "aucune base"}</span></div>`;
    const ok = P && !P.insuffisant, vu = n >= 10;
    if (ok || vu) {
      const [b, hh] = vu ? wilson(k, n) : [0, 0], mx = ech(Math.max(ok ? P.v[P.v.length - 1] : 0, hh, ref || 0, 0.01)), X = (v) => ((100 * Math.min(v, mx)) / mx).toFixed(2);
      h += `<div class="bande" aria-hidden="true"><div class="bande-piste">`;
      if (ok) h += `<span class="bande-q" style="left:${X(P.q1)}%;width:${(X(P.q3) - X(P.q1)).toFixed(2)}%"></span>` + P.v.map((v, j) => `<span class="bande-pt" style="left:${X(v)}%;top:${18 + ((j * 37) % 64)}%"></span>`).join("");
      if (ref != null) h += `<span class="bande-ref" style="left:${X(ref)}%"></span>`;
      if (vu) h += `<span class="bande-f" style="left:${X(b)}%;width:${Math.max(0.6, X(hh) - X(b)).toFixed(2)}%"></span><span class="bande-p" style="left:${X(k / n)}%"></span>`;
      h += `</div><div class="bande-axe">${[0, mx / 2, mx].map((v) => `<span style="left:${((100 * v) / mx).toFixed(1)}%">${nb(Math.round(100 * v))} %</span>`).join("")}</div></div>`;
    }
    h += `<p class="position">${esc(position(k, n, P))}</p>`;
    const mesure = vu ? `${nb(k)} sur ${nb(n)}, marge à 95 % de ${pctF(wilson(k, n)[0])} à ${pctF(wilson(k, n)[1])}. ` : "";
    const pairsTxt = !P ? "" : P.insuffisant ? "Trop peu de syndics de cette taille dans le département pour le situer. " : `${nb(P.v.length)} pairs${P.elargi ? ", classe élargie à " + libClasses(P.cls) : ""} ; leur moitié centrale va de ${pctF(P.q1)} à ${pctF(P.q3)} (bande claire ; points gris : chacun d'eux). `;
    h += `<p class="pairs">${esc(mesure + pairsTxt)}Département, même base : ${ref != null ? pctF(ref) : "—"} (trait vertical).</p>`;
    return h + `<p class="limite">${esc(I.limite)}</p></div>`;
  }
  // T4 : les décisions de justice rendues à Marseille : J3, J1, J2 et J6, puis J5 et J4 ; l'histoire datée de ses décisions.
  function blocJustice(e) {
    if (!AVEC_J) return `<section class="bloc"><h3>Décisions de justice</h3>${noteJustice()}</section>`;
    let h = `<section class="bloc"><h3>Décisions de justice à Marseille</h3>`;
    if (ENTS[e].ei) return h + `<p>Non renseigné : un entrepreneur individuel n'est rapproché d'aucune décision.</p></section>`;
    const n = BASE_MARS[e], j = JUS.get(e);
    if (!j && !n) return h + `<p>Hors du périmètre lu : il ne gère aucune copropriété à Marseille, et aucune décision du jeu ne le nomme.</p><p class="source">${esc(MENTION_J)}</p></section>`;
    h += `<p class="pairs">Base des taux : ses ${nb(n)} ${accord(n, "copropriété", "copropriétés")} d'aujourd'hui à Marseille, toutes tailles.</p><dl class="chiffres">`;
    for (const id of ["j3", "j1", "j2", "j6", "j5"]) {
      const k = jCompte(e, id), I = JIND[id];
      h += `<div><dt>${esc(I.titre)}</dt><dd>${nb(k)} · ${esc(sur100(k, n))}</dd>${I.mention ? `<dd class="limite">${esc(I.mention)}</dd>` : ""}<dd class="limite">${esc(phraseJustice(e, id))}</dd><dd class="limite">${esc(I.limite)}</dd></div>`;
    }
    const roles = [0, 0, 0];
    if (j) for (const d of j.d) roles[d[5]]++;
    h += `<div><dt>${esc(JIND.j4.titre)}</dt><dd>${nb(j ? j.n : 0)}</dd>${j ? `<dd class="limite">${ORDRE_ROLES.map((r) => esc(JM.role[r]) + " : " + nb(roles[r])).join(" · ")}.</dd>` : ""}<dd class="limite">${esc(JIND.j4.limite)}</dd></div>`;
    if (j && j.fs) h += `<div><dt>Dépens ou frais seuls</dt><dd>${nb(j.fs)}</dd><dd class="limite">${esc(FRAIS_SEULS)}</dd></div>`;
    h += `</dl>`;
    if (j) {
      h += `<div class="histoire"><p class="titre-h">Ses décisions, par année</p>${lignesAnnees(parAnnee(j.d))}</div>`;
      h += `<p class="titre-h">Ses ${nb(j.d.length)} ${accord(j.d.length, "décision", "décisions")}, de la plus récente à la plus ancienne</p><ol class="decisions">${j.d.map(ligneDecision).join("")}</ol>`;
    }
    // les avocats de ses syndicats, d'après le relevé ; le réseau entier est dans « Graphiques »
    const av = AVP.get(e);
    if (av && av[2].length) h += `<p class="titre-h">Les avocats de ses syndicats</p><p class="pairs">${av[2].slice(0, 5).map(([c, k]) => `${esc(AV.cab[c][0])} (${nb(k)})`).join(" · ")}${av[2].length > 5 ? ` · et ${nb(av[2].length - 5)} autres` : ""}.</p><p class="source">Sur ses ${nb(av[0])} ${accord(av[0], "décision", "décisions")} du relevé où il représente un syndicat ; entre parenthèses, le nombre de décisions. ${esc(MENTION_AV)}</p>`;
    return h + `<p class="limite">Une décision frappée d'appel a pu être réformée depuis : chacune se lit avec sa date et son degré.</p><p class="source">${esc(MENTION_J)}</p></section>`;
  }
  function ligneDecision(d) {
    const [date, jur, deg, obj, iss, role, bits, cond, lien] = d;
    const dr = JM.drap.filter((t, k) => bits & (1 << k));
    if (cond === 2) dr.push("dépens ou frais seuls");
    return `<li><span class="dd-tete">${dateFr(date)} · ${esc(JM.jur[jur])}, ${deg ? "appel" : "première instance"}</span><span>${esc(JM.obj[obj])} · ${esc(JM.iss[iss])}</span><span class="sous">${esc(JM.role[role])}</span>${dr.length ? `<span>${dr.map((t) => `<span class="etiq">${esc(t)}</span>`).join("")}</span>` : ""}${lien ? `<a class="lien-dec" href="${JM.prefixe}${lien}" target="_blank" rel="noopener noreferrer">Lire la décision sur Judilibre</a>` : ""}</li>`;
  }
  function rendreSelMobile() {
    const el = $("sel-mobile");
    const r = R && etat.sel != null && etat.fiche == null ? R.liste.find((y) => y.e === etat.sel) : null;
    if (!r) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const quoi = titreIci(true).replace(/^Copropriétés/, accord(r.ici, "copropriété", "copropriétés"));
    el.innerHTML = `<div><strong>${esc(ENTS[r.e].n)}</strong><span>${nb(r.ici)} ${esc(quoi)}</span></div><button type="button" class="btn-fiche" data-act="fiche" data-e="${r.e}">Voir la fiche</button><button type="button" class="btn-x" data-act="desel" aria-label="Retirer la sélection">×</button>`;
  }
  function majSelection() {
    document.querySelectorAll("#tab-corps tr[data-e]").forEach((tr) => {
      const on = Number(tr.dataset.e) === etat.sel;
      tr.classList.toggle("choisi", on);
      const b = tr.querySelector(".nom");
      if (b) b.setAttribute("aria-pressed", String(on));
    });
    rendreGraphiques(); rendreFiche(); rendreSelMobile(); rendreActionsCarte(); dessinerCarte();
    const tr = etat.sel != null ? document.querySelector(`#tab-corps tr[data-e="${etat.sel}"]`) : null, box = $("tab-defile");
    if (tr && box.scrollHeight > box.clientHeight + 2) {
      const d = tr.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (d < 36 || d > box.clientHeight - 40) box.scrollTop += d - box.clientHeight / 3;
    }
  }

  // ---------- la carte des syndics : contours, cercle et bureaux en SVG ; les copropriétés du seul syndic choisi sur un canevas ; projection équirectangulaire,
  // à la latitude moyenne du département. Les contours viennent avec les données ; en direct de l'IGN, ils arrivent après elles, qui
  // n'apportent alors que le cadre de chaque zone : de quoi cadrer la carte avant eux, ou sans eux.
  const CONT = DIRECT ? [] : D.contours.map(([zi, rings]) => ({ zi, rings: rings.map((r) => r.map((v, j) => (j % 2 ? ORIG[0] : ORIG[1]) + v / 1000)) }));
  const BBOX_ZONE = Z.map(() => null);
  const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  CONT.forEach((c) => {
    if (c.zi < 0) return;
    for (const r of c.rings) for (let j = 0; j < r.length; j += 2) BBOX_ZONE[c.zi] = union(BBOX_ZONE[c.zi], [r[j + 1], r[j], r[j + 1], r[j]]);
  });
  if (DIRECT) for (const [zi, a, b, c, d] of D.cadres) BBOX_ZONE[zi] = [ORIG[0] + a / 1000, ORIG[1] + b / 1000, ORIG[0] + c / 1000, ORIG[1] + d / 1000];
  const BBOX_DEPT = BBOX_ZONE.reduce(union, null), BBOX_MARS = ARR.map((i) => BBOX_ZONE[i]).reduce(union, null);
  const dansDept = (la, lo) => la >= BBOX_DEPT[0] && la <= BBOX_DEPT[2] && lo >= BBOX_DEPT[1] && lo <= BBOX_DEPT[3];
  const carte = { w: 0, h: 0, k: 1, lon0: 0, lat1: 0, ox: 0, oy: 0, cos: Math.cos((((BBOX_DEPT[0] + BBOX_DEPT[2]) / 2) * Math.PI) / 180), pos: [], hors: 0 };
  const px = (lon) => (lon - carte.lon0) * carte.cos * carte.k + carte.ox;
  const py = (lat) => (carte.lat1 - lat) * carte.k + carte.oy;
  function bboxZone(zn) {
    if (!zn || etendue(zn)) return BBOX_DEPT;
    return charges(zn).map((m) => (m.k === "mars" ? BBOX_MARS : BBOX_ZONE[m.i])).reduce(union, null) || BBOX_DEPT;
  }
  function bboxCercle() {
    if (!R || !R.ref || !R.rayon) return null;
    const dLa = R.rayon / 111320, dLo = R.rayon / (111320 * Math.cos((R.ref[0] * Math.PI) / 180));
    return [R.ref[0] - dLa, R.ref[1] - dLo, R.ref[0] + dLa, R.ref[1] + dLo];
  }
  function bboxSyndic(e) {
    let b = null;
    for (let i = 0; i < N; i++) if (ENT[i] === e) b = union(b, [LAT[i], LON[i], LAT[i], LON[i]]);
    return b;
  }
  // « Les bureaux » : le lieu, son cercle, et le bureau le plus proche de chaque syndic de la liste, s'il est dans le département.
  // « Ses copropriétés » : le lieu et toutes les copropriétés du syndic choisi dans le département.
  function bboxCadrage() {
    if (!R || etat.cadrage === "dept") return BBOX_DEPT;
    // la couche des copropriétés se cadre sur le lieu et son cercle : elle ne montre que les copropriétés du lieu
    if (etat.couche === "copros") return etendue(etat.zone) ? BBOX_DEPT : union(bboxZone(etat.zone), bboxCercle());
    if (etat.cadrage === "syndic" && etat.sel != null && !ENTS[etat.sel].ei) { const s = bboxSyndic(etat.sel); return s ? union(etendue(etat.zone) ? null : bboxZone(etat.zone), s) : BBOX_DEPT; }
    if (etendue(etat.zone)) return BBOX_DEPT;
    let b = union(bboxZone(etat.zone), bboxCercle());
    if (etat.cadrage === "bureaux") for (const r of R.liste) if (r.bk >= 0) { const o = BUR[r.bk]; if (dansDept(o[1], o[2])) b = union(b, [o[1], o[2], o[1], o[2]]); }
    return b;
  }
  function cadrer(b) {
    const pad = 14, W = carte.w - 2 * pad, H = carte.h - 2 * pad;
    const dx = Math.max((b[3] - b[1]) * carte.cos, 0.004), dy = Math.max(b[2] - b[0], 0.004);
    carte.k = Math.min(W / dx, H / dy);
    carte.lon0 = b[1] - (W / carte.k - dx) / 2 / carte.cos;
    carte.lat1 = b[2] + (H / carte.k - dy) / 2;
    carte.ox = pad; carte.oy = pad;
  }
  function zonesSurlignees() {
    if (!R || etendue(etat.zone)) return new Set();
    return new Set(charges(etat.zone).flatMap((m) => (m.k === "mars" ? ARR : [m.i])));
  }
  function chemin(c) {
    let d = "";
    for (const r of c.rings) {
      for (let j = 0; j < r.length; j += 2) d += (j ? "L" : "M") + px(r[j]).toFixed(1) + "," + py(r[j + 1]).toFixed(1);
      d += "Z";
    }
    return d;
  }
  // ---------- la couleur, sur la seule carte : le type de syndic en trois catégories validées, ou une teinte en quatre marches
  // pour la taille large et la construction. Jamais l'état du mandat.
  const COULEURS = {
    type: { lib: "Type de syndic", cats: ["Syndic professionnel", "Syndic bénévole", "Aucun syndic déclaré, ou type inconnu"], tok: ["--carte-1", "--carte-2", "--carte-3"], de: (i) => (ENT[i] >= 0 || ENT[i] === -4 ? 0 : ENT[i] === -1 ? 1 : 2) },
    taille: { lib: "Taille de la copropriété", cats: LIB_TL, tok: ["--seq-1", "--seq-2", "--seq-3", "--seq-4"], de: (i) => TL[i] },
    constr: { lib: "Période de construction", cats: CLASSES, tok: ["--seq-4", "--seq-3", "--seq-2", "--seq-1"], de: (i) => CLASSE[i] },
  };
  const cleCarte = (t, lib, n) => `<span class="cle"><span class="pastille" style="background: var(${t})"></span>${esc(lib)} : ${nb(n)}</span>`;
  // La bulle d'un point : la copropriété sans son numéro, et son syndic déclaré ; un entrepreneur individuel reste sans nom.
  function texteCopro(i) {
    const e = ENT[i];
    const syn = e >= 0 ? (ENTS[e].ei ? "un entrepreneur individuel, nom masqué" : ENTS[e].n) : e === -1 ? "un syndic bénévole" : e === -4 ? "un syndic professionnel sans SIRET" : "aucun, ou de type inconnu";
    return `Copropriété de ${TF[i] >= 0 ? libTranche(TF[i]) : "taille non connue"}, ${CLASSE[i] >= 0 ? construitesTxt(CLASSE[i], 1) : "de construction non datée"}. Syndic déclaré : ${syn}.`;
  }
  // Une grille de 16 px pour retrouver le point sous le pointeur sans parcourir les 36 000.
  function grilleDe(pts) {
    const g = new Map();
    for (const p of pts) { const k = ((p[1] / 16) | 0) + "," + ((p[2] / 16) | 0); if (!g.has(k)) g.set(k, []); g.get(k).push(p); }
    return g;
  }
  function plusProche(x, y) {
    const g = carte.copos && carte.copos.grille;
    if (!g) return null;
    let best = null, bd = 100;
    const cx = (x / 16) | 0, cy = (y / 16) | 0;
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) for (const p of g.get(a + "," + b) || []) { const d = (p[1] - x) ** 2 + (p[2] - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  // La couche des copropriétés : celles du lieu, de la taille et de la construction réglées, en couleur ; un syndic choisi garde les siennes
  // en couleur, les autres passent en gris clair. Un entrepreneur individuel n'est jamais isolé.
  function dessinerCopros(ctx, w, h, tok) {
    const K = COULEURS[etat.couleur], cols = K.cats.map((x, c) => tok(K.tok[c] || "--point-zone")), gris = tok("--point-zone");
    const filtre = etat.sel != null && !ENTS[etat.sel].ei ? etat.sel : null;
    const rad = carte.k > 6000 ? 3.6 : carte.k > 1500 ? 2.6 : 1.8, pts = [], compte = K.cats.map(() => 0);
    const dedans = (x, y) => x >= -4 && y >= -4 && x <= w + 4 && y <= h + 4;
    let inconnu = 0, vus = 0;
    if (filtre != null) {
      ctx.fillStyle = tok("--point-contexte");
      for (const i of R.retenues) if (ENT[i] !== filtre) { const x = px(LON[i]), y = py(LAT[i]); if (dedans(x, y)) { ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, rad - 0.8), 0, 2 * Math.PI); ctx.fill(); } }
    }
    ctx.strokeStyle = tok("--surface"); ctx.lineWidth = 1;
    for (const i of R.retenues) {
      if (filtre != null && ENT[i] !== filtre) continue;
      const c = K.de(i);
      if (c >= 0 && c < compte.length) compte[c]++; else inconnu++;
      const x = px(LON[i]), y = py(LAT[i]);
      if (!dedans(x, y)) continue;
      vus++;
      ctx.fillStyle = c >= 0 && c < cols.length ? cols[c] : gris;
      ctx.beginPath(); ctx.arc(x, y, filtre != null ? rad + 1 : rad, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      pts.push([i, x, y]);
    }
    carte.copos = { pts, compte, inconnu, vus, filtre, grille: grilleDe(pts) };
  }
  // Zoomer autour d'un point de l'écran : ce qui est sous le pointeur y reste. Déplacer : la carte suit la main.
  // Le geste du visiteur garde son cadre jusqu'au prochain changement de lieu, de cercle ou de cadrage, ou jusqu'à « Recentrer ».
  function zoomer(f, sx, sy, direct) {
    const k0 = carte.k, k1 = Math.max(carte.kMin || 0, Math.min(carte.kMax || Infinity, k0 * f));
    if (!k0 || k1 === k0) return;
    const lon = carte.lon0 + (sx - carte.ox) / (carte.cos * k0), lat = carte.lat1 - (sy - carte.oy) / k0;
    carte.k = k1;
    carte.lon0 = lon - (sx - carte.ox) / (carte.cos * k1);
    carte.lat1 = lat + (sy - carte.oy) / k1;
    garderVue(direct);
  }
  function deplacer(dx, dy, direct) { if (!carte.k) return; carte.lon0 -= dx / (carte.cos * carte.k); carte.lat1 += dy / carte.k; garderVue(direct); }
  function garderVue(direct) { carte.vue = { k: carte.k, lon0: carte.lon0, lat1: carte.lat1, ox: carte.ox, oy: carte.oy }; if (direct) dessinerCarte(); else dessinerBientot(); }
  function recentrer() { carte.vue = null; dessinerCarte(); }
  let minuteurAide = 0;
  function montrerAideCarte(t) { const a = $("carte-aide"); a.textContent = t; a.hidden = false; clearTimeout(minuteurAide); minuteurAide = setTimeout(() => { a.hidden = true; }, 3000); }
  // ---------- les images de l'IGN sous la carte (Géoplateforme, service WMS raster), demandées seulement si le visiteur en choisit.
  // Chacune couvre la vue, se demande 250 ms après le dernier geste et se pose par son propre cadre : elle reste calée pendant qu'on
  // déplace la carte, jusqu'à ce que la suivante arrive. Le cadastre ne se sert qu'en PNG : il se demande à part, transparent, pour
  // que le fond reste en JPEG, cinq fois plus léger.
  const WMS = "https://data.geopf.fr/wms-r/wms", FONDS_CONSULTE = "2026-10-29";
  const URL_DATES_ORTHO = "https://data.geopf.fr/annexes/ressources/fiches/photographies-aeriennes-RVB/geoportail_dates_des_prises_de_vues_aeriennes-RVB.pdf";
  const FONDS = { plan: { lib: "Plan IGN", couche: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", ton: "clair" }, ortho: { lib: "Photographies aériennes", couche: "ORTHOIMAGERY.ORTHOPHOTOS", ton: "photo" } };
  const CALQUES = [
    { id: "carte-fond", couche: () => (etat.fond ? FONDS[etat.fond].couche : ""), ton: () => (etat.fond ? FONDS[etat.fond].ton : ""), format: "image/jpeg" },
    { id: "carte-parcelles", couche: () => (etat.parcelles ? "CADASTRALPARCELS.PARCELLAIRE_EXPRESS" : ""), ton: () => "clair", format: "image/png", transparent: true },
  ].map((c) => Object.assign(c, { vu: "", pose: null, prevu: "", attendu: "", echec: "", minuteur: 0 }));
  const urlCalque = (c, b, W, H) => `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${c.couche()}&STYLES=&CRS=EPSG:4326&BBOX=${b.map((x) => x.toFixed(6)).join(",")}&WIDTH=${W}&HEIGHT=${H}&FORMAT=${c.format}${c.transparent ? "&TRANSPARENT=TRUE" : ""}`;
  function poserCalque(c) {
    const el = $(c.id), P = c.pose;
    if (!P) { el.hidden = true; return; }
    const x0 = px(P.b[1]), y0 = py(P.b[2]);
    el.style.left = x0.toFixed(1) + "px"; el.style.top = y0.toFixed(1) + "px";
    el.style.width = (px(P.b[3]) - x0).toFixed(1) + "px"; el.style.height = (py(P.b[0]) - y0).toFixed(1) + "px";
    el.hidden = false;
  }
  // L'image se charge à part, puis prend la place de la précédente d'un coup : jamais de carte à moitié peinte.
  function demanderCalque(c, url, b, ton) {
    c.attendu = url;
    const img = new Image();
    img.onload = () => {
      if (c.attendu !== url) return;
      Object.assign(c, { attendu: "", echec: "", pose: { url, b } });
      const el = $(c.id); el.src = url; el.className = "carte-fond " + ton; poserCalque(c); rendreLegendeCarte();
    };
    img.onerror = () => { if (c.attendu !== url) return; Object.assign(c, { attendu: "", echec: url }); rendreLegendeCarte(); };
    img.src = url;
  }
  // La vue en degrés, dans l'ordre du WMS 1.3.0 en EPSG:4326 : latitude min, longitude min, latitude max, longitude max.
  function majCalques(w, h) {
    const b = [carte.lat1 - (h - carte.oy) / carte.k, carte.lon0 - carte.ox / (carte.cos * carte.k), carte.lat1 + carte.oy / carte.k, carte.lon0 + (w - carte.ox) / (carte.cos * carte.k)];
    const s = Math.min(1, 2048 / Math.max(w, h)), W = Math.round(w * s), H = Math.round(h * s);
    for (const c of CALQUES) {
      const couche = c.couche(), el = $(c.id);
      if (couche !== c.vu) { clearTimeout(c.minuteur); Object.assign(c, { vu: couche, prevu: "", attendu: "", echec: "" }); }
      if (!couche) { c.pose = null; el.hidden = true; el.removeAttribute("src"); continue; }
      poserCalque(c);
      const url = urlCalque(c, b, W, H), ton = c.ton();
      if (url === c.prevu || url === c.attendu || url === c.echec || (c.pose && c.pose.url === url)) continue;
      clearTimeout(c.minuteur); c.prevu = url;
      c.minuteur = setTimeout(() => { c.prevu = ""; demanderCalque(c, url, b, ton); }, 250);
    }
  }
  // La mention des images de l'IGN, et ce qui a manqué : un serveur muet, ou un aperçu qui bloque les images venues d'un autre site.
  function mentionCalques() {
    if (!etat.fond && !etat.parcelles) return "";
    const quoi = [etat.fond ? FONDS[etat.fond].lib : "", etat.parcelles ? "parcelles du cadastre" : ""].filter(Boolean).join(" et ");
    let t = esc(`${cap(quoi)} : IGN, Géoplateforme, sous Licence Ouverte.`);
    if (etat.fond === "ortho") t += ` La date des photographies dépend du département : <a href="${URL_DATES_ORTHO}" target="_blank" rel="noopener noreferrer">tableau de l'IGN</a>.`;
    if (etat.parcelles) t += esc(" Les parcelles se dessinent quand on zoome sur un quartier ; de plus loin, seules les limites des communes et des arrondissements paraissent.");
    if (CALQUES.some((c) => c.echec)) t += esc(" Une image n'a pas pu être chargée : le serveur de l'IGN ne répond pas, ou la page est ouverte dans un aperçu qui bloque les images venues d'un autre site.");
    return `<span>${t}</span>`;
  }
  function dessinerCarte() {
    const boite = $("carte-boite"), w = boite.clientWidth, h = boite.clientHeight;
    if (!w || !h) return;
    demanderContours();
    carte.w = w; carte.h = h;
    const cle = [JSON.stringify(etat.zone), JSON.stringify(etat.adresseLieu), etat.rayon, etat.copro, etat.tf, etat.constr, etat.couche, etat.cadrage, etat.cadrage === "syndic" ? etat.sel : "", R ? 1 : 0, w, h].join("|");
    if (cle !== carte.cleCadre) { carte.cleCadre = cle; carte.vue = null; }
    carte.kMin = 0.8 * Math.min((w - 28) / ((BBOX_DEPT[3] - BBOX_DEPT[1]) * carte.cos), (h - 28) / (BBOX_DEPT[2] - BBOX_DEPT[0]));
    carte.kMax = 250000;
    if (carte.vue) Object.assign(carte, carte.vue); else cadrer(bboxCadrage());
    const pz = R ? pointDe(etat.zone) : null;
    boite.setAttribute("aria-label", `Carte ${!R || etendue(etat.zone) ? "du département" : pz ? deZone(pz) : "des lieux choisis"}. Flèches pour déplacer la carte, plus et moins pour zoomer, zéro pour recentrer.`);
    const cv = $("carte-points"), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement), tok = (n) => css.getPropertyValue(n).trim();
    // Les copropriétés n'apparaissent que pour le syndic choisi : toutes les siennes du département en points cerclés,
    // celles qui ressemblent à la vôtre ici en gros points foncés, par-dessus. Les carrés des autres syndics s'évident (SVG, au-dessus).
    carte.points = null; carte.copos = null;
    if (R && etat.couche === "copros") dessinerCopros(ctx, w, h, tok);
    else if (R && etat.sel != null && !ENTS[etat.sel].ei) {
      const r1 = carte.k > 1500 ? 3.6 : 2.8, r2 = r1 + 2.2, ici = new Set();
      for (const i of R.retenues) if (ENT[i] === etat.sel) ici.add(i);
      const rond = (i, rad) => { const x = px(LON[i]), y = py(LAT[i]); if (x < -6 || y < -6 || x > w + 6 || y > h + 6) return 0; ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); return 1; };
      let tous = 0, vus = 0;
      ctx.strokeStyle = tok("--surface"); ctx.lineWidth = 1; ctx.fillStyle = tok("--point-zone");
      for (let i = 0; i < N; i++) if (ENT[i] === etat.sel && !ici.has(i)) { tous++; vus += rond(i, r1); }
      ctx.lineWidth = 1.5; ctx.fillStyle = tok("--point-choisi");
      for (const i of ici) { tous++; vus += rond(i, r2); }
      carte.points = { tous, vus, ici: ici.size };
    }
    const surl = zonesSurlignees();
    let fond = "", zone = "", cercle = "", bur = "", choisis = "";
    const compte = { hors: 0, horsDept: 0, sans: 0 };
    for (const c of CONT) { const d = chemin(c); if (surl.has(c.zi)) zone += `<path class="contour zone" d="${d}"/>`; else fond += `<path class="contour" d="${d}"/>`; }
    if (R && R.ref) {
      const cx = px(R.ref[1]), cy = py(R.ref[0]);
      if (R.rayon) cercle += `<circle class="cercle" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${((R.rayon / 111320) * carte.k).toFixed(1)}"/>`;
      cercle += `<path class="centre" d="M${(cx - 5).toFixed(1)},${cy.toFixed(1)}h10M${cx.toFixed(1)},${(cy - 5).toFixed(1)}v10"/>`;
    }
    carte.pos = [];
    if (!R) {
      for (const b of BUR) {
        const x = px(b[2]), y = py(b[1]);
        if (x >= 0 && y >= 0 && x <= w && y <= h) bur += `<rect class="bureau anonyme" x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6"/>`;
      }
    } else {
      // Un carré par syndic de la liste, à son bureau le plus proche ; son côté suit la racine du nombre de copropriétés retenues ici.
      const maxIci = R.liste.reduce((m, r) => Math.max(m, r.ici), 1), marques = [];
      // la couche des copropriétés ne montre pas les carrés des syndics, seulement les bureaux de celui qui est choisi
      for (const r of etat.couche === "syndics" ? R.liste : []) {
        if (r.bk < 0) { compte.sans++; continue; }
        const b = BUR[r.bk];
        if (!dansDept(b[1], b[2])) { compte.horsDept++; continue; }
        const x = px(b[2]), y = py(b[1]);
        if (x < 0 || y < 0 || x > w || y > h) { compte.hors++; continue; }
        marques.push({ r, x, y, s: 6 + 14 * Math.sqrt(r.ici / maxIci) });
      }
      marques.sort((a, b) => b.s - a.s);
      for (const m of marques) {
        carte.pos.push([m.r.e, m.x, m.y, m.s]);
        if (m.r.e !== etat.sel) bur += `<rect class="bureau${etat.sel != null ? " estompe" : ""}" x="${(m.x - m.s / 2).toFixed(1)}" y="${(m.y - m.s / 2).toFixed(1)}" width="${m.s.toFixed(1)}" height="${m.s.toFixed(1)}"><title>${esc(ENTS[m.r.e].n)} : ${nb(m.r.ici)} ${accord(m.r.ici, "copropriété", "copropriétés")}</title></rect>`;
      }
      const rs = etat.sel != null && !ENTS[etat.sel].ei ? R.liste.find((r) => r.e === etat.sel) : null;
      if (rs) for (const k of BUR_DE[rs.e]) {
        const b = BUR[k], x = px(b[2]), y = py(b[1]);
        if (x < 0 || y < 0 || x > w || y > h) continue;
        const proche = k === rs.bk, s = proche ? 14 : 10, g = x > w * 0.6;
        choisis += `<rect class="bureau choisi" x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s}" height="${s}"/>`;
        if (proche) choisis += `<text class="etiq-carte" x="${(g ? x - 12 : x + 12).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${g ? "end" : "start"}">${esc(court(ENTS[rs.e].n, 34))}</text>`;
      }
    }
    const svg = $("carte-svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = fond + zone + cercle + bur + choisis;
    carte.compte = compte;
    majCalques(w, h);
    boite.classList.toggle("avec-fond", CALQUES.some((c) => !!c.couche()));
    rendreLegendeCarte();
  }
  let rafCarte = 0;
  function dessinerBientot() { cancelAnimationFrame(rafCarte); rafCarte = requestAnimationFrame(dessinerCarte); }
  // Les contours en direct : les communes du département, et les arrondissements de la commune qui en a, demandés une fois au
  // service WFS de la Géoplateforme, par le code du département ou de la commune, jamais par un cadre tiré de la copropriété du
  // visiteur. Le service doit tout rendre : le nombre trouvé égale le nombre rendu. Les points s'arrondissent au dix-millième de degré.
  const WFS = "https://data.geopf.fr/wfs/ows", WFS_CONSULTE = "2026-10-29";
  const contoursIGN = { etat: DIRECT ? "à demander" : "dans la page" };
  function demanderContours() {
    if (contoursIGN.etat !== "à demander") return;
    contoursIGN.etat = "demandés";
    const ZI = new Map(Z.map((z, i) => [z[0], i]));
    const couche = (nom, filtre) => fetch(WFS + "?" + new URLSearchParams({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: "ADMINEXPRESS-COG-CARTO.LATEST:" + nom, OUTPUTFORMAT: "application/json", CQL_FILTER: filtre }))
      .then((r) => { if (!r.ok) throw new Error("IGN : réponse " + r.status); return r.json(); })
      .then((j) => { if (!Array.isArray(j.features) || j.numberMatched !== j.numberReturned) throw new Error("IGN : réponse incomplète"); return j.features; });
    const demandes = [couche("commune", "code_insee_du_departement='" + M.dept + "'")];
    if (MARS >= 0) demandes.push(couche("arrondissement_municipal", "code_insee_de_la_commune_de_rattach='" + Z[MARS][0] + "'"));
    Promise.all(demandes).then((lots) => {
      for (const f of [].concat(...lots)) {
        const code = f.properties && f.properties.code_insee, g = f.geometry;
        // la commune découpée se dessine par ses arrondissements, comme dans les contours venus avec les données
        if (!g || (MARS >= 0 && code === Z[MARS][0])) continue;
        const rings = [];
        for (const poly of g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) for (const anneau of poly) {
          const r = [];
          for (const [lon, lat] of anneau) {
            const x = Math.round(lon * 1e4) / 1e4, y = Math.round(lat * 1e4) / 1e4;
            if (r.length && r[r.length - 2] === x && r[r.length - 1] === y) continue;
            r.push(x, y);
          }
          if (r.length >= 6) rings.push(r);
        }
        CONT.push({ zi: ZI.has(code) ? ZI.get(code) : -1, rings });
      }
      contoursIGN.etat = "reçus";
      dessinerBientot();
    }).catch(() => { contoursIGN.etat = "manquants"; dessinerBientot(); });
  }
  // Ce que la légende dit des contours en direct : leur attente, ou leur absence ; rien quand ils sont là.
  function mentionContours() {
    if (contoursIGN.etat === "demandés") return `<span>Les contours des communes sont demandés à l'IGN.</span>`;
    if (contoursIGN.etat === "manquants") return `<span>Les contours des communes n'ont pas pu être demandés à l'IGN : la carte montre les points seuls.</span>`;
    return "";
  }
  function rendreLegendeCarte() {
    const el = $("carte-legende"), c = carte.compte || { hors: 0, horsDept: 0, sans: 0 };
    if (!R) { el.innerHTML = `<span>Carrés : les bureaux déclarés des syndics professionnels du département chargé, sans leur nom. ${etat.zone ? "Aucun des lieux choisis n'est chargé sur cette page." : "Tapez un lieu pour voir ceux qui y gèrent des copropriétés."}</span>` + mentionContours() + mentionCalques(); rendreTableCarte(""); return; }
    const quoi = minuscule(titreIci(true)).replace(/ ici$/, "");
    const p = [];
    if (etat.couche === "copros" && carte.copos) {
      const K = COULEURS[etat.couleur], cc = carte.copos, tot = cc.compte.reduce((s, v) => s + v, 0) + cc.inconnu;
      p.push(`<span>Points : ${cc.filtre != null ? `les ${nb(tot)} ${esc(quoi)} que ${esc(ENTS[cc.filtre].n)} gère ${esc(iciTxt())}, en couleur ; les autres, en gris clair` : `les ${nb(tot)} ${esc(quoi)} ${esc(iciTxt())}`}. Couleur : ${esc(minuscule(K.lib))}. Un clic sur un point choisit son syndic professionnel.</span>`);
      p.push(...K.cats.map((lib, k) => cleCarte(K.tok[k] || "--point-zone", lib, cc.compte[k])));
      if (cc.inconnu) p.push(cleCarte("--point-zone", "Non connue", cc.inconnu));
      if (tot > cc.vus) p.push(`<span>${nb(tot - cc.vus)} ${accord(tot - cc.vus, "point est", "points sont")} hors du cadre : « Recentrer » ${accord(tot - cc.vus, "le", "les")} montre.</span>`);
    } else p.push(`<span>Carrés : un par syndic de la liste, ${R.ref ? "à son bureau le plus proche" : "à son siège, ou à défaut à l'un de ses bureaux"} ; la taille du carré suit le nombre de ${esc(quoi)} que ce syndic gère ${esc(iciTxt())}. Un clic en choisit un.</span>`);
    if (R.ref) p.push(`<span>Croix : ${etat.copro != null ? "votre copropriété" : "le centre " + esc(deZone(refZone()))}${R.rayon ? ` ; tirets : le cercle de ${kmTxt(R.rayon)}` : ""}.</span>`);
    const pts = carte.points;
    if (etat.sel != null && pts) {
      const hors = pts.tous - pts.vus;
      p.push(`<span>Le syndic choisi : ses bureaux en carrés pleins ; ses ${nb(pts.tous)} ${accord(pts.tous, "copropriété", "copropriétés")} du département en points${pts.ici ? `, dont ${nb(pts.ici)} ${esc(quoi)} ${esc(iciTxt())} en gros points foncés` : ""}. Les carrés des autres syndics s'évident.${hors ? ` ${nb(hors)} ${accord(hors, "est", "sont")} hors du cadre : « Ses copropriétés » ${accord(hors, "la", "les")} montre.` : ""}</span>`);
    }
    if (c.sans) p.push(`<span>${nb(c.sans)} ${accord(c.sans, "syndic de la liste n'a aucun bureau localisé : il n'est", "syndics de la liste n'ont aucun bureau localisé : ils ne sont")} pas sur la carte.</span>`);
    if (c.horsDept) p.push(`<span>${nb(c.horsDept)} ${accord(c.horsDept, "syndic de la liste a son bureau le plus proche", "syndics de la liste ont leur bureau le plus proche")} hors du département.</span>`);
    if (c.hors) p.push(`<span>${nb(c.hors)} ${accord(c.hors, "bureau est", "bureaux sont")} hors du cadre : « Les bureaux » ou « Le département » élargit la vue.</span>`);
    if (etat.sel != null && ENTS[etat.sel].ei) p.push(`<span>Le syndic choisi est un entrepreneur individuel : la carte ne montre ni son nom, ni ses bureaux, ni ses copropriétés, pour ne pas le désigner.</span>`);
    p.push(mentionContours(), mentionCalques());
    el.innerHTML = p.join("");
    rendreTableCarte(quoi);
  }
  // Le tableau jumeau de la couche des copropriétés : les mêmes comptes que la légende, lisibles sans la couleur.
  function rendreTableCarte(quoi) {
    const d = $("carte-tab"), cc = carte.copos;
    if (!R || etat.couche !== "copros" || !cc) { d.hidden = true; $("carte-tab-corps").innerHTML = ""; return; }
    const K = COULEURS[etat.couleur], tot = cc.compte.reduce((s, v) => s + v, 0) + cc.inconnu;
    const ligne = (lib, n) => `<tr><th scope="row">${esc(lib)}</th><td>${nb(n)}</td><td>${tot ? pctNb(n, tot) + " %" : "—"}</td></tr>`;
    d.hidden = false;
    $("carte-tab-corps").innerHTML = `<table class="tab-mini"><caption>${esc(cap(quoi))} ${esc(iciTxt())}${cc.filtre != null ? ", chez " + esc(ENTS[cc.filtre].n) : ""}, selon ${esc(minuscule(K.lib))}</caption><thead><tr><th scope="col">${esc(K.lib)}</th><th scope="col">Copropriétés</th><th scope="col">Part</th></tr></thead><tbody>${K.cats.map((lib, k) => ligne(lib, cc.compte[k])).join("")}${cc.inconnu ? ligne("Non connue", cc.inconnu) : ""}</tbody></table>`;
  }
  // Les réglages de la carte : la couche, la couleur des points, et le syndic, le même que dans le tableau. Les entrepreneurs individuels n'y figurent pas.
  // Les images de l'IGN se règlent toujours, même sans lieu choisi.
  function rendreReglagesCarte() {
    const el = $("carte-reglages"), f = document.activeElement && document.activeElement.id;
    const images = `<label class="trier" for="carte-fond-choix">Fond de carte <select id="carte-fond-choix"><option value="">Aucun</option>${Object.entries(FONDS).map(([k, F]) => `<option value="${k}"${k === etat.fond ? " selected" : ""}>${esc(F.lib)}</option>`).join("")}</select></label>` + puce("parcelles", "1", "Parcelles du cadastre", etat.parcelles, "petite");
    el.hidden = false;
    if (!R) el.innerHTML = images;
    else {
      const synd = R.liste.filter((r) => !ENTS[r.e].ei).sort((a, b) => b.ici - a.ici || parNom(a, b));
      el.innerHTML = `<span class="trier">Montrer</span>` + puce("couche", "syndics", "Les syndics", etat.couche === "syndics", "petite") + puce("couche", "copros", "Les copropriétés", etat.couche === "copros", "petite") +
        (etat.couche === "copros" ? `<label class="trier" for="carte-couleur">Couleur <select id="carte-couleur">${Object.entries(COULEURS).map(([k, K]) => `<option value="${k}"${k === etat.couleur ? " selected" : ""}>${esc(K.lib)}</option>`).join("")}</select></label>` : "") +
        `<label class="trier" for="carte-syndic">Syndic <select id="carte-syndic"><option value="">Tous ceux de la liste</option>${synd.map((r) => `<option value="${r.e}"${r.e === etat.sel ? " selected" : ""}>${esc(court(ENTS[r.e].n, 40))} (${nb(r.ici)})</option>`).join("")}</select></label>` + images;
    }
    if (f === "carte-couleur" || f === "carte-syndic" || f === "carte-fond-choix") { const n = $(f); if (n && n.focus) n.focus(); }
  }
  function rendreActionsCarte() {
    const el = $("carte-actions");
    rendreReglagesCarte();
    if (!R) { el.innerHTML = ""; return; }
    const large = etendue(etat.zone), plusieurs = charges(etat.zone).length > 1;
    const ch = large ? [] : [["zone", R.rayon ? (plusieurs ? "Les lieux et le cercle" : "Le lieu et son cercle") : plusieurs ? "Les lieux" : "Le lieu"]];
    // « Les bureaux » et « Ses copropriétés » n'ont de sens que sur la couche des syndics
    if (etat.couche === "syndics" && !large) ch.push(["bureaux", "Les bureaux"]);
    if (etat.couche === "syndics" && etat.sel != null && !ENTS[etat.sel].ei) ch.push(["syndic", "Ses copropriétés"]);
    ch.push(["dept", "Le département"]);
    // au département, sans syndic choisi, il n'y a qu'un cadrage : pas de bouton
    const actif = large && etat.cadrage !== "syndic" ? "dept" : etat.couche === "copros" && etat.cadrage !== "dept" ? "zone" : etat.cadrage;
    el.innerHTML = ch.length < 2 ? "" : ch.map(([v, l]) => puce("cadrage", v, l, actif === v, "petite")).join("");
  }

  // ---------- champs de lieu, avec liste de propositions
  function champLieu(inp, ul, opts) {
    let items = [], actif = -1;
    const fermer = () => { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); actif = -1; inp.removeAttribute("aria-activedescendant"); };
    const marquer = () => {
      Array.from(ul.children).forEach((li, k) => li.classList.toggle("actif", k === actif));
      if (actif >= 0) inp.setAttribute("aria-activedescendant", ul.id + "-" + actif); else inp.removeAttribute("aria-activedescendant");
    };
    function maj() {
      const q = inp.value.trim();
      items = [];
      if (!q) { ul.innerHTML = ""; fermer(); return; }
      // « Votre copropriété » prend un numéro ou une adresse ; « Où chercher », des lieux. Chacun renvoie à l'autre ce qui n'est pas à lui.
      const num = commeNumero(q);
      if (num && opts.numero) {
        const i = IMMAT.get(num);
        items.push(i != null ? { lib: "Copropriété n° " + num, sous: nb(LOTS[i]) + " lots · " + nomZ(ZONE[i]), copro: i }
          : NATIONAL ? { lib: "N° " + num, sous: "absent de ce département : Entrée le cherche dans les autres", chercher: num }
          : { lib: "N° " + num, sous: "absent du registre du département", inactif: true });
      } else if (num) items.push({ lib: "N° " + num, sous: "un numéro de copropriété se tape dans « Votre copropriété »", inactif: true });
      else if (opts.adresse) {
        const l = ressembleAdresse(q) ? lieuDansAdresse(q) : null;
        if (!ressembleAdresse(q)) items.push({ lib: "Tapez le numéro de la copropriété, ou son adresse", sous: "un numéro compte deux lettres et sept chiffres ; une adresse, sa commune", inactif: true });
        else items.push(l ? { lib: "Adresse : " + q, sous: "non localisée : la page la ramène à " + l.lib, zone: l.zone, adresse: q } : { lib: "Adresse : " + q, sous: MARS < 0 ? "ajoutez la commune" : "ajoutez la commune, ou le code postal à " + VILLE, inactif: true });
      } else {
        if (/^\d{5}$/.test(q)) {
          const l = lieuDuCodePostal(q), dep = depDuCodePostal(q);
          if (l) items.push({ lib: l.lib, sous: "code postal " + q, zone: l.zone });
          else if (DEPS.has(dep) && dep !== M.dept) items.push({ lib: libZone({ k: "dep", code: dep }), sous: "code postal " + q + (NATIONAL ? " : département à charger" : " : département pas encore chargé"), zone: { k: "dep", code: dep }, cp: q });
          else items.push({ lib: "Code postal " + q, sous: "tapez plutôt le nom de la commune", inactif: true });
        }
        chercherLieux(q).forEach((l) => { const deja = opts.deja(l.zone); items.push({ lib: l.lib, sous: deja ? "déjà choisi" : l.sous, zone: l.zone, inactif: deja }); });
        if (!items.length) items.push(ressembleAdresse(q) ? { lib: "Une adresse se tape dans « Votre copropriété »", sous: "ici, un lieu : commune, arrondissement, département, région ou France", inactif: true }
          : { lib: "Aucun lieu de ce nom", sous: NATIONAL ? "parmi les communes et arrondissements, les départements, les régions et la France" : "parmi les communes chargées, les départements, les régions et la France", inactif: true });
      }
      ul.innerHTML = items.map((it, k) => `<li role="option" id="${ul.id}-${k}" data-k="${k}"${it.inactif ? ' aria-disabled="true" class="inactif"' : ""}><span>${esc(it.lib)}</span>${it.sous ? `<small>${esc(it.sous)}</small>` : ""}</li>`).join("");
      ul.hidden = false;
      inp.setAttribute("aria-expanded", "true");
      actif = -1;
      marquer();
    }
    function prendre(k) {
      const it = items[k];
      if (!it || it.inactif) return;
      fermer();
      // un lieu choisi devient une étiquette : le champ se vide pour le suivant
      inp.value = opts.vider ? "" : it.copro != null ? immatDe(it.copro) : it.chercher || it.adresse || it.lib;
      opts.choix(it);
    }
    inp.addEventListener("input", maj);
    inp.addEventListener("focus", () => { if (inp.value.trim() && opts.rouvrir) maj(); });
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (ul.hidden) maj();
        const idx = items.map((it, k) => (it.inactif ? -1 : k)).filter((k) => k >= 0);
        if (!idx.length) return;
        ev.preventDefault();
        let p = idx.indexOf(actif);
        p = ev.key === "ArrowDown" ? (p + 1) % idx.length : p <= 0 ? idx.length - 1 : p - 1;
        actif = idx[p];
        marquer();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (ul.hidden) maj();
        prendre(actif >= 0 ? actif : items.findIndex((it) => !it.inactif));
      } else if (ev.key === "Escape") fermer();
    });
    ul.addEventListener("mousedown", (ev) => { const li = ev.target.closest("li[data-k]"); if (li) { ev.preventDefault(); prendre(Number(li.dataset.k)); } });
    inp.addEventListener("blur", () => window.setTimeout(fermer, 150));
  }

  // ---------- branchements

  // Deux champs. « Où chercher » : des lieux qui s'ajoutent les uns aux autres, réunis. « Votre copropriété » : un numéro, qui règle
  // aussi la jauge et la construction, ou une adresse, ramenée à son lieu ; sans lieu choisi, celui de la copropriété en devient un.
  // Un nouveau lieu retire les étiquettes et le filtre des décisions, et replie les listes ; la première fois, il ouvre le tableau.
  const nouveauLieu = () => {
    Object.assign(etat, { sel: null, fiche: null, cadrage: "bureaux", triChoisi: false, filtres: {}, filtreDec: null, modeTab: "syndics", tout: {} });
    if (!etat.ongletChoisi) etat.onglet = "tableau";
  };
  function poserLieux(L) {
    nouveauLieu();
    etat.lieux = L;
    etat.zone = !L.length ? null : L.length === 1 ? L[0] : { k: "multi", zones: L };
  }
  // Un lieu plus large absorbe ceux qu'il contient ; un lieu plus fin remplace celui qui le contient (Aubagne après le département).
  const ajouterLieu = (zn) => poserLieux(etat.lieux.filter((m) => !contient(zn, m) && !contient(m, zn)).concat([zn]));
  // La page nationale ne charge qu'un département à la fois : un lieu ou un numéro d'un autre le charge à la place de celui-ci.
  // Le lieu ou le numéro passe à la page rechargée par le stockage local du navigateur, que son amorce efface dès la relecture.
  const CLE_RELAIS = "syndicoscope.relais";
  function changerDeDepartement(dep, relais) {
    try { localStorage.setItem(CLE_RELAIS, JSON.stringify(Object.assign({ dep, depuis: M.dept }, relais))); } catch (e) { /* le lieu sera à retaper */ }
    location.hash = dep;
    location.reload();
  }
  const direNational = (t) => { const el = $("note-national"); if (el) { el.textContent = t; el.hidden = false; } };
  // Un numéro absent du département chargé : le fragment de l'index national qui porte ses trois premiers caractères dit son département.
  function chercherNumero(num) {
    const MN = window.SYNDICO_MANIFESTE, f = MN.immat.fragments[num.slice(0, 3)], suite = Number(num.slice(3));
    if (!f) return direNational("Le numéro " + num + " n'est au registre d'aucun département.");
    direNational("Recherche du numéro " + num + " dans les autres départements…");
    fetch(MN.immat.modele.replace("{prefixe}", num.slice(0, 3)).replace("{empreinte}", f))
      .then((r) => { if (!r.ok) throw new Error("réponse " + r.status); return r.json(); })
      .then((x) => {
        const dep = Object.keys(x.d).find((c) => x.d[c].includes(suite));
        if (dep && dep !== M.dept && MN.deps[dep]) changerDeDepartement(dep, { copro: num });
        else direNational("Le numéro " + num + " n'est au registre d'aucun département.");
      })
      .catch(() => direNational("L'index des numéros n'a pas pu être lu. Réessayez dans un instant."));
  }
  const ailleurs = (zn) => NATIONAL && (zn.k === "ailleurs" || zn.k === "dep");
  champLieu($("lieu"), $("lieu-liste"), {
    vider: true, rouvrir: true,
    deja: (zn) => etat.lieux.some((m) => memeLieu(m, zn)),
    choix: (it) => {
      if (ailleurs(it.zone)) return changerDeDepartement(it.zone.k === "dep" ? it.zone.code : it.zone.dep, { lieu: it.zone.code, cp: it.cp });
      ajouterLieu(it.zone); nouveauxCriteres();
    },
  });
  // Une copropriété choisie par son numéro règle la jauge et la construction ; sans lieu choisi, le sien en devient un.
  function prendreCopro(i) {
    Object.assign(etat, { copro: i, adresse: null, adresseLieu: null, tf: TF[i], constr: CLASSE[i] });
    if (!etat.lieux.length) poserLieux([{ k: "z", i: ZONE[i] }]);
  }
  champLieu($("copro"), $("copro-liste"), {
    numero: true, adresse: true, rouvrir: true,
    choix: (it) => {
      if (it.chercher) return chercherNumero(it.chercher);
      if (it.copro != null) prendreCopro(it.copro);
      else {
        Object.assign(etat, { copro: null, adresse: it.adresse, adresseLieu: it.zone });
        if (!etat.lieux.length) poserLieux([it.zone]);
      }
      nouveauxCriteres();
    },
  });
  // Vider le champ oublie la copropriété ; la jauge et la construction gardent leur réglage.
  $("copro").addEventListener("input", () => {
    if ($("copro").value.trim() || (etat.copro == null && !etat.adresse)) return;
    Object.assign(etat, { copro: null, adresse: null, adresseLieu: null });
    nouveauxCriteres();
  });
  $("dept-tout").addEventListener("click", () => {
    poserLieux([{ k: "dept" }]);
    $("lieu").value = "";
    nouveauxCriteres();
  });
  // La jauge : l'étiquette suit le geste ; le calcul attend que la main se pose, ou le relâchement.
  let attenteJauge = 0;
  const lireJauge = () => { const v = Number($("taille").value); etat.tf = v > 0 ? v - 1 : -1; };
  $("taille").addEventListener("input", () => {
    lireJauge();
    $("taille-val").textContent = libJauge();
    $("taille").setAttribute("aria-valuetext", libJauge());
    window.clearTimeout(attenteJauge);
    attenteJauge = window.setTimeout(nouveauxCriteres, 140);
  });
  $("taille").addEventListener("change", () => { window.clearTimeout(attenteJauge); lireJauge(); nouveauxCriteres(); });
  $("rayon").addEventListener("change", () => { etat.rayon = Number($("rayon").value); nouveauxCriteres(); });
  $("constr").addEventListener("change", () => { etat.constr = Number($("constr").value); nouveauxCriteres(); });

  // Un clic dans « Ensemble » (ou sur une case de la grille des décisions) ouvre la vue nominative qu'il compte, avec son étiquette.
  // Sans lieu, il prend tout le département : les noms n'apparaissent qu'après ce geste du visiteur.
  function voirDepuisEnsemble(act, v) {
    const auTableau = () => Object.assign(etat, { onglet: "tableau", ongletChoisi: true, modeTab: "syndics", filtreDec: null });
    if (!etat.zone) poserLieux([{ k: "dept" }]);
    if (act === "voir-classe") { etat.filtres.classe = Number(v); auTableau(); }
    else if (act === "voir-tranche") { etat.tf = Number(v); auTableau(); }
    else if (act === "voir-top") { etat.filtres.top = Number(v); Object.assign(etat, { tri: "ici", sens: "desc", triChoisi: true }); auTableau(); }
    else if (act === "voir-type") { etat.tf = Number(v); Object.assign(etat, { onglet: "carte", ongletChoisi: true, couche: "copros", couleur: "type" }); }
    else if (act === "voir-dev" || act === "voir-reg") {
      const [id, c] = v.split(":");
      if (Number(c) >= 0) etat.filtres.classe = Number(c); else delete etat.filtres.classe;
      Object.assign(etat, { tri: id, sens: SENS[id] || "desc", triChoisi: true });
      auTableau();
    } else if (act === "voir-soc") { const k = v.indexOf(":"), cle = v.slice(0, k), val = v.slice(k + 1); etat.filtres[cle] = cle === "forme" ? val : Number(val); auTableau(); }
    else if (act === "voir-dec") { auTableau(); Object.assign(etat, { modeTab: "decisions", filtreDec: lireFiltreDec(v) }); }
    nouveauxCriteres();
    const h = $("h-" + etat.onglet);
    if (h && h.focus) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  // Le bandeau de soutien : « Donner mon avis » ouvre et ferme son panneau ; Échap le ferme.
  function basculerAvis(ouvrir) {
    $("avis").hidden = !ouvrir; $("btn-avis").setAttribute("aria-expanded", String(ouvrir));
    if (ouvrir && !PUBLIC) { $("avis-contexte").value = contexteAvis(); avisOuvertA = Date.now(); }
  }
  for (const id of ["soutien", "avis"]) $(id).addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && $("btn-avis").getAttribute("aria-expanded") === "true") { basculerAvis(false); $("btn-avis").focus(); }
  });
  $("app").addEventListener("click", (ev) => {
    if (ev.target.closest("a")) return;
    const b = ev.target.closest("[data-act], [data-tri], [data-vue]");
    if (b) {
      if (b.dataset.tri) return choisirTri(b.dataset.tri, false);
      if (b.dataset.vue) { Object.assign(etat, { onglet: b.dataset.vue, ongletChoisi: true }); placerVues(); dessinerBientot(); return; }
      const act = b.dataset.act, e = Number(b.dataset.e), v = b.dataset.v;
      if (act === "sel") return choisir(e);
      if (act === "fiche") return ouvrirFiche(e);
      if (act === "fermer") return fermerFiche();
      if (act === "desel") return choisir(null);
      if (act === "cadrage") { etat.cadrage = v; garderFocus(rendreActionsCarte); return dessinerCarte(); }
      if (act === "couche") { etat.couche = v; $("carte-bulle").hidden = true; garderFocus(rendreActionsCarte); return dessinerCarte(); }
      if (act === "parcelles") { etat.parcelles = !etat.parcelles; garderFocus(rendreActionsCarte); return dessinerCarte(); }
      if (act === "zoom") { if (v === "recentrer") return recentrer(); return zoomer(v === "plus" ? 1.6 : 1 / 1.6, carte.w / 2, carte.h / 2, true); }
      if (act === "groupe") return choisirGroupe(v);
      if (act === "choix-col") { etat.choixCol = !etat.choixCol; return garderFocus(rendreTableau); }
      if (act === "aide-col") { etat.aideCol = etat.aideCol === v ? null : v; return garderFocus(rendreTableau); }
      if (act && act.startsWith("col-")) { if (b.getAttribute && b.getAttribute("aria-disabled") === "true") return; return modifierColonnes(act, v); }
      if (act === "avis") return basculerAvis($("btn-avis").getAttribute("aria-expanded") !== "true");
      if (act === "filtres") { etat.filtresOuverts = !etat.filtresOuverts; return rendreFiltres(); }
      if (act === "tout") { etat.tout[v] = !etat.tout[v]; return garderFocus(() => { rendreTableau(); rendreGraphiques(); }); }
      if (act === "forme") { etat.forme = v; return garderFocus(rendreGraphiques); }
      if (act === "noms") { etat.noms = !etat.noms; return garderFocus(rendreGraphiques); }
      if (act === "mode") { etat.modeTab = v; if (v === "syndics") etat.filtreDec = null; rendreEtiquettes(); return garderFocus(rendreTableau); }
      if (act === "retirer-filtre") { delete etat.filtres[v]; return nouveauxCriteres(); }
      if (act === "retirer-lieu") { poserLieux(etat.lieux.filter((m, k) => k !== Number(v))); nouveauxCriteres(); return $("lieu").focus(); }
      if (act === "retirer-dec") { Object.assign(etat, { filtreDec: null, modeTab: "syndics" }); rendreEtiquettes(); return rendreTableau(); }
      if (act && act.startsWith("voir-")) return voirDepuisEnsemble(act, v);
    }
    const tr = ev.target.closest("tr[data-e]");
    if (tr) choisir(Number(tr.dataset.e));
  });
  $("onglets").addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    etat.onglet = VUES[(VUES.indexOf(etat.onglet) + (ev.key === "ArrowRight" ? 1 : VUES.length - 1)) % VUES.length];
    etat.ongletChoisi = true;
    placerVues(); dessinerBientot();
    $("og-" + etat.onglet).focus();
  });
  for (const id of ["tri-choix", "tri-choix-g"]) $(id).addEventListener("change", (ev) => choisirTri(ev.target.value, true));
  // Les graphiques : l'axe vertical du nuage, et la bulle d'un point survolé ou atteint au clavier, écrite en texte, jamais en balises.
  $("graph-corps").addEventListener("change", (ev) => {
    if (ev.target.id !== "nuage-y") return;
    etat.nuageY = ev.target.value;
    rendreGraphiques();
    const s = $("nuage-y");
    if (s && s.focus) s.focus();
  });
  const bulleG = $("graph-bulle");
  const montrerBulleG = (t, x, y) => {
    bulleG.textContent = t;
    bulleG.hidden = false;
    bulleG.style.left = Math.max(4, x + 274 > window.innerWidth ? x - 274 : x + 14) + "px";
    bulleG.style.top = Math.max(4, Math.min(window.innerHeight - 90, y + 14)) + "px";
  };
  $("graph-corps").addEventListener("pointermove", (ev) => {
    const t = ev.target.closest && ev.target.closest("[data-bulle]");
    if (t) montrerBulleG(t.dataset.bulle, ev.clientX, ev.clientY); else bulleG.hidden = true;
  });
  $("graph-corps").addEventListener("pointerleave", () => { bulleG.hidden = true; });
  $("graph-corps").addEventListener("focusin", (ev) => {
    const t = ev.target.closest && ev.target.closest("[data-bulle]");
    if (!t) { bulleG.hidden = true; return; }
    const r = t.getBoundingClientRect();
    montrerBulleG(t.dataset.bulle, r.right, r.bottom);
  });
  $("graph-corps").addEventListener("focusout", () => { bulleG.hidden = true; });
  // Le réseau des avocats : survoler un nœud allume ses traits et estompe les autres.
  const foyerReseau = (t) => {
    const n = t && t.closest ? t.closest(".r-noeud") : null, svg = n ? n.closest(".reseau") : document.querySelector(".reseau.foyer");
    if (!svg) return;
    const cle = n ? (n.dataset.le != null ? ["le", n.dataset.le] : ["lc", n.dataset.lc]) : null;
    svg.classList.toggle("foyer", !!cle);
    for (const p of svg.querySelectorAll(".r-lien")) p.classList.toggle("allume", !!cle && p.dataset[cle[0]] === cle[1]);
  };
  $("graph-corps").addEventListener("pointerover", (ev) => foyerReseau(ev.target));
  $("graph-corps").addEventListener("pointerleave", () => foyerReseau(null));
  // Le nuage et le réseau se dessinent à la largeur de leur cadre : ils se redessinent quand elle change de plus de 40 pixels, onglet rouvert compris.
  if (window.ResizeObserver) new ResizeObserver(() => { const w = $("graph-corps").clientWidth; if (R && w > 0 && ((etat.forme === "nuage" && Math.abs(w - largeurNuage) > 40) || (AV && Math.abs(w - largeurReseau) > 40))) rendreGraphiques(); }).observe($("graph-corps"));
  window.addEventListener("scroll", () => { bulleG.hidden = true; }, { passive: true });
  // La réglette des trimestres : la poignée de gauche fixe la base, qui gérait la copropriété ce trimestre-là ;
  // celle de droite, l'état comparé, aujourd'hui par défaut. Seule la période du 3e trimestre 2025 à aujourd'hui est calculée :
  // une poignée tirée ailleurs revient, et la note dit pourquoi. Un fichier publié fin octobre est celui du 3e trimestre.
  const trimDe = (iso) => { const [y, mo] = String(iso).slice(0, 7).split("-").map(Number), t = Math.floor((mo - 1) / 3); return t ? { a: y, t } : { a: y - 1, t: 4 }; };
  const TRIMS = [];
  for (let a = 2022, t = 2, fin = trimDe(M.fichier); a * 4 + t <= fin.a * 4 + fin.t; ) { TRIMS.push({ a, t }); if (++t > 4) { t = 1; a++; } }
  const T_FIN = TRIMS.length - 1, T_BASE = TRIMS.findIndex((x) => x.a === trimDe(M.t3).a && x.t === trimDe(M.t3).t);
  const libTrim = (k) => (k === T_FIN ? "aujourd'hui" : (TRIMS[k].t === 1 ? "1er" : TRIMS[k].t + "e") + " trimestre " + TRIMS[k].a);
  // Le registre a publié quatorze fichiers trimestriels, du 2e trimestre 2022 au 3e trimestre 2025, la base de la chaîne ; depuis avril 2026,
  // seulement un état quotidien (jeu de data.gouv.fr lu le 29/10/2026). Les trimestres d'entre-deux n'ont aucun fichier.
  const sansFichier = (k) => k > T_BASE && k < T_FIN, N_SANS = Math.max(0, T_FIN - T_BASE - 1);
  const NOTE_PERIODE = `Seule la période du ${libTrim(T_BASE)} à aujourd'hui est calculée. La part hachurée, du ${libTrim(0)} au ${libTrim(T_BASE - 1)}, attend l'historique en préparation.${N_SANS ? ` ${N_SANS === 3 ? "Les trois" : nb(N_SANS)} ${accord(N_SANS, "cercle vide n'a", "cercles vides n'ont")} aucun fichier trimestriel : depuis avril 2026, le registre ne publie qu'un état quotidien.` : ""} La poignée de gauche fixe la base, qui gérait la copropriété ce trimestre-là ; celle de droite, l'état comparé.`;
  function rendrePeriode() {
    const P = (k) => (100 * k) / T_FIN;
    $("periode-val").textContent = "du " + libTrim(T_BASE) + " à aujourd'hui";
    $("reglette-piste").innerHTML = `<span class="reglette-hors" style="left:0;width:${P(T_BASE).toFixed(2)}%"></span><span class="reglette-sel" style="left:${P(T_BASE).toFixed(2)}%;width:${(P(T_FIN) - P(T_BASE)).toFixed(2)}%"></span>` + TRIMS.map((x, k) => `<i${sansFichier(k) ? ' class="sans-fichier"' : ""} style="left:${P(k).toFixed(2)}%"></i>`).join("");
    $("reglette-reperes").innerHTML = TRIMS.map((x, k) => (x.t === 1 || k === 0 ? `<span style="left:${P(k).toFixed(2)}%">${x.a}</span>` : "")).join("");
    for (const [id, v] of [["periode-debut", T_BASE], ["periode-fin", T_FIN]]) { const r = $(id); r.max = String(T_FIN); r.value = String(v); r.setAttribute("aria-valuetext", libTrim(v)); }
    $("periode-note").textContent = NOTE_PERIODE;
  }
  for (const id of ["periode-debut", "periode-fin"]) $(id).addEventListener("input", (ev) => {
    const garde = id === "periode-debut" ? T_BASE : T_FIN, voulu = Number(ev.target.value);
    if (voulu === garde) return;
    ev.target.value = String(garde);
    const croise = id === "periode-debut" ? voulu >= T_FIN : voulu <= T_BASE;
    const pourquoi = croise ? "La base doit précéder l'état comparé" : sansFichier(voulu) ? `${libTrim(voulu)} : aucun fichier trimestriel publié ; depuis avril 2026, le registre ne publie qu'un état quotidien` : `${libTrim(voulu)} : pas encore calculé, faute de l'historique trimestriel du registre`;
    $("periode-note").textContent = pourquoi + `. La période reste du ${libTrim(T_BASE)} à aujourd'hui.`;
  });
  // La carte navigable : glisser déplace, la molette zoome une fois la carte activée par un clic, deux doigts zooment ;
  // au clavier, les flèches déplacent, plus et moins zooment, zéro recentre. Un clic sans glissement choisit un syndic.
  const boite = $("carte-boite"), doigts = new Map();
  let glisse = null;
  const activer = (on) => { carte.active = on; boite.classList.toggle("active", on); };
  boite.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest && ev.target.closest(".carte-zoom")) return;
    if (!carte.active && ev.pointerType !== "mouse") montrerAideCarte("Carte active : glissez pour la déplacer, pincez pour zoomer. Touchez hors de la carte pour la libérer.");
    activer(true);
    doigts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (doigts.size === 1) glisse = { x: ev.clientX, y: ev.clientY, bouge: false };
    try { boite.setPointerCapture(ev.pointerId); } catch (e) { /* capture refusée : le glissement s'arrête au bord */ }
  });
  boite.addEventListener("pointermove", (ev) => {
    if (!doigts.has(ev.pointerId)) return survol(ev);
    const avant = doigts.get(ev.pointerId), r = boite.getBoundingClientRect();
    if (doigts.size === 2) {
      const [a, b] = [...doigts.values()], d0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
      doigts.set(ev.pointerId, [ev.clientX, ev.clientY]);
      const [a2, b2] = [...doigts.values()], d1 = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
      if (d0 > 0) zoomer(d1 / d0, (a2[0] + b2[0]) / 2 - r.left, (a2[1] + b2[1]) / 2 - r.top);
      if (glisse) glisse.bouge = true;
      return;
    }
    doigts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (!glisse) return;
    if (!glisse.bouge && Math.hypot(ev.clientX - glisse.x, ev.clientY - glisse.y) < 4) return;
    glisse.bouge = true;
    $("carte-bulle").hidden = true;
    deplacer(ev.clientX - avant[0], ev.clientY - avant[1]);
  });
  const lacher = (ev) => { doigts.delete(ev.pointerId); if (!doigts.size && glisse && glisse.bouge) carte.glisse = true; if (!doigts.size) glisse = null; };
  boite.addEventListener("pointerup", lacher);
  boite.addEventListener("pointercancel", lacher);
  boite.addEventListener("pointerleave", (ev) => { $("carte-bulle").hidden = true; if (ev.pointerType === "mouse" && !doigts.size) activer(false); });
  document.addEventListener("pointerdown", (ev) => { if (carte.active && !boite.contains(ev.target)) activer(false); });
  boite.addEventListener("wheel", (ev) => {
    if (!carte.active) return montrerAideCarte("Cliquez dans la carte pour zoomer avec la molette.");
    ev.preventDefault();
    const r = boite.getBoundingClientRect();
    zoomer(Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  boite.addEventListener("keydown", (ev) => {
    const w = carte.w, h = carte.h;
    if (ev.key === "ArrowLeft") deplacer(0.15 * w, 0, true);
    else if (ev.key === "ArrowRight") deplacer(-0.15 * w, 0, true);
    else if (ev.key === "ArrowUp") deplacer(0, 0.15 * h, true);
    else if (ev.key === "ArrowDown") deplacer(0, -0.15 * h, true);
    else if (ev.key === "+" || ev.key === "=") zoomer(1.6, w / 2, h / 2, true);
    else if (ev.key === "-" || ev.key === "_") zoomer(1 / 1.6, w / 2, h / 2, true);
    else if (ev.key === "0" || ev.key === "Home") recentrer();
    else return;
    ev.preventDefault();
  });
  // Le survol d'un point de la couche des copropriétés : sa bulle, écrite en texte, jamais en balises.
  function survol(ev) {
    const b = $("carte-bulle");
    if (etat.couche !== "copros" || !carte.copos) { b.hidden = true; return; }
    const r = boite.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, p = plusProche(x, y);
    if (!p) { b.hidden = true; return; }
    b.textContent = texteCopro(p[0]);
    b.hidden = false;
    b.style.left = Math.max(4, x + 274 > carte.w ? x - 274 : x + 14) + "px";
    b.style.top = Math.max(4, Math.min(carte.h - 70, y + 14)) + "px";
  }
  boite.addEventListener("click", (ev) => {
    if (!R || (ev.target.closest && ev.target.closest(".carte-zoom"))) return;
    if (carte.glisse) { carte.glisse = false; return; }
    const r = boite.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (etat.couche === "copros") { const p = plusProche(x, y), e = p ? ENT[p[0]] : -1; if (e >= 0 && !ENTS[e].ei) choisir(e, true); return; }
    let best = -1, bd = Infinity;
    for (const [e, bx, by, s] of carte.pos) {
      const d2 = (bx - x) ** 2 + (by - y) ** 2;
      if (d2 <= Math.max(18, s / 2 + 4) ** 2 && d2 < bd) { bd = d2; best = e; }
    }
    if (best >= 0) choisir(best, true);
  });
  $("carte-reglages").addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "carte-couleur") { etat.couleur = t.value; $("carte-bulle").hidden = true; rendreReglagesCarte(); dessinerCarte(); }
    else if (t.id === "carte-syndic") choisir(t.value === "" ? null : Number(t.value), etat.couche === "copros");
    else if (t.id === "carte-fond-choix") { etat.fond = FONDS[t.value] ? t.value : ""; rendreReglagesCarte(); dessinerCarte(); }
  });
  if (window.ResizeObserver) new ResizeObserver(dessinerBientot).observe($("carte-boite"));
  window.addEventListener("resize", dessinerBientot);
  try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", dessinerBientot); } catch (e) { /* ancien navigateur : la carte se redessine au prochain geste */ }
  new MutationObserver(dessinerBientot).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // Seule la rangée des onglets reste en haut : le bandeau remonte de la hauteur de ce qui la précède. Une fiche ouverte sur
  // écran étroit cache les onglets : le bandeau remonte alors tout entier, et la fiche a l'écran.
  const retraitBandeau = () => { const s = $("bandeau").style, o = $("onglets"); if (s.setProperty) s.setProperty("--bandeau-retrait", Math.max(0, o.hidden ? $("bandeau").offsetHeight : o.offsetTop - 6) + "px"); };
  if (window.ResizeObserver) new ResizeObserver(retraitBandeau).observe($("bandeau"));

  // ---------- le pied de page : la méthode, les sources et les limites, écrites avec les définitions mêmes de la page
  const URL_REGISTRE = "https://www.data.gouv.fr/fr/datasets/registre-national-dimmatriculation-des-coproprietes/";
  function rendrePied() {
    const p = (s) => `<p>${esc(s)}</p>`, bloc = (titre, corps) => `<div class="m-bloc"><h3>${esc(titre)}</h3>${corps}</div>`;
    const defs = (ids, T) => `<dl>${ids.map((id) => `<div><dt>${esc(T[id].titre)}</dt><dd>${esc([T[id].def, T[id].mention, T[id].limite].filter(Boolean).join(" "))}</dd></div>`).join("")}</dl>`;
    $("methode-corps").innerHTML = [
      bloc("Les données", p(`Le registre des copropriétés est lu à deux dates : au 3e trimestre 2025 (fichier du ${dateFr(M.t3)}) et au ${dateFr(M.fichier)}. Seules les copropriétés du département ${M.nomDept} (${M.dept}) sont chargées. Les établissements d'une même société sont réunis sous son numéro d'entreprise (SIREN). Un syndic professionnel en entreprise individuelle n'est jamais nommé, et aucune décision de justice ne lui est rattachée.`)),
      bloc("La taille d'un syndic", p(`Le nombre de copropriétés qu'il déclare aujourd'hui dans le département : ${LIB_CLASSE.join(", ")}.`)),
      bloc("Le devenir des copropriétés de 2025", p("Pour chaque syndic, les copropriétés qu'il déclarait au 3e trimestre 2025 font la base, y compris celles qui ont depuis quitté le registre. Au registre d'aujourd'hui, chacune a l'un de ces devenirs :")
        + `<ul>${ISSUES.map((x) => `<li>${esc(x[1])}</li>`).join("")}</ul>`),
      bloc("Les indicateurs du registre", defs(["i1", "i2", "i3", "i4", "i5", "i6", "i7"], IND)),
      bloc("Les pairs et la marge d'incertitude", p("Les pairs d'un syndic sont les sociétés de sa taille dont la base compte au moins 10 copropriétés, lui compris ; s'il y en a moins de 10, la taille voisine s'ajoute : la suivante, ou la précédente pour les syndics de 200 copropriétés et plus. La page situe son taux par rapport à la moitié centrale des taux de ses pairs, du 1er au 3e quartile, jamais par un rang. La marge d'un taux est un intervalle de Wilson à 95 % : quand elle atteint cette moitié centrale, la page dit que l'écart peut venir du hasard. Sur moins de 10 copropriétés, elle écrit « 2 sur 7 » plutôt qu'un taux.")),
      bloc("Les lots par salarié", p("Les lots qu'une société déclare au registre dans toute la France, divisés par sa tranche d'effectif salarié au répertoire des entreprises : une fourchette, dont le milieu est la moyenne géométrique des deux bornes. Une société sans tranche d'effectif salarié n'en a pas.")),
      bloc("Les décisions de justice", AVEC_J ? p(MENTION_J) + p("Les comptes se rapportent aux copropriétés que le syndic gère aujourd'hui à Marseille, toutes tailles, pour 100.") + defs(["j3", "j1", "j2", "j6", "j5", "j4"], JIND)
        : p(NOTE_J) + p("Pour refaire ce relevé dans un autre département :") + `<ol>${ETAPES_J.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`),
      bloc("Les lieux", p(NATIONAL ? `Plusieurs lieux d'un même département se réunissent : une copropriété compte une fois. Un lieu d'un autre département charge celui-ci à la place : la page ne réunit pas encore deux départements. Une région ou la France se tapent aussi ; la page ne compte que ce qu'elle a chargé, et dit le reste.`
        : `Plusieurs lieux choisis se réunissent : une copropriété compte une fois. Un département, une région ou la France se tapent aussi ; la page ne compte que ce qu'elle a chargé, et dit le reste.`)),
      bloc("Ce que la page ne fait pas", p(`Elle ne note ni ne classe aucun syndic, et ne nomme aucune personne. Elle ne localise pas une adresse : elle la ramène ${MARS >= 0 ? "à son arrondissement, pour " + VILLE + ", ou à sa commune" : "à sa commune"}.`)),
    ].join("");
    const lien = (url, txt) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>`;
    $("liste-sources").innerHTML = [
      `Registre national d'immatriculation des copropriétés, tenu par l'Agence nationale de l'habitat : fichier du ${esc(dateFr(M.fichier))} et fichier du 3e trimestre 2025 (${esc(dateFr(M.t3))}), publiés sur ${lien(URL_REGISTRE, "data.gouv.fr")}. Licence Ouverte 2.0.`,
      esc(`Répertoire des entreprises : base « Recherche d'entreprises » de la direction interministérielle du numérique, consultée le ${dateFr(M.repertoire)}. Licence à préciser.`),
      esc(DIRECT ? `Contours des communes et des arrondissements : IGN, ADMIN EXPRESS COG CARTO, demandés à l'ouverture de la carte au service WFS de la Géoplateforme (data.geopf.fr), vérifié le ${dateFr(WFS_CONSULTE)} ; liste des départements et des régions, par l'API Découpage administratif (geo.api.gouv.fr), consultée le ${dateFr(DEC.consulte)}. Licence à préciser.`
        : `Contours des communes et des arrondissements : IGN, par l'API Découpage administratif (geo.api.gouv.fr)${M.contours ? ", consultés le " + dateFr(M.contours) : ""} ; liste des départements et des régions, par la même API, consultée le ${dateFr(DEC.consulte)}. Licence à préciser.`),
      esc(`Images de la carte, si vous en choisissez : Plan IGN, photographies aériennes et parcelles du cadastre (Parcellaire Express, édition du 01/06/2026) de l'IGN, servis par la Géoplateforme (data.geopf.fr), consultés le ${dateFr(FONDS_CONSULTE)}. Licence Ouverte, selon leurs fiches de métadonnées. `) + lien("https://cartes.gouv.fr/cgu", "Conditions d'utilisation de la Géoplateforme") + esc(", version du 15/10/2024."),
      AVEC_J ? esc(`Décisions de justice publiées ${PERIODE_J} sur Judilibre, la base de décisions de la Cour de cassation : ${JM.zone}. Méthode : ${JM.methode}.`) : esc("Décisions de justice : aucun relevé pour ce département."),
    ].map((x) => `<li>${x}</li>`).join("");
    $("liste-limites").innerHTML = [
      "Le registre contient ce que les syndics y déclarent, à la date où ils le déclarent.",
      "« Mandat expiré sans successeur déclaré » veut dire qu'aucun nouveau mandat n'a été déclaré au registre. Cela ne prouve pas que la copropriété n'a pas de syndic.",
      "Une copropriété absente du fichier d'aujourd'hui a pu être radiée, fusionnée ou renumérotée ; une déclaration incomplète n'est pas un départ.",
      `Seules les copropriétés du département ${M.dept} sont chargées : un cercle qui déborde du département ne compte pas les copropriétés voisines.`,
      AVEC_J ? PHRASE_JUDILIBRE : "",
      "Un chiffre de cette page sert à poser une question. Il ne suffit pas à conclure.",
    ].filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("");
    $("pied-version").textContent = `Données du registre des copropriétés au ${dateFr(M.fichier)}.`;
  }

  // ---------- départ
  $("dept").textContent = M.nomDept + " (" + M.dept + ")";
  $("dates").textContent = `Registre des copropriétés : fichier du ${dateFr(M.fichier)}, extrait le ${dateFr(M.extraction)} à ${heureFr(M.extraction)}. Répertoire des entreprises : consulté le ${dateFr(M.repertoire)} ; effectifs de 2024.`;
  $("taille-reperes").innerHTML = ["toutes"].concat(TRANCHES.map((t) => nb(t[0]) + (t[1] === Infinity ? "+" : ""))).map((s) => `<span>${s}</span>`).join("");
  $("rayon").innerHTML = `<option value="0">aucun</option>` + RAYONS.map((m) => `<option value="${m}">${kmTxt(m)}</option>`).join("");
  $("constr").innerHTML = `<option value="-1">toutes</option>` + CLASSES.map((c, k) => `<option value="${k}">${esc(minuscule(c))}</option>`).join("");
  rendrePeriode();
  rendrePied();
  rendre();
  // La page nationale : le lieu ou le numéro choisi avant le chargement du département, ou avant d'en changer. Un lieu sans
  // copropriété au registre ramène au département tout entier, et la page le dit.
  if (NATIONAL) {
    const a = window.SYNDICO_AMORCE || {}, X = window.SYNDICO_COMMUNES;
    window.SYNDICO_AMORCE = null;
    if (a.depuis && a.depuis !== M.dept && DEPS.has(a.depuis)) direNational(`La page a chargé ${NOM_CH} à la place de ${DEPS.get(a.depuis).nom} (${a.depuis}) : elle ne réunit pas encore deux départements.`);
    const i = a.copro ? IMMAT.get(a.copro) : null;
    if (i != null) { $("copro").value = a.copro; prendreCopro(i); nouveauxCriteres(); }
    else if (a.lieu) {
      const l = a.cp ? lieuDuCodePostal(a.cp) : null, zi = Z.findIndex((z) => z[0] === a.lieu);
      const zn = l ? l.zone : a.lieu === M.dept ? { k: "dept" } : MARS >= 0 && zi === MARS ? { k: "mars" } : zi >= 0 ? { k: "z", i: zi } : null;
      if (!zn) {
        const j = X.code.indexOf(a.lieu);
        if (j >= 0) direNational(`${X.nom[j].replace(/ Arrondissement$/, "")} n'a aucune copropriété au registre : la page montre tout le département.`);
      }
      poserLieux([zn || { k: "dept" }]);
      nouveauxCriteres();
    }
    // le bouton « précédent » du navigateur revient au département d'avant : la page le recharge
    window.addEventListener("hashchange", () => { const d = decodeURIComponent(location.hash.slice(1)); if (d && d !== M.dept) location.reload(); });
  }
})();
