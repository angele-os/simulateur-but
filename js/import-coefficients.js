// Analyse du PDF « tableau des coefficients ».
//
// Fonction pure : elle reçoit la liste d'éléments texte renvoyée par
// lecture-pdf.js ({ texte, x, y, taille, largeur, page }) et ne touche ni à
// la page ni à pdf.js. On peut donc la tester avec des données inventées.
//
// Les règles suivies sont celles de la section 2 de FORMAT-PDF.md.

import { arrondiMillieme } from './calcul.js';

// Deux éléments dont les y diffèrent de moins de 2 points sont sur la même ligne.
const ECART_MAX_LIGNE = 2;

// Écart toléré entre une somme de coefficients et le total imprimé
// (pour ne pas être piégé par les flottants, comme 0,1 + 0,2).
const TOLERANCE_TOTAL = 0.001;

// En-tête d'une colonne d'UE : « UE1.1 », « UE5.6 »…
// Le premier chiffre (capturé entre parenthèses) est le numéro du semestre.
const MOTIF_UE = /^UE(\d)\.\d$/;

// Raison donnée aux lignes situées avant le premier en-tête d'UE (titre du
// document…). remplissage.js ne recopie jamais leur texte : dans un PDF qui
// n'est pas un tableau des coefficients (le relevé, choisi par erreur), une
// telle ligne peut contenir n'importe quoi, jusqu'à ton nom.
export const RAISON_AVANT_EN_TETE = 'avant le premier en-tête UE';

// Codes qui signalent une ligne de données (une ressource, une SAE…).
const MOTIFS_CODE = [
  /^R\d\.(?:[A-Z]\.)?\d{2}$/, // ressource : R1.01, R4.B.08
  /^S(?:AE ?)?\d\.(?:[A-Z]\.)?\d{2}$/, // SAE : S3.01, S6.A.01, SAE5.B.01, SAE 5.A.01
  /^S\d\.PF$/, // portfolio : S3.PF
  /^PORTFOLIO$/, // portfolio (BUT3)
  /^S\d\.(?:MP|STAGE)$/, // stage : S4.MP, S6.STAGE
];

// Vrai si le texte est un code de ligne (voir MOTIFS_CODE).
const estUnCode = (texte) => MOTIFS_CODE.some((motif) => motif.test(texte));

// Un nombre : entier ou décimal (« 12 », « 7,5 », « 7.5 »).
const MOTIF_NOMBRE = /^\d+(?:[.,]\d+)?$/;

// Colonne « Nature » du BUT3 : elle donne directement le type de la ligne.
const NATURES = new Map([
  ['SAE', 'sae'],
  ['RSC', 'ressource'],
]);

// Préfixe de nature (colonne « Nature », voir NATURES) devant une ligne de
// total, en BUT3 DACS : « RSC Total Ressources : 50 50 50 ».
const MOTIF_PREFIXE_NATURE = /^(?:SAE|RSC)\s+/;

// Lignes de total : leur libellé, et la clé où l'on range leurs valeurs.
const LIGNES_TOTAL = [
  { motif: /^total\s+sae\b/i, cle: 'sae', nom: '« TOTAL SAE »' },
  { motif: /^total\s+ressources?\b/i, cle: 'ressources', nom: '« Total Ressources »' },
  { motif: /^total\s+g[ée]n[ée]ral\b/i, cle: 'general', nom: '« TOTAL GENERAL »' },
];

/**
 * Regroupe les éléments en lignes, de haut en bas et page par page.
 * Dans chaque ligne, les éléments sont triés de gauche à droite.
 *
 * @param {{ texte: string, x: number, y: number, page: number }[]} elements
 * @returns {{ page: number, y: number, elements: object[] }[]}
 */
