// Analyse du PDF « Détail des notes » (relevé téléchargé sur l'ENT).
//
// Fonction pure : elle reçoit la liste d'éléments texte renvoyée par
// lecture-pdf.js ({ texte, x, y, taille, largeur, page }) et ne touche ni à
// la page ni à pdf.js. On peut donc la tester avec des données inventées.
//
// Les règles suivies sont celles de la section 3 de FORMAT-PDF.md.
//
// Données personnelles : l'en-tête du relevé (nom, dossier, NNE, courriel,
// date d'édition) n'est jamais lu. Les lignes écartées sont seulement
// COMPTÉES : leur texte ne va ni dans le résultat, ni dans le rapport.

import { regrouperEnLignes } from './import-coefficients.js';

// Au-delà de cette taille (en points), un élément est une lettre du
// filigrane « NON CERTIFIÉ » (environ 47 à 65 pt). Même valeur que dans
// lecture-pdf.js, qu'on ne peut pas importer ici (il charge pdf.js).
const TAILLE_MAX_TEXTE = 20;

// Un libellé peut commencer un peu avant son titre « Libellé » (en points).
// Ce qui commence encore plus à gauche est dans la colonne « Code ».
const MARGE_LIBELLE = 3;

// Une valeur (note, résultat, rang) peut déborder un peu à gauche du titre
// de sa colonne, par exemple quand elle est centrée et plus large que lui.
const MARGE_VALEURS = 10;

// Deux retraits qui diffèrent de moins de 2 points sont « au même niveau ».
const TOLERANCE_RETRAIT = 2;

// Deux morceaux de texte séparés de moins de 1 point se touchent : ce sont
// deux bouts du même mot (« Systèmes d'exploi » + « tation »).
const ECART_COLLE = 1;

