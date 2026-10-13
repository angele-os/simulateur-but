// Tests de js/import-notes.js.
// Toutes les données (fixture et cas construits ici) sont INVENTÉES,
// y compris la personne « EXEMPLE Camille » de l'en-tête.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { importerNotes } from '../js/import-notes.js';

// Charge une fixture de tests/fixtures/.
function chargerFixture(nom) {
  return JSON.parse(readFileSync(new URL(`fixtures/${nom}`, import.meta.url), 'utf8'));
}

// Retrouve un élément (ressource, SAE…) d'un semestre par son code.
function trouver(semestre, code) {
  const element = semestre.elements.find((candidat) => candidat.code === code);
  if (!element) {
    throw new Error(`${code} absent du semestre ${semestre.numero}`);
  }
  return element;
}

// ---------- Fixture : relevé inventé sur deux pages (S3 et S4) ----------

describe('relevé inventé sur deux pages (S3 et S4)', () => {
  const elements = chargerFixture('releve-but2.json');
  const resultat = importerNotes(elements);
  const [s3, s4] = resultat.semestres;

  test('la fixture a bien deux pages et des lettres de filigrane sur chacune', () => {
    assert.deepEqual([...new Set(elements.map((e) => e.page))], [1, 2]);
    for (const page of [1, 2]) {
      assert.ok(elements.some((e) => e.page === page && e.taille > 20));
    }
  });

  test('aucune erreur et rien à vérifier', () => {
    assert.deepEqual(resultat.rapport.erreurs, []);
    assert.deepEqual(resultat.rapport.aVerifier, []);
  });

  test('compétences de l’année : moyennes et résultats officiels conservés', () => {
    assert.deepEqual(resultat.competences, [
      {
        code: 'C1',
        libelle: 'Réaliser un développement d’application – Niveau 2',
        officiel: { moyenne: 12.5, resultat: 'V' },
      },
      { code: 'C2', libelle: 'Optimiser des applications – Niveau 2', officiel: { moyenne: 11.25, resultat: 'V' } },
      {
        code: 'C3',
        libelle: 'Administrer des systèmes communicants – Niveau 2',
        officiel: { moyenne: 9.5, resultat: 'V/COR' },
      },
    ]);
  });

  test('deux semestres, avec les UE trouvées (jamais 6 supposées)', () => {
    assert.deepEqual(
      resultat.semestres.map((s) => [s.numero, s.ues.map((ue) => ue.code)]),
      [
        [3, ['UE3.1', 'UE3.2', 'UE3.3']],
        [4, ['UE4.1', 'UE4.3']],
      ],
    );
  });

  test('moyennes officielles des UE et des pôles conservées pour comparaison', () => {
    assert.deepEqual(s3.ues[0], {
      code: 'UE3.1',
      libelle: 'Réaliser (intitulé inventé)',
      officiel: { moyenne: 12.345, resultat: 'ADM', poleSae: 13, poleRessources: 11.9 },
    });
    assert.deepEqual(trouver(s3, 'R3.01').officiel, { moyenne: 11.4, resultat: null });
    // S4 en cours : pas encore de moyenne officielle.
    assert.deepEqual(s4.ues[0].officiel, { moyenne: null, resultat: null, poleSae: null, poleRessources: null });
  });

  test('hiérarchie par retrait : chaque élément est sous l’UE où il apparaît, même après le saut de page', () => {
    // UE3.3 et ses ressources sont en page 2, la page 2 est décalée de 2,5 pt.
    assert.deepEqual(
      s3.elements.map((e) => [e.type, e.code, e.ue]),
      [
        ['sae', 'SAE 3.01', 'UE3.1'],
        ['ressource', 'R3.01', 'UE3.1'],
        ['ressource', 'R3.02', 'UE3.1'],
        ['ressource', 'R3.05', 'UE3.2'],
        ['ressource', 'R3.06', 'UE3.3'],
        ['ressource', 'R3.07', 'UE3.3'],
        ['ressource', 'R3.12', 'UE3.3'],
      ],
    );
  });

  test('coefficient lu dans le libellé : « coef », « Coef », « COEF », avec virgule', () => {
    assert.deepEqual(trouver(s3, 'R3.01').evaluations, [
      { libelle: 'Contrôle écrit - coef 2', note: 13.5, coef: 2, ue: null },
      { libelle: 'TP - coef 3', note: 10, coef: 3, ue: null },
    ]);
    assert.equal(trouver(s4, 'R4.01').evaluations[0].coef, 1); // « COEF 1 »
    assert.equal(trouver(s4, 'R4.B.10').evaluations[0].coef, 1.5); // « coef 1,5 »
  });

  test('note vide : l’évaluation est gardée, non notée (note null)', () => {
    assert.deepEqual(trouver(s3, 'R3.02').evaluations, [
      { libelle: 'Partiel - coef 3', note: null, coef: 3, ue: null },
    ]);
  });

  test('« Coef ?? » : coef null, et signalé pour être demandé à l’utilisateur', () => {
    assert.equal(trouver(s3, 'SAE 3.01').evaluations[3].coef, null);
    assert.deepEqual(resultat.rapport.coefsInconnus, [
      {
        page: 1,
        semestre: 3,
        element: 'SAE 3.01',
        libelle: 'Sae UE 3.1 : Soutenance - Coef ??',
        raison: 'coefficient inconnu (« Coef ?? »)',
      },
      {
        page: 2,
        semestre: 4,
        element: 'Stage',
        libelle: 'Évaluation entreprise - Coef ??',
        raison: 'coefficient inconnu (« Coef ?? »)',
      },
    ]);
  });

  test('malus : 0,05 au S3, case vide au S4', () => {
    assert.equal(s3.malus, 0.05);
    assert.equal(s4.malus, null);
  });

  test('niveau « matière » : Mati 1 Anglais, entre Langues et ses évaluations', () => {
    const langues = trouver(s3, 'R3.12');
    assert.deepEqual(langues.evaluations, []);
    assert.deepEqual(langues.matieres, [
      {
        libelle: 'Mati 1 Anglais',
        officiel: { moyenne: 12, resultat: null },
        evaluations: [
          { libelle: 'Oral - coef 1', note: 13, coef: 1, ue: null },
          { libelle: 'Écrit - coef 1', note: 11, coef: 1, ue: null },
        ],
      },
    ]);
  });

  test('SAE du S3 : chaque évaluation est rangée dans l’UE de son libellé (« UE 3.03 » = UE3.3)', () => {
    assert.deepEqual(
      trouver(s3, 'SAE 3.01').evaluations.map((e) => [e.ue, e.note, e.coef]),
      [
        ['UE3.1', 14, 2],
        ['UE3.2', 11.5, 2],
        ['UE3.3', null, 1],
        ['UE3.1', 12, null],
      ],
    );
  });

  test('S3 : la ligne de regroupement de la SAE est signalée dans les lignes ignorées', () => {
    assert.deepEqual(resultat.rapport.ignore[0], {
      page: 1,
      texte: 'Travaux SAE 3.01',
      raison: 'ligne de regroupement : ses évaluations sont rattachées à « SAE 3.01 »',
    });
  });

  test('S4 : le pôle SAE est formé de la SAE, du portfolio et du stage', () => {
    const parties = s4.elements.filter((e) => e.type !== 'ressource');
    assert.deepEqual(parties, [
      {
        type: 'sae',
        code: 'SAE 4.01',
        libelle: 'Projet inventé',
        ue: 'UE4.1',
        officiel: { moyenne: null, resultat: null },
        evaluations: [
          { libelle: 'Rapport - coef 2', note: 14.5, coef: 2, ue: null },
          { libelle: 'Soutenance - Coef 1', note: null, coef: 1, ue: null },
        ],
        matieres: [],
      },
      {
        type: 'portfolio',
        code: null,
        libelle: 'Portfolio',
        ue: 'UE4.1',
        officiel: { moyenne: null, resultat: null },
        // « Dossier » sans « : » : un vrai libellé, pas une ligne personnelle.
        evaluations: [{ libelle: 'Dossier de compétences - coef 1', note: 12, coef: 1, ue: null }],
        matieres: [],
      },
      {
        type: 'stage',
        code: null,
        libelle: 'Stage',
        ue: 'UE4.1',
        officiel: { moyenne: null, resultat: null },
        evaluations: [
          { libelle: 'Évaluation entreprise - Coef ??', note: null, coef: null, ue: null },
          { libelle: 'Mémoire - coef 2', note: null, coef: 2, ue: null },
        ],
        matieres: [],
      },
    ]);
  });

  test('lignes SENSE ignorées, avec tout ce qu’elles contiennent', () => {
    assert.deepEqual(resultat.rapport.ignore.slice(1), [
      { page: 2, texte: 'Certificat SENSE', raison: 'ligne SENSE' },
      { page: 2, texte: 'Se saisir des Enjeux Environnementaux (inventé) - coef 1', raison: 'ligne SENSE' },
    ]);
    assert.ok(!JSON.stringify(resultat.semestres).includes('SENSE'));
  });

  test('colonne « Rang » jamais gardée, et une case « Résultat » vide ne décale rien', () => {
    // R3.01 : résultat vide, rang « 8/30 ». Lu dans l'ordre du texte,
    // « 8/30 » serait pris pour le résultat.
    assert.equal(trouver(s3, 'R3.01').officiel.resultat, null);
    assert.ok(!JSON.stringify(resultat).includes('/30'));
  });

  test('filigrane : même résultat avec ou sans ses lettres', () => {
    const sansFiligrane = elements.filter((e) => e.taille <= 20);
    assert.deepEqual(importerNotes(elements), importerNotes(sansFiligrane));
  });

  test('filigrane : ni « F17.833 », ni « missioOns », ni note disparue', () => {
    // Une lettre « F » touche la note 17.833.
    assert.equal(trouver(s3, 'R3.05').evaluations[0].note, 17.833);
    // Une lettre « O » est posée au milieu de « missions ».
    assert.equal(trouver(s3, 'R3.06').evaluations[0].libelle, 'Étude de missions - coef 1');
    // Une lettre « N » juste au-dessus de « Oral » couperait sa ligne en deux.
    assert.equal(trouver(s3, 'R3.12').matieres[0].evaluations[0].note, 13);
  });

  test('champs collés : le texte brut colle la note au code suivant, les positions non', () => {
    // Le piège existe bien dans la fixture…
    const texteBrut = elements.map((e) => e.texte).join('');
    assert.ok(texteBrut.includes('TP - coef 3109INV3R02'));
    // … mais l'analyseur lit coef 3 et note 10.
    assert.deepEqual(trouver(s3, 'R3.01').evaluations[1], { libelle: 'TP - coef 3', note: 10, coef: 3, ue: null });
  });

  test('libellé coupé en deux morceaux qui se touchent : recollé sans espace', () => {
    assert.equal(trouver(s3, 'R3.07').libelle, 'Systèmes d’exploitation (inventée)');
  });
});

