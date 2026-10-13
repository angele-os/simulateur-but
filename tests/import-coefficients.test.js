// Tests de js/import-coefficients.js.
// Toutes les données (fixtures et cas construits ici) sont INVENTÉES.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { importerCoefficients, regrouperEnLignes } from '../js/import-coefficients.js';

// Charge une fixture de tests/fixtures/.
function chargerFixture(nom) {
  return JSON.parse(readFileSync(new URL(`fixtures/${nom}`, import.meta.url), 'utf8'));
}

// Retrouve une UE par son code dans le résultat.
function trouverUe(resultat, code) {
  for (const semestre of resultat.semestres) {
    const ue = semestre.ues.find((candidate) => candidate.code === code);
    if (ue) {
      return ue;
    }
  }
  throw new Error(`UE ${code} absente du résultat`);
}

// ---------- Petits outils pour construire des cas à la main ----------

// Un élément texte qui commence en x (largeur ≈ une demi-taille par caractère).
function element(texte, x, y, page = 1) {
  return { texte, x, y, taille: 9, largeur: texte.length * 4.5, page };
}

// Un élément centré sur « centre » (comme un nombre sous une colonne).
function centre(texte, milieu, y, page = 1) {
  const largeur = texte.length * 4.5;
  return { texte, x: milieu - largeur / 2, y, taille: 9, largeur, page };
}

// Tableau inventé du « semestre 9 », avec deux colonnes : UE9.1 (centre 300)
// et UE9.2 (centre 350). La tolérance vaut donc 50 / 2 = 25 points.
const COLONNES = { 'UE9.1': 300, 'UE9.2': 350 };

// Une ligne : des textes à gauche (x = 40, 100, 160…) et des nombres sous les colonnes.
function ligne(y, textes, nombres = {}, page = 1) {
  const elements = textes.map((texte, i) => element(texte, 40 + i * 60, y, page));
  for (const [ue, valeur] of Object.entries(nombres)) {
    elements.push(centre(String(valeur), COLONNES[ue], y, page));
  }
  return elements;
}

function enTete(y, page = 1) {
  return [
    element('Numéro', 40, y, page),
    element('Intitulé', 100, y, page),
    centre('UE9.1', 300, y, page),
    centre('UE9.2', 350, y, page),
  ];
}

const totauxJustes = (y) => [
  ...ligne(y, ['TOTAL SAE'], { 'UE9.1': 40, 'UE9.2': 40 }),
  ...ligne(y - 14, ['Total Ressources'], { 'UE9.1': 60, 'UE9.2': 60 }),
  ...ligne(y - 28, ['TOTAL GENERAL'], { 'UE9.1': 100, 'UE9.2': 100 }),
];

// Un tableau minimal et juste, auquel on peut ajouter des éléments.
function tableauMinimal(elementsEnPlus = []) {
  return [
    ...enTete(800),
    ...ligne(786, ['Pôle SAE']),
    ...ligne(772, ['S9.01', 'SAE inventée'], { 'UE9.1': 40, 'UE9.2': 40 }),
    ...ligne(758, ['Pôle Ressources']),
    ...ligne(744, ['R9.01', 'Ressource inventée'], { 'UE9.1': 60, 'UE9.2': 60 }),
    ...totauxJustes(730),
    ...elementsEnPlus,
  ];
}

// ---------- Tests ----------

describe('regrouperEnLignes', () => {
  test('regroupe par y (écart < 2), de haut en bas, page par page, de gauche à droite', () => {
    const lignes = regrouperEnLignes([
      element('d', 40, 800, 2), // page 2 : vient après toute la page 1
      element('b', 100, 700.8),
      element('a', 40, 700), // 0,8 sous « b » : même ligne
      element('c', 40, 698.5), // 2,3 sous « b » : nouvelle ligne
      element('haut', 40, 750), // y plus grand = plus haut sur la page
    ]);
    assert.deepEqual(
      lignes.map((l) => l.elements.map((e) => e.texte)),
      [['haut'], ['a', 'b'], ['c'], ['d']],
    );
  });

  test('ne modifie pas la liste reçue', () => {
    const elements = [element('b', 40, 100), element('a', 40, 200)];
    regrouperEnLignes(elements);
    assert.deepEqual(
      elements.map((e) => e.texte),
      ['b', 'a'],
    );
  });
});