export function regrouperEnLignes(elements) {
  // 1. On trie par page, puis par y DÉCROISSANT : dans un PDF, y part du bas
  //    de la page, donc le y le plus grand est tout en haut.
  //    [...elements] fait une copie : on ne modifie pas la liste reçue.
  const tries = [...elements].sort((a, b) => a.page - b.page || b.y - a.y);

  const lignes = [];
  let ligne = null;
  for (const element of tries) {
    // 2. Même page et y proche du haut de la ligne en cours : même ligne.
    if (ligne !== null && element.page === ligne.page && ligne.y - element.y < ECART_MAX_LIGNE) {
      ligne.elements.push(element);
    } else {
      // 3. Sinon, on commence une nouvelle ligne.
      ligne = { page: element.page, y: element.y, elements: [element] };
      lignes.push(ligne);
    }
  }

  // 4. Dans chaque ligne, on range les éléments de gauche à droite.
  for (const { elements: elementsLigne } of lignes) {
    elementsLigne.sort((a, b) => a.x - b.x);
  }
  return lignes;
}

/**
 * Analyse un tableau des coefficients.
 *
 * @param {{ texte: string, x: number, y: number, taille: number, largeur: number, page: number }[]} elements
 * @returns {{
 *   semestres: { numero: number, ues: {
 *     code: string, poidsSae: number, poidsRessources: number,
 *     sae: { code: string, libelle: string, coef: number }[],
 *     ressources: { code: string, libelle: string, coef: number }[],
 *   }[],
 *   // Les mêmes données, ligne par ligne, dans l'ordre du tableau. Une ligne
 *   // sans aucun coefficient (portfolio du S1…) y figure aussi, avec coefs = {}.
 *   // alias : les autres codes de la ligne (« R4.08 » pour « R4.08 R4.B.08 »).
 *   lignes: { type: 'sae'|'ressource', code: string, alias: string[], libelle: string, coefs: Object<string, number> }[],
 *   // Les totaux imprimés, par UE : { sae: { 'UE1.1': 40 }, ressources: …, general: … } (null si la ligne manque).
 *   totaux: { sae: Object<string, number>|null, ressources: Object<string, number>|null, general: Object<string, number>|null },
 *   }[],
 *   rapport: {
 *     lu: { semestre: number, page: number, type: 'sae'|'ressource', code: string, alias: string[], libelle: string, coefs: Object<string, number> }[],
 *     ignore: { page: number, texte: string, raison: string }[],
 *     erreurs: { semestre?: number, ue?: string, message: string }[],
 *   },
 * }}
 */
