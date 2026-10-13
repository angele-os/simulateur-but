// Tests de js/choix-annee.js : le choix « année + parcours » crée les
// semestres à partir du référentiel (data/referentiel.json, coefficients
// publics de l'IUT). Le relevé utilisé est INVENTÉ (fixture).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import referentiel from '../data/referentiel.js';
import { codeUe, creerSemestre } from '../js/modele.js';
import { importerNotes } from '../js/import-notes.js';
import { preparerImportReleve } from '../js/remplissage.js';
import { parcoursDe, semestresDe, nomAnnee, creerSemestresAnnee } from '../js/choix-annee.js';

function fabriqueIds() {
  let compteur = 0;
  return () => `t${++compteur}`;
}

// Une ligne d'un semestre, par son code.
function ligne(semestre, code) {
  const trouvee = semestre.elements.find((element) => element.code === code);
  assert.ok(trouvee, `ligne ${code} absente`);
  return trouvee;
}

// Les coefficients d'une ligne, avec le CODE des UE : { 'UE4.3': '10' }.
function coefsParCode(semestre, numero, element) {
  return Object.fromEntries(
    Object.entries(element.coefs).map(([id, coef]) => [codeUe(numero, semestre.ues.find((ue) => ue.id === id).numero), coef]),
  );
}

describe('choix de l’année et du parcours', () => {
  test('parcours proposés : tronc commun en 1re année, DACS et RA ensuite', () => {
    assert.deepEqual(parcoursDe(referentiel, 1), ['commun']);
    assert.deepEqual(parcoursDe(referentiel, 2), ['DACS', 'RA']);
    assert.deepEqual(parcoursDe(referentiel, 3), ['DACS', 'RA']);
    assert.deepEqual(parcoursDe(referentiel, 4), []);
  });

  test('semestres et nom d’une année', () => {
    assert.deepEqual([1, 2, 3].map(semestresDe), [[1, 2], [3, 4], [5, 6]]);
    assert.deepEqual([1, 2, 3].map(nomAnnee), ['1re', '2e', '3e']);
  });

  test('2e année DACS : S3 et S4, avec leurs UE, leurs lignes et leurs coefficients, sans aucune note', () => {
    const semestres = creerSemestresAnnee(referentiel, 2, 'DACS', fabriqueIds());
    assert.deepEqual(Object.keys(semestres), ['3', '4']);
    const s4 = semestres[4];
    assert.deepEqual(s4.ues.map((ue) => ue.numero), [1, 2, 3, 4, 5, 6]);

    // La ressource de parcours porte le code du relevé, et garde l'autre en alias.
    const virtualisation = ligne(s4, 'R4.B.08');
    assert.deepEqual(virtualisation.alias, ['R4.08']);
    assert.equal(virtualisation.intitule, 'Virtualisation');
    assert.deepEqual(coefsParCode(s4, 4, virtualisation), { 'UE4.3': '10' });

    // Aucune note, aucun malus.
    for (const semestre of Object.values(semestres)) {
      assert.equal(semestre.malus, '');
      assert.ok(semestre.elements.every((element) => element.evaluations.length === 0));
    }
    // Le portfolio du S3 n'a aucun coefficient : il n'est pas créé.
    assert.ok(!semestres[3].elements.some((element) => element.code === 'S3.PF'));
  });

  test('3e année : les UE du parcours (DACS 1, 3, 6 ; RA 1, 2, 6)', () => {
    const dacs = creerSemestresAnnee(referentiel, 3, 'DACS', fabriqueIds());
    const ra = creerSemestresAnnee(referentiel, 3, 'RA', fabriqueIds());
    assert.deepEqual(dacs[5].ues.map((ue) => ue.numero), [1, 3, 6]);
    assert.deepEqual(ra[5].ues.map((ue) => ue.numero), [1, 2, 6]);
    assert.ok(dacs[5].elements.some((element) => element.code === 'R5.B.01'));
    assert.ok(ra[5].elements.some((element) => element.code === 'R5.A.01'));
  });

  test('chaque UE créée totalise 100 (pôle SAE + pôle ressources)', () => {
    for (const annee of [1, 2, 3]) {
      for (const parcours of parcoursDe(referentiel, annee)) {
        for (const [numero, semestre] of Object.entries(creerSemestresAnnee(referentiel, annee, parcours, fabriqueIds()))) {
          for (const ue of semestre.ues) {
            const total = semestre.elements.reduce((cumul, element) => cumul + Number(element.coefs[ue.id] ?? 0), 0);
            assert.equal(total, 100, `${annee} ${parcours} S${numero} UE${numero}.${ue.numero}`);
          }
        }
      }
    }
  });

  test('ne dépend pas de la saisie : deux choix identiques donnent les mêmes semestres', () => {
    assert.deepEqual(
      creerSemestresAnnee(referentiel, 1, 'commun', fabriqueIds()),
      creerSemestresAnnee(referentiel, 1, 'commun', fabriqueIds()),
    );
  });

  test('année ou parcours inconnu : erreur claire', () => {
    assert.throws(() => creerSemestresAnnee(referentiel, 1, 'DACS', fabriqueIds()), /1re année, parcours DACS/);
  });

  test('ensuite, le relevé inventé rattache ses notes de R4.B.10 à la ligne du référentiel', () => {
    const ids = fabriqueIds();
    const saisie = { 1: creerSemestre(), 2: creerSemestre(), 5: creerSemestre(), 6: creerSemestre() };
    Object.assign(saisie, creerSemestresAnnee(referentiel, 2, 'DACS', ids));
    const releve = importerNotes(JSON.parse(readFileSync(new URL('fixtures/releve-but2.json', import.meta.url), 'utf8')));
    const s4 = preparerImportReleve(saisie, releve, ids).semestres[4];
    const r4b10 = s4.elements.filter((element) => element.code === 'R4.B.10');
    assert.equal(r4b10.length, 1);
    assert.deepEqual(
      r4b10[0].evaluations.map((e) => [e.libelle, e.note, e.coef]),
      [['TP - coef 1,5', '16', '1,5']],
    );
    assert.deepEqual(coefsParCode(s4, 4, r4b10[0]), { 'UE4.2': '11', 'UE4.3': '4', 'UE4.4': '7' });
  });
});