describe('mise en page BUT1-2 (fixture inventée : 6 UE, 2 semestres sur 2 pages)', () => {
  const resultat = importerCoefficients(chargerFixture('coefficients-but1-2.json'));

  test('trouve les deux semestres et leurs 6 UE', () => {
    assert.deepEqual(
      resultat.semestres.map((s) => s.numero),
      [1, 2],
    );
    assert.deepEqual(
      resultat.semestres[0].ues.map((ue) => ue.code),
      ['UE1.1', 'UE1.2', 'UE1.3', 'UE1.4', 'UE1.5', 'UE1.6'],
    );
    assert.deepEqual(
      resultat.semestres[1].ues.map((ue) => ue.code),
      ['UE2.1', 'UE2.2', 'UE2.3', 'UE2.4', 'UE2.5', 'UE2.6'],
    );
  });

  test('aucune erreur : tous les totaux tombent juste', () => {
    assert.deepEqual(resultat.rapport.erreurs, []);
  });

  test('range chaque coefficient dans la bonne UE', () => {
    assert.deepEqual(trouverUe(resultat, 'UE1.1'), {
      code: 'UE1.1',
      poidsSae: 40,
      poidsRessources: 60,
      sae: [{ code: 'S1.01', libelle: 'SAE inventée A', coef: 40 }],
      ressources: [
        { code: 'R1.01', libelle: 'Ressource inventée 1', coef: 30 },
        { code: 'R1.02', libelle: 'Ressource inventée 2', coef: 30 },
      ],
    });
  });

  test('le poids des SAE est lu dans le tableau : 40 au S1, 50 au S2', () => {
    for (const ue of resultat.semestres[0].ues) {
      assert.equal(ue.poidsSae, 40);
      assert.equal(ue.poidsRessources, 60);
    }
    for (const ue of resultat.semestres[1].ues) {
      assert.equal(ue.poidsSae, 50);
      assert.equal(ue.poidsRessources, 50);
    }
  });

  test('chaque semestre donne aussi ses lignes, avec leur coefficient dans chaque UE', () => {
    const [s1] = resultat.semestres;
    assert.deepEqual(
      s1.lignes.find((l) => l.code === 'R1.01'),
      { type: 'ressource', code: 'R1.01', alias: [], libelle: 'Ressource inventée 1', coefs: { 'UE1.1': 30, 'UE1.2': 20 } },
    );
    // Le portfolio du S1 n'a aucun coefficient : il figure quand même, sans coefficient.
    assert.deepEqual(s1.lignes.find((l) => l.code === 'S1.PF').coefs, {});
    // Toutes les lignes lues sont là, dans l'un ou l'autre semestre.
    assert.equal(resultat.semestres.flatMap((s) => s.lignes).length, resultat.rapport.lu.length);
  });

  test('code répété (R1.01 R1.01) : une seule ligne lue', () => {
    const lignesR101 = resultat.rapport.lu.filter((l) => l.code === 'R1.01');
    assert.equal(lignesR101.length, 1);
    assert.deepEqual(lignesR101[0].coefs, { 'UE1.1': 30, 'UE1.2': 20 });
  });

  test('deux codes (R2.08 R2.B.08) : on garde le dernier, le plus précis', () => {
    assert.deepEqual(trouverUe(resultat, 'UE2.4').ressources, [
      { code: 'R2.B.08', libelle: 'Ressource inventée de parcours', coef: 50 },
    ]);
    assert.ok(!resultat.rapport.lu.some((l) => l.code === 'R2.08'));
    // Le premier code est gardé comme alias, pour retrouver la ligne.
    assert.deepEqual(resultat.rapport.lu.find((l) => l.code === 'R2.B.08').alias, ['R2.08']);
  });

  test('portfolio sans coefficient au S1 : lu, mais ne compte dans aucune UE', () => {
    const portfolio = resultat.rapport.lu.find((l) => l.code === 'S1.PF');
    assert.deepEqual(portfolio.coefs, {});
    for (const ue of resultat.semestres[0].ues) {
      assert.ok(!ue.sae.some((s) => s.code === 'S1.PF'));
    }
  });

  test('portfolio avec coefficient au S2 : il compte dans le pôle SAE', () => {
    assert.deepEqual(trouverUe(resultat, 'UE2.5').sae, [
      { code: 'S2.02', libelle: 'SAE inventée E', coef: 40 },
      { code: 'S2.PF', libelle: 'Portfolio', coef: 10 },
    ]);
  });

  test('« Non évalué ce semestre » : la ressource est lue sans coefficient et ne compte nulle part', () => {
    const ressource = resultat.rapport.lu.find((l) => l.code === 'R2.A.09');
    assert.deepEqual(ressource.coefs, {});
    assert.equal(ressource.libelle, 'Ressource inventée d’un autre parcours');
    for (const ue of resultat.semestres[1].ues) {
      assert.ok(!ue.ressources.some((r) => r.code === 'R2.A.09'));
    }
  });

  test('rapport : bandeau, titres, « Parcours » et « Non évalué » sont ignorés', () => {
    assert.deepEqual(
      resultat.rapport.ignore.map(({ page, raison }) => [page, raison]),
      [
        [1, 'bandeau « IUT concerné »'],
        [1, 'avant le premier en-tête UE'],
        [2, 'bandeau « IUT concerné »'],
        [2, 'ligne sans code (titre…)'],
        [2, 'ligne « Parcours »'],
        [2, '« Non évalué ce semestre » (ligne R2.A.09)'],
      ],
    );
  });

  test('rapport : toutes les lignes de données sont lues, avec leur type', () => {
    assert.equal(resultat.rapport.lu.length, 15);
    assert.deepEqual(resultat.rapport.lu[0], {
      semestre: 1,
      page: 1,
      type: 'sae',
      code: 'S1.01',
      alias: [],
      libelle: 'SAE inventée A',
      coefs: { 'UE1.1': 40 },
    });
    assert.equal(resultat.rapport.lu.find((l) => l.code === 'R1.04').type, 'ressource');
  });
});

