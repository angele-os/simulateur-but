// Remplissage de la saisie à partir d'un import : le tableau des
// coefficients, ou le relevé « Détail des notes ».
//
// Fonctions pures : elles reçoivent l'état de la saisie (voir modele.js) et
// le résultat d'un analyseur, et renvoient une PROPOSITION :
//   - les nouveaux semestres (l'état reçu n'est jamais modifié) ;
//   - ce qui serait remplacé, pour demander confirmation ;
//   - le rapport à afficher.
// app.js demande confirmation si besoin, puis applique la proposition.
//
// Chaque import ne remplit que SA partie :
//   - le tableau : les UE, et le coefficient de chaque ligne dans chaque UE ;
//   - le relevé : les évaluations, le malus et les moyennes officielles.
// Les deux se retrouvent grâce au code des lignes (R3.01, S4.PF…), ou à un
// alias venu du tableau (« R4.08 » pour la ligne « R4.08 R4.B.08 ») : que
// l'on importe le relevé avant ou après le tableau, le résultat est le même.
// Une ressource du relevé qu'aucune ligne du tableau ne porte est signalée.
//
// Les identifiants des nouvelles lignes viennent de la fonction nouvelId,
// reçue en paramètre : app.js donne la sienne, les tests une fonction simple.

import {
  creerUe,
  creerElement,
  creerEvaluation,
  codeUe,
  lireNote,
  lireCoefEvaluation,
  lireCoefUe,
  lireMalus,
} from './modele.js';
import { RAISON_AVANT_EN_TETE } from './import-coefficients.js';

// Nombre maximal de lignes citées dans la demande de confirmation.
const REMPLACES_AFFICHES = 8;

/* ==================== Codes des lignes ==================== */

/**
 * Clé de rapprochement d'un code : deux codes qui désignent la même ligne
 * ont la même clé, qu'ils viennent du tableau, du relevé ou de la saisie.
 *   « SAE 4.01 », « SAE4.01 », « S4.01 »      → « S4.01 »
 *   « S4.PF », « PORTFOLIO », « Portfolio »    → « PORTFOLIO »
 *   « S4.MP », « S6.STAGE », « Stage »         → « STAGE »
 *   « R4.B.09 »                                → « R4.B.09 »
 *
 * @param {string} code
 * @returns {string}
 */
export function cleCode(code) {
  // 1. Sans espaces et en majuscules : « SAE 4.01 » → « SAE4.01 ».
  const brut = code.replace(/\s+/g, '').toUpperCase();

  // 2. Le tableau donne un code au portfolio et au stage ; le relevé, un nom.
  if (/^(?:S\d\.PF|PORTFOLIO)$/.test(brut)) {
    return 'PORTFOLIO';
  }
  if (/^(?:S\d\.(?:MP|STAGE)|STAGE)$/.test(brut)) {
    return 'STAGE';
  }

  // 3. « SAE4.01 » s'écrit aussi « S4.01 » : on garde la forme courte.
  return brut.replace(/^SAE(?=\d)/, 'S');
}

// Séparateur des parties de SAE propres à une UE : « S3.01 – UE3.2 ».
const SEPARATEUR_PARTIE = ' – ';

/**
 * Code d'une partie de SAE propre à une UE (au S3).
 * « S3.01 » et « UE3.2 » → « S3.01 – UE3.2 ».
 */
export function codePartie(code, ue) {
  return `${code}${SEPARATEUR_PARTIE}${ue}`;
}

/**
 * Découpe le code d'une partie de SAE : « S3.01 – UE3.2 » → { base: 'S3.01', ue: 'UE3.2' }.
 * Renvoie null pour un code ordinaire (« R3.01 »). Le tiret peut être court ou long.
 */
function lirePartie(code) {
  const trouve = /^(.+?)\s*[–—-]\s*(UE\d\.\d)$/i.exec(code.trim());
  return trouve ? { base: trouve[1], ue: trouve[2].toUpperCase() } : null;
}

// Les codes d'une ligne de la saisie : son code, puis ses alias. Les alias
// viennent du tableau : « R4.08 R4.B.08 » donne le code « R4.B.08 » et
// l'alias « R4.08 ». Une ligne saisie à la main n'en a pas.
const codesDe = (element) => [element.code, ...(element.alias ?? [])];

// Vrai si deux listes de codes ont un code en commun (même clé).
function codeCommun(codesA, codesB) {
  const cles = new Set(codesA.map(cleCode));
  return codesB.some((code) => cles.has(cleCode(code)));
}

