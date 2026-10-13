// Tests de js/remplissage.js : comment un import remplit la saisie.
// Toutes les données (fixtures et tableaux construits ici) sont INVENTÉES.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { creerSemestre, creerUe, creerElement, creerEvaluation, codeUe } from '../js/modele.js';
import { importerCoefficients } from '../js/import-coefficients.js';
import { importerNotes } from '../js/import-notes.js';
import {
  cleCode,
  codePartie,
  preparerImportCoefficients,
  preparerImportReleve,
  messageConfirmation,
} from '../js/remplissage.js';

// ---------- Outils ----------

function chargerFixture(nom) {
  return JSON.parse(readFileSync(new URL(`fixtures/${nom}`, import.meta.url), 'utf8'));
}

// Fabrique d'identifiants, comme celle de app.js : t1, t2, t3…
function fabriqueIds() {
  let compteur = 0;
  return () => `t${++compteur}`;
}

// La saisie vide des 6 semestres.
const saisieVide = () => Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, creerSemestre()]));

// Applique une proposition, comme app.js après confirmation.
const appliquer = (semestres, proposition) => ({ ...semestres, ...proposition.semestres });

// Une ligne de la saisie, par son code.
function ligne(semestre, code) {
  const element = semestre.elements.find((candidat) => candidat.code === code);
  if (!element) {
    throw new Error(`ligne ${code} absente (lignes : ${semestre.elements.map((e) => e.code).join(', ')})`);
  }
  return element;
}

// Les coefficients d'une ligne, avec le CODE des UE à la place de leur
// identifiant : { 'UE3.1': '30' }.
function coefsParCode(semestre, numero, element) {
  return Object.fromEntries(
    Object.entries(element.coefs).map(([id, coef]) => [
      codeUe(numero, semestre.ues.find((ue) => ue.id === id).numero),
      coef,
    ]),
  );
}

// Les évaluations d'une ligne, sans les identifiants : [libellé, note, coef].
const evaluations = (element) => element.evaluations.map((e) => [e.libelle, e.note, e.coef]);

// Tableau des coefficients INVENTÉ (S3 et S4 du BUT2), réduit à ce que lit le
// remplissage. Les codes sont ceux du relevé inventé releve-but2.json.
function tableau(numero, lignes) {
  const codesUe = [...new Set(lignes.flatMap((l) => Object.keys(l.coefs)))].sort();
  return { numero, ues: codesUe.map((code) => ({ code })), lignes };
}
const TABLEAU_BUT2 = {
  semestres: [
    tableau(3, [
      { type: 'sae', code: 'S3.01', libelle: 'SAE inventée du S3', coefs: { 'UE3.1': 40, 'UE3.2': 40, 'UE3.3': 40 } },
      { type: 'sae', code: 'S3.PF', libelle: 'Portfolio', coefs: {} },
      { type: 'ressource', code: 'R3.01', libelle: 'Développement web', coefs: { 'UE3.1': 30, 'UE3.2': 10 } },
      { type: 'ressource', code: 'R3.02', libelle: 'Développement efficace', coefs: { 'UE3.1': 30 } },
      { type: 'ressource', code: 'R3.05', libelle: 'Programmation système', coefs: { 'UE3.2': 50 } },
      { type: 'ressource', code: 'R3.06', libelle: 'Réseaux', coefs: { 'UE3.3': 20 } },
      { type: 'ressource', code: 'R3.07', libelle: 'Systèmes d’exploitation', coefs: { 'UE3.3': 20 } },
      { type: 'ressource', code: 'R3.12', libelle: 'Langues', coefs: { 'UE3.3': 20 } },
    ]),
    tableau(4, [
      { type: 'sae', code: 'S4.01', libelle: 'SAE inventée du S4', coefs: { 'UE4.1': 30, 'UE4.3': 30 } },
      { type: 'sae', code: 'S4.PF', libelle: 'Portfolio', coefs: { 'UE4.1': 10, 'UE4.3': 10 } },
      { type: 'sae', code: 'S4.MP', libelle: 'Stage', coefs: { 'UE4.1': 20, 'UE4.3': 20 } },
      { type: 'ressource', code: 'R4.01', libelle: 'Architecture logicielle', coefs: { 'UE4.1': 20 } },
      { type: 'ressource', code: 'R4.B.10', libelle: 'Cryptographie', coefs: { 'UE4.1': 20, 'UE4.3': 40 } },
    ]),
  ],
  rapport: { erreurs: [], ignore: [] },
};