describe('mise en page BUT3 (fixture inventée : 3 UE, colonne Nature, ligne ECTS)', () => {
  const resultat = importerCoefficients(chargerFixture('coefficients-but3.json'));

  test('trouve les deux semestres avec seulement 3 UE chacun', () => {
    assert.deepEqual(
      resultat.semestres.map((s) => [s.numero, s.ues.map((ue) => ue.code)]),
      [
        [5, ['UE5.1', 'UE5.3', 'UE5.6']],
        [6, ['UE6.1', 'UE6.3', 'UE6.6']],
      ],
    );
  });

  test('aucune erreur : les « 10 » des lignes ECTS ne sont pas pris pour des coefficients', () => {
    assert.deepEqual(resultat.rapport.erreurs, []);
    const lignesEcts = resultat.rapport.ignore.filter((i) => i.raison === 'ligne ECTS');
    assert.deepEqual(
      lignesEcts.map((i) => i.texte),
      ['ECTS 10 10 10', 'ECTS 10 10 10'],
    );
  });

  test('« SAE SAE 5.A.01 SAE5.B.01 » : Nature SAE, et on garde le dernier code', () => {
    assert.deepEqual(trouverUe(resultat, 'UE5.1').sae, [
      { code: 'SAE5.B.01', libelle: 'SAE inventée de parcours', coef: 40 },
    ]);
  });

  test('Nature RSC : ressource', () => {
    assert.deepEqual(trouverUe(resultat, 'UE5.6'), {
      code: 'UE5.6',
      poidsSae: 40,
      poidsRessources: 60,
      sae: [{ code: 'SAE5.B.01', libelle: 'SAE inventée de parcours', coef: 40 }],
      ressources: [{ code: 'R5.B.12', libelle: 'Ressource inventée 8', coef: 60 }],
    });
  });

  test('S6 : le pôle SAE (60) est formé de la SAE, du portfolio et du stage', () => {
    const ue = trouverUe(resultat, 'UE6.3');
    assert.equal(ue.poidsSae, 60);
    assert.equal(ue.poidsRessources, 40);
    assert.deepEqual(
      ue.sae.map((s) => [s.code, s.coef]),
      [
        ['S6.B.01', 30],
        ['PORTFOLIO', 10],
        ['S6.STAGE', 20],
      ],
    );
  });

  test('PORTFOLIO sans coefficient au S5, avec coefficient au S6', () => {
    const portfolios = resultat.rapport.lu.filter((l) => l.code === 'PORTFOLIO');
    assert.deepEqual(
      portfolios.map((l) => [l.semestre, l.coefs]),
      [
        [5, {}],
        [6, { 'UE6.1': 10, 'UE6.3': 10, 'UE6.6': 10 }],
      ],
    );
  });
});