// ---------- Données personnelles ----------

describe('données personnelles (non négociable)', () => {
  const elements = chargerFixture('releve-but2.json');
  const resultat = importerNotes(elements);

  // Ce qui figure dans l'en-tête et les pieds de page de la fixture.
  const DONNEES_PERSONNELLES = [
    'EXEMPLE',
    'Camille',
    '99999999', // n° de dossier
    '000000000ZZ', // NNE
    'camille.exemple',
    'exemple.invalid',
    '@',
    '13/10/2026', // date d'édition
    'Dossier :',
    'NNE',
    'Courriel',
    'Date d’édition',
  ];

  test('la fixture contient bien ces données (sinon le test suivant ne prouverait rien)', () => {
    const fixture = JSON.stringify(elements);
    for (const donnee of DONNEES_PERSONNELLES) {
      assert.ok(fixture.includes(donnee), `« ${donnee} » manque dans la fixture`);
    }
  });

  test('aucun nom, dossier, NNE, e-mail ni date d’édition ne sort du parseur', () => {
    const sortie = JSON.stringify(resultat);
    for (const donnee of DONNEES_PERSONNELLES) {
      assert.ok(!sortie.includes(donnee), `« ${donnee} » est sorti du parseur`);
    }
  });

  test('les lignes d’en-tête et de pied de page sont comptées, jamais recopiées', () => {
    // Page 1 : 4 lignes d'en-tête + « Page 1/2 ». Page 2 : 1 ligne d'en-tête
    // + un pied de page qui contient le nom.
    assert.equal(resultat.rapport.lignesNonLues, 7);
  });
});