// Lignes personnelles (ou pieds de page) qui se trouveraient DANS le
// tableau. Elles sont écartées sans être gardées, comme l'en-tête.
const MOTIFS_PERSONNELS = [
  /\b(?:nom|pr[ée]nom|dossier|nne|ine|courriel|e-?mail)\s*(?:n°\s*)?:/i, // « Dossier : … », « NNE : … »
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // une adresse e-mail
  /date\s+d['’]\s*[ée]dition/i, // « Date d'édition »
  /\bpage\s*\d+\s*(?:\/|sur)\s*\d+/i, // pied de page « Page 1/2 »
];

// Légende du bas de page : « ADM : Admis   AJ : Ajourné … ». Ce n'est pas
// une ligne du tableau. Sans ce filtre, rangée par son retrait, elle
// tomberait sous la ligne précédente (une ligne SENSE, une ressource…).
const MOTIFS_LEGENDE = [
  /^(?:ADM|ADJ|AJ|AJAC|ATT|CMP|DEF|NAR|NV|VAL|V\/COR|V)\s*:\s/, // un code de résultat, puis « : »
  /^l[ée]gende\b/i,
];

// Titres des colonnes de valeurs. « Code » et « Libellé » sont traités à part.
const TITRES_VALEURS = [
  { nom: 'session1', motif: /^session\s*1$/i },
  { nom: 'session2', motif: /^session\s*2$/i },
  { nom: 'resultat', motif: /^r[ée]sultats?$/i },
  { nom: 'rang', motif: /^rang$/i },
];
const MOTIF_TITRE_LIBELLE = /^libell[ée]s?$/i;

// Coefficient d'une évaluation, à la FIN du libellé : « … - coef 2 »,
// « … - Coef 1,5 », « … - Coef ?? ». Les majuscules ne comptent pas (i).
const MOTIF_COEF = /\bcoef(?:ficient)?\.?\s*:?\s*(\?+|\d+(?:[.,]\d+)?)\s*$/i;

// UE citée dans un libellé : « UE 3.2 », « UE3.1 », « UE 3.03 » (= 3.3).
// Le « 0? » avale le zéro de « 3.03 ».
const MOTIF_UE_CITEE = /\bUE\s?(\d)\.0?(\d)\b/i;

// Une note ou une moyenne : « 12 », « 12.5 », « 12,5 », « 17.833 ».
const MOTIF_NOMBRE = /^\d+(?:[.,]\d+)?$/;

// Types de lignes, reconnus par le libellé. L'ORDRE compte : on garde le
// premier motif qui correspond. Par exemple « Sae UE 3.2 : MVP - Coef 2 »
// est une évaluation (elle a un coef), pas une UE.
const TYPES_DE_LIGNES = [
  { type: 'sense', motif: /\bSENSE\b/ }, // en majuscules seulement
  { type: 'sense', motif: /^se saisir des enjeux/i },
  { type: 'diplome', motif: /^B\d\s*-\s*Informatique\b/i }, // « B2 - Informatique PT DACS (FI) »
  { type: 'malus', motif: /^malus\b/i },
  // Pôle : « Pôle SAE », « Pôle Ressource(s) », ou en abrégé « Pôle Res » / « Pôle RES ».
  { type: 'pole', motif: /^p[ôo]le\s+(sae|res(?:sources?)?)\b/i },
  { type: 'evaluation', motif: MOTIF_COEF },
  { type: 'competence', motif: /^(C\d)\b\s*(.*)$/ },
  { type: 'semestre', motif: /^semestre\s+(\d)\b/i },
  { type: 'ue', motif: /^UE\s?(\d)\.0?(\d)\b\s*(.*)$/i },
  { type: 'ressource', motif: /^(R\d\.(?:[A-Z]\.)?\d{2})\b\s*(.*)$/ }, // R3.01, R4.B.10
  { type: 'sae', motif: /^(SA[EÉ]\s?\d\.(?:[A-Z]\.)?\d{2})\b\s*(.*)$/i }, // SAE 3.01
  { type: 'portfolio', motif: /^portfolio\b/i },
  { type: 'stage', motif: /^stage\b/i },
  { type: 'matiere', motif: /^mati(?:[èe]re)?\.?\s*\d+\b/i }, // « Mati 1 Anglais »
];

// Libellé de l'évaluation créée quand le relevé ne donne qu'une moyenne
// officielle, sans évaluation détaillée.
const LIBELLE_MOYENNE_RELEVE = 'Moyenne du relevé';

/**
 * Analyse un relevé « Détail des notes ».
 *
 * @param {{ texte: string, x: number, y: number, taille: number, largeur: number, page: number }[]} elements
 * @returns {{
 *   competences: { code: string, libelle: string, officiel: { moyenne: number|null, resultat: string|null } }[],
 *   semestres: {
 *     numero: number, libelle: string,
 *     officiel: { moyenne: number|null, resultat: string|null },
 *     malus: number|null,          // null : pas de malus indiqué (case vide)
 *     ues: { code: string, libelle: string, officiel: {
 *       moyenne: number|null, resultat: string|null,
 *       poleSae: number|null, poleRessources: number|null } }[],
 *     elements: {
 *       type: 'ressource'|'sae'|'portfolio'|'stage',
 *       code: string|null,         // R3.01, SAE 3.01… (null pour portfolio et stage)
 *       libelle: string,
 *       ue: string|null,           // UE sous laquelle il apparaît dans le relevé
 *       officiel: { moyenne: number|null, resultat: string|null },
 *       evaluations: Evaluation[],
 *       matieres: { libelle: string, officiel: object, evaluations: Evaluation[] }[],
 *     }[],
 *   }[],
 *   rapport: {
 *     lignesNonLues: number,       // en-tête personnel, pieds de page et légende, jamais lus
 *     ignore: { page: number, texte: string, raison: string }[],
 *     aVerifier: { page?: number, message: string }[],
 *     coefsInconnus: { page: number, semestre: number, element: string, libelle: string, raison: string }[],
 *     erreurs: { message: string }[],
 *   },
 * }}
 * avec Evaluation = { libelle: string, note: number|null, coef: number|null, ue: string|null }
 *   - note null : pas encore notée ;
 *   - coef null : coefficient inconnu, à demander à l'utilisateur ;
 *   - ue : UE citée dans le libellé (évaluations de SAE du S3), sinon null ;
 *   - libellé « Moyenne du relevé » : créée quand le relevé ne donne que la
 *     moyenne officielle d'un élément, sans évaluation détaillée (signalé).
 *
 * Un élément écrit sur deux lignes de même code (« R5.B.04 … » puis
 * « R5.B.04 … FI », au BUT3) est réuni en un seul.
 */
export function importerNotes(elements) {
  const rapport = { lignesNonLues: 0, ignore: [], aVerifier: [], coefsInconnus: [], erreurs: [] };
  const resultat = { competences: [], semestres: [] };

  // 1. On écarte les lettres du filigrane AVANT tout le reste : sinon elles
  //    se collent aux notes (« F17.833 ») ou coupent une ligne en deux.
  const visibles = elements.filter((element) => element.taille <= TAILLE_MAX_TEXTE);

  // 2. On reconstitue les lignes, puis on garde les rangées du tableau.
  const rangees = lireRangees(regrouperEnLignes(visibles), rapport);
  if (rangees === null) {
    rapport.erreurs.push({
      message:
        'Aucune ligne de titres « Code Libellé Session 1 … » n’a été trouvée : ce PDF ne semble pas être un relevé « Détail des notes ».',
    });
    return { ...resultat, rapport };
  }

  // 3. On construit l'arbre grâce au retrait des libellés.
  const racine = construireArbre(rangees);

  // 4. On interprète chaque ligne, de haut en bas.
  for (const noeud of racine.enfants) {
    interpreter(noeud, {}, resultat, rapport);
  }

  // 5. Passe finale, une fois TOUT le relevé lu.
  if (resultat.semestres.length === 0) {
    rapport.erreurs.push({ message: 'Aucune ligne « SEMESTRE … » n’a été trouvée dans le relevé.' });
  }
  for (const semestre of resultat.semestres) {
    terminerSemestre(semestre, rapport);
  }

  return { ...resultat, rapport };
}

/* ==================== Étape 2 : les rangées du tableau ==================== */

/**
 * Parcourt les lignes et renvoie les rangées du tableau, découpées en colonnes.
 * L'en-tête personnel et les pieds de page sont écartés sans être lus.
 *
 * @returns {object[]|null} null si aucune ligne de titres n'a été trouvée
 */
function lireRangees(lignes, rapport) {
  // 1. On repère les pages qui ont leur propre ligne de titres. Sur ces
  //    pages, tout ce qui est AU-DESSUS des titres est l'en-tête du document.
  const pagesAvecTitres = new Set(lignes.filter(estLigneDeTitres).map((ligne) => ligne.page));

  const rangees = [];
  let colonnes = null; // positions des colonnes, lues sur la dernière ligne de titres
  let page = null;
  let titresVusSurLaPage = false;
  let session2Signalee = false;

  for (const ligne of lignes) {
    // 2. Changement de page : on n'a pas encore vu ses titres.
    if (ligne.page !== page) {
      page = ligne.page;
      titresVusSurLaPage = false;
    }

    // 3. Ligne de titres : elle donne la position des colonnes.
    //    (La colonne « Session 2 » existe toujours, même vide : on ne la
    //    signale que si elle contient une note, à l'étape 7.)
    if (estLigneDeTitres(ligne)) {
      colonnes = lireColonnes(ligne);
      titresVusSurLaPage = true;
      continue;
    }

    // 4. En-tête du document (avant les titres) : jamais lu, seulement compté.
    const avantLesTitres = pagesAvecTitres.has(page) && !titresVusSurLaPage;
    if (colonnes === null || avantLesTitres) {
      rapport.lignesNonLues++;
      continue;
    }

    // 5. Ligne personnelle ou pied de page dans le tableau : même traitement.
    const texte = ligne.elements.map((element) => element.texte).join(' ');
    if (MOTIFS_PERSONNELS.some((motif) => motif.test(texte))) {
      rapport.lignesNonLues++;
      continue;
    }

    // 6. Légende du bas de page (« ADM : Admis … ») : écartée, comme un
    //    pied de page, AVANT de construire l'arbre.
    if (MOTIFS_LEGENDE.some((motif) => motif.test(texte))) {
      rapport.lignesNonLues++;
      continue;
    }

    // 7. On range chaque élément dans sa colonne. Une note en « Session 2 »
    //    n'est pas importée : on le signale (une seule fois).
    const rangee = decouperRangee(ligne, colonnes);
    if (rangee.session2 !== null && !session2Signalee) {
      session2Signalee = true;
      rapport.aVerifier.push({
        page,
        message: 'Le relevé contient des notes de « Session 2 » : seules les notes de la session 1 sont importées.',
      });
    }

    // 8. Sans libellé, on ne sait pas à quoi la ligne correspond. On ne
    //    recopie pas son texte : il pourrait venir d'en dehors du tableau.
    if (rangee.libelle === '') {
      rapport.aVerifier.push({
        page,
        message: 'Une ligne sans libellé a été ignorée (valeur seule, ou texte hors du tableau).',
      });
      continue;
    }
    rangees.push(rangee);
  }

  return colonnes === null ? null : rangees;
}

// Vrai si la ligne contient au moins les titres « Libellé » et « Session 1 ».
function estLigneDeTitres(ligne) {
  const textes = ligne.elements.map((element) => element.texte);
  return (
    textes.some((texte) => MOTIF_TITRE_LIBELLE.test(texte)) &&
    textes.some((texte) => TITRES_VALEURS[0].motif.test(texte))
  );
}

/**
 * Lit la position des colonnes sur une ligne de titres.
 *
 * @returns {{ libelle: number, debutValeurs: number,
 *             valeurs: { nom: string, debut: number, centre: number }[] }}
 */
function lireColonnes(ligne) {
  // 1. Le libellé commence là où commence son titre.
  const titreLibelle = ligne.elements.find((element) => MOTIF_TITRE_LIBELLE.test(element.texte));

  // 2. Chaque colonne de valeurs est repérée par le début et le centre de son titre.
  const valeurs = [];
  for (const { nom, motif } of TITRES_VALEURS) {
    const titre = ligne.elements.find((element) => motif.test(element.texte));
    if (titre) {
      valeurs.push({ nom, debut: titre.x, centre: titre.x + titre.largeur / 2 });
    }
  }

  return {
    libelle: titreLibelle.x,
    // 3. La zone des valeurs commence un peu avant le premier titre de valeur.
    debutValeurs: Math.min(...valeurs.map((valeur) => valeur.debut)) - MARGE_VALEURS,
    valeurs,
  };
}

/**
 * Découpe une ligne en colonnes, d'après la POSITION de chaque élément
 * (jamais d'après l'ordre du texte, où les cases vides disparaissent).
 *
 * @returns {{ page: number, retrait: number, libelle: string,
 *             session1: string|null, session2: string|null, resultat: string|null }}
 */
function decouperRangee(ligne, colonnes) {
  const morceaux = { libelle: [], session1: [], session2: [], resultat: [], rang: [] };

  for (const element of ligne.elements) {
    // 1. Colonne « Code » : identifiant interne, on ne s'en sert pas.
    if (element.x < colonnes.libelle - MARGE_LIBELLE) {
      continue;
    }
    // 2. Entre le titre « Libellé » et la zone des valeurs : le libellé.
    if (element.x < colonnes.debutValeurs) {
      morceaux.libelle.push(element);
      continue;
    }
    // 3. Dans la zone des valeurs : la colonne dont le centre est le plus proche.
    morceaux[colonneLaPlusProche(element, colonnes.valeurs)].push(element);
  }

  // 4. Le retrait est mesuré par rapport au titre « Libellé » de la page :
  //    si une page est un peu décalée, les retraits restent comparables.
  //    (La colonne « Rang » n'est jamais gardée.)
  const debutLibelle = morceaux.libelle[0];
  return {
    page: ligne.page,
    retrait: debutLibelle ? debutLibelle.x - colonnes.libelle : 0,
    libelle: assembler(morceaux.libelle),
    session1: assembler(morceaux.session1) || null,
    session2: assembler(morceaux.session2) || null,
    resultat: assembler(morceaux.resultat) || null,
  };
}

// Nom de la colonne de valeurs dont le centre est le plus proche de l'élément.
function colonneLaPlusProche(element, valeurs) {
  const centre = element.x + element.largeur / 2;
  let meilleure = valeurs[0];
  for (const colonne of valeurs) {
    if (Math.abs(centre - colonne.centre) < Math.abs(centre - meilleure.centre)) {
      meilleure = colonne;
    }
  }
  return meilleure.nom;
}

/**
 * Recolle les morceaux d'une case, de gauche à droite. Deux morceaux qui se
 * touchent sont collés sans espace (un mot coupé en deux) ; sinon, on met
 * une espace entre eux.
 */
function assembler(morceaux) {
  let texte = '';
  let finPrecedent = null;
  for (const morceau of morceaux) {
    const colle = finPrecedent !== null && morceau.x - finPrecedent < ECART_COLLE;
    if (finPrecedent !== null && !colle) {
      texte += ' ';
    }
    texte += morceau.texte;
    finPrecedent = morceau.x + morceau.largeur;
  }
  return texte.trim();
}

/* ==================== Étape 3 : l'arbre ==================== */

/**
 * Range les rangées en arbre, d'après le retrait de leur libellé.
 * Le parent d'une ligne est la ligne précédente dont le retrait est plus
 * petit. On ne compare que les retraits entre eux : aucune valeur fixe.
 *
 * Exemple (retraits entre crochets) :
 *   [0]  SEMESTRE 3          ← racine
 *   [10]   UE3.1             ← enfant de SEMESTRE 3
 *   [20]     Pôle SAE UE 3.1 ← enfant de UE3.1
 *   [10]   UE3.2             ← retrait 10 : on remonte, enfant de SEMESTRE 3
 */
function construireArbre(rangees) {
  const racine = { enfants: [] };
  // La pile contient le « chemin » depuis la racine jusqu'à la ligne en cours.
  const pile = [];

  for (const rangee of rangees) {
    // 1. On retire de la pile les lignes qui ne sont pas plus à gauche que
    //    la nouvelle : ce sont ses sœurs ou les enfants de ses sœurs.
    while (pile.length > 0 && pile.at(-1).retrait >= rangee.retrait - TOLERANCE_RETRAIT) {
      pile.pop();
    }

    // 2. Le haut de la pile est le parent (ou la racine si la pile est vide).
    const noeud = { ...rangee, enfants: [] };
    (pile.at(-1) ?? racine).enfants.push(noeud);

    // 3. La nouvelle ligne devient la ligne en cours.
    pile.push(noeud);
  }
  return racine;
}

/* ==================== Étape 4 : l'interprétation ==================== */

// Trouve le type d'une ligne d'après son libellé.
function reconnaitre(libelle) {
  for (const { type, motif } of TYPES_DE_LIGNES) {
    const trouve = motif.exec(libelle);
    if (trouve) {
      return { type, trouve };
    }
  }
  return { type: 'inconnu', trouve: null };
}

/**
 * Interprète une ligne de l'arbre, puis ses enfants.
 *
 * @param {object} noeud ligne de l'arbre
 * @param {{ semestre?: object, ue?: object, element?: object, matiere?: object }} contexte
 *   ce qui « contient » la ligne : son semestre, son UE, sa ressource…
 */
function interpreter(noeud, contexte, resultat, rapport) {
  const { type, trouve } = reconnaitre(noeud.libelle);
  const aVerifier = (message) => rapport.aVerifier.push({ page: noeud.page, message });
  const { semestre, ue, element } = contexte;
  let contexteEnfants = contexte;

  switch (type) {
    // 1. SENSE : la ligne et tout ce qu'elle contient sont ignorés.
    case 'sense':
      ignorerSousArbre(noeud, 'ligne SENSE', rapport);
      return;

    // Ligne du diplôme (« B2 - Informatique PT DACS (FI) ») : rien à
    // importer, rien à signaler. Les lignes qu'elle contient (si elle est
    // plus à gauche que les autres) sont lues normalement, à l'étape 11.
    case 'diplome':
      break;

    // 2. Compétence de l'année : seule sa moyenne officielle est gardée.
    case 'competence':
      resultat.competences.push({
        code: trouve[1],
        libelle: trouve[2],
        officiel: lireOfficiel(noeud, rapport),
      });
      break;

    // 3. Semestre : tout ce qui suit lui appartient, jusqu'au prochain.
    case 'semestre': {
      const numero = Number(trouve[1]);
      // Semestre déjà vu (titre répété) : on le continue.
      let nouveau = resultat.semestres.find((candidat) => candidat.numero === numero);
      if (!nouveau) {
        nouveau = {
          numero,
          libelle: noeud.libelle,
          officiel: lireOfficiel(noeud, rapport),
          malus: null,
          ues: [],
          elements: [],
        };
        resultat.semestres.push(nouveau);
      }
      contexteEnfants = { semestre: nouveau };
      break;
    }

    // 4. Malus d'absences : une valeur à retrancher à chaque UE du semestre.
    case 'malus':
      if (!semestre) {
        aVerifier(`« ${noeud.libelle} » : malus trouvé hors d’un semestre, il n’est pas importé.`);
        return;
      }
      semestre.malus = lireValeur(noeud.session1, noeud, rapport);
      break;

    // 5. UE : sa moyenne et son résultat officiels.
    case 'ue': {
      if (!semestre) {
        aVerifier(`« ${noeud.libelle} » : UE trouvée hors d’un semestre, elle n’est pas importée.`);
        return;
      }
      const code = `UE${trouve[1]}.${trouve[2]}`;
      if (Number(trouve[1]) !== semestre.numero) {
        aVerifier(`« ${noeud.libelle} » : ${code} n’appartient pas au semestre ${semestre.numero}.`);
      }
      const nouvelle = {
        code,
        libelle: trouve[3],
        officiel: { ...lireOfficiel(noeud, rapport), poleSae: null, poleRessources: null },
      };
      semestre.ues.push(nouvelle);
      contexteEnfants = { semestre, ue: nouvelle };
      break;
    }

    // 6. Pôle : seule sa moyenne officielle est gardée, dans son UE.
    case 'pole': {
      if (!ue) {
        aVerifier(`« ${noeud.libelle} » : pôle trouvé hors d’une UE, sa moyenne n’est pas importée.`);
        break;
      }
      const ueCitee = lireUeCitee(noeud.libelle);
      if (ueCitee !== null && ueCitee !== ue.code) {
        aVerifier(`« ${noeud.libelle} » : ce pôle est rangé sous ${ue.code}.`);
      }
      const cle = trouve[1].toLowerCase() === 'sae' ? 'poleSae' : 'poleRessources';
      ue.officiel[cle] = lireValeur(noeud.session1, noeud, rapport);
      break;
    }

    // 7. Ressource, SAE, portfolio ou stage : un « élément » avec ses évaluations.
    case 'ressource':
    case 'sae':
    case 'portfolio':
    case 'stage': {
      const trouveOuCree = trouverOuCreerElement(noeud, type, trouve, contexte, rapport);
      if (!trouveOuCree) {
        return; // déjà signalé : ses lignes ne sont pas importées
      }
      contexteEnfants = { semestre, ue, element: trouveOuCree };
      break;
    }

    // 8. Matière (« Mati 1 Anglais ») : un niveau entre une ressource et ses évaluations.
    case 'matiere': {
      if (!element) {
        aVerifier(`« ${noeud.libelle} » : matière trouvée hors d’une ressource, elle n’est pas importée.`);
        return;
      }
      const matiere = { libelle: noeud.libelle, officiel: lireOfficiel(noeud, rapport), evaluations: [] };
      element.matieres.push(matiere);
      contexteEnfants = { ...contexte, matiere };
      break;
    }

    // 9. Évaluation : le coefficient est dans le libellé.
    case 'evaluation':
      ajouterEvaluation(noeud, lireCoef(trouve[1]), contexte, rapport);
      return;

    // 10. Ligne non reconnue.
    default:
      if (element && noeud.enfants.length > 0) {
        // Ligne de regroupement dans une ressource ou une SAE (par exemple
        // au S3) : ses évaluations sont rattachées à l'élément.
        rapport.ignore.push({
          page: noeud.page,
          texte: noeud.libelle,
          raison: `ligne de regroupement : ses évaluations sont rattachées à « ${element.code ?? element.libelle} »`,
        });
      } else if (element) {
        // Dernière ligne d'une branche, dans une ressource ou une SAE : c'est
        // une évaluation, mais sans coefficient dans son libellé.
        ajouterEvaluation(noeud, { coef: null, raison: 'aucun coefficient dans le libellé' }, contexte, rapport);
        return;
      } else {
        aVerifier(`« ${noeud.libelle} » : ligne non reconnue, elle n’est pas importée.`);
      }
  }

  // 11. On interprète les lignes contenues dans celle-ci.
  for (const enfant of noeud.enfants) {
    interpreter(enfant, contexteEnfants, resultat, rapport);
  }
}

/**
 * Crée un élément (ressource, SAE, portfolio ou stage) dans son semestre, ou
 * retrouve celui qui a déjà le même code (ligne doublée « FI » du BUT3).
 *
 * @returns {object|null} l'élément où ranger les lignes qui suivent, ou null
 *   s'il ne peut pas être importé
 */
function trouverOuCreerElement(noeud, type, trouve, { semestre, ue }, rapport) {
  // 1. Un élément appartient forcément à un semestre.
  if (!semestre) {
    rapport.aVerifier.push({
      page: noeud.page,
      message: `« ${noeud.libelle} » : trouvé hors d’un semestre, il n’est pas importé.`,
    });
    return null;
  }

  // 2. Code et libellé : « R3.01 Développement web » → R3.01 + Développement web.
  //    Le portfolio et le stage n'ont pas de code dans le relevé.
  const avecCode = type === 'ressource' || type === 'sae';
  const code = avecCode ? trouve[1] : null;
  const libelle = avecCode ? trouve[2] : noeud.libelle;
  const officiel = lireOfficiel(noeud, rapport);

  // 3. Même code déjà lu dans ce semestre : c'est le même élément, écrit
  //    sur deux lignes (au BUT3 : « R5.B.04 … » puis « R5.B.04 … FI »).
  //    On réunit les deux. Le portfolio et le stage, sans code, sont
  //    reconnus par leur type.
  const existant = semestre.elements.find((element) => (element.code ?? element.type) === (code ?? type));
  if (existant) {
    fusionner(existant, libelle, officiel, noeud, rapport);
    return existant;
  }

  // 4. Sinon, c'est un nouvel élément.
  const nouveau = { type, code, libelle, ue: ue?.code ?? null, officiel, evaluations: [], matieres: [] };
  semestre.elements.push(nouveau);
  return nouveau;
}

/**
 * Réunit une deuxième ligne de même code avec l'élément déjà lu. Ses
 * évaluations (les lignes en dessous) iront dans l'élément existant.
 */
function fusionner(existant, libelle, officiel, noeud, rapport) {
  const signaler = (message) => rapport.aVerifier.push({ page: noeud.page, message });

  // 1. « Programmation système FI » et « Programmation système » sont la
  //    même chose. Un libellé vraiment différent est inattendu : on réunit
  //    quand même (même code = même élément), mais on le dit.
  if (sansSuffixeFi(libelle) !== sansSuffixeFi(existant.libelle)) {
    signaler(`« ${noeud.libelle} » a le même code que « ${nomComplet(existant)} » : leurs évaluations sont réunies.`);
  }

  // 2. Moyenne officielle : celle de la ligne qui en a une. Si les deux en
  //    ont une, différente, on garde la première et on le dit.
  if (existant.officiel.moyenne === null) {
    existant.officiel.moyenne = officiel.moyenne;
  } else if (officiel.moyenne !== null && officiel.moyenne !== existant.officiel.moyenne) {
    signaler(
      `« ${existant.code ?? existant.libelle} » apparaît sur deux lignes avec deux moyennes officielles différentes (${enFrancais(existant.officiel.moyenne)} et ${enFrancais(officiel.moyenne)}) : seule la première est gardée.`,
    );
  }

  // 3. Résultat officiel : de même, celui de la ligne qui en a un.
  if (existant.officiel.resultat === null) {
    existant.officiel.resultat = officiel.resultat;
  }
}

// Retire « FI » (ou « (FI) ») à la fin d'un libellé : formation initiale.
function sansSuffixeFi(libelle) {
  return libelle.replace(/\s+(?:FI|\(FI\))$/, '');
}

// Nom d'un élément dans un message : « R3.01 Développement web », ou « Stage ».
function nomComplet(element) {
  return element.code ? `${element.code} ${element.libelle}` : element.libelle;
}

/**
 * Ajoute une évaluation à sa matière ou à son élément.
 *
 * @param {{ coef: number|null, raison?: string }} lu coefficient lu dans le libellé
 */
function ajouterEvaluation(noeud, lu, { semestre, element, matiere }, rapport) {
  // 1. Une évaluation doit être dans une ressource, une SAE, un portfolio ou un stage.
  if (!element) {
    rapport.aVerifier.push({
      page: noeud.page,
      message: `« ${noeud.libelle} » : évaluation trouvée hors d’une ressource ou d’une SAE, elle n’est pas importée.`,
    });
    return;
  }

  // 2. La note : vide = pas encore notée (null). L'évaluation est gardée.
  const evaluation = {
    libelle: noeud.libelle,
    note: lireValeur(noeud.session1, noeud, rapport),
    coef: lu.coef,
    ue: lireUeCitee(noeud.libelle),
  };
  (matiere ?? element).evaluations.push(evaluation);

  // 3. Coefficient inconnu : on ne le devine pas, on le demandera.
  if (lu.coef === null) {
    rapport.coefsInconnus.push({
      page: noeud.page,
      semestre: semestre.numero,
      element: element.code ?? element.libelle,
      libelle: noeud.libelle,
      raison: lu.raison,
    });
  }

  // 4. Une évaluation ne devrait rien contenir.
  if (noeud.enfants.length > 0) {
    rapport.aVerifier.push({
      page: noeud.page,
      message: `« ${noeud.libelle} » : des lignes sont rangées sous cette évaluation, elles ne sont pas importées.`,
    });
  }
}

// Ignore une ligne et toutes celles qu'elle contient.
function ignorerSousArbre(noeud, raison, rapport) {
  rapport.ignore.push({ page: noeud.page, texte: noeud.libelle, raison });
  for (const enfant of noeud.enfants) {
    ignorerSousArbre(enfant, raison, rapport);
  }
}

/* ==================== Étape 5 : la passe finale ==================== */

/**
 * Termine un semestre, une fois TOUT le relevé lu. On attend la fin car un
 * élément peut encore recevoir des évaluations plus bas dans le relevé.
 */
function terminerSemestre(semestre, rapport) {
  for (const element of semestre.elements) {
    reprendreMoyenneOfficielle(element, rapport);
    controlerUeManquantes(element, rapport);
  }
  controlerUeCitees(semestre, rapport);
}

// Toutes les évaluations d'un élément, matières comprises.
function evaluationsDe(element) {
  return [...element.evaluations, ...element.matieres.flatMap((matiere) => matiere.evaluations)];
}

/**
 * Ressource ou partie SAE qui a une moyenne officielle, mais aucune
 * évaluation détaillée (par exemple « R4.03 … 15 », sans rien dessous).
 * Sans évaluation, elle n'aurait pas de note et ne compterait pas : on crée
 * une évaluation « Moyenne du relevé » avec cette moyenne, coef 1 (seule
 * dans sa ressource, son coef ne change pas la moyenne). Et on le dit.
 */
function reprendreMoyenneOfficielle(element, rapport) {
  // 1. Il faut une moyenne officielle, et aucune évaluation (matières comprises).
  const moyenne = element.officiel.moyenne;
  if (moyenne === null || evaluationsDe(element).length > 0) {
    return;
  }

  // 2. L'évaluation créée. La note n'est pas inventée : c'est celle du relevé.
  element.evaluations.push({ libelle: LIBELLE_MOYENNE_RELEVE, note: moyenne, coef: 1, ue: null });

  // 3. On le signale : l'utilisateur sait d'où vient cette évaluation.
  rapport.aVerifier.push({
    message: `« ${element.code ?? element.libelle} » : aucune évaluation détaillée dans le relevé. Sa moyenne officielle (${enFrancais(moyenne)}) devient une évaluation « ${LIBELLE_MOYENNE_RELEVE} », coef 1.`,
  });
}

/**
 * Au S3, les évaluations de SAE citent leur UE (« Sae UE 3.2 : … »). Si
 * certaines évaluations d'un élément citent une UE et d'autres non, on ne
 * sait pas où ranger ces dernières : on le signale.
 */
function controlerUeManquantes(element, rapport) {
  const evaluations = evaluationsDe(element);
  if (!evaluations.some((evaluation) => evaluation.ue !== null)) {
    return; // aucune UE citée : élément « normal »
  }
  for (const evaluation of evaluations.filter((e) => e.ue === null)) {
    rapport.aVerifier.push({
      message: `« ${evaluation.libelle} » : aucune UE dans le libellé, alors que les autres évaluations de « ${element.code ?? element.libelle} » en citent une.`,
    });
  }
}

// Une UE citée doit exister dans le semestre.
function controlerUeCitees(semestre, rapport) {
  const codes = new Set(semestre.ues.map((ue) => ue.code));
  for (const element of semestre.elements) {
    for (const evaluation of evaluationsDe(element)) {
      if (evaluation.ue !== null && !codes.has(evaluation.ue)) {
        rapport.aVerifier.push({
          message: `« ${evaluation.libelle} » : ${evaluation.ue} n’existe pas au semestre ${semestre.numero}.`,
        });
      }
    }
  }
}

/* ==================== Lecture des valeurs ==================== */

/**
 * Lit le coefficient trouvé à la fin d'un libellé.
 * « 2 » → 2, « 1,5 » → 1.5, « ?? » → null (coefficient inconnu).
 */
function lireCoef(texte) {
  if (texte.startsWith('?')) {
    return { coef: null, raison: 'coefficient inconnu (« Coef ?? »)' };
  }
  return { coef: Number(texte.replace(',', '.')) };
}

// UE citée dans un libellé (« Sae UE 3.03 : … » → « UE3.3 »), ou null.
function lireUeCitee(libelle) {
  const trouve = MOTIF_UE_CITEE.exec(libelle);
  return trouve ? `UE${trouve[1]}.${trouve[2]}` : null;
}

// Écrit un nombre à la française : 14.5 → « 14,5 ».
function enFrancais(nombre) {
  return String(nombre).replace('.', ',');
}

// Moyenne et résultat officiels d'une ligne (compétence, UE, ressource…).
function lireOfficiel(noeud, rapport) {
  return { moyenne: lireValeur(noeud.session1, noeud, rapport), resultat: noeud.resultat };
}

/**
 * Lit une note, une moyenne ou un malus (entre 0 et 20).
 * Case vide → null. Valeur incompréhensible → null, et on le signale :
 * on n'invente jamais de valeur.
 */
function lireValeur(texte, noeud, rapport) {
  // 1. Case vide : pas (encore) de valeur.
  if (texte === null) {
    return null;
  }

  // 2. Ce n'est pas un nombre (« ABI », lettre de filigrane collée…).
  if (!MOTIF_NOMBRE.test(texte)) {
    rapport.aVerifier.push({
      page: noeud.page,
      message: `« ${noeud.libelle} » : « ${texte} » n’est pas une note, elle n’est pas importée.`,
    });
    return null;
  }

  // 3. On remplace la virgule par un point pour que JavaScript le comprenne.
  const valeur = Number(texte.replace(',', '.'));

  // 4. Une note est sur 20.
  if (valeur > 20) {
    rapport.aVerifier.push({
      page: noeud.page,
      message: `« ${noeud.libelle} » : « ${texte} » dépasse 20, la valeur n’est pas importée.`,
    });
    return null;
  }
  return valeur;
}