// La ligne « ordinaire » (pas une partie par UE) qui porte l'un de ces codes,
// par son code ou par un alias, ou undefined.
function ligneOrdinaire(semestre, codes) {
  return semestre.elements.find(
    (element) => lirePartie(element.code) === null && codeCommun(codesDe(element), codes),
  );
}

// Les parties par UE d'une SAE (« S3.01 – UE3.1 », « S3.01 – UE3.2 »…),
// dont le code de base est l'un de ces codes.
function partiesDe(semestre, codes) {
  return semestre.elements.filter((element) => {
    const partie = lirePartie(element.code);
    return partie !== null && codeCommun([partie.base], codes);
  });
}

/* ==================== Petits outils ==================== */

// Nombre → texte d'un champ, à la française : 14.5 → « 14,5 » ; null → « ».
function enTexte(nombre) {
  return nombre === null || nombre === undefined ? '' : String(nombre).replace('.', ',');
}

// « UE3.2 » → { semestre: 3, numero: 2 } ; un code mal formé → null.
function lireCodeUe(code) {
  const trouve = /^UE(\d)\.(\d)$/.exec(code ?? '');
  return trouve ? { semestre: Number(trouve[1]), numero: Number(trouve[2]) } : null;
}

// « 1 évaluation », « 3 évaluations ».
function nombreDe(n, singulier, pluriel) {
  return `${n} ${n === 1 ? singulier : pluriel}`;
}

// Nom d'une ligne de la saisie dans un message : « R3.01 Développement web ».
function nomLigne(element) {
  const code = element.code.trim() || 'ligne sans code';
  const intitule = element.intitule.trim();
  return intitule ? `${code} ${intitule}` : code;
}

// Une case de coefficient au moins est remplie.
const aDesCoefs = (element) => Object.values(element.coefs).some((texte) => String(texte).trim() !== '');

// Deux jeux de coefficients sont les mêmes, en valeur (« 7,5 » = « 7.5 », case vide = 0).
function memesCoefs(a, b) {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ids].every((id) => lireCoefUe(a[id]).valeur === lireCoefUe(b[id]).valeur);
}

// Une évaluation a au moins un champ rempli.
const aDuContenu = (evaluation) =>
  [evaluation.libelle, evaluation.note, evaluation.coef].some((texte) => String(texte).trim() !== '');

// Deux listes d'évaluations sont les mêmes, en valeur.
function memesEvaluations(a, b) {
  const resumer = (liste) =>
    liste
      .filter(aDuContenu)
      .map((e) => [e.libelle.trim(), lireNote(e.note).valeur, lireCoefEvaluation(e.coef).valeur]);
  return JSON.stringify(resumer(a)) === JSON.stringify(resumer(b));
}

/**
 * L'UE de ce numéro dans la saisie, ou une nouvelle UE (les UE restent
 * rangées par numéro).
 */
function trouverOuCreerUe(semestre, numero, nouvelId) {
  let ue = semestre.ues.find((candidate) => candidate.numero === numero);
  if (!ue) {
    ue = creerUe(nouvelId(), numero);
    semestre.ues.push(ue);
    semestre.ues.sort((a, b) => a.numero - b.numero);
  }
  return ue;
}

// Le champ à compléter pour donner un coefficient à une ligne : sa première case d'UE.
function cibleCoefficient(numero, semestre, element) {
  return { semestre: numero, champ: 'element-coef', element: element.id, ue: semestre.ues[0]?.id ?? null };
}

/**
 * Ajoute à « à compléter » chaque évaluation du semestre qui a un contenu
 * mais pas de coefficient : un « Coef ?? » du relevé, ou une saisie
 * incomplète. Les deux imports l'appellent : le rapport du DERNIER import
 * montre donc tout ce qui reste à compléter.
 */
function demanderCoefsEvaluations(semestre, numero, rapport) {
  for (const element of semestre.elements) {
    for (const evaluation of element.evaluations) {
      if (aDuContenu(evaluation) && String(evaluation.coef).trim() === '') {
        rapport.aCompleter.push({
          texte: `S${numero} · ${nomLigne(element)} : « ${evaluation.libelle.trim() || 'évaluation sans intitulé'} », coefficient inconnu. Saisis-le.`,
          cible: { semestre: numero, champ: 'evaluation-coef', element: element.id, evaluation: evaluation.id },
        });
      }
    }
  }
}

