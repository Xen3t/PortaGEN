# PortaGEN V2

Portail de génération de MES (mises en situation produit) pour CASANOOV et CAZEBOO,
piloté par Nano Banana Pro. Destiné au Pôle Média HoorTrade.

Deux familles de MES : **contraintes** (pipeline Décor → Piliers & murets → Intégration produit,
avec effet catalogue garanti) et **libres** (formulaire → génération directe).
Priorité actuelle : portails battants (18 tailles).

📄 Documents de référence :

- [docs/CADRAGE-2026-07-08.md](docs/CADRAGE-2026-07-08.md) — décisions, diagnostic dimensionnel, architecture
- [docs/JOURNAL.md](docs/JOURNAL.md) — avancement jour par jour
- [Brief/Portagen positionnement stratégique.md](Brief/Portagen%20positionnement%20stratégique.md) — cahier des charges hiérarchie

## Prérequis

- Node.js >= 20
- Une clé API Google Gemini (génération d'images + rôles LLM)

## Installation

```bash
npm install
copy .env.example .env.local   # puis renseigner GEMINI_API_KEY
```

## Utilisation (poste de pilotage)

```bash
npm run dev        # puis ouvrir http://localhost:3302
```

Connexion : compte `admin` créé automatiquement au premier démarrage — mot de passe dans
`data/admin-initial-password.txt` (local, non commité). Deux rôles : **admin** (prompts
versionnés, coûts, comptes) et **utilisateur** (générer, valider/régénérer).

Écrans : **Génération** (décors, curseurs de gabarits avec aperçu live, tailles, lancement),
**Suivi & validation** (visionneuse des 4 étapes, Valider/Rejeter/Régénérer avec compteur),
**Admin** (Prompts, Coûts, Utilisateurs).

## Tests

```bash
npm test
```

## Scripts outils

| Commande | Rôle |
| --- | --- |
| `npm run smoke:gemini` | Vérifie la clé et la chaîne complète (1 appel texte + 1 image 1K) |
| `npm run lab` | Calibration dimensionnelle Nano Banana (formats natifs, décalage trottoir) |
| `npm run decor` | Étape Décor de bout en bout (moodboard → prompt → décor natif) |
| `npx tsx scripts/preview-gabarit.ts` | Superpose les aplats d'une taille sur un décor (entrée de l'étape Piliers) |
| `npx tsx scripts/run-pillars-smoke.ts` | Essai de l'étape Piliers (sans compositing, J2) |
| `npx tsx scripts/measure-offset.ts` | Re-mesure le décalage trottoir d'une image déjà générée (0 appel API) |

Les artefacts (images, prompts, masques, rapports) sont écrits sous `data/` (non versionné) ;
chaque appel API est journalisé en base SQLite (`data/portagen.db`, table `api_calls`).

## Structure

```text
src/lib/geometry/   Gabarits en cm → pixels (portage testé du mockup Assets/mockup-gabarits.html)
src/lib/images/     sharp : aplats, masques, analyse trottoir, redimensionnements
src/lib/genai/      Client Gemini (génération, retries, journalisation coûts)
src/lib/pipeline/   Étapes du pipeline MES Contraintes + formats natifs calibrés
src/lib/db/         SQLite : tailles, jobs, appels API
scripts/            Outils CLI (lab, decor, smoke…)
tests/unit/         Vitest — la géométrie et les gabarits sont couverts
```

## Déploiement

Prévu ultérieurement (phase locale pour le moment). Procédure : voir `baseDocs/DEPLOYMENT.md`
(source unique de vérité — port réservé : **3302**).
