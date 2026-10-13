// Lecture des PDF avec pdf.js.
//
// C'est le SEUL fichier de l'app qui parle à pdf.js. Il transforme un PDF en
// une simple liste d'éléments texte { texte, x, y, taille, largeur, page }. Les
// analyseurs (import-coefficients.js, import-notes.js) travaillent ensuite sur
// cette liste, ce qui permet de les tester sans PDF.
//
// Rien n'est envoyé ni stocké : le fichier est lu dans la mémoire du
// navigateur, puis pdf.js est arrêté et sa mémoire libérée.

import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

// Le worker est servi par l'app elle-même, à côté de pdf.min.mjs.
// new URL(…, import.meta.url) calcule son adresse à partir de CE fichier,
// et non de la page qui l'importe : le chemin reste juste partout.
export const URL_WORKER = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

// Nom de la politique Trusted Types qui autorise ce worker. La CSP de
// index.html n'autorise QUE ce nom : « trusted-types pdfjs-worker ».
export const NOM_POLITIQUE = 'pdfjs-worker';

// La politique, créée à la première lecture (un nom ne peut servir qu'une fois).
let politiqueWorker = null;

// Limites imposées au fichier, pour éviter de bloquer le navigateur.
const TAILLE_MAX_OCTETS = 5 * 1024 * 1024; // 5 Mo
const PAGES_MAX = 10;
const DELAI_MAX_MS = 15_000; // 15 secondes

// Au-delà de cette taille (en points), un élément est une lettre du
// filigrane « NON CERTIFIÉ » (environ 47 à 65 pt) : on l'écarte.
const TAILLE_MAX_TEXTE = 20;

// La signature qui ouvre tout fichier PDF.
const SIGNATURE_PDF = '%PDF-';

/**
 * Erreur « prévue » : le fichier ne convient pas ou ne peut pas être lu.
 * Son message, en français, peut être affiché tel quel à l'utilisateur
 * (avec textContent).
 */
export class ErreurLecturePdf extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ErreurLecturePdf';
  }
}

/**
 * Position et taille d'un élément texte sur la page AFFICHÉE.
 *
 * pdf.js donne la position d'un texte dans le repère du FICHIER, c'est-à-dire
 * AVANT la rotation de la page. Or le relevé « Détail des notes » est tourné
 * de 90° : sans ce calcul, x et y seraient échangés et aucune ligne ne
 * serait trouvée.
 *
 * Fonction pure : elle ne lit que ses paramètres (pdfjs.Util.transform n'est
 * qu'un calcul). Elle est testée dans tests/lecture-pdf.test.js.
 *
 * @param {number[]} transform matrice de l'élément [a, b, c, d, x, y], dans le repère du fichier
 * @param {{ transform: number[], height: number }} viewport page.getViewport({ scale: 1 })
 * @returns {{ x: number, y: number, taille: number }}
 *   x depuis la gauche et y depuis le BAS de la page affichée, taille en points
 */
export function positionAffichee(transform, viewport) {
  // 1. Une « matrice » [a, b, c, d, e, f] décrit comment tourner, étirer et
  //    déplacer un point. Celle du viewport fait passer du repère du fichier
  //    au repère affiché (rotation comprise). On l'enchaîne avec celle du
  //    texte pour obtenir la matrice du texte sur la page affichée.
  const m = pdfjs.Util.transform(viewport.transform, transform);

  return {
    // 2. Position horizontale, depuis la gauche de la page affichée.
    x: m[4],
    // 3. Le viewport compte y depuis le HAUT (comme un écran). On le
    //    recompte depuis le BAS, comme le reste de l'app (FORMAT-PDF.md).
    y: viewport.height - m[5],
    // 4. Taille = longueur du vecteur (c, d) : la hauteur des lettres, même
    //    pour un texte penché (le filigrane est souvent en diagonale).
    taille: Math.hypot(m[2], m[3]),
  };
}

/**
 * Crée la politique Trusted Types qui autorise le worker de pdf.js.
 *
 * La CSP (require-trusted-types-for 'script') interdit de donner une simple
 * chaîne à new Worker(url) : le navigateur exige une adresse « approuvée »
 * par une politique. Celle-ci n'approuve qu'UNE adresse, celle du worker
 * servi par l'app. Toute autre adresse lève une erreur : même si un PDF
 * piégé trompait pdf.js, il ne pourrait pas lancer un autre script.
 *
 * Elle reçoit trustedTypes en paramètre : on peut donc la tester sans
 * navigateur, avec une imitation (tests/lecture-pdf.test.js).
 *
 * @param {object|undefined} trustedTypes window.trustedTypes (absent sur les anciens navigateurs)
 * @param {string} urlAutorisee la seule adresse acceptée
 * @returns {{ createScriptURL: (url: string) => (TrustedScriptURL|string) }}
 */