export function importerCoefficients(elements) {
  const rapport = { lu: [], ignore: [], erreurs: [] };
  const semestres = [];
  let semestre = null; // semestre en cours de lecture

  for (const ligne of regrouperEnLignes(elements)) {
    const texte = ligne.elements.map((element) => element.texte).join(' ');
    const ignorer = (raison) => rapport.ignore.push({ page: ligne.page, texte, raison });

    // 1. Ligne d'en-tête (UE1.1, UE1.2…) : elle ouvre un semestre et donne
    //    la position des colonnes d'UE.
    const enTetes = ligne.elements.filter((element) => MOTIF_UE.test(element.texte));
    if (enTetes.length > 0) {
      semestre = ouvrirSemestre(enTetes, semestre, semestres);
      continue;
    }

    // 2. Lignes ignorées où qu'elles soient. La ligne ECTS est reconnue ici ;
    //    sans son libellé, elle serait de toute façon ignorée (pas de code).
    if (/IUT concern/i.test(texte)) {
      ignorer('bandeau « IUT concerné »');
      continue;
    }
    if (/^parcours\b/i.test(texte)) {
      ignorer('ligne « Parcours »');
      continue;
    }
    if (/\bECTS\b/.test(texte)) {
      ignorer('ligne ECTS');
      continue;
    }

    // 3. Avant le premier en-tête, rien ne peut être rangé dans une colonne.
    if (semestre === null) {
      ignorer(RAISON_AVANT_EN_TETE);
      continue;
    }

    // 4. Ligne de section : elle donne le type des lignes qui suivent.
    //    On regarde le libellé sans les nombres.
    const libelleLigne = ligne.elements
      .filter((element) => !MOTIF_NOMBRE.test(element.texte))
      .map((element) => element.texte)
      .join(' ');
    if (/^p[ôo]le\s+sae\b/i.test(libelleLigne)) {
      semestre.section = 'sae';
      continue;
    }
    if (/^p[ôo]le\s+ressources?\b/i.test(libelleLigne)) {
      semestre.section = 'ressource';
      continue;
    }

    // 5. Ligne de total : on garde ses valeurs pour le contrôle final.
    //    On retire d'abord un éventuel préfixe de nature : « RSC Total
    //    Ressources : » devient « Total Ressources : ».
    const libelleTotal = libelleLigne.replace(MOTIF_PREFIXE_NATURE, '');
    const total = LIGNES_TOTAL.find(({ motif }) => motif.test(libelleTotal));
    if (total) {
      const nombres = ligne.elements.filter((element) => MOTIF_NOMBRE.test(element.texte));
      semestre.totaux[total.cle] = rangerNombres(nombres, ligne, semestre, rapport, `Ligne ${total.nom}`);
      continue;
    }

    // 6. Ligne de données (elle commence par un code).
    if (lireLigneDonnees(ligne, semestre, rapport)) {
      continue;
    }

    // 7. Tout le reste est ignoré : titres, lignes vides de code…
    ignorer(/non évalué/i.test(texte) ? '« Non évalué ce semestre »' : 'ligne sans code (titre…)');
  }

  // 8. Aucun en-tête : ce n'est sans doute pas le bon PDF.
  if (semestres.length === 0) {
    rapport.erreurs.push({
      message:
        'Aucune ligne d’en-tête d’UE (UE1.1, UE1.2…) n’a été trouvée : ce PDF ne semble pas être un tableau des coefficients.',
    });
  }

  // 9. On construit le résultat par UE et on contrôle les totaux.
  return {
    semestres: semestres.map((etat) => construireSemestre(etat, rapport)),
    rapport,
  };
}

/**
 * Ouvre un semestre à partir des éléments « UEx.y » d'une ligne d'en-tête.
 * Si c'est l'en-tête du semestre en cours (répété en haut d'une nouvelle
 * page), on continue ce semestre au lieu d'en créer un autre.
 */
function ouvrirSemestre(enTetes, semestreEnCours, semestres) {
  // 1. Numéro du semestre : le chiffre après « UE » (UE5.1 → 5).
  const numero = Number(MOTIF_UE.exec(enTetes[0].texte)[1]);

  // 2. Chaque colonne d'UE est repérée par son centre horizontal.
  //    Leur nombre varie (6, ou 3 en BUT3) : on prend celles qu'on trouve.
  const colonnes = enTetes.map((element) => ({
    code: element.texte,
    centre: element.x + element.largeur / 2,
  }));
  const tolerance = calculerTolerance(colonnes);

  // 3. En-tête répété : même semestre, nouvelles positions de colonnes.
  if (semestreEnCours !== null && semestreEnCours.numero === numero) {
    semestreEnCours.colonnes = colonnes;
    semestreEnCours.tolerance = tolerance;
    return semestreEnCours;
  }

  // 4. Sinon, nouveau semestre.
  const nouveau = {
    numero,
    colonnes,
    tolerance,
    section: null, // 'sae' ou 'ressource', d'après la dernière ligne « Pôle … »
    lignes: [], // lignes de données lues
    codes: new Set(), // codes déjà vus, pour repérer les doublons
    totaux: { sae: null, ressources: null, general: null },
  };
  semestres.push(nouveau);
  return nouveau;
}

/**
 * Distance maximale entre un nombre et le centre de sa colonne : la moitié
 * du plus petit écart entre deux colonnes voisines. Au-delà, le nombre est
 * plus près du « milieu » entre deux colonnes que d'une colonne.
 */
function calculerTolerance(colonnes) {
  if (colonnes.length < 2) {
    return Infinity;
  }
  const centres = colonnes.map((colonne) => colonne.centre).sort((a, b) => a - b);
  let ecartMin = Infinity;
  for (let i = 1; i < centres.length; i++) {
    ecartMin = Math.min(ecartMin, centres[i] - centres[i - 1]);
  }
  return ecartMin / 2;
}

