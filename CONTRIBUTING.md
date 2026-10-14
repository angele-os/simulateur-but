# Contribuer

## Règles de base

- **Aucune vraie donnée.** Pas de vrai relevé, de vraie note ni de vrai nom dans le dépôt, les tests ou les messages de commit. Les fixtures de `tests/fixtures/` sont inventées. La CI échoue si un PDF est suivi par Git ailleurs que dans `tests/fixtures/`, ou si un fichier de `prive/` l'est.
- **Tests.** `npm test` doit passer. Les fichiers de logique (`js/calcul.js`, `js/import-*.js`, `js/remplissage.js`, `js/modele.js`, `js/edition.js`, `js/choix-annee.js`) sont des fonctions pures, testées avec `node:test`.
- **Commits** au format Conventional Commits : `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`.
- **Sécurité** : voir [SECURITY.md](SECURITY.md).

## Quand Dependabot propose une nouvelle version de pdfjs-dist

La page ne charge pas pdf.js depuis `node_modules/` : elle sert ses propres copies, dans `vendor/pdfjs/`. Dependabot ne met à jour que `package.json` et `package-lock.json`. Le test `tests/vendor-pdfjs.test.js` compare les deux versions : **il échoue sur la pull request tant que `vendor/pdfjs/` n'est pas recopié.** C'est voulu, sinon le site servirait encore l'ancienne version.

Sur la branche de la pull request :

1. **Lis les notes de version** de pdf.js, en particulier les avis de sécurité et les changements de l'API (`getDocument`, `PDFWorker`, `getTextContent`).
2. **Récupère la branche** de la pull request, par exemple avec `gh pr checkout <numéro>`.
3. **Installe** exactement les versions du lockfile, puis **recopie** pdf.js :
   ```sh
   npm ci
   npm run vendor
   ```
   `vendor/pdfjs/pdf.min.mjs`, `pdf.worker.min.mjs` et `LICENSE` sont remplacés.
4. **Vérifie** :
   ```sh
   npm test
   npm audit --audit-level=high
   ```
   Puis ouvre l'app dans un navigateur et importe un relevé : pas d'erreur dans la console (CSP, Trusted Types), et un worker `pdf.worker.min.mjs` qui apparaît pendant la lecture.
5. **Committe** `vendor/pdfjs/` sur la même branche (par exemple `chore(deps): copier pdf.js x.y.z dans vendor/`), puis pousse. La CI repasse au vert, et la pull request peut être fusionnée.

Une fois que tu as poussé un commit sur sa branche, Dependabot ne met plus cette pull request à jour tout seul. Si `main` a changé entre-temps, mets la branche à jour toi-même.

## Quand Dependabot propose une nouvelle version d'une action GitHub

Il met à jour l'empreinte SHA et le commentaire `# vX.Y.Z` dans `.github/workflows/`. Lis les notes de version de l'action, vérifie que la CI passe, puis fusionne.