// ---------- Fixture : relevé inventé de BUT3 DACS (pièges vus sur un vrai relevé) ----------

describe('relevé inventé de BUT3 DACS (pièges vus sur un vrai relevé)', () => {
  const resultat = importerNotes(chargerFixture('releve-but3.json'));
  const [s5] = resultat.semestres;

  test('ressource sans évaluation détaillée : sa moyenne officielle devient une évaluation « Moyenne du relevé »', () => {
    assert.deepEqual(trouver(s5, 'R5.B.06').evaluations, [
      { libelle: 'Moyenne du relevé', note: 15, coef: 1, ue: null },
    ]);
    assert.ok(
      messages(resultat).includes(
        '« R5.B.06 » : aucune évaluation détaillée dans le relevé. Sa moyenne officielle (15) devient une évaluation « Moyenne du relevé », coef 1.',
      ),
    );
  });

  test('lignes doublées « FI » : un seul élément, avec les évaluations des deux lignes', () => {
    // « R5.B.04 … » porte la moyenne officielle, « R5.B.04 … FI » les évaluations.
    const lignes = s5.elements.filter((e) => e.code === 'R5.B.04');
    assert.deepEqual(lignes, [
      {
        type: 'ressource',
        code: 'R5.B.04',
        libelle: 'Programmation système (inventée)',
        ue: 'UE5.1',
        officiel: { moyenne: 12.5, resultat: null },
        evaluations: [
          { libelle: 'TP - coef 1', note: 12.5, coef: 1, ue: null },
          { libelle: 'Examen - coef 2', note: null, coef: 2, ue: null },
        ],
        matieres: [],
      },
    ]);
    assert.ok(!messages(resultat).some((message) => message.includes('R5.B.04')));
  });

  test('colonne « Session 2 » présente mais vide : aucun message', () => {
    assert.ok(!messages(resultat).some((message) => message.includes('Session 2')));
  });

  test('ligne du diplôme (« B2 - Informatique PT DACS (FI) ») : ignorée sans message, et tout ce qu’elle contient est lu', () => {
    assert.ok(!messages(resultat).some((message) => message.includes('B2 - Informatique')));
    // Elle est plus à gauche que tout le reste : C1 et le S5 sont « dessous ».
    assert.deepEqual(
      resultat.competences.map((c) => c.code),
      ['C1'],
    );
    assert.deepEqual(
      resultat.semestres.map((s) => s.numero),
      [5],
    );
  });

  test('légende « ADM : Admis » du bas de page : pas une ligne SENSE, et jamais recopiée', () => {
    assert.deepEqual(resultat.rapport.ignore, [
      { page: 1, texte: 'Certificat SENSE', raison: 'ligne SENSE' },
      { page: 1, texte: 'Se saisir des Enjeux Environnementaux (inventé) - coef 1', raison: 'ligne SENSE' },
    ]);
    assert.ok(!JSON.stringify(resultat).includes('Admis'));
  });

  test('il ne reste qu’un seul message, utile : la moyenne reprise de R5.B.06', () => {
    assert.deepEqual(messages(resultat), [
      '« R5.B.06 » : aucune évaluation détaillée dans le relevé. Sa moyenne officielle (15) devient une évaluation « Moyenne du relevé », coef 1.',
    ]);
  });
});