export function creerPolitiqueWorker(trustedTypes, urlAutorisee) {
  // 1. La règle : l'adresse exacte du worker, rien d'autre.
  const regles = {
    createScriptURL(url) {
      if (url !== urlAutorisee) {
        throw new TypeError(`Adresse de worker refusée : ${url}`);
      }
      return url;
    },
  };

  // 2. Navigateur sans Trusted Types : il accepte une simple chaîne. On
  //    garde la même vérification, qui renvoie l'adresse telle quelle.
  if (!trustedTypes) {
    return regles;
  }

  // 3. Sinon, on déclare la politique au navigateur. Il n'accepte ce nom
  //    que parce que la CSP l'autorise.
  return trustedTypes.createPolicy(NOM_POLITIQUE, regles);
}

/**
 * Lance le worker de pdf.js, avec une adresse approuvée par la politique.
 *
 * @returns {Worker}
 */
function lancerWorker() {
  // 1. La politique est créée une seule fois : le navigateur refuse de
  //    déclarer deux fois le même nom. (globalThis est « window » dans la
  //    page ; il existe aussi dans Node, où ce fichier est testé.)
  politiqueWorker ??= creerPolitiqueWorker(globalThis.trustedTypes, URL_WORKER);

  // 2. type: 'module' : le worker de pdf.js est un module ES (.mjs).
  return new Worker(politiqueWorker.createScriptURL(URL_WORKER), { type: 'module' });
}

/**
 * Lit toutes les pages d'un PDF et renvoie ses éléments texte.
 *
 * @param {File} fichier fichier choisi par l'utilisateur (<input type="file">)
 * @returns {Promise<{ texte: string, x: number, y: number, taille: number, largeur: number, page: number }[]>}
 * @throws {ErreurLecturePdf} si le fichier ne convient pas ou est illisible
 */
export async function lirePdf(fichier) {
  // 1. Vérifications rapides, avant même de lire le contenu.
  verifierFichier(fichier);

  // 2. On charge le contenu en mémoire et on vérifie qu'il ressemble à un PDF.
  const donnees = new Uint8Array(await fichier.arrayBuffer());
  verifierSignature(donnees);

  // N'affiche dans la console que les vraies erreurs.
  const verbosity = pdfjs.VerbosityLevel.ERRORS;
  let worker = null; // le worker du navigateur (un fil d'exécution à part)
  let pdfWorker = null; // l'objet de pdf.js qui lui parle
  let tache = null; // la tâche de chargement du document

  try {
    // 3. On lance NOUS-MÊMES le worker, avec une adresse approuvée (voir
    //    lancerWorker). Si on laissait pdf.js le faire, il passerait une
    //    simple chaîne à new Worker : la CSP la bloquerait, et pdf.js se
    //    rabattrait sur un « faux worker » qui tourne dans la page.
    worker = lancerWorker();

    // 4. On confie ce worker à pdf.js. « port » : le canal par lequel
    //    pdf.js lui envoie ses messages. Un nouveau worker par lecture :
    //    rien ne reste d'un PDF à l'autre.
    pdfWorker = new pdfjs.PDFWorker({ port: worker, verbosity });

    // 5. On ouvre le document avec pdf.js, dans ce worker.
    tache = pdfjs.getDocument({
      data: donnees,
      worker: pdfWorker,
      // Interdit à pdf.js de générer et d'exécuter du code (eval) :
      // un PDF piégé ne peut pas s'en servir.
      isEvalSupported: false,
      // On ne fait que lire le texte : inutile de charger des polices.
      disableFontFace: true,
      verbosity,
    });

    // 6. On lit toutes les pages, avec une durée maximale.
    return await avecDelai(
      extraireElements(tache),
      DELAI_MAX_MS,
      `La lecture du PDF a pris trop de temps (plus de ${DELAI_MAX_MS / 1000} secondes). Le fichier est peut-être endommagé.`,
    );
  } catch (erreur) {
    throw traduireErreur(erreur);
  } finally {
    // 7. Dans tous les cas (réussite, erreur ou délai dépassé), on arrête
    //    tout, dans l'ordre : le document, puis l'objet de pdf.js, puis le
    //    worker lui-même. pdf.js n'arrête pas un worker qu'on lui a confié :
    //    c'est à nous de le faire. Le contenu du PDF quitte alors la mémoire.
    //    (Le try / finally intérieur arrête le worker même si l'arrêt du
    //    document échoue.)
    try {
      await tache?.destroy();
    } finally {
      pdfWorker?.destroy();
      worker?.terminate();
    }
  }
}

/**
 * Vérifie le type et la taille du fichier, sans lire son contenu.
 *
 * @param {File} fichier
 */
function verifierFichier(fichier) {
  // Les messages ne citent jamais le nom du fichier : venu de l'ENT, il peut
  // contenir ton nom ou ton numéro de dossier.
  if (!fichier) {
    throw new ErreurLecturePdf('Aucun fichier n’a été choisi.');
  }
  // Le type est déduit de l'extension par le navigateur : c'est un premier
  // filtre, que la signature (étape suivante) vient confirmer.
  if (fichier.type !== 'application/pdf') {
    throw new ErreurLecturePdf('Ce fichier n’est pas un PDF.');
  }
  if (fichier.size === 0) {
    throw new ErreurLecturePdf('Ce fichier est vide.');
  }
  if (fichier.size > TAILLE_MAX_OCTETS) {
    const tailleMo = (fichier.size / (1024 * 1024)).toFixed(1).replace('.', ',');
    throw new ErreurLecturePdf(
      `Ce fichier est trop lourd (${tailleMo} Mo). La limite est de 5 Mo.`,
    );
  }
}