/**
 * Range chaque nombre dans la colonne d'UE dont le centre est le plus proche.
 *
 * @returns {Object<string, number>} par exemple { 'UE1.1': 30, 'UE1.3': 12 }
 */
function rangerNombres(nombres, ligne, semestre, rapport, nomLigne) {
  const valeurs = {};

  for (const element of nombres) {
    // 1. Centre horizontal du nombre.
    const centre = element.x + element.largeur / 2;

    // 2. On cherche la colonne la plus proche.
    let colonne = null;
    let distance = Infinity;
    for (const candidate of semestre.colonnes) {
      const ecart = Math.abs(centre - candidate.centre);
      if (ecart < distance) {
        distance = ecart;
        colonne = candidate;
      }
    }

    // 3. Trop loin de toute colonne : on ne devine pas, on signale.
    if (distance > semestre.tolerance) {
      rapport.ignore.push({
        page: ligne.page,
        texte: element.texte,
        raison: `nombre hors des colonnes UE (${nomLigne})`,
      });
      continue;
    }

    // 4. Deux nombres dans la même colonne : c'est anormal, on signale.
    const valeur = Number(element.texte.replace(',', '.'));
    if (Object.hasOwn(valeurs, colonne.code)) {
      rapport.erreurs.push({
        semestre: semestre.numero,
        ue: colonne.code,
        message: `${nomLigne} : deux nombres sous ${colonne.code} (${enFrancais(valeurs[colonne.code])} et ${enFrancais(valeur)}). Seul le premier est gardé.`,
      });
      continue;
    }

    valeurs[colonne.code] = valeur;
  }
  return valeurs;
}

/**
 * Sépare un code collé au début de l'intitulé, dans un même élément texte.
 * C'est la forme des vrais tableaux : pdf.js renvoie « R4.08 », puis
 * « R4.B.08 Virtualisation » d'un seul bloc.
 *   « R4.B.08 Virtualisation »  → { code: 'R4.B.08', reste: 'Virtualisation' }
 *   « SAE 2.01 Développement… » → { code: 'SAE 2.01', reste: 'Développement…' }
 *   « R2.01Développement… »     → { code: 'R2.01', reste: 'Développement…' } (sans espace, BUT1)
 *   « Virtualisation »          → null (pas de code au début)
 *
 * @param {string} texte
 * @returns {{ code: string, reste: string }|null}
 */
function separerCodeColle(texte) {
  const mots = texte.split(/\s+/);

  // 1. On essaie d'abord un code en deux mots (« SAE 2.01 »), puis en un mot
  //    (« R4.B.08 »). Il doit rester au moins un mot pour l'intitulé.
  for (const nombreDeMots of [2, 1]) {
    const debut = mots.slice(0, nombreDeMots).join(' ');
    if (mots.length > nombreDeMots && estUnCode(debut)) {
      return { code: debut, reste: mots.slice(nombreDeMots).join(' ') };
    }
  }

  // 2. Code collé SANS espace : « R2.01Développement ». On coupe le premier
  //    mot au premier endroit où une lettre suit un chiffre (\p{L} : une
  //    lettre, accents compris), et on garde la coupe si le début est un code.
  const coupe = /^(.*?\d)(\p{L}.*)$/u.exec(mots[0]);
  if (coupe !== null && estUnCode(coupe[1])) {
    return { code: coupe[1], reste: [coupe[2], ...mots.slice(1)].join(' ') };
  }
  return null;
}

/**
 * Lit une ligne de données : [Nature] code(s) intitulé coefficients.
 *
 * @returns {boolean} false si la ligne ne commence pas par un code
 */