// ---------- Cas particuliers : relevés construits dans le test ----------

// Un élément texte qui commence en x (largeur ≈ une demi-taille par caractère).
function element(texte, x, y, page = 1) {
  return { texte, x, y, taille: 9, largeur: texte.length * 4.5, page };
}

// Colonnes de valeurs des relevés construits ici. Elles sont volontairement
// ailleurs que dans la fixture : l'analyseur lit leurs positions sur les titres.
const COLONNES = [
  { cle: 'note', titre: 'Session 1', x: 360 },
  { cle: 'session2', titre: 'Session 2', x: 410 },
  { cle: 'resultat', titre: 'Résultat', x: 470 },
  { cle: 'rang', titre: 'Rang', x: 530 },
];

function titres(y, { session2 = false } = {}) {
  return [
    element('Code', 30, y),
    element('Libellé', 90, y),
    ...COLONNES.filter((c) => session2 || c.cle !== 'session2').map((c) => element(c.titre, c.x, y)),
  ];
}

// Une rangée : niveau 1 à 6 (12 points de retrait par niveau), puis ses
// valeurs, centrées sous le titre de leur colonne.
function rangee(y, niveau, libelle, valeurs = {}) {
  const elements = [element('9INVTEST', 30, y), element(libelle, 90 + (niveau - 1) * 12, y)];
  for (const { cle, titre, x } of COLONNES) {
    if (valeurs[cle] !== undefined) {
      const texte = String(valeurs[cle]);
      const centre = x + (titre.length * 4.5) / 2;
      elements.push(element(texte, centre - (texte.length * 4.5) / 2, y));
    }
  }
  return elements;
}