/**
 * Vérifie que le contenu commence par la signature « %PDF- ».
 * La norme PDF la tolère n'importe où dans le premier kilo-octet.
 *
 * @param {Uint8Array} donnees
 */
function verifierSignature(donnees) {
  // On décode le premier kilo-octet comme du texte simple (1 octet = 1 lettre).
  const debut = new TextDecoder('latin1').decode(donnees.subarray(0, 1024));
  if (!debut.includes(SIGNATURE_PDF)) {
    throw new ErreurLecturePdf('Ce fichier porte l’extension .pdf mais n’est pas un vrai PDF.');
  }
}

/**
 * Ouvre le document et transforme le texte de chaque page en éléments.
 *
 * @param {object} tache tâche de chargement renvoyée par pdfjs.getDocument
 */
async function extraireElements(tache) {
  const documentPdf = await tache.promise;

  // 1. On refuse les documents trop longs, avant de lire la moindre page.
  if (documentPdf.numPages > PAGES_MAX) {
    throw new ErreurLecturePdf(
      `Ce PDF a ${documentPdf.numPages} pages. La limite est de ${PAGES_MAX} pages.`,
    );
  }

  const elements = [];

  // 2. On lit les pages une par une (pdf.js les numérote à partir de 1).
  for (let numero = 1; numero <= documentPdf.numPages; numero++) {
    const page = await documentPdf.getPage(numero);
    const contenu = await page.getTextContent();

    // 3. Le repère de la page AFFICHÉE, rotation comprise. À l'échelle 1,
    //    une unité vaut un point, comme dans le fichier.
    const viewport = page.getViewport({ scale: 1 });

    // 4. Les éléments texte de la page (voir elementsDeLaPage).
    elements.push(...elementsDeLaPage(contenu.items, viewport, numero));

    // 5. On libère la mémoire de la page lue.
    page.cleanup();
  }

  return elements;
}

/**
 * Transforme le texte brut d'une page (renvoyé par pdf.js) en éléments
 * { texte, x, y, taille, largeur, page }.
 *
 * Fonction pure : scripts/generer-referentiel.mjs l'utilise aussi, dans
 * Node, pour lire les tableaux des coefficients exactement comme l'app.
 *
 * @param {{ str?: string, transform: number[], width: number }[]} items page.getTextContent().items
 * @param {{ transform: number[], height: number }} viewport page.getViewport({ scale: 1 })
 * @param {number} numero numéro de la page (à partir de 1)
 */
export function elementsDeLaPage(items, viewport, numero) {
  const elements = [];
  for (const element of items) {
    // 1. On ne garde que les vrais morceaux de texte, non vides.
    //    (pdf.js peut aussi renvoyer des marqueurs sans texte.)
    if (typeof element.str !== 'string' || element.str.trim() === '') {
      continue;
    }

    // 2. Position et taille sur la page affichée (voir positionAffichee).
    const { x, y, taille } = positionAffichee(element.transform, viewport);

    // 3. On écarte le filigrane AVANT tout le reste.
    if (taille > TAILLE_MAX_TEXTE) {
      continue;
    }

    // 4. largeur = longueur du texte, en points, mesurée le long de la
    //    ligne : la rotation de la page ne la change pas. Elle sert à
    //    calculer le centre d'un élément (x + largeur / 2), pour le ranger
    //    dans la bonne colonne d'un tableau.
    elements.push({
      texte: element.str.trim(),
      x,
      y,
      taille,
      largeur: element.width,
      page: numero,
    });
  }
  return elements;
}

/**
 * Rejette la promesse si elle n'a pas abouti dans le délai donné.
 *
 * @param {Promise} promesse
 * @param {number} delaiMs
 * @param {string} message message de l'erreur en cas de dépassement
 */
async function avecDelai(promesse, delaiMs, message) {
  let minuteur;
  const delaiDepasse = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new ErreurLecturePdf(message)), delaiMs);
  });
  try {
    // Promise.race : le premier des deux qui termine l'emporte.
    return await Promise.race([promesse, delaiDepasse]);
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Transforme une erreur de pdf.js en ErreurLecturePdf au message clair.
 * L'erreur d'origine est gardée dans « cause », pour le débogage.
 *
 * @param {Error} erreur
 * @returns {ErreurLecturePdf}
 */
function traduireErreur(erreur) {
  if (erreur instanceof ErreurLecturePdf) {
    return erreur;
  }
  if (erreur?.name === 'PasswordException') {
    return new ErreurLecturePdf(
      'Ce PDF est protégé par un mot de passe. Télécharge une version sans mot de passe.',
      { cause: erreur },
    );
  }
  if (erreur?.name === 'InvalidPDFException') {
    return new ErreurLecturePdf('Ce PDF est endommagé ou invalide.', { cause: erreur });
  }
  return new ErreurLecturePdf('Impossible de lire ce PDF.', { cause: erreur });
}