const RELEVE_BUT2 = importerNotes(chargerFixture('releve-but2.json'));

// Les deux imports, dans un ordre ou dans l'autre.
function importerTableauPuisReleve() {
  const ids = fabriqueIds();
  const apresTableau = appliquer(saisieVide(), preparerImportCoefficients(saisieVide(), TABLEAU_BUT2, ids));
  const proposition = preparerImportReleve(apresTableau, RELEVE_BUT2, ids);
  return { semestres: appliquer(apresTableau, proposition), proposition };
}
function importerReleveSeul() {
  const proposition = preparerImportReleve(saisieVide(), RELEVE_BUT2, fabriqueIds());
  return { semestres: appliquer(saisieVide(), proposition), proposition };
}

// ---------- Codes ----------

describe('rapprochement des codes', () => {
  test('cleCode : une même ligne a la même clé, qu’elle vienne du tableau, du relevé ou de la saisie', () => {
    assert.equal(cleCode('SAE 4.01'), 'S4.01');
    assert.equal(cleCode('SAE5.B.01'), cleCode('SAE 5.B.01'));
    assert.equal(cleCode('S4.01'), 'S4.01');
    for (const code of ['S4.PF', 'S3.PF', 'PORTFOLIO', 'Portfolio']) {
      assert.equal(cleCode(code), 'PORTFOLIO');
    }
    for (const code of ['S4.MP', 'S6.STAGE', 'Stage']) {
      assert.equal(cleCode(code), 'STAGE');
    }
    assert.equal(cleCode(' r4.b.09 '), 'R4.B.09');
  });

  test('codePartie : « S3.01 » et « UE3.2 » donnent « S3.01 – UE3.2 »', () => {
    assert.equal(codePartie('S3.01', 'UE3.2'), 'S3.01 – UE3.2');
  });
});

// ---------- Tableau des coefficients ----------