// Une proposition vide, que les fonctions de remplissage complètent.
function nouvelleProposition(sorte) {
  return {
    semestres: {}, // numéro → nouvel état de ce semestre
    remplaces: [], // ce qui serait remplacé : « S3 · coefficients de R3.01 … »
    officiels: null, // (relevé) moyennes officielles, pour la comparaison
    rapport: {
      sorte, // 'coefficients' ou 'releve'
      compris: [], // ce qui a été compris et rempli
      aCompleter: [], // { texte, cible } : un champ à remplir, avec un lien
      aVerifier: [], // ce qui n'a pas été compris, ou demande une vérification
      ignores: [], // ce qui a été écarté volontairement
    },
  };
}

/* ==================== Import du tableau des coefficients ==================== */

/**
 * Prépare l'import d'un tableau des coefficients.
 *
 * @param {Object<number, object>} semestres état de la saisie des 6 semestres
 * @param {object} resultat résultat de importerCoefficients
 * @param {() => string} nouvelId fabrique un identifiant unique
 * @returns {{ semestres: Object<number, object>, remplaces: string[], officiels: null, rapport: object }}
 */
export function preparerImportCoefficients(semestres, resultat, nouvelId) {
  const proposition = nouvelleProposition('coefficients');
  const { rapport } = proposition;

  // 1. Ce que l'analyseur a refusé (totaux faux…).
  for (const { message } of resultat.rapport.erreurs) {
    rapport.aVerifier.push(message);
  }

  // 2. Ce qu'il a écarté (titres, ECTS…). On ne recopie le texte que des
  //    lignes écartées DANS un vrai tableau. Sinon (au-dessus du tableau, ou
  //    dans un autre PDF, comme le relevé choisi par erreur), une ligne peut
  //    contenir n'importe quoi, jusqu'à ton nom : on donne seulement leur nombre.
  const estUnTableau = resultat.semestres.length > 0;
  let horsTableau = 0;
  for (const { page, texte, raison } of resultat.rapport.ignore) {
    if (estUnTableau && raison !== RAISON_AVANT_EN_TETE) {
      rapport.ignores.push(`Page ${page} : « ${texte} » (${raison}).`);
    } else {
      horsTableau++;
    }
  }
  if (horsTableau > 0) {
    rapport.ignores.unshift(
      horsTableau === 1
        ? '1 ligne hors du tableau (titre du document…) écartée sans être affichée.'
        : `${horsTableau} lignes hors du tableau (titre du document…) écartées sans être affichées.`,
    );
  }

  // 3. Chaque semestre du tableau remplit le semestre de même numéro.
  for (const table of resultat.semestres) {
    if (!semestres[table.numero]) {
      rapport.aVerifier.push(`Semestre ${table.numero} : il n’existe pas dans le simulateur (S1 à S6), il n’est pas importé.`);
      continue;
    }
    proposition.semestres[table.numero] = remplirCoefficients(semestres[table.numero], table, nouvelId, proposition);
  }
  return proposition;
}

/**
 * Remplit un semestre avec son tableau : UE, puis coefficients ligne par ligne.
 * Renvoie le nouvel état du semestre.
 */
