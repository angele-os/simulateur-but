// Calcul des moyennes du BUT Informatique (IUT de Metz).
//
// Toutes les fonctions de ce fichier sont « pures » : elles ne lisent que leurs
// paramètres, ne modifient rien et ne touchent ni à la page ni à pdf.js.
// On peut donc les tester simplement avec node:test.
//
// Les règles appliquées sont celles de la section 4 de FORMAT-PDF.md.

/*
 * Modèle de données
 * -----------------
 * semestre = {
 *   numero: 3,
 *   malus: 0.05,          // malus d'absences, retranché à chaque UE (0 si aucun)
 *   ues: [ue, ...],
 * }
 *
 * ue = {
 *   code: 'UE3.1',
 *   poleSae: {
 *     poids: 40,          // « TOTAL SAE » du tableau pour cette UE (sur 100)
 *     // Au S3 : les évaluations SAE de cette UE, directement.
 *     evaluations: [evaluation, ...],
 *     // Au S4 et au S6, à la place : des parties pondérées par le tableau.
 *     // parties: [{ code: 'S4.01', libelle, coef: 30, evaluations: [...] }, ...],
 *   },
 *   poleRessources: {
 *     poids: 60,          // « Total Ressources » du tableau pour cette UE
 *     ressources: [{ code: 'R3.01', libelle, coef: 12, evaluations: [...] }, ...],
 *   },
 * }
 *
 * evaluation = { libelle: 'Projet - coef 2', note: 14.5 ou null, coef: 2 ou null }
 *   - note null : pas encore notée, l'évaluation ne compte pas ;
 *   - coef null : coefficient inconnu (« Coef ?? »), l'évaluation ne compte pas
 *     tant que l'utilisateur ne l'a pas saisi.
 *
 * Une ressource qui compte dans plusieurs UE apparaît dans chacune de ces UE,
 * avec le coefficient du tableau propre à l'UE.
 */

// Marge ajoutée avant d'arrondir, exprimée en millièmes (voir arrondiMillieme).
const MARGE_ARRONDI = 1e-6;

/**
 * Arrondit au millième le plus proche (la moitié est arrondie vers le haut).
 *
 * Piège : l'ordinateur stocke les nombres en binaire, souvent de façon
 * approchée. La moyenne de 14,007 et 10 vaut 12,0035 en maths, mais
 * JavaScript obtient 12,00349999… : un arrondi naïf donne alors 12,003 au
 * lieu de 12,004.
 *
 * @param {number} valeur
 * @returns {number}
 */
export function arrondiMillieme(valeur) {
  // 1. On travaille sur la valeur absolue et on remet le signe à la fin,
  //    car Math.round arrondit -0,5 vers 0 (ce qui fausserait les négatifs).
  const signe = valeur < 0 ? -1 : 1;

  // 2. On passe en millièmes : 12,0035 devient 12003,4999999…
  const enMilliemes = Math.abs(valeur) * 1000;

  // 3. On ajoute une marge minuscule (un millionième de millième) :
  //    12003,4999999… passe au-dessus de 12003,5 et s'arrondit vers le haut.
  //    La marge est bien trop petite pour changer un arrondi « normal ».
  const arrondi = Math.round(enMilliemes + MARGE_ARRONDI);

  // 4. Cas du zéro : on renvoie 0 et non -0 (qui existe en JavaScript).
  if (arrondi === 0) {
    return 0;
  }

  // 5. On revient en points.
  return (signe * arrondi) / 1000;
}

/**
 * Moyenne pondérée d'une liste d'éléments { valeur, coef }.
 * Un élément sans valeur, sans coef ou avec un coef nul ne compte pas.
 * Le résultat est arrondi au millième (règle 6).
 *
 * @param {{ valeur: number|null, coef: number|null }[]} elements
 * @returns {number|null} null s'il ne reste aucun élément à moyenner
 */