describe('import du tableau des coefficients', () => {
  const resultatBut12 = importerCoefficients(chargerFixture('coefficients-but1-2.json'));

  test('crée les UE de chaque semestre trouvé, et les lignes avec leur coefficient par UE', () => {
    const proposition = preparerImportCoefficients(saisieVide(), resultatBut12, fabriqueIds());
    assert.deepEqual(Object.keys(proposition.semestres), ['1', '2']);
    const s1 = proposition.semestres[1];
    assert.deepEqual(
      s1.ues.map((ue) => ue.numero),
      [1, 2, 3, 4, 5, 6],
    );
    const r101 = ligne(s1, 'R1.01');
    assert.equal(r101.type, 'ressource');
    assert.equal(r101.intitule, 'Ressource inventée 1');
    assert.deepEqual(coefsParCode(s1, 1, r101), { 'UE1.1': '30', 'UE1.2': '20' });
    assert.deepEqual(coefsParCode(s1, 1, ligne(s1, 'S1.01')), { 'UE1.1': '40' });
    assert.equal(ligne(s1, 'S1.01').type, 'sae');
    assert.deepEqual(proposition.remplaces, []);
  });

  test('ligne sans aucun coefficient (portfolio du S1) : pas créée, et signalée parmi les lignes écartées', () => {
    const proposition = preparerImportCoefficients(saisieVide(), resultatBut12, fabriqueIds());
    assert.ok(!proposition.semestres[1].elements.some((e) => e.code === 'S1.PF'));
    assert.ok(
      proposition.rapport.ignores.includes('S1 · S1.PF Portfolio : aucun coefficient ce semestre, la ligne n’est pas créée.'),
    );
  });

  test('BUT3 DACS : seulement les UE 5.1, 5.3 et 5.6, jamais 6 UE supposées', () => {
    const resultat = importerCoefficients(chargerFixture('coefficients-but3-dacs.json'));
    const proposition = preparerImportCoefficients(saisieVide(), resultat, fabriqueIds());
    assert.deepEqual(
      proposition.semestres[5].ues.map((ue) => ue.numero),
      [1, 3, 6],
    );
    assert.ok(proposition.rapport.compris[0].startsWith('S5 : 3 UE (UE5.1, UE5.3, UE5.6)'));
  });

  test('ne modifie pas la saisie reçue', () => {
    const semestres = saisieVide();
    const copie = structuredClone(semestres);
    preparerImportCoefficients(semestres, resultatBut12, fabriqueIds());
    assert.deepEqual(semestres, copie);
  });

  test('garde les UE déjà saisies (même numéro), avec leur intitulé : pas de doublon', () => {
    const semestres = saisieVide();
    semestres[1].ues.push({ ...creerUe('u1', 1), intitule: 'Mon intitulé' });
    const s1 = preparerImportCoefficients(semestres, resultatBut12, fabriqueIds()).semestres[1];
    assert.equal(s1.ues.length, 6);
    assert.deepEqual(s1.ues[0], { id: 'u1', numero: 1, intitule: 'Mon intitulé' });
  });

  test('coefficients déjà saisis et différents : listés pour confirmation ; mêmes coefficients : rien à confirmer', () => {
    const ids = fabriqueIds();
    const apres = appliquer(saisieVide(), preparerImportCoefficients(saisieVide(), resultatBut12, ids));
    // Même tableau réimporté : rien ne change, rien à confirmer.
    assert.deepEqual(preparerImportCoefficients(apres, resultatBut12, ids).remplaces, []);
    // Un coefficient modifié à la main : il serait remplacé, on demande.
    const r101 = ligne(apres[1], 'R1.01');
    r101.coefs[Object.keys(r101.coefs)[0]] = '31';
    assert.deepEqual(preparerImportCoefficients(apres, resultatBut12, ids).remplaces, [
      'S1 · coefficients de R1.01 Ressource inventée 1',
    ]);
  });

  test('relevé donné par erreur au bouton des coefficients : aucune de ses lignes n’est recopiée', () => {
    const resultat = importerCoefficients(chargerFixture('releve-but2.json'));
    const proposition = preparerImportCoefficients(saisieVide(), resultat, fabriqueIds());
    assert.deepEqual(proposition.semestres, {});
    const sortie = JSON.stringify(proposition);
    for (const donnee of ['EXEMPLE', 'Camille', '99999999', '000000000ZZ', '@', '13/10/2026']) {
      assert.ok(!sortie.includes(donnee), `« ${donnee} » est sorti`);
    }
    // On dit seulement combien de lignes ont été écartées.
    assert.equal(proposition.rapport.ignores.length, 1);
    assert.match(proposition.rapport.ignores[0], /^\d+ lignes hors du tableau \(titre du document…\) écartées sans être affichées\.$/);
  });

  test('titre au-dessus du tableau : compté, mais pas recopié ; lignes écartées dans le tableau : recopiées', () => {
    const proposition = preparerImportCoefficients(saisieVide(), resultatBut12, fabriqueIds());
    assert.ok(proposition.rapport.ignores.includes('1 ligne hors du tableau (titre du document…) écartée sans être affichée.'));
    assert.ok(!proposition.rapport.ignores.some((texte) => texte.includes('avant le premier en-tête')));
    assert.ok(proposition.rapport.ignores.some((texte) => texte.includes('(ligne « Parcours »)')));
  });

  test('totaux faux dans le tableau : signalés dans « à vérifier »', () => {
    const resultat = importerCoefficients(chargerFixture('coefficients-totaux-faux.json'));
    const proposition = preparerImportCoefficients(saisieVide(), resultat, fabriqueIds());
    assert.ok(proposition.rapport.aVerifier.includes('UE1.6 : le « TOTAL GENERAL » vaut 90 au lieu de 100.'));
  });

  test('ligne saisie absente du tableau, sans coefficient : à compléter, avec un lien vers sa première case', () => {
    const semestres = saisieVide();
    semestres[1].elements.push({ ...creerElement('e1', 'ressource'), code: 'R1.99' });
    const proposition = preparerImportCoefficients(semestres, resultatBut12, fabriqueIds());
    const s1 = proposition.semestres[1];
    assert.deepEqual(proposition.rapport.aCompleter, [
      {
        texte: 'S1 · R1.99 : absente du tableau des coefficients. Saisis ses coefficients.',
        cible: { semestre: 1, champ: 'element-coef', element: 'e1', ue: s1.ues[0].id },
      },
    ]);
  });

  test('UE saisie absente du tableau : gardée, et signalée', () => {
    const semestres = saisieVide();
    semestres[5].ues.push(creerUe('u2', 2));
    const resultat = importerCoefficients(chargerFixture('coefficients-but3-dacs.json'));
    const proposition = preparerImportCoefficients(semestres, resultat, fabriqueIds());
    assert.deepEqual(
      proposition.semestres[5].ues.map((ue) => ue.numero),
      [1, 2, 3, 6],
    );
    assert.ok(
      proposition.rapport.aVerifier.includes('S5 · UE5.2 : absente du tableau. Elle est gardée : supprime-la si elle ne sert pas.'),
    );
  });
});