function remplirCoefficients(ancien, table, nouvelId, { remplaces, rapport }) {
  const semestre = structuredClone(ancien); // copie : l'état reçu ne change pas
  const n = table.numero;

  // 1. Une UE par colonne du tableau. Une UE de même numéro déjà saisie est
  //    gardée (avec son intitulé) : on ne crée pas de doublon.
  const idsUe = {}; // « UE3.1 » → identifiant de l'UE dans la saisie
  for (const { code } of table.ues) {
    idsUe[code] = trouverOuCreerUe(semestre, lireCodeUe(code).numero, nouvelId).id;
  }

  // 2. Le coefficient de chaque ligne dans chaque UE.
  const remplies = new Set(); // identifiants des lignes qui ont reçu leurs coefficients
  for (const ligne of table.lignes) {
    // Le code de la ligne et ses alias (« R4.B.08 » et « R4.08 ») : la
    // saisie peut contenir l'un ou l'autre.
    const codesLigne = [ligne.code, ...(ligne.alias ?? [])];

    // a. SAE déjà découpée par UE (au S3, par le relevé) : chaque partie
    //    reçoit le coefficient de SA seule UE.
    const parties = partiesDe(semestre, codesLigne);
    if (parties.length > 0) {
      remplirParties(semestre, ligne, parties, idsUe, n, nouvelId, { remplaces, rapport, remplies });
      continue;
    }

    // b. Ligne sans aucun coefficient (portfolio du S1…) : elle ne compte
    //    pas ce semestre. On ne la crée que si le relevé l'a déjà apportée.
    let element = ligneOrdinaire(semestre, codesLigne);
    const sansCoef = Object.keys(ligne.coefs).length === 0;
    if (sansCoef && !element) {
      rapport.ignores.push(`S${n} · ${ligne.code} ${ligne.libelle} : aucun coefficient ce semestre, la ligne n’est pas créée.`);
      continue;
    }

    // c. Ligne déjà saisie (même code, ou un alias) : on la complète, et le
    //    code du tableau remplace celui du relevé (« Portfolio » → « S4.PF »).
    //    Sinon, on la crée. Dans les deux cas, elle garde les alias du
    //    tableau, pour que le relevé la retrouve.
    if (element) {
      element.code = ligne.code;
      element.alias = ligne.alias ?? [];
      element.type = ligne.type;
      if (!element.intitule.trim()) {
        element.intitule = ligne.libelle;
      }
    } else {
      element = {
        ...creerElement(nouvelId(), ligne.type),
        code: ligne.code,
        alias: ligne.alias ?? [],
        intitule: ligne.libelle,
      };
      semestre.elements.push(element);
    }

    // d. Les coefficients, en texte, rangés par identifiant d'UE.
    const coefs = {};
    for (const [ue, coef] of Object.entries(ligne.coefs)) {
      coefs[idsUe[ue]] = enTexte(coef);
    }
    if (aDesCoefs(element) && !memesCoefs(element.coefs, coefs)) {
      remplaces.push(`S${n} · coefficients de ${nomLigne(element)}`);
    }
    element.coefs = coefs;
    remplies.add(element.id);
    if (sansCoef) {
      rapport.aVerifier.push(`S${n} · ${nomLigne(element)} : aucun coefficient dans le tableau ce semestre, ses notes ne comptent pas.`);
    }
  }

  // 3. Lignes de la saisie absentes du tableau et sans coefficient : à compléter.
  for (const element of semestre.elements) {
    if (!remplies.has(element.id) && !aDesCoefs(element)) {
      rapport.aCompleter.push({
        texte: `S${n} · ${nomLigne(element)} : absente du tableau des coefficients. Saisis ses coefficients.`,
        cible: cibleCoefficient(n, semestre, element),
      });
    }
  }

  // 4. Évaluations au coefficient inconnu (« Coef ?? » d'un relevé déjà importé…).
  demanderCoefsEvaluations(semestre, n, rapport);

  // 5. UE de la saisie absentes du tableau : gardées, mais signalées.
  for (const ue of semestre.ues) {
    if (!Object.values(idsUe).includes(ue.id)) {
      rapport.aVerifier.push(`S${n} · ${codeUe(n, ue.numero)} : absente du tableau. Elle est gardée : supprime-la si elle ne sert pas.`);
    }
  }

  // 6. Ce qui a été compris.
  const lignes = semestre.elements.filter((element) => remplies.has(element.id));
  const ressources = lignes.filter((element) => element.type === 'ressource').length;
  rapport.compris.push(
    `S${n} : ${nombreDe(table.ues.length, 'UE', 'UE')} (${table.ues.map((ue) => ue.code).join(', ')}) ; ` +
      `${nombreDe(ressources, 'ressource', 'ressources')} et ${nombreDe(lignes.length - ressources, 'partie', 'parties')} du pôle SAE, avec leurs coefficients.`,
  );
  return semestre;
}

/**
 * Coefficients d'une SAE découpée par UE (au S3) : la partie « S3.01 – UE3.2 »
 * ne reçoit que le coefficient de S3.01 dans UE3.2. Une partie manquante pour
 * une UE où la SAE compte est créée (sans évaluation), pour que le poids du
 * pôle SAE de cette UE soit juste.
 */