function lireLigneDonnees(ligne, semestre, rapport) {
  // 1. Début de ligne : la Nature éventuelle (BUT3), puis un ou plusieurs codes.
  //    Le dernier code peut être collé au début de l'intitulé : on le
  //    détache, et le reste de l'élément devient le début de l'intitulé.
  let nature = null;
  const codes = [];
  const morceauxIntitule = [];
  let i = 0;
  for (; i < ligne.elements.length; i++) {
    const texte = ligne.elements[i].texte;
    if (codes.length === 0 && nature === null && NATURES.has(texte)) {
      nature = NATURES.get(texte);
      continue;
    }
    if (estUnCode(texte)) {
      codes.push(texte);
      continue;
    }
    const colle = separerCodeColle(texte);
    if (colle !== null) {
      codes.push(colle.code);
      morceauxIntitule.push(colle.reste);
      i++; // cet élément est lu : la suite de la ligne commence après lui
    }
    break; // début de l'intitulé
  }

  // 2. Pas de code en début de ligne : ce n'est pas une ligne de données.
  if (codes.length === 0) {
    return false;
  }

  // 3. Plusieurs codes (R4.08 R4.B.08) : on garde le DERNIER avant
  //    l'intitulé. C'est le plus précis, celui du relevé de notes.
  //    Les autres deviennent des « alias » : d'autres noms de la même
  //    ligne, qui servent à la retrouver (un code répété, R1.01 R1.01,
  //    n'en donne pas).
  const code = codes[codes.length - 1];
  const alias = [...new Set(codes.slice(0, -1))].filter((autre) => autre !== code);

  // 4. La suite de la ligne : l'intitulé (du texte) et les coefficients (des nombres).
  const nombres = [];
  for (const element of ligne.elements.slice(i)) {
    if (MOTIF_NOMBRE.test(element.texte)) {
      nombres.push(element);
    } else if (/non évalué/i.test(element.texte)) {
      rapport.ignore.push({
        page: ligne.page,
        texte: element.texte,
        raison: `« Non évalué ce semestre » (ligne ${code})`,
      });
    } else {
      morceauxIntitule.push(element.texte);
    }
  }
  const libelle = morceauxIntitule.join(' ');

  // 5. Le type vient de la colonne Nature si elle existe, sinon de la
  //    dernière ligne « Pôle SAE » ou « Pôle Ressources ».
  const type = nature ?? semestre.section;
  if (type === null) {
    rapport.erreurs.push({
      semestre: semestre.numero,
      message: `Ligne ${code} : impossible de savoir si c’est une SAE ou une ressource (aucune ligne « Pôle SAE » ou « Pôle Ressources » au-dessus). Elle n’est pas importée.`,
    });
    return true;
  }

  // 6. Un même code deux fois dans le semestre : on ne garde que le premier.
  if (semestre.codes.has(code)) {
    rapport.erreurs.push({
      semestre: semestre.numero,
      message: `Le code ${code} apparaît deux fois au semestre ${semestre.numero}. Seule la première ligne est importée.`,
    });
    return true;
  }
  semestre.codes.add(code);

  // 7. On range les coefficients dans les colonnes d'UE.
  const coefs = rangerNombres(nombres, ligne, semestre, rapport, `Ligne ${code}`);
  semestre.lignes.push({ type, code, alias, libelle, coefs });
  rapport.lu.push({ semestre: semestre.numero, page: ligne.page, type, code, alias, libelle, coefs });
  return true;
}

/**
 * Construit le résultat d'un semestre, UE par UE, puis contrôle les totaux.
 */