// ---------- Relevé de notes ----------

describe('import du relevé de notes', () => {
  test('rattache les notes par code aux lignes du tableau (R3.01)', () => {
    const { semestres } = importerTableauPuisReleve();
    const r301 = ligne(semestres[3], 'R3.01');
    assert.deepEqual(coefsParCode(semestres[3], 3, r301), { 'UE3.1': '30', 'UE3.2': '10' });
    assert.deepEqual(evaluations(r301), [
      ['Contrôle écrit - coef 2', '13,5', '2'],
      ['TP - coef 3', '10', '3'],
    ]);
    // L'intitulé saisi (ici celui du tableau) n'est pas remplacé.
    assert.equal(r301.intitule, 'Développement web');
  });

  test('Portfolio → S4.PF, Stage → S4.MP, SAE 4.01 → S4.01 : le code du tableau est gardé', () => {
    const s4 = importerTableauPuisReleve().semestres[4];
    assert.deepEqual(
      s4.elements.map((e) => e.code),
      ['S4.01', 'S4.PF', 'S4.MP', 'R4.01', 'R4.B.10'],
    );
    assert.deepEqual(evaluations(ligne(s4, 'S4.PF')), [['Dossier de compétences - coef 1', '12', '1']]);
    assert.deepEqual(evaluations(ligne(s4, 'S4.MP')), [
      ['Évaluation entreprise - Coef ??', '', ''],
      ['Mémoire - coef 2', '', '2'],
    ]);
    assert.deepEqual(evaluations(ligne(s4, 'S4.01')), [
      ['Rapport - coef 2', '14,5', '2'],
      ['Soutenance - Coef 1', '', '1'],
    ]);
  });

  test('BUT3 : Portfolio → PORTFOLIO, Stage → S6.STAGE', () => {
    const ids = fabriqueIds();
    const tableauBut3 = importerCoefficients(chargerFixture('coefficients-but3.json'));
    const apresTableau = appliquer(saisieVide(), preparerImportCoefficients(saisieVide(), tableauBut3, ids));
    const releve = {
      competences: [],
      semestres: [
        {
          numero: 6,
          libelle: 'SEMESTRE 6 BUT Informatique',
          officiel: { moyenne: null, resultat: null },
          malus: null,
          ues: [],
          elements: [
            { type: 'portfolio', code: null, libelle: 'Portfolio', ue: 'UE6.1', officiel: { moyenne: null, resultat: null }, evaluations: [{ libelle: 'Oral - coef 1', note: 14, coef: 1, ue: null }], matieres: [] },
            { type: 'stage', code: null, libelle: 'Stage', ue: 'UE6.1', officiel: { moyenne: null, resultat: null }, evaluations: [{ libelle: 'Mémoire - coef 1', note: 15, coef: 1, ue: null }], matieres: [] },
          ],
        },
      ],
      rapport: { lignesNonLues: 0, ignore: [], aVerifier: [], coefsInconnus: [], erreurs: [] },
    };
    const s6 = appliquer(apresTableau, preparerImportReleve(apresTableau, releve, ids))[6];
    assert.deepEqual(evaluations(ligne(s6, 'PORTFOLIO')), [['Oral - coef 1', '14', '1']]);
    assert.deepEqual(evaluations(ligne(s6, 'S6.STAGE')), [['Mémoire - coef 1', '15', '1']]);
    assert.ok(!s6.elements.some((e) => e.code === 'Portfolio' || e.code === 'Stage'));
  });

  test('S3 : une partie SAE par UE, avec un coefficient dans son UE seulement et ses évaluations seulement', () => {
    const s3 = importerTableauPuisReleve().semestres[3];
    // La ligne « S3.01 » du tableau est remplacée par ses parties.
    assert.ok(!s3.elements.some((e) => e.code === 'S3.01'));
    const parties = s3.elements.filter((e) => e.code.startsWith('S3.01 – '));
    assert.deepEqual(
      parties.map((p) => [p.code, p.type, coefsParCode(s3, 3, p)]),
      [
        ['S3.01 – UE3.1', 'sae', { 'UE3.1': '40' }],
        ['S3.01 – UE3.2', 'sae', { 'UE3.2': '40' }],
        ['S3.01 – UE3.3', 'sae', { 'UE3.3': '40' }],
      ],
    );
    assert.deepEqual(evaluations(parties[0]), [
      ['Sae UE 3.1 : Cahier des charges - Coef 2', '14', '2'],
      ['Sae UE 3.1 : Soutenance - Coef ??', '12', ''],
    ]);
    assert.deepEqual(evaluations(parties[1]), [['Sae UE 3.2 : MVP - Coef 2', '11,5', '2']]);
    // « UE 3.03 » est bien rangée dans UE3.3.
    assert.deepEqual(evaluations(parties[2]), [['Sae UE 3.03 : Déploiement - Coef 1', '', '1']]);
  });

  test('même saisie, que le relevé arrive avant ou après le tableau', () => {
    // Résumé d'un semestre, sans les identifiants ni l'ordre des lignes.
    const resumer = (semestre, numero) => ({
      ues: semestre.ues.map((ue) => [ue.numero, ue.intitule]),
      malus: semestre.malus,
      lignes: semestre.elements
        .map((e) => ({ code: e.code, type: e.type, coefs: coefsParCode(semestre, numero, e), evaluations: evaluations(e) }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    });

    const tableauPuisReleve = importerTableauPuisReleve().semestres;

    const ids = fabriqueIds();
    const apresReleve = appliquer(saisieVide(), preparerImportReleve(saisieVide(), RELEVE_BUT2, ids));
    const proposition = preparerImportCoefficients(apresReleve, TABLEAU_BUT2, ids);
    const relevePuisTableau = appliquer(apresReleve, proposition);

    for (const n of [3, 4]) {
      assert.deepEqual(resumer(relevePuisTableau[n], n), resumer(tableauPuisReleve[n], n));
    }
    // Les notes venues du relevé ne sont pas « remplacées » par le tableau.
    assert.deepEqual(proposition.remplaces, []);
  });

  test('le rapport du tableau, importé après le relevé, rappelle les « Coef ?? » encore vides', () => {
    const ids = fabriqueIds();
    const apresReleve = appliquer(saisieVide(), preparerImportReleve(saisieVide(), RELEVE_BUT2, ids));
    const { rapport } = preparerImportCoefficients(apresReleve, TABLEAU_BUT2, ids);
    // Plus aucune ligne sans coefficient : il ne reste que les deux « Coef ?? ».
    assert.deepEqual(
      rapport.aCompleter.map((a) => [a.texte, a.cible.champ]),
      [
        ['S3 · S3.01 – UE3.1 Application inventée : « Sae UE 3.1 : Soutenance - Coef ?? », coefficient inconnu. Saisis-le.', 'evaluation-coef'],
        ['S4 · S4.MP Stage : « Évaluation entreprise - Coef ?? », coefficient inconnu. Saisis-le.', 'evaluation-coef'],
      ],
    );
  });

  test('relevé avant le tableau : notes gardées, et il demande d’importer le tableau ou de saisir les coefficients', () => {
    const { semestres, proposition } = importerReleveSeul();
    const s3 = semestres[3];
    // Les UE du relevé sont créées, avec leur intitulé : on peut saisir les coefficients.
    assert.deepEqual(
      s3.ues.map((ue) => [ue.numero, ue.intitule]),
      [
        [1, 'Réaliser (intitulé inventé)'],
        [2, 'Optimiser (intitulé inventé)'],
        [3, 'Administrer (intitulé inventé)'],
      ],
    );
    assert.deepEqual(evaluations(ligne(s3, 'R3.01')), [
      ['Contrôle écrit - coef 2', '13,5', '2'],
      ['TP - coef 3', '10', '3'],
    ]);
    // Sans tableau, le code du relevé est gardé.
    assert.ok(s3.elements.some((e) => e.code === 'SAE 3.01 – UE3.2'));
    assert.ok(semestres[4].elements.some((e) => e.code === 'Portfolio'));
    // Une seule demande par semestre, avec un lien vers une case de coefficient.
    const demandes = proposition.rapport.aCompleter.filter((a) => a.texte.includes('aucune ligne'));
    assert.deepEqual(
      demandes.map((a) => [a.texte, a.cible.semestre, a.cible.champ]),
      [
        ['S3 : aucune ligne n’a encore de coefficient. Importe le tableau des coefficients, ou saisis les coefficients de chaque ligne. Les notes sont gardées.', 3, 'element-coef'],
        ['S4 : aucune ligne n’a encore de coefficient. Importe le tableau des coefficients, ou saisis les coefficients de chaque ligne. Les notes sont gardées.', 4, 'element-coef'],
      ],
    );
  });

  test('une seule matière : la ressource prend ses évaluations (Langues → Anglais)', () => {
    const s3 = importerTableauPuisReleve().semestres[3];
    assert.deepEqual(evaluations(ligne(s3, 'R3.12')), [
      ['Oral - coef 1', '13', '1'],
      ['Écrit - coef 1', '11', '1'],
    ]);
  });

  test('plusieurs matières : évaluations réunies dans la ressource, et c’est signalé', () => {
    const releve = structuredClone(RELEVE_BUT2);
    const langues = releve.semestres[0].elements.find((e) => e.code === 'R3.12');
    langues.matieres.push({
      libelle: 'Mati 2 Espagnol',
      officiel: { moyenne: 15, resultat: null },
      evaluations: [{ libelle: 'Oral espagnol - coef 1', note: 15, coef: 1, ue: null }],
    });
    const proposition = preparerImportReleve(saisieVide(), releve, fabriqueIds());
    assert.equal(ligne(proposition.semestres[3], 'R3.12').evaluations.length, 3);
    assert.ok(
      proposition.rapport.aVerifier.includes(
        'S3 · R3.12 : 2 matières (« Mati 1 Anglais », « Mati 2 Espagnol »). Leurs évaluations sont réunies dans cette ressource : vérifie les coefficients, la moyenne officielle peut se calculer autrement.',
      ),
    );
  });

  test('le malus du relevé remplit le champ malus (case vide : pas de malus)', () => {
    const { semestres } = importerReleveSeul();
    assert.equal(semestres[3].malus, '0,05');
    assert.equal(semestres[4].malus, '');
  });

  test('« Coef ?? » : coefficient vide, et un lien vers ce champ dans « à compléter »', () => {
    const { semestres, proposition } = importerTableauPuisReleve();
    const partie = ligne(semestres[3], 'S3.01 – UE3.1');
    const soutenance = partie.evaluations[1];
    assert.equal(soutenance.coef, '');
    assert.deepEqual(proposition.rapport.aCompleter, [
      {
        texte: 'S3 · S3.01 – UE3.1 SAE inventée du S3 : « Sae UE 3.1 : Soutenance - Coef ?? », coefficient inconnu. Saisis-le.',
        cible: { semestre: 3, champ: 'evaluation-coef', element: partie.id, evaluation: soutenance.id },
      },
      {
        texte: 'S4 · S4.MP Stage : « Évaluation entreprise - Coef ?? », coefficient inconnu. Saisis-le.',
        cible: {
          semestre: 4,
          champ: 'evaluation-coef',
          element: ligne(semestres[4], 'S4.MP').id,
          evaluation: ligne(semestres[4], 'S4.MP').evaluations[0].id,
        },
      },
    ]);
  });

  test('évaluations déjà saisies et différentes : listées pour confirmation ; même relevé réimporté : rien à confirmer', () => {
    const { semestres } = importerTableauPuisReleve();
    assert.deepEqual(preparerImportReleve(semestres, RELEVE_BUT2, fabriqueIds()).remplaces, []);

    ligne(semestres[3], 'R3.01').evaluations[0].note = '20';
    semestres[3].malus = '0,1';
    assert.deepEqual(preparerImportReleve(semestres, RELEVE_BUT2, fabriqueIds()).remplaces, [
      'S3 · malus (0,1)',
      'S3 · évaluations de R3.01 Développement web',
    ]);
  });

  test('une ligne saisie à la main, absente du relevé, garde ses évaluations', () => {
    const semestres = saisieVide();
    const evaluation = { ...creerEvaluation('v1'), libelle: 'Mon devoir', note: '15', coef: '1' };
    semestres[3].elements.push({ ...creerElement('e1', 'ressource'), code: 'R3.99', evaluations: [evaluation] });
    const s3 = preparerImportReleve(semestres, RELEVE_BUT2, fabriqueIds()).semestres[3];
    assert.deepEqual(evaluations(ligne(s3, 'R3.99')), [['Mon devoir', '15', '1']]);
  });

  test('moyennes officielles gardées : UE et pôles par semestre, compétences de l’année', () => {
    const { proposition } = importerReleveSeul();
    assert.deepEqual(proposition.officiels.ues[3]['UE3.1'], { moyenne: 12.345, poleSae: 13, poleRessources: 11.9 });
    assert.deepEqual(proposition.officiels.ues[4]['UE4.1'], { moyenne: null, poleSae: null, poleRessources: null });
    // C1, C2, C3 de l'année S3 + S4.
    assert.deepEqual(proposition.officiels.competences, { 3: { 1: 12.5, 2: 11.25, 3: 9.5 } });
  });

  test('rapport : ce qui a été compris, et ce qui a été écarté', () => {
    const { proposition } = importerTableauPuisReleve();
    const { compris, ignores } = proposition.rapport;
    assert.deepEqual(compris, [
      'S3 : 6 ressources et 3 parties du pôle SAE ; 13 évaluations, dont 2 pas encore notées. Malus : 0,05.',
      'S4 : 2 ressources et 3 parties du pôle SAE ; 7 évaluations, dont 3 pas encore notées. Malus : aucun.',
      'Moyennes officielles gardées pour les comparer aux moyennes calculées : 3 UE (avec leurs pôles) et 3 compétences.',
    ]);
    assert.equal(
      ignores[0],
      '7 lignes d’en-tête ou de bas de page (nom, n° de dossier, légende…) écartées sans être lues.',
    );
    assert.ok(ignores.includes('Page 1 : « Travaux SAE 3.01 » (ligne de regroupement : ses évaluations sont rattachées à « SAE 3.01 »).'));
  });

  test('aucune donnée personnelle dans la proposition ni dans le rapport', () => {
    const sortie = JSON.stringify(importerTableauPuisReleve().proposition);
    for (const donnee of ['EXEMPLE', 'Camille', '99999999', '000000000ZZ', '@', '13/10/2026']) {
      assert.ok(!sortie.includes(donnee), `« ${donnee} » est sorti`);
    }
  });
});

// ---------- Confirmation ----------

describe('demande de confirmation', () => {
  test('liste ce qui serait remplacé, au plus 8 lignes', () => {
    const remplaces = Array.from({ length: 10 }, (_, i) => `S3 · coefficients de R3.0${i}`);
    const message = messageConfirmation(remplaces);
    assert.ok(message.startsWith('Cet import va remplacer ce qui est déjà saisi :\n• S3 · coefficients de R3.00\n'));
    assert.ok(message.includes('• S3 · coefficients de R3.07\n• … et 2 autres\n\nContinuer ?'));
    assert.ok(!message.includes('R3.08'));
  });
});