function remplirParties(semestre, ligne, parties, idsUe, n, nouvelId, { remplaces, rapport, remplies }) {
  // 1. Une partie pour chaque UE où la SAE a un coefficient.
  for (const ue of Object.keys(ligne.coefs)) {
    if (!parties.some((partie) => lirePartie(partie.code).ue === ue)) {
      const nouvelle = { ...creerElement(nouvelId(), 'sae'), code: codePartie(ligne.code, ue), intitule: ligne.libelle };
      // Rangée juste après la dernière partie de cette SAE.
      semestre.elements.splice(semestre.elements.indexOf(parties.at(-1)) + 1, 0, nouvelle);
      parties.push(nouvelle);
    }
  }

  // 2. Chaque partie : le code du tableau, et le coefficient de son UE seulement.
  for (const partie of parties) {
    const { ue } = lirePartie(partie.code);
    const coef = ligne.coefs[ue];
    const coefs = coef === undefined ? {} : { [idsUe[ue]]: enTexte(coef) };
    if (aDesCoefs(partie) && !memesCoefs(partie.coefs, coefs)) {
      remplaces.push(`S${n} · coefficients de ${nomLigne(partie)}`);
    }
    partie.code = codePartie(ligne.code, ue);
    partie.type = 'sae';
    partie.coefs = coefs;
    if (!partie.intitule.trim()) {
      partie.intitule = ligne.libelle;
    }
    remplies.add(partie.id);
    if (coef === undefined) {
      rapport.aVerifier.push(`S${n} · ${partie.code} : le tableau ne donne aucun coefficient à ${ligne.code} dans ${ue}, ses notes ne comptent pas.`);
    }
  }
}

/* ==================== Import du relevé de notes ==================== */

/**
 * Prépare l'import d'un relevé « Détail des notes ».
 *
 * @param {Object<number, object>} semestres état de la saisie des 6 semestres
 * @param {object} resultat résultat de importerNotes
 * @param {() => string} nouvelId fabrique un identifiant unique
 * @returns {{
 *   semestres: Object<number, object>, remplaces: string[], rapport: object,
 *   officiels: {
 *     ues: Object<number, Object<string, { moyenne: number|null, poleSae: number|null, poleRessources: number|null }>>,
 *     competences: Object<number, Object<number, number|null>>,   // année (n° du semestre impair) → n° de compétence → moyenne
 *   },
 * }}
 */
export function preparerImportReleve(semestres, resultat, nouvelId) {
  const proposition = nouvelleProposition('releve');
  const { rapport } = proposition;
  const lu = resultat.rapport;

  // 1. Ce que l'analyseur a écarté ou n'a pas compris. L'en-tête personnel
  //    n'est jamais lu : on n'en donne que le nombre de lignes.
  if (lu.lignesNonLues > 0) {
    rapport.ignores.push(
      lu.lignesNonLues === 1
        ? '1 ligne d’en-tête ou de bas de page (nom, n° de dossier, légende…) écartée sans être lue.'
        : `${lu.lignesNonLues} lignes d’en-tête ou de bas de page (nom, n° de dossier, légende…) écartées sans être lues.`,
    );
  }
  for (const { page, texte, raison } of lu.ignore) {
    rapport.ignores.push(`Page ${page} : « ${texte} » (${raison}).`);
  }
  for (const { page, message } of lu.aVerifier) {
    rapport.aVerifier.push(page ? `Page ${page} : ${message}` : message);
  }
  for (const { message } of lu.erreurs) {
    rapport.aVerifier.push(message);
  }

  // 2. Chaque semestre du relevé remplit le semestre de même numéro.
  for (const releve of resultat.semestres) {
    if (!semestres[releve.numero]) {
      rapport.aVerifier.push(`Semestre ${releve.numero} : il n’existe pas dans le simulateur (S1 à S6), il n’est pas importé.`);
      continue;
    }
    proposition.semestres[releve.numero] = remplirReleve(semestres[releve.numero], releve, nouvelId, proposition);
  }

  // 3. Les moyennes officielles, gardées pour les comparer aux moyennes calculées.
  proposition.officiels = officielsDu(resultat);
  const nbUe = Object.values(proposition.officiels.ues)
    .flatMap((ues) => Object.values(ues))
    .filter((ue) => ue.moyenne !== null).length;
  const nbCompetences = Object.values(proposition.officiels.competences)
    .flatMap((competences) => Object.values(competences))
    .filter((moyenne) => moyenne !== null).length;
  if (nbUe + nbCompetences > 0) {
    rapport.compris.push(
      `Moyennes officielles gardées pour les comparer aux moyennes calculées : ${nombreDe(nbUe, 'UE', 'UE')} (avec leurs pôles) et ${nombreDe(nbCompetences, 'compétence', 'compétences')}.`,
    );
  }
  return proposition;
}

/**
 * Remplit un semestre avec son relevé : malus, UE, puis les évaluations de
 * chaque ligne. Renvoie le nouvel état du semestre.
 */