describe('BUT3 DACS : totaux précédés de la colonne Nature (fixture inventée)', () => {
  const resultat = importerCoefficients(chargerFixture('coefficients-but3-dacs.json'));

  test('« RSC Total Ressources : » et « RSC TOTAL GENERAL : » sont reconnus : aucune erreur', () => {
    assert.deepEqual(resultat.rapport.erreurs, []);
  });

  test('ces lignes ne sont plus ignorées comme des titres', () => {
    assert.ok(!resultat.rapport.ignore.some((i) => /total/i.test(i.texte)));
  });

  test('les deux semestres sont lus, avec les totaux préfixés (S5) et normaux (S6)', () => {
    assert.deepEqual(
      resultat.semestres.map((s) => s.ues.map((ue) => [ue.code, ue.poidsSae, ue.poidsRessources])),
      [
        [
          ['UE5.1', 50, 50],
          ['UE5.3', 50, 50],
          ['UE5.6', 50, 50],
        ],
        [
          ['UE6.1', 60, 40],
          ['UE6.3', 60, 40],
          ['UE6.6', 60, 40],
        ],
      ],
    );
  });
});

describe('contrôle des totaux (fixture inventée aux totaux faux)', () => {
  const resultat = importerCoefficients(chargerFixture('coefficients-totaux-faux.json'));

  test('signale chaque total qui ne tombe pas juste, avec l’UE concernée', () => {
    assert.deepEqual(resultat.rapport.erreurs, [
      {
        semestre: 1,
        ue: 'UE1.3',
        message:
          'UE1.3 : les coefficients des ressources lus font 50, mais la ligne « Total Ressources » indique 60.',
      },
      {
        semestre: 1,
        ue: 'UE1.6',
        message: 'UE1.6 : le « TOTAL GENERAL » vaut 90 au lieu de 100.',
      },
      {
        semestre: 1,
        ue: 'UE1.6',
        message:
          'UE1.6 : TOTAL SAE (40) + Total Ressources (60) ne font pas le « TOTAL GENERAL » (90).',
      },
    ]);
  });

  test('renvoie quand même ce qui a été lu, pour que l’utilisateur corrige', () => {
    assert.equal(trouverUe(resultat, 'UE1.3').poidsRessources, 50);
  });
});