function moyennePonderee(elements) {
  let sommeProduits = 0;
  let sommeCoefs = 0;

  for (const { valeur, coef } of elements) {
    // 1. On écarte ce qui ne peut pas compter : pas de note, pas de coef,
    //    ou coef à 0 (par exemple un portfolio sans coefficient ce semestre).
    if (typeof valeur !== 'number' || typeof coef !== 'number' || coef <= 0) {
      continue;
    }
    // 2. On accumule « valeur × coef » et la somme des coefs.
    sommeProduits += valeur * coef;
    sommeCoefs += coef;
  }

  // 3. Rien n'a compté : il n'y a pas de moyenne (et non 0, qui serait faux).
  if (sommeCoefs === 0) {
    return null;
  }

  // 4. Moyenne = Σ(valeur × coef) / Σ coef, arrondie au millième.
  return arrondiMillieme(sommeProduits / sommeCoefs);
}

/**
 * Moyenne d'une ressource, d'une matière ou d'une partie SAE (règle 1) :
 * Σ(note × coef) / Σ coef, sur les évaluations notées et de coef connu.
 *
 * @param {{ note: number|null, coef: number|null }[]} evaluations
 * @returns {number|null}
 */
export function moyenneEvaluations(evaluations) {
  return moyennePonderee(
    evaluations.map((evaluation) => ({ valeur: evaluation.note, coef: evaluation.coef })),
  );
}

/**
 * Pôle Ressources d'une UE (règle 2) :
 * Σ(moyenne de la ressource × coef du tableau pour cette UE) / Σ coef.
 * Une ressource sans aucune note ne compte pas.
 *
 * @param {{ ressources: { coef: number|null, evaluations: object[] }[] }} pole
 * @returns {number|null}
 */
export function poleRessources(pole) {
  return moyennePonderee(
    pole.ressources.map((ressource) => ({
      // 1. On calcule d'abord la moyenne de chaque ressource (déjà arrondie)…
      valeur: moyenneEvaluations(ressource.evaluations),
      // 2. … puis on la pondère par son coefficient du tableau dans cette UE.
      coef: ressource.coef,
    })),
  );
}

/**
 * Pôle SAE d'une UE (règle 3) :
 * - au S3 (pole.evaluations) : moyenne pondérée des évaluations SAE de cette
 *   UE, avec les coefficients des libellés ;
 * - au S4 et au S6 (pole.parties) : moyenne des parties (SAE, portfolio,
 *   stage), pondérée par les coefficients du tableau.
 *
 * @param {{ evaluations?: object[], parties?: object[] }} pole
 * @returns {number|null}
 */
export function poleSae(pole) {
  if (pole.parties) {
    return moyennePonderee(
      pole.parties.map((partie) => ({
        valeur: moyenneEvaluations(partie.evaluations),
        coef: partie.coef,
      })),
    );
  }
  return moyenneEvaluations(pole.evaluations);
}

/**
 * Moyenne d'une UE (règles 4 et 5) :
 * (poids SAE × pôle SAE + poids ressources × pôle ressources) / 100, moins
 * le malus du semestre.
 *
 * Si un pôle n'a encore aucune note, l'UE est « provisoire » : elle est
 * calculée avec le pôle qui existe.
 *
 * @param {object} ue
 * @param {number} [malus=0] malus d'absences du semestre
 * @returns {{ moyenne: number|null, provisoire: boolean,
 *             poleSae: number|null, poleRessources: number|null }}
 */