function remplirReleve(ancien, releve, nouvelId, { remplaces, rapport }) {
  const semestre = structuredClone(ancien); // copie : l'état reçu ne change pas
  const n = releve.numero;
  const contexte = {
    semestre,
    n,
    nouvelId,
    remplaces,
    rapport,
    touchees: new Set(), // identifiants des lignes qui ont reçu des évaluations
    // Le tableau des coefficients est déjà là si une ligne a un coefficient.
    // On le regarde AVANT d'ajouter les notes du relevé.
    avecTableau: semestre.elements.some(aDesCoefs),
    absentes: new Set(), // ressources du relevé absentes du tableau (déjà signalées)
  };

  // 1. Le malus du relevé remplit le champ malus (case vide : pas de malus).
  const malus = enTexte(releve.malus);
  if (semestre.malus.trim() !== '' && lireMalus(semestre.malus).valeur !== lireMalus(malus).valeur) {
    remplaces.push(`S${n} · malus (${semestre.malus.trim()})`);
  }
  semestre.malus = malus;

  // 2. Les UE du relevé : créées si besoin (pour pouvoir saisir les
  //    coefficients), et leur intitulé complété s'il est vide.
  for (const ue of releve.ues) {
    const lu = lireCodeUe(ue.code);
    if (lu?.semestre !== n) {
      continue; // déjà signalé par l'analyseur
    }
    const existante = trouverOuCreerUe(semestre, lu.numero, nouvelId);
    if (!existante.intitule.trim()) {
      existante.intitule = ue.libelle;
    }
  }

  // 3. Les évaluations de chaque ressource, SAE, portfolio ou stage.
  for (const element of releve.elements) {
    const evaluations = evaluationsDuReleve(element, n, rapport).map((evaluation) => ({
      ...evaluation,
      // Une UE citée qui n'est pas de ce semestre ne compte pas.
      ue: lireCodeUe(evaluation.ue)?.semestre === n ? evaluation.ue : null,
    }));
    if (evaluations.some((evaluation) => evaluation.ue !== null)) {
      placerParUe(element, evaluations, contexte); // SAE du S3
    } else {
      placerDansLigne(element, evaluations, contexte);
    }
  }

  // 4. Coefficients à compléter : lignes sans aucun coefficient. Si AUCUNE
  //    ligne du semestre n'en a, le relevé arrive avant le tableau : on le
  //    dit en une seule fois.
  //    Les ressources absentes du tableau sont déjà signalées : pas deux messages.
  const touchees = semestre.elements.filter((element) => contexte.touchees.has(element.id));
  const sansCoef = touchees.filter((element) => !aDesCoefs(element) && !contexte.absentes.has(element.id));
  if (sansCoef.length > 0 && !semestre.elements.some(aDesCoefs)) {
    rapport.aCompleter.push({
      texte: `S${n} : aucune ligne n’a encore de coefficient. Importe le tableau des coefficients, ou saisis les coefficients de chaque ligne. Les notes sont gardées.`,
      cible: cibleCoefficient(n, semestre, sansCoef[0]),
    });
  } else {
    for (const element of sansCoef) {
      rapport.aCompleter.push({
        texte: `S${n} · ${nomLigne(element)} : aucun coefficient, ses notes ne comptent pas. Saisis ses coefficients s’il en a.`,
        cible: cibleCoefficient(n, semestre, element),
      });
    }
  }

  // 5. … et évaluations au coefficient inconnu (« Coef ?? »).
  demanderCoefsEvaluations(semestre, n, rapport);

  // 6. Ce qui a été compris.
  const ressources = touchees.filter((element) => element.type === 'ressource').length;
  const evaluations = touchees.flatMap((element) => element.evaluations);
  const nonNotees = evaluations.filter((evaluation) => evaluation.note === '').length;
  rapport.compris.push(
    `S${n} : ${nombreDe(ressources, 'ressource', 'ressources')} et ${nombreDe(touchees.length - ressources, 'partie', 'parties')} du pôle SAE ; ` +
      `${nombreDe(evaluations.length, 'évaluation', 'évaluations')}, dont ${nombreDe(nonNotees, 'pas encore notée', 'pas encore notées')}. ` +
      `Malus : ${malus || 'aucun'}.`,
  );
  return semestre;
}

/**
 * Les évaluations d'une ligne du relevé. Une ressource avec une seule
 * matière (Langues → Anglais) prend les évaluations de la matière. Avec
 * plusieurs matières, on les réunit, et on le signale : la moyenne
 * officielle peut se calculer autrement.
 */