// Un relevé : la ligne de titres, puis les rangées [niveau, libellé, valeurs].
function releve(lignes, options) {
  const elements = titres(800, options);
  lignes.forEach(([niveau, libelle, valeurs], i) => {
    elements.push(...rangee(780 - i * 14, niveau, libelle, valeurs));
  });
  return elements;
}

// Le début commun : un semestre, une UE, son pôle Ressources, une ressource.
const DEBUT_S3 = [
  [1, 'SEMESTRE 3 BUT Informatique'],
  [2, 'UE3.1 Réaliser (inventé)'],
  [3, 'Pôle Ressource UE 3.1'],
  [4, 'R3.01 Ressource inventée'],
];

// Le début d'une SAE du S3, sous l'UE3.1.
const DEBUT_SAE_S3 = [
  [1, 'SEMESTRE 3 BUT Informatique'],
  [2, 'UE3.1 Réaliser (inventé)'],
  [3, 'Pôle SAE UE 3.1'],
  [4, 'SAE 3.01 SAE inventée'],
];

const messages = (resultat) => resultat.rapport.aVerifier.map((entree) => entree.message);

describe('cas particuliers (relevés construits dans le test)', () => {
  test('aucune ligne de titres : erreur claire, rien n’est importé', () => {
    for (const elements of [[], [element('Un document inventé', 40, 800)]]) {
      const resultat = importerNotes(elements);
      assert.deepEqual(resultat.semestres, []);
      assert.deepEqual(resultat.competences, []);
      assert.equal(resultat.rapport.erreurs.length, 1);
      assert.match(resultat.rapport.erreurs[0].message, /ne semble pas être un relevé « Détail des notes »/);
    }
  });

  test('des titres mais aucun semestre : erreur claire', () => {
    const resultat = importerNotes(releve([[1, 'C1 Compétence inventée', { note: 12 }]]));
    assert.deepEqual(resultat.rapport.erreurs, [
      { message: 'Aucune ligne « SEMESTRE … » n’a été trouvée dans le relevé.' },
    ]);
  });

  test('relevé de début d’année : toute la structure, sans aucune note', () => {
    const resultat = importerNotes(
      releve([...DEBUT_S3, [5, 'Contrôle - coef 2'], [5, 'TP - coef 1'], [2, 'Malus absences (inventé)']]),
    );
    assert.deepEqual(resultat.rapport.aVerifier, []);
    assert.deepEqual(resultat.semestres[0].elements[0].evaluations, [
      { libelle: 'Contrôle - coef 2', note: null, coef: 2, ue: null },
      { libelle: 'TP - coef 1', note: null, coef: 1, ue: null },
    ]);
    assert.equal(resultat.semestres[0].malus, null);
  });

  test('note en « Session 2 » : signalée, et pas importée', () => {
    const resultat = importerNotes(
      releve([...DEBUT_S3, [5, 'Examen - coef 1', { note: 8, session2: 12, resultat: 'ADM' }]], { session2: true }),
    );
    assert.deepEqual(resultat.semestres[0].elements[0].evaluations, [
      { libelle: 'Examen - coef 1', note: 8, coef: 1, ue: null },
    ]);
    assert.deepEqual(messages(resultat), [
      'Le relevé contient des notes de « Session 2 » : seules les notes de la session 1 sont importées.',
    ]);
  });

  test('colonne « Session 2 » sans aucune note : pas de message', () => {
    const resultat = importerNotes(releve([...DEBUT_S3, [5, 'Examen - coef 1', { note: 8 }]], { session2: true }));
    assert.deepEqual(resultat.rapport.aVerifier, []);
  });

  test('légende en bas d’une page, au milieu d’une ressource : elle ne devient pas une évaluation', () => {
    const elements = releve([
      ...DEBUT_S3, // rangées en y = 780, 766, 752, 738
      [5, 'Contrôle - coef 1', { note: 10 }], // y = 724
      [5, 'TP - coef 1', { note: 12 }], // y = 710
    ]);
    // La légende n'a pas de code. Elle commence au même retrait que les
    // évaluations (90 + 4 × 12 = 138) : rangée par son retrait, elle
    // deviendrait une évaluation de R3.01, sans coefficient.
    elements.push(element('ADM : Admis', 138, 717), element('AJ : Ajourné', 210, 717));
    const resultat = importerNotes(elements);
    assert.deepEqual(
      resultat.semestres[0].elements[0].evaluations.map((e) => e.libelle),
      ['Contrôle - coef 1', 'TP - coef 1'],
    );
    assert.deepEqual(resultat.rapport.coefsInconnus, []);
    assert.deepEqual(resultat.rapport.aVerifier, []);
  });

  test('variante « UE 3.6 DACS : … » : l’évaluation va dans UE3.6', () => {
    const resultat = importerNotes(
      releve([
        ...DEBUT_SAE_S3,
        [5, 'Sae UE 3.1 : Rapport - Coef 1', { note: 12 }],
        [5, 'Sae UE 3.6 DACS : Réunion - Coef 1', { note: 15 }],
        [2, 'UE3.6 Collaborer (inventé)'],
      ]),
    );
    assert.deepEqual(resultat.rapport.aVerifier, []);
    assert.deepEqual(
      resultat.semestres[0].elements[0].evaluations.map((e) => e.ue),
      ['UE3.1', 'UE3.6'],
    );
  });

  test('UE citée qui n’existe pas dans le semestre : signalée', () => {
    const resultat = importerNotes(releve([...DEBUT_SAE_S3, [5, 'Sae UE 3.6 DACS : Réunion - Coef 1', { note: 15 }]]));
    assert.deepEqual(messages(resultat), ['« Sae UE 3.6 DACS : Réunion - Coef 1 » : UE3.6 n’existe pas au semestre 3.']);
  });

  test('évaluation de SAE sans UE, alors que les autres en citent une : signalée', () => {
    const resultat = importerNotes(
      releve([...DEBUT_SAE_S3, [5, 'Sae UE 3.1 : Rapport - Coef 1', { note: 12 }], [5, 'Oral - Coef 1', { note: 10 }]]),
    );
    assert.deepEqual(messages(resultat), [
      '« Oral - Coef 1 » : aucune UE dans le libellé, alors que les autres évaluations de « SAE 3.01 » en citent une.',
    ]);
  });

  test('note illisible ou supérieure à 20 : non importée et signalée', () => {
    const resultat = importerNotes(
      releve([...DEBUT_S3, [5, 'Examen - coef 1', { note: 'ABI' }], [5, 'TP - coef 1', { note: '25' }]]),
    );
    assert.deepEqual(
      resultat.semestres[0].elements[0].evaluations.map((e) => e.note),
      [null, null],
    );
    assert.deepEqual(messages(resultat), [
      '« Examen - coef 1 » : « ABI » n’est pas une note, elle n’est pas importée.',
      '« TP - coef 1 » : « 25 » dépasse 20, la valeur n’est pas importée.',
    ]);
  });

  test('évaluation sans coefficient dans le libellé : coef null, et signalée', () => {
    const resultat = importerNotes(releve([...DEBUT_S3, [5, 'Projet final (inventé)', { note: 14 }]]));
    assert.deepEqual(resultat.semestres[0].elements[0].evaluations, [
      { libelle: 'Projet final (inventé)', note: 14, coef: null, ue: null },
    ]);
    assert.equal(resultat.rapport.coefsInconnus[0].raison, 'aucun coefficient dans le libellé');
  });

  test('partie SAE (stage) sans évaluation détaillée : sa moyenne officielle devient une évaluation', () => {
    const resultat = importerNotes(
      releve([
        [1, 'SEMESTRE 6 BUT Informatique'],
        [2, 'UE6.1 Réaliser (inventé)'],
        [3, 'Pôle SAE UE 6.1'],
        [4, 'Stage', { note: '14.5' }],
      ]),
    );
    assert.deepEqual(resultat.semestres[0].elements[0].evaluations, [
      { libelle: 'Moyenne du relevé', note: 14.5, coef: 1, ue: null },
    ]);
    assert.deepEqual(messages(resultat), [
      '« Stage » : aucune évaluation détaillée dans le relevé. Sa moyenne officielle (14,5) devient une évaluation « Moyenne du relevé », coef 1.',
    ]);
  });

  test('sans moyenne officielle, ou avec des évaluations dans une matière : rien n’est ajouté', () => {
    const resultat = importerNotes(
      releve([
        ...DEBUT_S3, // R3.01 : ni moyenne officielle, ni évaluation
        [4, 'R3.12 Langues (inventée)', { note: 12 }],
        [5, 'Mati 1 Anglais', { note: 12 }],
        [6, 'Oral - coef 1', { note: 12 }],
      ]),
    );
    const [r301, r312] = resultat.semestres[0].elements;
    assert.deepEqual(r301.evaluations, []);
    assert.deepEqual(r312.evaluations, []);
    assert.equal(r312.matieres[0].evaluations.length, 1);
    assert.deepEqual(resultat.rapport.aVerifier, []);
  });

  test('évaluation hors d’une ressource ou d’une SAE : non importée, et signalée', () => {
    const resultat = importerNotes(
      releve([
        [1, 'SEMESTRE 3 BUT Informatique'],
        [2, 'UE3.1 Réaliser (inventé)'],
        [3, 'Examen - coef 1', { note: 12 }],
      ]),
    );
    assert.deepEqual(resultat.semestres[0].elements, []);
    assert.deepEqual(messages(resultat), [
      '« Examen - coef 1 » : évaluation trouvée hors d’une ressource ou d’une SAE, elle n’est pas importée.',
    ]);
  });

  test('ligne non reconnue hors d’une ressource : signalée', () => {
    const resultat = importerNotes(releve([[1, 'SEMESTRE 3 BUT Informatique'], [2, 'Ligne mystère (inventée)']]));
    assert.deepEqual(messages(resultat), ['« Ligne mystère (inventée) » : ligne non reconnue, elle n’est pas importée.']);
  });

  // Début commun des cas « ligne doublée » : R3.01 sera écrite deux fois.
  const DEBUT_DOUBLE = [
    [1, 'SEMESTRE 3 BUT Informatique'],
    [2, 'UE3.1 Réaliser (inventé)'],
    [3, 'Pôle Ressource UE 3.1'],
  ];

  test('ligne doublée « FI » : la moyenne officielle est prise sur la ligne qui en a une', () => {
    const resultat = importerNotes(
      releve([
        ...DEBUT_DOUBLE,
        [4, 'R3.01 Ressource inventée'],
        [5, 'A - coef 1', { note: 10 }],
        [4, 'R3.01 Ressource inventée FI', { note: 11, resultat: 'V' }],
        [5, 'B - coef 1', { note: 12 }],
      ]),
    );
    const [r301] = resultat.semestres[0].elements;
    assert.equal(resultat.semestres[0].elements.length, 1);
    assert.deepEqual(r301.officiel, { moyenne: 11, resultat: 'V' });
    assert.deepEqual(
      r301.evaluations.map((e) => e.libelle),
      ['A - coef 1', 'B - coef 1'],
    );
    assert.deepEqual(resultat.rapport.aVerifier, []);
  });

  test('ligne doublée avec deux moyennes officielles différentes : la première est gardée, et c’est signalé', () => {
    const resultat = importerNotes(
      releve([
        ...DEBUT_DOUBLE,
        [4, 'R3.01 Ressource inventée', { note: 11 }],
        [5, 'A - coef 1', { note: 11 }],
        [4, 'R3.01 Ressource inventée FI', { note: '13.5' }],
        [5, 'B - coef 1', { note: '13.5' }],
      ]),
    );
    assert.equal(resultat.semestres[0].elements[0].officiel.moyenne, 11);
    assert.deepEqual(messages(resultat), [
      '« R3.01 » apparaît sur deux lignes avec deux moyennes officielles différentes (11 et 13,5) : seule la première est gardée.',
    ]);
  });

  test('même code mais libellé vraiment différent : lignes réunies, et c’est signalé', () => {
    const resultat = importerNotes(
      releve([
        ...DEBUT_DOUBLE,
        [4, 'R3.01 Ressource inventée'],
        [5, 'A - coef 1', { note: 10 }],
        [4, 'R3.01 Autre intitulé (inventé)'],
        [5, 'B - coef 1', { note: 20 }],
      ]),
    );
    assert.equal(resultat.semestres[0].elements.length, 1);
    assert.equal(resultat.semestres[0].elements[0].evaluations.length, 2);
    assert.deepEqual(messages(resultat), [
      '« R3.01 Autre intitulé (inventé) » a le même code que « R3.01 Ressource inventée » : leurs évaluations sont réunies.',
    ]);
  });

  test('ligne personnelle glissée dans le tableau : écartée, et jamais recopiée', () => {
    const elements = releve([...DEBUT_S3, [5, 'Contrôle - coef 1', { note: 10 }]]);
    elements.push(element('Courriel : camille.exemple@exemple.invalid', 90, 500));
    const resultat = importerNotes(elements);
    assert.equal(resultat.rapport.lignesNonLues, 1);
    assert.ok(!JSON.stringify(resultat).includes('exemple'));
  });

  test('les retraits sont comparés entre eux : un relevé décalé de 37 points donne le même résultat', () => {
    const elements = releve([...DEBUT_S3, [5, 'Mati 1 Anglais'], [6, 'Oral - coef 1', { note: 13 }]]);
    const decale = elements.map((e) => ({ ...e, x: e.x + 37 }));
    assert.deepEqual(importerNotes(decale), importerNotes(elements));
    assert.equal(importerNotes(decale).semestres[0].elements[0].matieres[0].evaluations[0].note, 13);
  });

  test('ne modifie pas la liste reçue', () => {
    const elements = releve([...DEBUT_S3, [5, 'Contrôle - coef 1', { note: 10 }]]);
    const copie = structuredClone(elements);
    importerNotes(elements);
    assert.deepEqual(elements, copie);
  });
});