export function moyenneUe(ue, malus = 0) {
  // 1. On calcule les deux pôles.
  const sae = poleSae(ue.poleSae);
  const ressources = poleRessources(ue.poleRessources);

  // 2. On les combine avec leurs poids. Quand les deux pôles existent, la
  //    somme des poids vaut 100 : c'est exactement la formule de la règle 4.
  //    Quand un seul existe, on divise par son seul poids (règle 5).
  const moyennePoles = moyennePonderee([
    { valeur: sae, coef: ue.poleSae.poids },
    { valeur: ressources, coef: ue.poleRessources.poids },
  ]);

  // 3. Un pôle « manque » s'il devrait compter (poids > 0) mais n'a pas de note.
  const saeManque = sae === null && ue.poleSae.poids > 0;
  const ressourcesManque = ressources === null && ue.poleRessources.poids > 0;
  const provisoire = saeManque || ressourcesManque;

  // 4. Aucune note dans l'UE : pas de moyenne, et donc pas de malus non plus.
  if (moyennePoles === null) {
    return { moyenne: null, provisoire: true, poleSae: sae, poleRessources: ressources };
  }

  // 5. On retranche le malus, puis on arrondit au millième.
  return {
    moyenne: arrondiMillieme(moyennePoles - malus),
    provisoire,
    poleSae: sae,
    poleRessources: ressources,
  };
}

/**
 * Moyenne d'une compétence sur l'année (règle 7) : moyenne simple des deux UE
 * de même numéro (par exemple UE3.1 et UE4.1 pour C1).
 *
 * Elle reçoit les résultats renvoyés par moyenneUe. Si une seule UE a une
 * moyenne, on l'utilise seule et la compétence est provisoire.
 *
 * @param {{ moyenne: number|null, provisoire: boolean }} resultatUeA
 * @param {{ moyenne: number|null, provisoire: boolean }} resultatUeB
 * @returns {{ moyenne: number|null, provisoire: boolean }}
 */
export function moyenneCompetence(resultatUeA, resultatUeB) {
  // 1. On garde les moyennes qui existent.
  const moyennes = [resultatUeA.moyenne, resultatUeB.moyenne].filter(
    (moyenne) => moyenne !== null,
  );

  // 2. Aucune des deux UE n'a de moyenne.
  if (moyennes.length === 0) {
    return { moyenne: null, provisoire: true };
  }

  // 3. Moyenne simple (sans coefficient), arrondie au millième.
  const somme = moyennes.reduce((total, moyenne) => total + moyenne, 0);

  // 4. Provisoire s'il manque une UE ou si l'une des deux est provisoire.
  return {
    moyenne: arrondiMillieme(somme / moyennes.length),
    provisoire: moyennes.length < 2 || resultatUeA.provisoire || resultatUeB.provisoire,
  };
}

/**
 * Liste toutes les évaluations d'une UE, dans ses deux pôles.
 *
 * @param {object} ue
 * @returns {object[]}
 */
function listeEvaluations(ue) {
  const evaluationsSae = ue.poleSae.parties
    ? ue.poleSae.parties.flatMap((partie) => partie.evaluations)
    : ue.poleSae.evaluations;
  const evaluationsRessources = ue.poleRessources.ressources.flatMap(
    (ressource) => ressource.evaluations,
  );
  return [...evaluationsSae, ...evaluationsRessources];
}

/**
 * Renvoie une COPIE de l'UE où les évaluations choisies reçoivent la note
 * donnée. L'UE d'origine n'est pas modifiée (la fonction reste pure).
 *
 * La notation { ...objet, note } crée un nouvel objet qui reprend toutes les
 * propriétés de « objet » en remplaçant seulement « note ».
 *
 * @param {object} ue
 * @param {Set<object>} choisies évaluations à remplacer
 * @param {number} note
 * @returns {object}
 */
function ueAvecNote(ue, choisies, note) {
  const remplacer = (evaluations) =>
    evaluations.map((evaluation) => (choisies.has(evaluation) ? { ...evaluation, note } : evaluation));

  const nouveauPoleSae = ue.poleSae.parties
    ? {
        ...ue.poleSae,
        parties: ue.poleSae.parties.map((partie) => ({
          ...partie,
          evaluations: remplacer(partie.evaluations),
        })),
      }
    : { ...ue.poleSae, evaluations: remplacer(ue.poleSae.evaluations) };

  const nouveauPoleRessources = {
    ...ue.poleRessources,
    ressources: ue.poleRessources.ressources.map((ressource) => ({
      ...ressource,
      evaluations: remplacer(ressource.evaluations),
    })),
  };

  return { ...ue, poleSae: nouveauPoleSae, poleRessources: nouveauPoleRessources };
}