function evaluationsDuReleve(element, n, rapport) {
  const evaluations = [...element.evaluations];
  for (const matiere of element.matieres) {
    evaluations.push(...matiere.evaluations);
  }
  if (element.matieres.length > 1) {
    const noms = element.matieres.map((matiere) => `« ${matiere.libelle} »`).join(', ');
    rapport.aVerifier.push(
      `S${n} · ${element.code ?? element.libelle} : ${element.matieres.length} matières (${noms}). Leurs évaluations sont réunies dans cette ressource : vérifie les coefficients, la moyenne officielle peut se calculer autrement.`,
    );
  }
  return evaluations;
}

// Le code d'une ligne du relevé dans la saisie : « R3.01 », « SAE 4.01 »,
// ou un nom pour le portfolio et le stage (le tableau le remplacera par son code).
function codeDuReleve(element) {
  if (element.code) {
    return element.code;
  }
  return element.type === 'stage' ? 'Stage' : 'Portfolio';
}

// Une évaluation du relevé → une évaluation de la saisie (les nombres en texte).
function versSaisie(evaluation, { nouvelId }) {
  return {
    ...creerEvaluation(nouvelId()),
    libelle: evaluation.libelle,
    note: enTexte(evaluation.note),
    coef: enTexte(evaluation.coef),
  };
}

/**
 * Remplace les évaluations d'une ligne de la saisie par celles du relevé.
 * Si la ligne avait déjà d'autres évaluations, on le note pour la confirmation.
 */
function remplacerEvaluations(ligne, evaluationsReleve, contexte) {
  const nouvelles = evaluationsReleve.map((evaluation) => versSaisie(evaluation, contexte));
  if (ligne.evaluations.some(aDuContenu) && !memesEvaluations(ligne.evaluations, nouvelles)) {
    contexte.remplaces.push(`S${contexte.n} · évaluations de ${nomLigne(ligne)}`);
  }
  ligne.evaluations = nouvelles;
  contexte.touchees.add(ligne.id);
}

/**
 * Ligne ordinaire : ses évaluations vont dans la ligne de même code, ou dont
 * un alias est ce code (R3.01 ; R4.B.08 → ligne « R4.B.08 » du tableau, alias
 * « R4.08 » ; Portfolio → S4.PF ou PORTFOLIO ; Stage → S4.MP ou S6.STAGE ;
 * SAE 4.01 → S4.01), créée si elle n'existe pas encore.
 *
 * Une RESSOURCE introuvable alors que le tableau est déjà importé n'est pas
 * ajoutée en silence : elle est signalée dans « à vérifier ». Ses notes sont
 * gardées, pour ne rien perdre, mais elles ne comptent pas tant qu'elle n'a
 * pas de coefficient.
 */
function placerDansLigne(element, evaluations, contexte) {
  const { semestre, n, nouvelId, rapport } = contexte;
  const code = codeDuReleve(element);
  let ligne = ligneOrdinaire(semestre, [code]);
  if (!ligne) {
    const type = element.type === 'ressource' ? 'ressource' : 'sae';
    // Le portfolio et le stage n'ont que leur nom : pas d'intitulé en plus.
    ligne = { ...creerElement(nouvelId(), type), code, intitule: element.code ? element.libelle : '' };
    semestre.elements.push(ligne);
    if (type === 'ressource' && contexte.avecTableau) {
      rapport.aVerifier.push(
        `S${n} · ${nomLigne(ligne)} : cette ressource du relevé ne correspond à aucune ligne du tableau des coefficients. ` +
          'Elle est ajoutée avec ses notes, mais sans coefficient : ses notes ne comptent pas. Vérifie son code, ou saisis ses coefficients.',
      );
      contexte.absentes.add(ligne.id);
    }
  } else if (!ligne.intitule.trim() && element.code) {
    ligne.intitule = element.libelle;
  }
  remplacerEvaluations(ligne, evaluations, contexte);
  return ligne;
}

/**
 * SAE du S3, dont les évaluations sont rangées par UE (« Sae UE 3.2 : … ») :
 * une partie par UE, par exemple « S3.01 – UE3.2 », qui n'a de coefficient
 * que dans cette UE et ne contient que ses évaluations.
 */