describe('cas particuliers (tableaux construits dans le test)', () => {
  test('un tableau minimal juste ne donne aucune erreur', () => {
    const resultat = importerCoefficients(tableauMinimal());
    assert.deepEqual(resultat.rapport.erreurs, []);
    assert.deepEqual(trouverUe(resultat, 'UE9.2').ressources, [
      { code: 'R9.01', libelle: 'Ressource inventée', coef: 60 },
    ]);
  });

  test('aucun en-tête d’UE : erreur claire et aucun semestre', () => {
    for (const elements of [[], ligne(800, ['Relevé de notes inventé'])]) {
      const resultat = importerCoefficients(elements);
      assert.deepEqual(resultat.semestres, []);
      assert.equal(resultat.rapport.erreurs.length, 1);
      assert.match(resultat.rapport.erreurs[0].message, /ne semble pas être un tableau des coefficients/);
    }
  });

  test('chaque nombre va dans la colonne dont le centre est le plus proche', () => {
    const elements = [
      ...enTete(800),
      ...ligne(786, ['Pôle Ressources']),
      // centre 312 : à 12 de UE9.1 et 38 de UE9.2 → UE9.1
      // centre 333 : à 33 de UE9.1 et 17 de UE9.2 → UE9.2
      element('R9.01', 40, 772),
      element('Ressource inventée', 100, 772),
      centre('30', 312, 772),
      centre('12', 333, 772),
    ];
    const resultat = importerCoefficients(elements);
    assert.deepEqual(resultat.rapport.lu[0].coefs, { 'UE9.1': 30, 'UE9.2': 12 });
  });

  test('un nombre trop loin de toute colonne est ignoré et signalé', () => {
    const resultat = importerCoefficients(
      tableauMinimal([
        element('R9.02', 40, 600),
        element('Ressource inventée bis', 100, 600),
        centre('7', 200, 600), // à 100 points de UE9.1 : hors colonne
      ]),
    );
    const ignore = resultat.rapport.ignore.find((i) => i.texte === '7');
    assert.equal(ignore.raison, 'nombre hors des colonnes UE (Ligne R9.02)');
    assert.deepEqual(resultat.rapport.lu.find((l) => l.code === 'R9.02').coefs, {});
  });

  test('deux nombres dans la même colonne : erreur', () => {
    const resultat = importerCoefficients(
      tableauMinimal([
        element('R9.02', 40, 600),
        element('Ressource inventée bis', 100, 600),
        centre('5', 296, 600),
        centre('8', 306, 600),
      ]),
    );
    assert.ok(
      resultat.rapport.erreurs.some(
        (e) => e.message === 'Ligne R9.02 : deux nombres sous UE9.1 (5 et 8). Seul le premier est gardé.',
      ),
    );
  });

  test('coefficient décimal avec une virgule', () => {
    const resultat = importerCoefficients([
      ...enTete(800),
      ...ligne(786, ['Pôle Ressources']),
      ...ligne(772, ['R9.01', 'Ressource inventée'], { 'UE9.1': '7,5' }),
    ]);
    assert.deepEqual(resultat.rapport.lu[0].coefs, { 'UE9.1': 7.5 });
  });

  test('préfixe de nature « SAE » devant « TOTAL SAE » : la ligne de total est reconnue', () => {
    const elements = tableauMinimal()
      .filter((e) => e.texte !== 'TOTAL SAE')
      .concat(element('SAE', 40, 730), element('TOTAL SAE :', 100, 730));
    const resultat = importerCoefficients(elements);
    assert.deepEqual(resultat.rapport.erreurs, []);
  });

  test('ligne de total absente : on signale que le contrôle est impossible', () => {
    const sansTotalSae = tableauMinimal().filter((e) => e.y !== 730); // retire la ligne TOTAL SAE
    const resultat = importerCoefficients(sansTotalSae);
    assert.deepEqual(resultat.rapport.erreurs, [
      {
        semestre: 9,
        message:
          'Semestre 9 : ligne « TOTAL SAE » introuvable, les coefficients ne peuvent pas être vérifiés.',
      },
    ]);
  });

  test('ligne de données sans section ni Nature : erreur, ligne non importée', () => {
    const resultat = importerCoefficients([
      ...enTete(800),
      ...ligne(786, ['R9.01', 'Ressource inventée'], { 'UE9.1': 60 }),
    ]);
    assert.ok(resultat.rapport.erreurs.some((e) => /impossible de savoir si c’est une SAE ou une ressource/.test(e.message)));
    assert.deepEqual(resultat.rapport.lu, []);
  });

  test('code présent deux fois dans un semestre : erreur, seule la première ligne compte', () => {
    const resultat = importerCoefficients(
      tableauMinimal(ligne(600, ['R9.01', 'Ressource inventée en double'], { 'UE9.1': 99 })),
    );
    assert.ok(
      resultat.rapport.erreurs.some(
        (e) => e.message === 'Le code R9.01 apparaît deux fois au semestre 9. Seule la première ligne est importée.',
      ),
    );
    assert.equal(trouverUe(resultat, 'UE9.1').ressources[0].coef, 60);
  });

  test('en-tête répété en haut de la page suivante : même semestre, pas un nouveau', () => {
    const elements = [
      ...enTete(800),
      ...ligne(786, ['Pôle SAE']),
      ...ligne(772, ['S9.01', 'SAE inventée'], { 'UE9.1': 40, 'UE9.2': 40 }),
      ...ligne(758, ['Pôle Ressources']),
      // page 2 : l'en-tête est répété, puis le tableau continue
      ...enTete(800, 2),
      ...ligne(786, ['R9.01', 'Ressource inventée'], { 'UE9.1': 60, 'UE9.2': 60 }, 2),
      ...totauxJustes(772).map((e) => ({ ...e, page: 2 })),
    ];
    const resultat = importerCoefficients(elements);
    assert.equal(resultat.semestres.length, 1);
    assert.deepEqual(resultat.rapport.erreurs, []);
    assert.equal(trouverUe(resultat, 'UE9.1').ressources[0].code, 'R9.01');
  });
});