/**
 * Note minimale à obtenir à une évaluation pour que l'UE atteigne la cible.
 *
 * Si on passe une liste d'évaluations, on suppose la même note partout.
 * La note est donnée au millième, en tenant compte des arrondis officiels.
 *
 * @param {object} ue
 * @param {object|object[]} evaluation évaluation(s) de cette UE, pas encore notée(s)
 * @param {number} [cible=10]
 * @param {number} [malus=0] malus d'absences du semestre
 * @returns {{ statut: 'deja-atteinte'|'possible'|'impossible'|'coef-inconnu',
 *             note: number|null, moyenne: number|null }}
 *   - deja-atteinte : même avec 0, l'UE atteint la cible (note = 0) ;
 *   - possible : note = la note minimale, moyenne = la moyenne d'UE obtenue ;
 *   - impossible : même avec 20, on n'y arrive pas (moyenne = le maximum) ;
 *   - coef-inconnu : une évaluation n'a pas de coef, sa note ne compte pas.
 */
export function noteAViser(ue, evaluation, cible = 10, malus = 0) {
  // 1. On accepte une évaluation seule ou une liste d'évaluations.
  const choisies = new Set(Array.isArray(evaluation) ? evaluation : [evaluation]);

  // 2. Chaque évaluation doit appartenir à l'UE. Sinon, sa note n'aurait
  //    aucun effet et le résultat serait trompeur : c'est une erreur.
  const evaluationsDeLUe = new Set(listeEvaluations(ue));
  for (const choisie of choisies) {
    if (!evaluationsDeLUe.has(choisie)) {
      throw new Error(`Évaluation introuvable dans l'UE ${ue.code} : « ${choisie.libelle} »`);
    }
  }

  // 3. Sans coefficient, la note ne compte pas : on ne peut rien viser.
  for (const choisie of choisies) {
    if (typeof choisie.coef !== 'number' || choisie.coef <= 0) {
      return { statut: 'coef-inconnu', note: null, moyenne: null };
    }
  }

  // 4. Petite fonction qui calcule la moyenne de l'UE pour une note donnée.
  const moyenneAvec = (note) => moyenneUe(ueAvecNote(ue, choisies, note), malus).moyenne;

  // 5. Même avec 0, la cible est atteinte : rien à viser.
  const moyenneAvecZero = moyenneAvec(0);
  if (moyenneAvecZero >= cible) {
    return { statut: 'deja-atteinte', note: 0, moyenne: moyenneAvecZero };
  }

  // 6. Même avec 20, la cible est hors d'atteinte.
  const moyenneAvecVingt = moyenneAvec(20);
  if (moyenneAvecVingt < cible) {
    return { statut: 'impossible', note: null, moyenne: moyenneAvecVingt };
  }

  // 7. Recherche par dichotomie, en millièmes entiers (de 0 à 20 000).
  //    Plus la note monte, plus la moyenne monte : on coupe l'intervalle en
  //    deux à chaque tour, en gardant toujours :
  //      - « bas »  : une note qui ne suffit pas ;
  //      - « haut » : une note qui suffit.
  //    Une quinzaine de tours suffit pour trouver la note minimale.
  let bas = 0;
  let haut = 20000;
  while (haut - bas > 1) {
    const milieu = Math.floor((bas + haut) / 2);
    if (moyenneAvec(milieu / 1000) >= cible) {
      haut = milieu;
    } else {
      bas = milieu;
    }
  }

  // 8. « haut » est la plus petite note (en millièmes) qui suffit.
  const note = haut / 1000;
  return { statut: 'possible', note, moyenne: moyenneAvec(note) };
}