function placerParUe(element, evaluations, contexte) {
  const { semestre, n, nouvelId, rapport } = contexte;
  const code = codeDuReleve(element);

  // 1. La ligne ordinaire de même code, si le tableau l'a déjà créée avec un
  //    coefficient par UE : elle va être remplacée par ses parties.
  const ordinaire = ligneOrdinaire(semestre, [code]);
  const parties = partiesDe(semestre, [code]);
  const base = ordinaire?.code ?? (parties.length > 0 ? lirePartie(parties[0].code).base : code);

  // 2. Les UE concernées : celles des évaluations, et celles où la ligne du
  //    tableau a un coefficient (une partie sans évaluation garde le poids du pôle juste).
  const codesUe = new Set(evaluations.map((evaluation) => evaluation.ue).filter(Boolean));
  if (ordinaire) {
    for (const ue of semestre.ues) {
      if (lireCoefUe(ordinaire.coefs[ue.id]).valeur > 0) {
        codesUe.add(codeUe(n, ue.numero));
      }
    }
  }

  // 3. Une partie par UE, avec le coefficient de la ligne du tableau dans cette UE.
  const nouvelles = [];
  for (const codeUeCible of [...codesUe].sort()) {
    const ue = trouverOuCreerUe(semestre, lireCodeUe(codeUeCible).numero, nouvelId);
    let partie = parties.find((candidate) => lirePartie(candidate.code).ue === codeUeCible);
    if (!partie) {
      const coef = String(ordinaire?.coefs[ue.id] ?? '').trim();
      partie = {
        ...creerElement(nouvelId(), 'sae'),
        code: codePartie(base, codeUeCible),
        intitule: ordinaire?.intitule.trim() || element.libelle,
        coefs: coef ? { [ue.id]: coef } : {},
      };
      nouvelles.push(partie);
    }
    remplacerEvaluations(
      partie,
      evaluations.filter((evaluation) => evaluation.ue === codeUeCible),
      contexte,
    );
  }

  // 4. Évaluations sans UE (rare, déjà signalé par l'analyseur) : rangées
  //    dans la ligne ordinaire. Sinon, la ligne ordinaire est remplacée par
  //    ses parties (elle ne doit pas compter deux fois).
  const sansUe = evaluations.filter((evaluation) => evaluation.ue === null);
  if (sansUe.length > 0) {
    const ligne = placerDansLigne(element, sansUe, contexte);
    rapport.aVerifier.push(
      `S${n} · ${nomLigne(ligne)} : ${nombreDe(sansUe.length, 'évaluation sans UE dans son libellé, rangée', 'évaluations sans UE dans leur libellé, rangées')} dans cette ligne. Vérifie ses coefficients.`,
    );
  } else if (ordinaire) {
    if (ordinaire.evaluations.some(aDuContenu)) {
      contexte.remplaces.push(`S${n} · évaluations de ${nomLigne(ordinaire)}`);
    }
    semestre.elements.splice(semestre.elements.indexOf(ordinaire), 1, ...nouvelles);
    nouvelles.length = 0; // déjà rangées, à la place de la ligne ordinaire
  }

  // 5. Les nouvelles parties restantes : après les parties existantes, sinon à la fin.
  const apres = parties.length > 0 ? semestre.elements.indexOf(parties.at(-1)) + 1 : semestre.elements.length;
  semestre.elements.splice(apres, 0, ...nouvelles);
}

/**
 * Moyennes officielles du relevé, rangées pour l'affichage « calculé / officiel ».
 * Les compétences sont celles de l'ANNÉE du relevé (S3 + S4 → année du S3).
 */
function officielsDu(resultat) {
  const officiels = { ues: {}, competences: {} };
  for (const semestre of resultat.semestres) {
    officiels.ues[semestre.numero] = Object.fromEntries(
      semestre.ues.map((ue) => [
        ue.code,
        { moyenne: ue.officiel.moyenne, poleSae: ue.officiel.poleSae, poleRessources: ue.officiel.poleRessources },
      ]),
    );
  }
  const premier = resultat.semestres[0]?.numero;
  if (premier !== undefined && resultat.competences.length > 0) {
    const impair = premier % 2 === 1 ? premier : premier - 1;
    officiels.competences[impair] = Object.fromEntries(
      resultat.competences.map((competence) => [Number(competence.code.slice(1)), competence.officiel.moyenne]),
    );
  }
  return officiels;
}

/* ==================== Confirmation ==================== */

/**
 * Texte de la demande de confirmation, quand un import remplacerait une
 * saisie existante.
 *
 * @param {string[]} remplaces
 * @returns {string}
 */
export function messageConfirmation(remplaces) {
  const lignes = remplaces.slice(0, REMPLACES_AFFICHES).map((texte) => `• ${texte}`);
  if (remplaces.length > REMPLACES_AFFICHES) {
    const reste = remplaces.length - REMPLACES_AFFICHES;
    lignes.push(`• … et ${nombreDe(reste, 'autre', 'autres')}`);
  }
  return `Cet import va remplacer ce qui est déjà saisi :\n${lignes.join('\n')}\n\nContinuer ?`;
}