describe('code collé à l’intitulé (fixture inventée, forme des vrais tableaux)', () => {
  // Dans les vrais PDF, pdf.js renvoie « R4.10 », puis « R4.B.10 Cryptographie »
  // d'un seul bloc : le 2ᵉ code est collé au début de l'intitulé.
  const resultat = importerCoefficients(chargerFixture('coefficients-codes-colles.json'));
  const lignes = resultat.semestres[0].lignes;

  test('aucune erreur : les totaux tombent juste', () => {
    assert.deepEqual(resultat.rapport.erreurs, []);
  });

  test('le code collé est détaché : c’est lui le code, le premier devient un alias', () => {
    assert.deepEqual(
      lignes.map((l) => [l.code, l.alias, l.libelle]),
      [
        ['SAE 4.01', ['S4.01'], 'Projet inventé'],
        ['S4.PF', [], 'Portfolio'],
        ['S4.MP', [], 'Stage'],
        ['R4.01', [], 'Architecture logicielle (inventée)'], // code répété : pas d'alias
        ['R4.B.10', ['R4.10'], 'Cryptographie (inventée)'],
        ['R4.B.11', ['R4.11'], 'Réseau inventé'],
      ],
    );
  });

  test('les coefficients restent dans les bonnes colonnes', () => {
    assert.deepEqual(trouverUe(resultat, 'UE4.3').ressources, [
      { code: 'R4.B.10', libelle: 'Cryptographie (inventée)', coef: 30 },
      { code: 'R4.B.11', libelle: 'Réseau inventé', coef: 10 },
    ]);
  });

  test('un intitulé qui ne commence pas par un code n’est pas découpé', () => {
    const resultat = importerCoefficients(
      tableauMinimal(ligne(600, ['R9.02', 'Réseaux R9.03 avancés'])),
    );
    const lue = resultat.rapport.lu.find((l) => l.code === 'R9.02');
    assert.deepEqual([lue.alias, lue.libelle], [[], 'Réseaux R9.03 avancés']);
  });
});
