// Test de démarrage : il vérifie seulement que node:test fonctionne.
// Il sera remplacé par les vrais tests de js/calcul.js et des imports.

// On importe les outils de test fournis avec Node (aucune dépendance à installer).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('la mise en place des tests fonctionne', () => {
  // assert.equal(valeur obtenue, valeur attendue) : le test échoue si elles diffèrent.
  assert.equal(1 + 1, 2);
});