function construireSemestre(semestre, rapport) {
  const ues = semestre.colonnes.map((colonne) => {
    const sae = [];
    const ressources = [];

    for (const ligne of semestre.lignes) {
      const coef = ligne.coefs[colonne.code];
      // Pas de coefficient (case vide ou 0) : la ligne ne compte pas dans
      // cette UE. C'est le cas du portfolio aux semestres 1, 3 et 5.
      if (coef === undefined || coef <= 0) {
        continue;
      }
      const liste = ligne.type === 'sae' ? sae : ressources;
      liste.push({ code: ligne.code, libelle: ligne.libelle, coef });
    }

    // Le poids de chaque pôle est LU dans le tableau (40, 50 ou 60…),
    // jamais écrit en dur : c'est la somme des coefficients de l'UE.
    return {
      code: colonne.code,
      poidsSae: somme(sae),
      poidsRessources: somme(ressources),
      sae,
      ressources,
    };
  });

  controlerTotaux(semestre, ues, rapport);
  // Les lignes servent à remplir la saisie, qui range les coefficients ligne
  // par ligne (une ressource et son coefficient dans chaque UE).
  const lignes = semestre.lignes.map(({ type, code, alias, libelle, coefs }) => ({ type, code, alias, libelle, coefs }));
  // Les totaux IMPRIMÉS (lignes « TOTAL SAE »…), tels quels : null si la
  // ligne manque. Le référentiel les garde pour son propre contrôle.
  return { numero: semestre.numero, ues, lignes, totaux: semestre.totaux };
}

/**
 * Compare, pour chaque UE, les coefficients lus aux lignes de total.
 * Une différence est signalée comme erreur : on n'importe pas en silence.
 */
function controlerTotaux(semestre, ues, rapport) {
  const { numero, totaux } = semestre;

  // 1. Chaque ligne de total doit exister, sinon on ne peut rien vérifier.
  for (const { cle, nom } of LIGNES_TOTAL) {
    if (totaux[cle] === null) {
      rapport.erreurs.push({
        semestre: numero,
        message: `Semestre ${numero} : ligne ${nom} introuvable, les coefficients ne peuvent pas être vérifiés.`,
      });
    }
  }

  for (const ue of ues) {
    const signaler = (message) => rapport.erreurs.push({ semestre: numero, ue: ue.code, message });

    // 2. Valeur d'un total pour cette UE : null si la ligne manque,
    //    0 si la case est vide.
    const lireTotal = (cle) => (totaux[cle] === null ? null : (totaux[cle][ue.code] ?? 0));
    const totalSae = lireTotal('sae');
    const totalRessources = lireTotal('ressources');
    const totalGeneral = lireTotal('general');

    // 3. Somme des SAE lues = TOTAL SAE.
    if (totalSae !== null && differe(ue.poidsSae, totalSae)) {
      signaler(
        `${ue.code} : les coefficients SAE lus font ${enFrancais(ue.poidsSae)}, mais la ligne « TOTAL SAE » indique ${enFrancais(totalSae)}.`,
      );
    }

    // 4. Somme des ressources lues = Total Ressources.
    if (totalRessources !== null && differe(ue.poidsRessources, totalRessources)) {
      signaler(
        `${ue.code} : les coefficients des ressources lus font ${enFrancais(ue.poidsRessources)}, mais la ligne « Total Ressources » indique ${enFrancais(totalRessources)}.`,
      );
    }

    if (totalGeneral !== null) {
      // 5. Le total général vaut 100.
      if (differe(totalGeneral, 100)) {
        signaler(`${ue.code} : le « TOTAL GENERAL » vaut ${enFrancais(totalGeneral)} au lieu de 100.`);
      }
      // 6. TOTAL SAE + Total Ressources = TOTAL GENERAL.
      if (totalSae !== null && totalRessources !== null && differe(totalSae + totalRessources, totalGeneral)) {
        signaler(
          `${ue.code} : TOTAL SAE (${enFrancais(totalSae)}) + Total Ressources (${enFrancais(totalRessources)}) ne font pas le « TOTAL GENERAL » (${enFrancais(totalGeneral)}).`,
        );
      }
    }
  }
}

// Somme des coefficients d'une liste, arrondie au millième.
function somme(liste) {
  return arrondiMillieme(liste.reduce((total, ligne) => total + ligne.coef, 0));
}

// Vrai si deux nombres sont différents (au-delà de la tolérance).
function differe(a, b) {
  return Math.abs(a - b) > TOLERANCE_TOTAL;
}

// Écrit un nombre à la française : 7.5 → « 7,5 ».
function enFrancais(nombre) {
  return String(nombre).replace('.', ',');
}
