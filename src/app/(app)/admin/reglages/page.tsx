'use client'

import { useEffect, useRef, useState } from 'react'
import GabaritsManager from '@/components/GabaritsManager'
import PromptEditor from '@/components/PromptEditor'
import RalifySection from '@/components/RalifySection'
import ReglagesApp, { type AppRubrique } from '@/components/ReglagesApp'
import ResetApp from '@/components/ResetApp'
import type { MoteurKey, MoteurReglages } from '@/lib/moteurs'
import {
  cadrageDaEffectif,
  type CadrageDaReglages,
  type CouleursPlan,
} from '@/lib/cadrageDa'
import { computeLayout, projection, DEFAULT_PARAMS } from '@/lib/geometry'
import { taillesMesEffectives, type TailleMes } from '@/lib/taillesMes'
import { ralCodeDepuisHex, ralHexDepuisCode } from '@/lib/ralify'

/**
 * Admin → Réglages — « affichage complet » (maquette reglages-full-v1 validée
 * par Mathias le 29/07/2026). On garde l'arborescence de la proposition C
 * (28/07) à gauche — Application, moteurs avec leurs rubriques dépliées dessous,
 * Système — mais le panneau de droite n'affiche plus UNE rubrique à la fois : il
 * EMPILE toutes les rubriques du contexte choisi (l'Application, ou le moteur
 * sélectionné) et l'arborescence sert de SIGNETS cliquables qui font défiler
 * jusqu'au bon bloc (scroll-spy pour surligner celui qu'on regarde). Un bandeau
 * de contexte collant garde le rappel du moteur et l'Enregistrer à portée.
 *
 * Un moteur par type de produit ; ses rubriques regroupent toutes ses
 * technologies : détection & coloris, RALify, gabarits, Canny, Prompt System,
 * export. La fiche TERMINUS ajoute les rubriques Gabarits XL et Canny XL.
 */

/**
 * Séparation totale (05/08/2026, bascule « décor autour ») : la liste sert les
 * DEUX générations de moteurs — legacy (battant/coulissant/portillon, méthode
 * Canny+piliers+pose-fusion, affichés « (legacy) ») et décor autour
 * (janus/terminus/forculus). Clés DA redéclarées localement : le registre
 * serveur (src/lib/moteursDa.ts) tire better-sqlite3, interdit au bundle client.
 */
type MoteurDaKey = 'janus' | 'terminus' | 'forculus'
type AnyMoteurKey = MoteurKey | MoteurDaKey
const DA_KEYS: readonly string[] = ['janus', 'terminus', 'forculus']
const isDaKey = (k: string): k is MoteurDaKey => DA_KEYS.includes(k)
/** Homologue legacy d'un moteur décor autour (aperçus RALify : mêmes produits). */
const DA_TO_LEGACY: Record<MoteurDaKey, MoteurKey> = {
  janus: 'battant',
  terminus: 'coulissant',
  forculus: 'portillon',
}

interface MoteurEntry {
  key: AnyMoteurKey
  label: string
  /** Nom de code (ex. Battant = « JANUS », baptisé le 13/07/2026). */
  codeName?: string
  status: 'actif' | 'preparation'
  productCount: number
  /** Famille d'affichage (héritée de l'API — non affichée depuis la refonte C). */
  famille: string
  /** Génération du moteur : legacy ou décor autour (absent = legacy). */
  methode?: 'legacy' | 'decor-autour'
}

/**
 * Les 3 moteurs décor autour, connus d'avance : ils remplissent la nav DÈS le
 * premier rendu (retour Mathias 08/08 : la section « Moteurs » vide pendant le
 * chargement était perturbante). L'API /api/moteurs rafraîchit ensuite
 * (productCount réel, moteurs en préparation éventuels).
 */
const MOTEURS_INITIAUX: MoteurEntry[] = [
  { key: 'janus', label: 'Battant', codeName: 'JANUS', status: 'actif', productCount: 0, famille: 'Portails', methode: 'decor-autour' },
  { key: 'terminus', label: 'Coulissant', codeName: 'TERMINUS', status: 'actif', productCount: 0, famille: 'Portails', methode: 'decor-autour' },
  { key: 'forculus', label: 'Portillon', codeName: 'FORCULUS', status: 'actif', productCount: 0, famille: 'Portails', methode: 'decor-autour' },
]

interface PromptMeta {
  name: string
  version: number
  /** Date (SQLite UTC) et auteur de la version active — affichés sur la ligne fermée. */
  updated: string
  updatedBy: string | null
}

/**
 * Prompts d'UN moteur, rangés par étape de génération. Les noms sont les noms
 * de BASE (ceux du battant) : pour les autres moteurs ils sont préfixés au
 * rendu (« portillon-… ») et les libellés emploient le mot du produit
 * (« Intégration du portillon », pas « du portail »).
 */
const PROMPTS_DECOR: { name: string; label: string; exact?: boolean }[] = [
  { name: 'moodboard-llm', label: 'Analyse moodboard' },
  { name: 'decor-architecture', label: 'Architecture du décor' },
  { name: 'decor-couloir', label: 'Contrainte du couloir' },
]
// Fiche TERMINUS uniquement : l'analyse moodboard des décors XL (caméra reculée,
// allée 6 m) — nom EXACT, hors du préfixage par moteur (jeu « coulissant-xl »).
const PROMPTS_DECOR_COULISSANT: typeof PROMPTS_DECOR = [
  ...PROMPTS_DECOR,
  { name: 'coulissant-xl-moodboard-llm', label: 'Analyse moodboard — décors XL', exact: true },
]
const PROMPTS_PILIERS: { name: string; label: string }[] = [
  { name: 'piliers-murets', label: 'Rendu stucco piliers & murets' },
]
const PROMPTS_MARKETPLACE: { name: string; label: string }[] = [
  { name: 'marketplace-extension', label: 'Extension des bords (outpainting Nano)' },
]
const promptsIntegration = (produit: string): { name: string; label: string }[] => [
  { name: 'pose-fusion', label: `Pose + fusion du ${produit} (stuc + lumière, produit déjà posé)` },
  { name: 'integration-simple', label: `Intégration du ${produit} (méthode simple)` },
  { name: 'integration', label: `Intégration du ${produit} (méthode verrouillée)` },
]

/** Datetime SQLite (UTC sans suffixe) → « JJ/MM » local, pour les lignes de prompt. */
function fmtDbDate(s: string): string {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Mot du produit d'un moteur — pour tous les libellés de la page. */
const PRODUIT_PAR_MOTEUR: Record<MoteurKey, string> = {
  battant: 'portail',
  coulissant: 'portail',
  portillon: 'portillon',
}

/** Coloris de la palette (origine + ajoutés depuis cette page), servis par /api/coloris. */
interface ColorisEntry {
  key: string
  label: string
  ral: string | null
  swatch: string
  custom: boolean
}

/** Image Canny active du moteur (personnalisée ou d'origine), servie par l'API. */
interface CannyInfo {
  custom: boolean
  relPath: string
  width: number | null
  height: number | null
  version: number
}

/* ===== Arborescence (proposition C) : la sélection désigne UNE rubrique ===== */

/** Rubriques de la fiche moteur — les « XL » n'existent que sur TERMINUS. */
type MoteurRubrique =
  | 'detection'
  | 'ralify'
  | 'cadrage'
  | 'tailles'
  | 'gabarits'
  | 'gabarits-xl'
  | 'canny'
  | 'canny-xl'
  | 'prompts'
  | 'export'

/** Ancre (id du bloc) d'une rubrique — sert de cible aux signets et au scroll-spy. */
const APP_ANCHOR = (rub: AppRubrique) => `app-${rub}`
const MOTEUR_ANCHOR = (rub: MoteurRubrique) => `m-${rub}`

const APP_RUBRIQUES: { rub: AppRubrique; label: string }[] = [
  { rub: 'generations', label: 'Générations & modèle' },
  // Décors des MES Contrainte (08/08) : même bibliothèque que la modale
  // « Gérer les décors » de la page — tout réglage reste pilotable en admin.
  { rub: 'decors', label: 'Décors' },
  { rub: 'marquage', label: 'Marquage IA' },
  { rub: 'serveur', label: 'Serveur de fichiers' },
]

const MOTEUR_RUBRIQUES: { rub: MoteurRubrique; label: string; xl?: boolean }[] = [
  { rub: 'detection', label: 'Détection & coloris' },
  { rub: 'ralify', label: 'RALify' },
  // Fiche décor autour seulement (07/08 soir) : le resizing/la scène sous UI.
  { rub: 'cadrage', label: 'Cadrage' },
  // Fiche décor autour seulement (20/08) : le tableau croisé des tailles.
  { rub: 'tailles', label: 'Tailles' },
  { rub: 'gabarits', label: 'Gabarits' },
  { rub: 'gabarits-xl', label: 'Gabarits XL', xl: true },
  { rub: 'canny', label: 'Canny' },
  { rub: 'canny-xl', label: 'Canny XL', xl: true },
  { rub: 'prompts', label: 'Prompt System' },
  { rub: 'export', label: 'Export' },
]

/**
 * APERÇU LIVE du cadrage (demande Mathias 07/08 soir : « une vraie preview ») :
 * reconstruit le plan gris à l'écran avec la MÊME géométrie que le serveur
 * (computeLayout → projection, logique de construirePlanGris) — bandes de sol,
 * murets, piliers, chapeaux, rail et rectangle du produit, aux couleurs et
 * réglages COURANTS (non enregistrés compris). Le rectangle sombre figure le
 * produit posé.
 */
/**
 * Géométrie d'un aperçu — MÊME logique que la pose serveur : gabarit du moteur
 * (bascule XL comprise) + échelle produit appliquée DANS la géométrie (un
 * produit agrandi écarte ses piliers, tout se recompose autour). Sert à
 * l'affichage ET au scan des alertes hors-cadre.
 */
function apercuLayout(
  moteur: 'janus' | 'terminus' | 'forculus',
  cadrage: CadrageDaReglages,
  taille: { w: number; h: number }
) {
  const terminus = moteur === 'terminus'
  // Règle RATIO (20/08) : vraie largeur + fenêtre de scène ∝ largeur — même
  // logique que bancCadrage. La bascule XL ne joue plus quand elle est active.
  const ratio = cadrage.ratioActif && cadrage.refWidthCm !== null
  const xl = terminus && !ratio && taille.w >= cadrage.xlMinW
  const gab: Record<string, number> = {}
  if (ratio) {
    const f = taille.w / (cadrage.refWidthCm as number)
    // % d'image → fenêtre de scène en cm (même conversion que bancCadrage).
    const sceneHRef =
      ((cadrage.refWidthCm as number) * 100) / cadrage.ratioPortailPct / DEFAULT_PARAMS.mesAspect
    gab.sceneH = sceneHRef * f
    gab.groundY = sceneHRef * (cadrage.ratioSolPct / 100) * f
    // Pas de zoom en règle ratio : « Portail dans l'image (%) » est la seule
    // vérité du cadrage (le zoom en faisait doublon).
    if (cadrage.offsetX !== 0) gab.offsetX = cadrage.offsetX * f
    if (cadrage.offsetY !== 0) gab.offsetY = cadrage.offsetY * f
    if (cadrage.pillarHMax !== null) gab.pillarHMax = cadrage.pillarHMax
  } else if (xl) {
    gab.sceneH = cadrage.xlSceneH
    gab.groundY = cadrage.xlGroundY
    if (cadrage.xlZoom !== 100) gab.zoom = cadrage.xlZoom
  } else {
    if (cadrage.zoom !== 100) gab.zoom = cadrage.zoom
    if (cadrage.offsetX !== 0) gab.offsetX = cadrage.offsetX
    if (cadrage.offsetY !== 0) gab.offsetY = cadrage.offsetY
    if (cadrage.pillarHMax !== null) gab.pillarHMax = cadrage.pillarHMax
  }
  const echL = cadrage.produitLargeurPct / 100
  const echH = cadrage.produitHauteurPct / 100
  const tailleEff = {
    w: Math.max(1, Math.round(taille.w * echL)),
    h: Math.max(1, Math.round(taille.h * echH)),
  }
  const refWidth = ratio ? null : xl ? cadrage.xlRefWidthCm : cadrage.refWidthCm
  const refWidthEff = refWidth !== null ? Math.max(1, Math.round(refWidth * echL)) : null
  const layout = computeLayout(tailleEff, {
    ...gab,
    ...(refWidthEff !== null ? { refWidth: refWidthEff } : {}),
  })
  return { layout, xl, terminus }
}

/**
 * Scan hors-cadre (07/08 soir, demande Mathias) : pour CHAQUE hauteur standard,
 * signale un pilier qui sort du cadre (latéralement ou entièrement) ou un
 * portail qui déborde de la scène — affiché en rouge sous l'aperçu.
 */
function alertesCadrage(
  moteur: 'janus' | 'terminus' | 'forculus',
  cadrage: CadrageDaReglages
): { pilier: string[]; portail: string[] } {
  // Règle ratio : le cadrage dépend de la largeur — on scanne les deux bornes
  // de la famille (le 300 est le plus serré, la plus grande largeur la plus
  // dézoomée). Ancienne règle : largeurs représentatives historiques.
  const ratio = cadrage.ratioActif && cadrage.refWidthCm !== null
  const largeurs = ratio
    ? moteur === 'terminus'
      ? [
          { w: 300, tag: ' (L300)' },
          { w: 600, tag: ' (L600)' },
        ]
      : [
          { w: 300, tag: ' (L300)' },
          { w: 400, tag: ' (L400)' },
        ]
    : moteur === 'terminus'
      ? [
          { w: 350, tag: '' },
          { w: 500, tag: ' XL' },
        ]
      : [{ w: moteur === 'forculus' ? 100 : 350, tag: '' }]
  const pilier: string[] = []
  const portail: string[] = []
  for (const { w, tag } of largeurs) {
    for (const h of APERCU_HAUTEURS) {
      const { layout } = apercuLayout(moteur, cadrage, { w, h })
      const sort = (r: { w: number; h: number; lossX: number } | null | undefined) =>
        !!r && (r.lossX > 0 || r.w <= 0 || r.h <= 0)
      if (sort(layout.pillarLeft) || sort(layout.pillarRight)) pilier.push(`H${h}${tag}`)
      if (
        layout.gateLeft < 0 ||
        layout.gateTop < 0 ||
        layout.gateLeft + layout.gateW > layout.sceneW
      ) {
        portail.push(`H${h}${tag}`)
      }
    }
  }
  return { pilier, portail }
}

function ApercuScene({
  moteur,
  cadrage,
  taille,
  onPart,
}: {
  moteur: 'janus' | 'terminus' | 'forculus'
  cadrage: CadrageDaReglages
  taille: { w: number; h: number }
  /** Clic sur une partie dessinée (édition des couleurs À MÊME l'aperçu, 07/08 soir). */
  onPart?: (part: keyof CouleursPlan, e: React.MouseEvent) => void
}) {
  const { layout, terminus } = apercuLayout(moteur, cadrage, taille)

  // Même ratio que la livraison (2000 × 1330).
  const W = 600
  const H = 399
  const proj = projection(W, H, layout.sceneW, layout.sceneH, 'stretch')
  /** Projection SANS arrondi (08/08, bug vu par Mathias) : projectRect arrondit
   *  chaque rect séparément → à 600 px de large, portail/murets/rail pouvaient
   *  se décaler de 1-2 px entre eux. Le SVG accepte les décimales : tout reste
   *  calé sur la même ligne de sol, comme le vrai plan. */
  const P = (r: { x: number; y: number; w: number; h: number }) => ({
    x: r.x * proj.sx,
    y: r.y * proj.sy,
    w: r.w * proj.sx,
    h: r.h * proj.sy,
  })
  const gate = P({ x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH })
  const coul = cadrage.couleurs
  const g = { x: gate.x, y: gate.y, w: gate.w, h: gate.h }
  const yG = gate.y + gate.h
  // COULISSANT (08/08) : le rail est l'ORIGINE — posé sur la ligne de sol, la
  // lame monte de sa hauteur pour rouler dessus (comme à la pose serveur).
  const railH = terminus && cadrage.bandesSol ? Math.max(2, proj.sy * 2) : 0
  if (railH > 0) g.y -= railH
  // Coulissant : la lame s'engage sous le pilier droit (comme à la pose).
  let gateW = g.w
  if (terminus) {
    const pr = P(layout.pillarRight)
    const eng = Math.min(W, pr.x + Math.min(pr.w, cadrage.recouvrementCm * proj.sx))
    gateW = Math.max(g.w, eng - g.x)
  }
  const hBelow = H - yG
  const hTrottoir = Math.round(hBelow * 0.45)
  const hBordure = Math.max(2, Math.round(hBelow * 0.08))

  /** Rect cliquable : chaque partie ouvre son menu couleur (07/08 soir). */
  const clicProps = (part: keyof CouleursPlan) =>
    onPart
      ? {
          onClick: (e: React.MouseEvent) => onPart(part, e),
          className: 'cursor-pointer hover:opacity-80 transition-opacity',
        }
      : {}

  const aplat = (
    r: { x: number; y: number; w: number; h: number } | null | undefined,
    fill: string,
    key: string,
    part: keyof CouleursPlan
  ) => {
    if (!r) return null
    const p = P(r)
    if (p.w <= 0 || p.h <= 0) return null
    return (
      <rect key={key} x={p.x} y={p.y} width={p.w} height={p.h} fill={fill} {...clicProps(part)} />
    )
  }

  const avant: (React.ReactElement | null)[] = []
  const apres: (React.ReactElement | null)[] = []
  if (cadrage.bandesSol) {
    if (hBelow > 7) {
      avant.push(
        <rect
          key="trottoir"
          x={0}
          y={yG}
          width={W}
          height={hTrottoir}
          fill={coul.trottoir}
          {...clicProps('trottoir')}
        />,
        <rect
          key="bordure"
          x={0}
          y={yG + hTrottoir}
          width={W}
          height={hBordure}
          fill={coul.bordure}
          {...clicProps('bordure')}
        />,
        <rect
          key="route"
          x={0}
          y={yG + hTrottoir + hBordure}
          width={W}
          height={hBelow - hTrottoir - hBordure}
          fill={coul.route}
          {...clicProps('route')}
        />
      )
      if (terminus && railH > 0) {
        const pr = P(layout.pillarRight)
        const railW = Math.max(0, pr.x + pr.w - g.x)
        if (railW > 0) {
          avant.push(
            <rect
              key="rail"
              x={g.x}
              y={yG - railH}
              width={railW}
              height={railH}
              fill={coul.rail}
              {...clicProps('rail')}
            />
          )
        }
      }
    }
    avant.push(aplat(layout.muretLeft, coul.muret, 'muretL', 'muret'))
    ;(terminus ? apres : avant).push(aplat(layout.muretRight, coul.muret, 'muretR', 'muret'))
    avant.push(aplat(layout.pillarLeft, coul.pilier, 'pilierL', 'pilier'))
    ;(terminus ? apres : avant).push(aplat(layout.pillarRight, coul.pilier, 'pilierR', 'pilier'))
    avant.push(aplat(layout.capLeft?.bbox, coul.chapeau, 'chapL', 'chapeau'))
    ;(terminus ? apres : avant).push(aplat(layout.capRight?.bbox, coul.chapeau, 'chapR', 'chapeau'))
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-[10px] border border-border bg-white"
    >
      <rect x={0} y={0} width={W} height={H} fill="#c8c8c8" />
      {avant}
      {/* Le produit posé (vraie empreinte du resizing, échelle produit
          comprise). Teinte BLEUTÉE claire (08/08) : l'ancien gris sombre se
          confondait avec le rail. Liseré blanc RETIRÉ (retour Mathias 08/08). */}
      <rect x={g.x} y={g.y} width={gateW} height={g.h} fill="#6b7684" />
      {apres}
      {/* Coulissant : le RECOUVREMENT (lame cachée sous le pilier droit) montré
          en transparence PAR-DESSUS le pilier — sinon invisible par définition
          (retour Mathias 08/08). */}
      {terminus &&
        (() => {
          const pr = P(layout.pillarRight)
          const fin = Math.min(W, pr.x + Math.min(pr.w, cadrage.recouvrementCm * proj.sx))
          if (fin <= pr.x) return null
          return (
            <rect
              x={pr.x}
              y={g.y}
              width={fin - pr.x}
              height={g.h}
              fill="#6b7684"
              opacity={0.4}
            />
          )
        })()}
    </svg>
  )
}

/** Hauteurs standard proposées par le sélecteur discret de l'aperçu. */
const APERCU_HAUTEURS = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200]

/** Libellés des parties cliquables de l'aperçu. */
const PARTIES_PLAN: Record<keyof CouleursPlan, string> = {
  pilier: 'Piliers',
  chapeau: 'Chapeaux',
  muret: 'Murets',
  trottoir: 'Trottoir',
  bordure: 'Bordure',
  route: 'Route',
  rail: 'Rail',
}

/**
 * Petit menu couleur ouvert au CLIC sur une partie de l'aperçu (07/08 soir,
 * demande Mathias) : même logique que RALify — on tape un code RAL, la pastille
 * suit ; le sélecteur libre reste pour les teintes hors RAL.
 */
function CouleurMenu({
  part,
  hex,
  onHex,
  onClose,
}: {
  part: keyof CouleursPlan
  hex: string
  onHex: (hex: string) => void
  onClose: () => void
}) {
  const [texte, setTexte] = useState(() => ralCodeDepuisHex(hex) ?? '')
  useEffect(() => {
    setTexte(ralCodeDepuisHex(hex) ?? '')
  }, [hex, part])
  const inconnu = texte.trim() !== '' && ralHexDepuisCode(texte) === null
  return (
    <div
      className="w-[190px] bg-white border border-border rounded-[10px] shadow-lg p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
          style={{ background: hex }}
        />
        <b className="text-[13px] flex-1">{PARTIES_PLAN[part]}</b>
        <button
          type="button"
          onClick={onClose}
          className="text-text-disabled hover:text-text-primary text-sm leading-none"
          title="Fermer"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-text-secondary">RAL</span>
        <input
          type="text"
          inputMode="numeric"
          value={texte}
          maxLength={4}
          placeholder="7016"
          autoFocus
          onChange={(e) => {
            const t = e.target.value
            setTexte(t)
            const h = ralHexDepuisCode(t)
            if (h) onHex(h)
          }}
          title="Code RAL — la couleur suit automatiquement"
          className="w-16 border border-border bg-white rounded-[8px] px-2 py-1.5 text-sm font-mono tabular-nums focus:outline-none focus:border-brand-green transition-colors"
        />
        {inconnu && (
          <span title="Code RAL inconnu de la table" className="text-amber-700 text-xs font-bold">
            ?
          </span>
        )}
        <input
          type="color"
          value={hex}
          onChange={(e) => onHex(e.target.value)}
          title="Couleur libre"
          className="ml-auto w-9 h-8 border border-border rounded-[6px] bg-white cursor-pointer"
        />
      </div>
    </div>
  )
}

/** L'aperçu se débrouille SEUL : largeur représentative par moteur — pour le
 *  coulissant les DEUX scènes, standard et XL, côte à côte. La hauteur se
 *  choisit PRÉCISÉMENT via un petit sélecteur discret en bas à droite de
 *  l'image (retour Mathias 07/08 soir). */
function ApercuCadrage({
  moteur,
  cadrage,
  vueXl = false,
  hauteurs,
  largeurs,
  onCouleur,
}: {
  moteur: 'janus' | 'terminus' | 'forculus'
  cadrage: CadrageDaReglages
  /** COULISSANT : true = la vue XL est affichée (commutateur de la carte). */
  vueXl?: boolean
  /** Hauteurs proposées au sélecteur (21/08) : celles du TABLEAU DES TAILLES
   *  du moteur — plus de liste figée H100-H200 quand la liste existe. */
  hauteurs?: number[]
  /** Largeurs proposées au sélecteur (21/08, demande Mathias) : celles du
   *  tableau des tailles — absentes = largeur représentative historique. */
  largeurs?: number[]
  /** Édition d'une couleur au clic sur l'aperçu (07/08 soir). */
  onCouleur?: (part: keyof CouleursPlan, hex: string) => void
}) {
  const choixHauteurs = hauteurs && hauteurs.length > 0 ? hauteurs : APERCU_HAUTEURS
  const cleHauteurs = choixHauteurs.join('-')
  const [h, setH] = useState(160)
  useEffect(() => {
    const defaut = moteur === 'forculus' ? 140 : 160
    setH(
      choixHauteurs.includes(defaut)
        ? defaut
        : choixHauteurs[Math.floor(choixHauteurs.length / 2)]
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moteur, cleHauteurs])
  const choixLargeurs = largeurs && largeurs.length > 0 ? largeurs : null
  const cleLargeurs = (choixLargeurs ?? []).join('-')
  const [w, setW] = useState(350)
  useEffect(() => {
    if (!choixLargeurs) return
    const defaut = moteur === 'forculus' ? 100 : 350
    setW(
      choixLargeurs.includes(defaut)
        ? defaut
        : choixLargeurs[Math.floor(choixLargeurs.length / 2)]
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moteur, cleLargeurs])

  // Menu couleur : ouvert au clic sur une partie, positionné près du clic
  // (coordonnées relatives au conteneur de l'aperçu).
  const boxRef = useRef<HTMLDivElement>(null)
  const [edit, setEdit] = useState<{ part: keyof CouleursPlan; x: number; y: number } | null>(null)
  useEffect(() => {
    setEdit(null)
  }, [moteur])
  const ouvrirMenu = onCouleur
    ? (part: keyof CouleursPlan, e: React.MouseEvent) => {
        const r = boxRef.current?.getBoundingClientRect()
        if (!r) return
        setEdit({
          part,
          x: Math.max(0, Math.min(e.clientX - r.left + 8, r.width - 200)),
          y: Math.max(0, e.clientY - r.top + 8),
        })
      }
    : undefined

  const menu = edit && onCouleur && (
    <div className="absolute z-20" style={{ left: edit.x, top: edit.y }}>
      <CouleurMenu
        part={edit.part}
        hex={cadrage.couleurs[edit.part]}
        onHex={(hex) => onCouleur(edit.part, hex)}
        onClose={() => setEdit(null)}
      />
    </div>
  )

  // Alerte ROUGE sous l'aperçu quand un réglage sort quelque chose du cadre,
  // avec les hauteurs concernées (demande Mathias 07/08 soir).
  const alertes = alertesCadrage(moteur, cadrage)
  const blocAlertes = (alertes.pilier.length > 0 || alertes.portail.length > 0) && (
    <div className="mt-2 bg-brand-red-light text-brand-red text-xs font-bold rounded-[8px] px-3 py-2 space-y-0.5">
      {alertes.pilier.length > 0 && <p>⚠ Attention : pilier hors cadre en {alertes.pilier.join(', ')}</p>}
      {alertes.portail.length > 0 && (
        <p>⚠ Attention : portail hors cadre en {alertes.portail.join(', ')}</p>
      )}
    </div>
  )

  const classeSelecteur =
    'bg-white/55 border border-border/50 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary/70 cursor-pointer opacity-60 hover:opacity-100 hover:bg-white/90 transition-opacity focus:outline-none focus:border-brand-green'
  // Largeur ET hauteur de l'aperçu (21/08, demande Mathias) : les deux listes
  // viennent du tableau des tailles du moteur, côte à côte en bas à droite.
  const selecteur = (
    <div className="absolute bottom-1.5 right-1.5 flex gap-1">
      {choixLargeurs && !vueXl && (
        <select
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
          title="Largeur de l'aperçu (cm)"
          className={classeSelecteur}
        >
          {choixLargeurs.map((v) => (
            <option key={v} value={v}>
              L {v}
            </option>
          ))}
        </select>
      )}
      <select
        value={h}
        onChange={(e) => setH(Number(e.target.value))}
        title="Hauteur de l'aperçu (cm)"
        className={classeSelecteur}
      >
        {choixHauteurs.map((v) => (
          <option key={v} value={v}>
            H {v}
          </option>
        ))}
      </select>
    </div>
  )

  // Coulissant en ANCIENNE règle : la vue XL force sa largeur représentative
  // (commutateur Standard/XL). Sinon : largeur choisie dans la liste des
  // tailles quand elle existe, largeur représentative historique en repli.
  const largeurApercu = vueXl
    ? 500
    : choixLargeurs
      ? w
      : moteur === 'forculus'
        ? 100
        : 350
  return (
    <div className="max-w-[640px]">
      <div ref={boxRef} className="relative">
        <ApercuScene
          moteur={moteur}
          cadrage={cadrage}
          taille={{ w: largeurApercu, h }}
          onPart={ouvrirMenu}
        />
        {selecteur}
        {menu}
      </div>
      {blocAlertes}
    </div>
  )
}

/** Une taille sort-elle du cadre avec le cadrage courant ? (règle ratio
 *  seulement : avec l'ancienne règle le gabarit est unique, rien à contrôler). */
function tailleDeborde(
  moteur: 'janus' | 'terminus' | 'forculus',
  cadrage: CadrageDaReglages,
  t: TailleMes
): boolean {
  return (
    cadrage.ratioActif &&
    cadrage.refWidthCm !== null &&
    apercuLayout(moteur, cadrage, t).layout.isClamped
  )
}

/**
 * LISTE des tailles proposées en MES (20/08 soir, retour Mathias : « je veux
 * une liste de tailles, dedans j'ajoute/retire ; un tableau croisé en dessous
 * sur lequel on n'a pas d'impact ») : chips triées, retrait au ✕, ajout par
 * largeur + hauteur. Une chip passe en rouge si la taille sort du cadre avec
 * le cadrage actuel du moteur.
 */
function ListeTailles({
  moteur,
  cadrage,
  tailles,
  onChange,
}: {
  moteur: 'janus' | 'terminus' | 'forculus'
  cadrage: CadrageDaReglages
  tailles: TailleMes[]
  onChange: (tailles: TailleMes[]) => void
}) {
  const [saisieW, setSaisieW] = useState('')
  const [saisieH, setSaisieH] = useState('')
  useEffect(() => {
    setSaisieW('')
    setSaisieH('')
  }, [moteur])

  // Mêmes bornes que la validation serveur (sanitizeTaillesMes).
  const ajouter = () => {
    const w = Math.round(Number(saisieW))
    const h = Math.round(Number(saisieH))
    if (!Number.isFinite(w) || w < 50 || w > 1000) return
    if (!Number.isFinite(h) || h < 50 || h > 400) return
    if (tailles.some((t) => t.w === w && t.h === h)) return
    onChange([...tailles, { w, h }].sort((a, b) => a.w - b.w || a.h - b.h))
    setSaisieW('')
    setSaisieH('')
  }
  const retirer = (w: number, h: number) =>
    onChange(tailles.filter((t) => !(t.w === w && t.h === h)))

  const champ =
    'w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors'
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {tailles.map((t) => {
          const ko = tailleDeborde(moteur, cadrage, t)
          return (
            <span
              key={`${t.w}x${t.h}`}
              title={ko ? `${t.w}×${t.h} sort du cadre avec le cadrage actuel` : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold ${
                ko
                  ? 'bg-brand-red-light border-brand-red text-brand-red'
                  : 'bg-brand-green-light border-brand-green text-brand-green'
              }`}
            >
              {t.w}×{t.h}
              <button
                type="button"
                onClick={() => retirer(t.w, t.h)}
                title={`Retirer la taille ${t.w}×${t.h}`}
                className="hover:opacity-60 font-bold"
              >
                ✕
              </button>
            </span>
          )
        })}
        {tailles.length === 0 && (
          <span className="text-sm text-text-disabled">
            Aucune taille — tout lancement sera refusé pour ce moteur.
          </span>
        )}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <FieldLabel>Largeur (cm)</FieldLabel>
          <input
            type="number"
            min={50}
            max={1000}
            value={saisieW}
            onChange={(e) => setSaisieW(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ajouter()
            }}
            className={champ}
          />
        </div>
        <div>
          <FieldLabel>Hauteur (cm)</FieldLabel>
          <input
            type="number"
            min={50}
            max={400}
            value={saisieH}
            onChange={(e) => setSaisieH(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ajouter()
            }}
            className={champ}
          />
        </div>
        <button
          type="button"
          onClick={ajouter}
          disabled={!saisieW || !saisieH}
          className="bg-brand-green text-white text-sm font-bold rounded-[8px] px-4 py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>
    </div>
  )
}

/**
 * TABLEAU CROISÉ dérivé de la liste — PUREMENT VISUEL, aucun clic (retour
 * Mathias 20/08 soir, précisé « un vrai tableau avec les ratios calculés ») :
 * le tableau du directeur, calculé. Chaque case = le RATIO hauteur ÷ largeur
 * (la forme du portail dans l'image) ; en règle ratio chaque ligne affiche
 * aussi son échelle (1 cm = X px sur la livraison 2000 px). Rouge = la taille
 * sort du cadre avec le cadrage actuel.
 */
function TableauCroiseTailles({
  moteur,
  cadrage,
  tailles,
}: {
  moteur: 'janus' | 'terminus' | 'forculus'
  cadrage: CadrageDaReglages
  tailles: TailleMes[]
}) {
  if (tailles.length === 0) return null
  const largeurs = [...new Set(tailles.map((t) => t.w))].sort((a, b) => a - b)
  const hauteurs = [...new Set(tailles.map((t) => t.h))].sort((a, b) => a - b)
  const offerte = (w: number, h: number) => tailles.some((t) => t.w === w && t.h === h)
  const enDebord = tailles.filter((t) => tailleDeborde(moteur, cadrage, t))
  const ratioActif = cadrage.ratioActif && cadrage.refWidthCm !== null
  // Règle ratio : le portail occupe ratioPortailPct % des 2000 px de la
  // livraison, quelle que soit sa largeur → l'échelle px/cm ne dépend que de
  // la largeur (caméra plus proche pour les petits).
  const pxParCm = (w: number) => (2000 * (cadrage.ratioPortailPct / 100)) / w
  const fr = (n: number) => n.toFixed(2).replace('.', ',')
  const cellule = 'border border-border px-3 py-1.5 text-center'
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-border bg-surface px-3 py-1.5 text-left text-xs font-bold text-text-secondary">
              L × H
            </th>
            {hauteurs.map((h) => (
              <th
                key={h}
                className="border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary"
              >
                H {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {largeurs.map((w) => (
            <tr key={w}>
              <th className="border border-border bg-surface px-3 py-1.5 text-left whitespace-nowrap">
                <span className="text-[13px] font-bold">{w} cm</span>
                {ratioActif && (
                  <span className="block text-[10.5px] font-normal text-text-secondary">
                    1 cm = {fr(pxParCm(w))} px
                  </span>
                )}
              </th>
              {hauteurs.map((h) => {
                const on = offerte(w, h)
                const ko = on && tailleDeborde(moteur, cadrage, { w, h })
                return (
                  <td
                    key={h}
                    title={
                      on
                        ? `${w}×${h} — ratio ${fr(h / w)}${ko ? ' — sort du cadre' : ''}`
                        : undefined
                    }
                    className={`${cellule} ${
                      ko
                        ? 'bg-brand-red-light text-brand-red font-bold'
                        : on
                          ? 'font-semibold'
                          : 'bg-surface/60 text-text-disabled'
                    }`}
                  >
                    {on ? fr(h / w) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11.5px] text-text-secondary">
        Valeur = ratio hauteur ÷ largeur : la forme du portail dans l&apos;image (0,35 = écrasé,
        0,60 = presque carré). Même largeur d&apos;image pour tous, la hauteur suit ce ratio.
      </p>
      {enDebord.length > 0 && (
        <div className="mt-2 bg-brand-red-light text-brand-red text-xs font-bold rounded-[8px] px-3 py-2">
          ⚠ Sortent du cadre avec le cadrage actuel :{' '}
          {enDebord.map((t) => `${t.w}×${t.h}`).join(', ')} — baisser « Portail dans l&apos;image
          (%) » dans Cadrage, ou les retirer de la liste.
        </div>
      )}
    </div>
  )
}

/** Sélecteur segmenté (Auto / Off, etc.) aux couleurs de l'app. */
function Seg<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <span className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
            i > 0 ? 'border-l border-border' : ''
          } ${
            o.value === value
              ? 'bg-brand-green text-white font-bold'
              : 'text-text-secondary hover:bg-surface'
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

/**
 * Carte blanche d'une rubrique. `id`/`data-anchor` = cible des signets et du
 * scroll-spy ; `scroll-mt` compense le bandeau de contexte collant.
 */
function Card({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      data-anchor={id}
      className="bg-white rounded-[12px] border border-border shadow-sm p-5 scroll-mt-[150px]"
    >
      {children}
    </section>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-text-secondary mb-1.5">{children}</span>
}

/** Titre d'une rubrique empilée — `extra` accueille un contrôle (interrupteur RALify)
 *  ou un rappel (compteur de prompts) à droite du titre. */
function CardTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap mb-4">
      <h3 className="text-[16px] font-bold leading-tight">{children}</h3>
      {extra}
    </div>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mt-5 mb-3 first:mt-0">
      {children}
    </h3>
  )
}

export default function MoteursPage() {
  const [moteurs, setMoteurs] = useState<MoteurEntry[]>(MOTEURS_INITIAUX)
  const [selected, setSelected] = useState<AnyMoteurKey>('battant')
  // Contexte affiché (refonte « affichage complet », maquette reglages-full-v1
  // validée le 29/07/2026) : le panneau empile TOUTES les rubriques du contexte
  // et l'arborescence sert de signets. `activeAnchor` = rubrique surlignée par le
  // scroll-spy ; `pendingScroll` = ancre à rejoindre après le rendu.
  const [ctx, setCtx] = useState<'app' | 'moteur' | 'reset'>('app')
  const [activeAnchor, setActiveAnchor] = useState<string>('app-generations')
  const [pendingScroll, setPendingScroll] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [reglages, setReglages] = useState<MoteurReglages | null>(null)
  const [dirty, setDirty] = useState(false)
  const [promptVersions, setPromptVersions] = useState<Record<string, PromptMeta>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [coloris, setColoris] = useState<ColorisEntry[]>([])
  const [colorisForm, setColorisForm] = useState<{
    label: string
    ral: string
    swatch: string
  } | null>(null)
  const [canny, setCanny] = useState<CannyInfo | null>(null)
  const [cannyBusy, setCannyBusy] = useState(false)
  const cannyFileRef = useRef<HTMLInputElement>(null)
  // Canny XL (22/07/2026) : image ET réglages (alignement, corridor) du jeu
  // « coulissant-xl », EN COMPLÉMENT du Canny coulissant qui ne bouge pas —
  // rubrique de la fiche TERMINUS uniquement.
  const [cannyXl, setCannyXl] = useState<CannyInfo | null>(null)
  const [cannyXlBusy, setCannyXlBusy] = useState(false)
  const cannyXlFileRef = useRef<HTMLInputElement>(null)
  const [reglagesXl, setReglagesXl] = useState<MoteurReglages | null>(null)
  const [dirtyXl, setDirtyXl] = useState(false)
  // Prompt dont l'éditeur est déroulé (un seul à la fois, replié par défaut).
  const [openPrompt, setOpenPrompt] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/moteurs')
      .then((r) => r.json())
      .then((d) => setMoteurs(d.moteurs ?? []))
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, PromptMeta> = {}
        for (const p of (d.prompts ?? []) as PromptMeta[]) map[p.name] = p
        setPromptVersions(map)
      })
    fetch('/api/coloris')
      .then((r) => r.json())
      .then((d) => setColoris(d.coloris ?? []))
  }, [])

  // Les réglages suivent le moteur : chaque moteur a LES SIENS (règle 13/07/2026 —
  // jamais partagés). Changer de moteur recharge et abandonne les modifs non
  // enregistrées ; changer de RUBRIQUE du même moteur les conserve.
  useEffect(() => {
    setReglages(null)
    setDirty(false)
    setCanny(null)
    setOpenPrompt(null)
    fetch(`/api/moteurs/${selected}/reglages`)
      .then((r) => r.json())
      .then((d) => setReglages(d.reglages ?? null))
    // Un moteur décor autour n'a NI Canny ni gabarits-scène (pipeline collapsé).
    if (!isDaKey(selected)) {
      fetch(`/api/moteurs/${selected}/canny`)
        .then((r) => r.json())
        .then((d) => setCanny(d.canny ?? null))
    }
    setCannyXl(null)
    setReglagesXl(null)
    setDirtyXl(false)
    if (selected === 'coulissant') {
      fetch('/api/moteurs/coulissant-xl/canny')
        .then((r) => r.json())
        .then((d) => setCannyXl(d.canny ?? null))
      fetch('/api/moteurs/coulissant-xl/reglages')
        .then((r) => r.json())
        .then((d) => setReglagesXl(d.reglages ?? null))
    }
  }, [selected])

  // Rejoint l'ancre demandée par un signet APRÈS que son contexte soit rendu
  // (le bloc n'existe pas forcément dans la même frame que le clic).
  useEffect(() => {
    if (!pendingScroll) return
    const el = document.getElementById(pendingScroll)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPendingScroll(null)
  }, [pendingScroll, ctx, selected])

  // Scroll-spy : surligne dans l'arborescence la rubrique la plus haute visible.
  useEffect(() => {
    function onScroll() {
      const cards = panelRef.current?.querySelectorAll<HTMLElement>('[data-anchor]')
      if (!cards || cards.length === 0) return
      // Ligne de lecture qui DESCEND avec le défilement : 160 px sous le haut quand
      // on est en haut, jusqu'au bas de l'écran quand on est en bas de page. Sur une
      // page courte (Application : 4 cartes visibles d'un coup, peu de défilement),
      // elle balaie ainsi chaque rubrique — sinon les dernières ne s'activeraient
      // jamais, leur haut ne franchissant pas un seuil fixe avant le bas de page.
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      const line = 160 + p * (window.innerHeight - 160)
      let active: string | null = cards[0].dataset.anchor ?? null
      cards.forEach((c) => {
        if (c.getBoundingClientRect().top <= line) active = c.dataset.anchor ?? null
      })
      if (active) setActiveAnchor(active)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [ctx, selected])

  /** Ajout d'un coloris à la palette (POST /api/coloris), depuis le mini-formulaire. */
  async function submitColoris() {
    if (!colorisForm) return
    setBusy(true)
    const res = await fetch('/api/coloris', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: colorisForm.label,
        ral: colorisForm.ral.trim() || null,
        swatch: colorisForm.swatch,
      }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok && data?.coloris) {
      setColoris(data.coloris)
      setColorisForm(null)
      setNotice(`Coloris « ${colorisForm.label.trim()} » ajouté à la palette.`)
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function deleteColoris(entry: ColorisEntry) {
    if (!window.confirm(`Supprimer le coloris « ${entry.label} » de la palette ?`)) return
    const res = await fetch('/api/coloris', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: entry.key }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.coloris) {
      setColoris(data.coloris)
      setNotice(`Coloris « ${entry.label} » supprimé.`)
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  /** Remplacement de l'image Canny du moteur (fichier choisi via l'input caché). */
  async function uploadCanny(file: File) {
    setCannyBusy(true)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/moteurs/${selected}/canny`, { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    setCannyBusy(false)
    if (res.ok && data?.canny) {
      setCanny(data.canny)
      setNotice(
        `Image Canny remplacée (${data.canny.width}×${data.canny.height}). Elle sert dès la prochaine génération.`
      )
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  /** Remplacement de l'image Canny XL (jeu « coulissant-xl », fiche TERMINUS). */
  async function uploadCannyXl(file: File) {
    setCannyXlBusy(true)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/moteurs/coulissant-xl/canny', { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    setCannyXlBusy(false)
    if (res.ok && data?.canny) {
      setCannyXl(data.canny)
      setNotice(
        `Image Canny XL remplacée (${data.canny.width}×${data.canny.height}). Elle sert dès le prochain décor XL.`
      )
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function resetCannyXl() {
    if (!window.confirm('Revenir à l’image Canny XL d’origine (trottoir « caméra reculée ») ?')) return
    setCannyXlBusy(true)
    const res = await fetch('/api/moteurs/coulissant-xl/canny', { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    setCannyXlBusy(false)
    if (res.ok && data?.canny) {
      setCannyXl(data.canny)
      setNotice('Image Canny XL d’origine rétablie.')
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function resetCanny() {
    if (!window.confirm('Revenir à l’image Canny d’origine ?')) return
    setCannyBusy(true)
    const res = await fetch(`/api/moteurs/${selected}/canny`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    setCannyBusy(false)
    if (res.ok && data?.canny) {
      setCanny(data.canny)
      setNotice('Image Canny d’origine rétablie.')
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  function setField<K extends keyof MoteurReglages>(key: K, value: MoteurReglages[K]) {
    // Pas encore chargé → on ignore (sinon « dirty » fantôme sur un clic perdu).
    if (!reglages) return
    setReglages({ ...reglages, [key]: value })
    setDirty(true)
  }

  // Cadrage & scène (fiche décor autour, 07/08 soir) : valeurs EFFECTIVES =
  // recette d'usine du moteur + delta enregistré ; l'édition n'écrit que le delta.
  const cadEff = isDaKey(selected)
    ? cadrageDaEffectif(selected, reglages?.cadrageDa)
    : null
  function setCadrage(patch: Partial<CadrageDaReglages>) {
    if (!reglages) return
    setField('cadrageDa', { ...(reglages.cadrageDa ?? {}), ...patch })
  }
  function setCouleurPlan(k: keyof CouleursPlan, hex: string) {
    if (!cadEff) return
    setCadrage({ couleurs: { ...cadEff.couleurs, [k]: hex } })
  }
  /** COULISSANT : vue affichée dans la carte Cadrage — Standard ou XL, l'aperçu
   *  ET les options suivent (demande Mathias 07/08 soir). */
  const [vueXl, setVueXl] = useState(false)
  /** Carte Cadrage : bascule aperçu simple ↔ VUE GLOBALE (20/08 soir, demande
   *  Mathias « comme la planche ») — toutes les tailles de la liste du moteur,
   *  rendues avec le cadrage courant. */
  const [vueGlobale, setVueGlobale] = useState(false)
  useEffect(() => {
    setVueXl(false)
    setVueGlobale(false)
  }, [selected])
  // Règle ratio active (20/08) : la bascule XL ne joue plus — la vue Xl et ses
  // champs disparaissent de la carte, quel que soit l'état du commutateur.
  const vueXlEff = vueXl && selected === 'terminus' && cadEff !== null && !cadEff.ratioActif

  /** Réglages du jeu Canny XL (alignement, corridor) — fiche TERMINUS. */
  function setFieldXl<K extends keyof MoteurReglages>(key: K, value: MoteurReglages[K]) {
    if (!reglagesXl) return
    setReglagesXl({ ...reglagesXl, [key]: value })
    setDirtyXl(true)
  }

  async function save() {
    if (!reglages) return
    setBusy(true)
    setNotice(null)
    // Champs numériques : bornés côté client, et envoyés SEULEMENT quand leur mode
    // est « Manuel » — sinon un champ vidé (0, hors bornes) puis masqué par un
    // retour en Auto bloquerait tout l'enregistrement sur une erreur invisible.
    const body: Record<string, unknown> = { ...reglages }
    if (reglages.cannyPlacement === 'manuel') {
      body.cannyOffsetPx = Math.min(300, Math.max(-300, Math.round(reglages.cannyOffsetPx || 0)))
    } else {
      delete body.cannyOffsetPx
    }
    if (reglages.corridor === 'manuel') {
      body.corridorWidthCm = Math.min(800, Math.max(100, Math.round(reglages.corridorWidthCm || 100)))
    } else {
      delete body.corridorWidthCm
    }
    if (reglages.integrationMethod === 'pose-fusion') {
      body.poseDebordPct = Math.min(10, Math.max(0, Number(reglages.poseDebordPct) || 0))
    } else {
      delete body.poseDebordPct
    }
    // Seuil alpha : utilisé par pose-fusion ET par le plan gris décor autour
    // (rubrique Cadrage & scène, 07/08 soir).
    if (
      reglages.integrationMethod === 'pose-fusion' ||
      reglages.integrationMethod === 'decor-autour'
    ) {
      body.poseSeuilAlpha = Math.min(255, Math.max(1, Math.round(reglages.poseSeuilAlpha || 200)))
    } else {
      delete body.poseSeuilAlpha
    }
    // Tableau des tailles (20/08) : delta envoyé tel quel ; null explicite =
    // retour aux tailles du catalogue (même mécanique que cadrageDa dessous).
    body.taillesMes = reglages.taillesMes ?? null
    // Cadrage & scène décor autour (07/08 soir) : delta envoyé tel quel ; null
    // EXPLICITE = « revenir à la recette d'usine » (le serveur efface le delta).
    body.cadrageDa = reglages.cadrageDa ?? null
    // RALify TOUJOURS actif sur les moteurs décor autour (Mathias 08/08 : plus
    // d'interrupteur) — un ancien « désactivé » en base se répare au 1ᵉʳ save.
    if (isDaKey(selected)) {
      body.ralify = { ...reglages.ralify, actif: true }
      // La méthode d'un moteur décor autour est IMMUABLE ('decor-autour') et
      // volontairement NON patchable côté API (protection des moteurs legacy) :
      // l'envoyer faisait rejeter tout l'enregistrement (bug 17/08).
      delete body.integrationMethod
    }
    // Ombre du pilier sur la lame : réglage PROPRE au coulissant (28/07/2026).
    if (selected === 'coulissant' && reglages.integrationMethod === 'pose-fusion') {
      body.ombrePilierPct = Math.min(100, Math.max(0, Math.round(Number(reglages.ombrePilierPct) || 0)))
    } else {
      delete body.ombrePilierPct
    }
    // Générations par taille (29/07/2026) : borné 1..6.
    body.generationsParTaille = Math.min(6, Math.max(1, Math.round(Number(reglages.generationsParTaille) || 3)))
    const res = await fetch(`/api/moteurs/${selected}/reglages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.reglages) {
      setBusy(false)
      setNotice(`Erreur : ${data?.error ?? res.status}`)
      return
    }
    setReglages(data.reglages)
    setDirty(false)
    // Réglages du jeu Canny XL (fiche TERMINUS) : seuls ses champs Canny partent —
    // alignement et corridor, avec la même règle « Manuel seulement » que ci-dessus.
    if (dirtyXl && reglagesXl) {
      const bodyXl: Record<string, unknown> = {
        cannyPlacement: reglagesXl.cannyPlacement,
        corridor: reglagesXl.corridor,
      }
      if (reglagesXl.cannyPlacement === 'manuel') {
        bodyXl.cannyOffsetPx = Math.min(300, Math.max(-300, Math.round(reglagesXl.cannyOffsetPx || 0)))
      }
      if (reglagesXl.corridor === 'manuel') {
        bodyXl.corridorWidthCm = Math.min(800, Math.max(100, Math.round(reglagesXl.corridorWidthCm || 100)))
      }
      const resXl = await fetch('/api/moteurs/coulissant-xl/reglages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyXl),
      })
      const dataXl = await resXl.json().catch(() => null)
      if (!resXl.ok || !dataXl?.reglages) {
        setBusy(false)
        setNotice(`Erreur (Canny XL) : ${dataXl?.error ?? resXl.status}`)
        return
      }
      setReglagesXl(dataXl.reglages)
      setDirtyXl(false)
    }
    setBusy(false)
    const m = moteurs.find((x) => x.key === selected)
    setNotice(`Réglages du moteur ${m?.label ?? selected} enregistrés.`)
  }

  const current = moteurs.find((m) => m.key === selected)
  // Moteur décor autour sélectionné : fiche dédiée (RALify + Prompt System +
  // Export), jamais les rubriques legacy (Canny, gabarits-scène, intégration).
  const isDa = isDaKey(selected)
  // Indexations legacy (PRODUIT_PAR_MOTEUR, aperçu RALify) : clé legacy sûre.
  const legacySelected: MoteurKey = isDaKey(selected) ? DA_TO_LEGACY[selected] : selected

  /**
   * Ligne prompt : libellé, version active, date · auteur de la dernière
   * modification, et « Modifier » qui DÉPLIE l'atelier sur place (frise des
   * versions + Éditer / Comparer — refonte du 28/07/2026, maquette
   * prompt-system-v6, toujours DANS la fiche moteur). Les prompts appartiennent
   * AU moteur (règle 13/07/2026) : battant garde les noms historiques, les
   * autres moteurs préfixent (« portillon-piliers-murets »). Un prompt que le
   * moteur n'a pas encore (ex. décor portillon) est « à venir ».
   */
  // Résumé de l'en-tête « Prompt System » (maquette v6) : nombre de prompts du
  // moteur et dernière modification, tous prompts confondus.
  // Moteur décor autour : UN prompt (le rendu complet), nom EXACT `<clé>-decor-autour`.
  const promptDefsDa: { name: string; label: string; exact?: boolean }[] = [
    {
      name: `${selected}-decor-autour`,
      exact: true,
      label: `Décor autour — rendu complet (${PRODUIT_PAR_MOTEUR[legacySelected]} posé, Nano peint l’entrée)`,
    },
    // Juge vision (17/08) : PARTAGÉ entre les trois moteurs décor autour — les
    // critères de refus (défauts flagrants seulement) s'éditent ici.
    {
      name: 'juge-mes',
      exact: true,
      label: 'Juge des MES — critères d’acceptation du rendu (partagé aux 3 moteurs)',
    },
  ]
  const promptDefs: { name: string; label: string; exact?: boolean }[] = isDa
    ? promptDefsDa
    : [
        ...(selected === 'coulissant' ? PROMPTS_DECOR_COULISSANT : PROMPTS_DECOR),
        ...PROMPTS_PILIERS,
        ...promptsIntegration(PRODUIT_PAR_MOTEUR[legacySelected]),
        ...PROMPTS_MARKETPLACE,
      ]
  const promptMetas = promptDefs
    .map((p) =>
      promptVersions[p.exact ? p.name : selected === 'battant' ? p.name : `${selected}-${p.name}`]
    )
    .filter((m): m is PromptMeta => Boolean(m))
  const dernierPrompt = promptMetas.reduce<PromptMeta | null>(
    (a, b) => (a && a.updated > b.updated ? a : b),
    null
  )

  // FONCTION de rendu, PAS un composant (08/08, bug vu par Mathias) : déclaré
  // comme composant local, chaque re-rendu de la page (scroll-spy compris) en
  // recréait un « nouveau » → React démontait/remontait tout le bloc et le
  // PromptEditor ouvert rechargeait en plein défilement.
  const promptRows = (list: { name: string; label: string; exact?: boolean }[]) => (
    <div className="space-y-1.5">
      {list.map((p) => {
        // exact = nom pris tel quel (prompts d'un JEU, ex. coulissant-xl-…).
        const name = p.exact ? p.name : selected === 'battant' ? p.name : `${selected}-${p.name}`
        const meta = promptVersions[name]
        const open = openPrompt === name
        return (
          <div
            key={name}
            className={`border rounded-[8px] ${
              open ? 'border-brand-green shadow-[0_0_0_2px_var(--color-brand-green-light)]' : 'border-border'
            }`}
          >
            <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
              <span className="font-semibold">{p.label}</span>
              <span
                className={`text-[11px] font-mono rounded-full px-2 py-px ${
                  open ? 'bg-brand-green text-white font-bold' : 'bg-surface text-text-disabled'
                }`}
              >
                {meta ? `v${meta.version}` : '—'}
              </span>
              {meta && (
                <span className="text-[11.5px] text-text-disabled">
                  {fmtDbDate(meta.updated)}
                  {meta.updatedBy ? ` · ${meta.updatedBy}` : ''}
                </span>
              )}
              {meta ? (
                <button
                  type="button"
                  onClick={() => setOpenPrompt(open ? null : name)}
                  className="ml-auto text-brand-green font-bold text-xs hover:underline"
                >
                  {open ? 'Fermer' : 'Modifier'}
                </button>
              ) : (
                <span className="ml-auto text-text-disabled text-xs" title="Ce moteur n'a pas encore ce prompt">
                  à venir
                </span>
              )}
            </div>
            {open && (
              <PromptEditor
                name={name}
                onSaved={(n, saved) =>
                  setPromptVersions((m) => ({
                    ...m,
                    [n]: {
                      name: n,
                      version: saved.version,
                      updated: saved.created_at,
                      updatedBy: saved.created_by,
                    },
                  }))
                }
              />
            )}
          </div>
        )
      })}
    </div>
  )

  /* ===== En-tête du panneau : rappel du contexte affiché ===== */

  const nomMoteur = current
    ? `${current.label === 'Portillon' ? 'Portillon' : `Portail ${current.label}`}${
        current.codeName ? ` « ${current.codeName} »` : ''
      }`
    : ''

  /** Clic sur un signet : bascule sur son contexte et rejoint sa rubrique. */
  function goTo(nextCtx: 'app' | 'moteur' | 'reset', anchor: string) {
    setCtx(nextCtx)
    setActiveAnchor(anchor)
    setPendingScroll(anchor)
  }

  /** Clic sur un moteur : le sélectionne et affiche sa fiche complète (1ʳᵉ rubrique en haut). */
  function pickMoteur(key: AnyMoteurKey) {
    // Fiche décor autour : pas de rubrique Détection — on arrive sur RALify.
    const first = MOTEUR_ANCHOR(isDaKey(key) ? 'ralify' : 'detection')
    setSelected(key)
    setCtx('moteur')
    setActiveAnchor(first)
    setPendingScroll(first)
  }

  // Moteurs LEGACY MASQUÉS de la nav (demande Mathias 07/08, MES Contrainte
  // officiel) : fiches et réglages conservés tels quels — repasser à true pour
  // les revoir. Ordre historique : décor autour en haut, legacy en bas.
  const AFFICHER_MOTEURS_LEGACY = false
  const navMoteurs = [...moteurs]
    .filter((m) => AFFICHER_MOTEURS_LEGACY || m.methode !== 'legacy')
    .sort(
      (a, b) =>
        (a.methode === 'decor-autour' ? 0 : 1) - (b.methode === 'decor-autour' ? 0 : 1) ||
        a.label.localeCompare(b.label, 'fr')
    )
  // Rubriques d'une fiche décor autour : RALify, Cadrage & scène, Prompt
  // System, Export.
  const DA_RUBRIQUES: MoteurRubrique[] = ['ralify', 'cadrage', 'tailles', 'prompts', 'export']

  return (
    <div className="max-w-6xl mx-auto">
      {/*
        Arborescence (proposition C, 28/07/2026) : Application, moteurs — le
        moteur sélectionné déplie ses rubriques dessous — puis Système. Le
        panneau de droite n'affiche que la rubrique cliquée.
      */}
      <div className="grid gap-6 items-start lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="bg-white rounded-[12px] border border-border shadow-sm p-3.5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled px-1 mt-0.5 mb-1.5">
            Application
          </p>
          {APP_RUBRIQUES.map((r) => {
            const on = ctx === 'app' && activeAnchor === APP_ANCHOR(r.rub)
            return (
              <button
                key={r.rub}
                type="button"
                aria-current={on}
                onClick={() => goTo('app', APP_ANCHOR(r.rub))}
                className={`w-full flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm transition-colors ${
                  on
                    ? 'bg-brand-green-light text-brand-green font-bold'
                    : 'text-text-primary font-semibold hover:bg-surface'
                }`}
              >
                {r.label}
              </button>
            )
          })}

          <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled px-1 mt-4 mb-1.5">
            Moteurs
          </p>
          {navMoteurs.map((m) => {
            const active = m.key === selected
            const onFiche = active && ctx === 'moteur'
            const mDa = m.methode === 'decor-autour'
            return (
              <div key={m.key}>
                <button
                  type="button"
                  aria-current={onFiche}
                  onClick={() => pickMoteur(m.key)}
                  className={`w-full flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm transition-colors ${
                    onFiche
                      ? 'bg-brand-green-light text-brand-green font-bold'
                      : 'text-text-primary font-semibold hover:bg-surface'
                  }`}
                >
                  {/* Séparation totale 05/08. 07/08 (demande Mathias) : chaque
                      moteur affiche son NOM DE CODE — « Battant "Janus" ». */}
                  <span className="flex-1 truncate">
                    {m.label}
                    {m.methode === 'decor-autour' && m.codeName && (
                      <span className="text-text-disabled font-semibold">
                        {' '}
                        «&nbsp;{m.codeName.charAt(0) + m.codeName.slice(1).toLowerCase()}&nbsp;»
                      </span>
                    )}
                    {m.methode === 'legacy' && (
                      <span className="text-text-disabled font-semibold"> (legacy)</span>
                    )}
                  </span>
                  {m.status === 'preparation' ? (
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-px whitespace-nowrap">
                      prépa
                    </span>
                  ) : (
                    <span
                      className={`text-[10px] ${onFiche ? 'text-brand-green' : 'text-text-disabled'}`}
                    >
                      {onFiche ? '▾' : '▸'}
                    </span>
                  )}
                </button>
                {/* Rubriques du moteur déplié = signets vers ses blocs — les XL n'existent que sur TERMINUS.
                    Fiche décor autour : rubriques réduites (RALify, Prompt System, Export).
                    Déplié SEULEMENT quand on consulte vraiment sa fiche (onFiche), pas juste parce
                    qu'il est sélectionné par défaut : au chargement (contexte Application) le Battant
                    reste ainsi fermé. */}
                {onFiche && m.status === 'actif' && (
                  <div className="ml-3.5 border-l-2 border-border pl-2 my-1 space-y-px">
                    {MOTEUR_RUBRIQUES.filter((r) =>
                      mDa ? DA_RUBRIQUES.includes(r.rub) : !r.xl || m.key === 'coulissant'
                    ).map((r) => {
                      const on = ctx === 'moteur' && activeAnchor === MOTEUR_ANCHOR(r.rub)
                      return (
                        <button
                          key={r.rub}
                          type="button"
                          aria-current={on}
                          onClick={() => goTo('moteur', MOTEUR_ANCHOR(r.rub))}
                          className={`w-full rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                            on
                              ? 'text-brand-green font-bold bg-brand-green-light'
                              : 'text-text-secondary hover:bg-surface'
                          }`}
                        >
                          {r.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled px-1 mt-4 mb-1.5">
            Système
          </p>
          <button
            type="button"
            aria-current={ctx === 'reset'}
            onClick={() => setCtx('reset')}
            className={`w-full flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm font-semibold transition-colors ${
              ctx === 'reset' ? 'bg-brand-red-light text-brand-red font-bold' : 'text-brand-red hover:bg-surface'
            }`}
          >
            Remise à zéro
          </button>
        </aside>

        {/* ============ Panneau : toutes les rubriques du contexte, empilées ============ */}
        <div ref={panelRef}>
          {/* Bandeau de contexte collant : rappelle le contexte affiché et garde
              l'Enregistrer moteur à portée. Collé SOUS le header dans une bande
              OPAQUE couleur de page (retour Mathias 07/08 soir : le bandeau qui
              flottait au-dessus des cartes en défilant était détestable) — le
              contenu disparaît proprement dessous, aucune superposition visible. */}
          <div className="sticky top-14 z-10 mb-4 bg-surface pt-4 pb-2 -mx-1 px-1">
            <div className="flex items-center justify-between gap-3 flex-wrap bg-white rounded-[12px] border border-border shadow-sm px-5 py-3">
            <div>
              <h2 className={`text-[19px] font-bold leading-tight ${ctx === 'reset' ? 'text-brand-red' : ''}`}>
                {ctx === 'app' ? 'Application' : ctx === 'reset' ? 'Remise à zéro de l’application' : nomMoteur}
              </h2>
              <span className="text-xs text-text-disabled">
                {ctx === 'app' && 'Réglages valables quel que soit le moteur'}
                {ctx === 'reset' && 'Système · sauvegarde complète avant effacement'}
                {ctx === 'moteur' &&
                  current &&
                  (current.status === 'actif'
                    ? `Moteur actif · ${current.productCount} produits`
                    : 'Moteur en préparation')}
              </span>
            </div>
            {ctx === 'moteur' && current?.status === 'actif' && (
              <div className="flex items-center gap-3">
                {(dirty || dirtyXl) && (
                  <span className="text-xs text-brand-teal">Modifications non enregistrées.</span>
                )}
                <button
                  onClick={save}
                  disabled={busy || (!dirty && !dirtyXl) || !reglages}
                  className="bg-brand-green text-white text-sm font-bold rounded-[10px] px-5 py-2.5 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                >
                  Enregistrer les réglages du moteur
                </button>
              </div>
            )}
            </div>
          </div>

          {ctx === 'app' && <ReglagesApp />}

          {ctx === 'reset' && <ResetApp />}

          {ctx === 'moteur' && (
            <>
              {notice && (
                <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-4 py-3 mb-5 flex justify-between gap-3">
                  <span>{notice}</span>
                  <button onClick={() => setNotice(null)} className="hover:opacity-70">✕</button>
                </div>
              )}

              {current?.status === 'preparation' ? (
                <div className="bg-white rounded-[12px] shadow-sm border border-dashed border-[#cfd4da] p-10 text-center">
                  <h2 className="font-semibold mb-1.5">Moteur {current.label} — en préparation</h2>
                  <p className="text-sm text-text-secondary max-w-xl mx-auto">
                    {current.key === 'coulissant'
                      ? 'Mêmes réglages que le Battant, avec une intégration propre : le vantail se cache derrière le pilier.'
                      : 'Ses propres tailles, gabarits, palette de coloris et Prompt System.'}
                  </p>
                </div>
              ) : isDa ? (
                /* ============ Fiche MOTEUR DÉCOR AUTOUR (séparation totale 05/08) ============
                   La nouvelle génération (JANUS/TERMINUS/FORCULUS) n'a NI Canny, NI
                   gabarits-scène, NI étapes piliers/intégration : RALify, SON prompt
                   « décor autour », et l'export. Les rubriques legacy restent sur les
                   moteurs « (legacy) », inchangées. */
                <div className="space-y-5">
                  <Card id={MOTEUR_ANCHOR('ralify')}>
                    {/* Plus d'interrupteur Activé/Désactivé (Mathias 08/08 :
                        « activé par défaut basta pas de choix ») — RALify est
                        TOUJOURS actif sur les moteurs décor autour, le tableau
                        par coloris suffit à dire quoi corriger. save() force
                        actif:true. */}
                    <CardTitle>RALify</CardTitle>
                    {/* Simplification 07/08 soir (« RALify frankenstein ») : plus
                        de bloc palette séparé — l'ajout/la suppression de coloris
                        vivent DANS le tableau de la section (RalifySection).
                        Aperçus sur les PNG produits de l'homologue legacy (mêmes
                        produits catalogue) — les RÉGLAGES édités sont ceux de CE
                        moteur. */}
                    <RalifySection
                      moteur={legacySelected}
                      value={reglages?.ralify ?? null}
                      coloris={coloris}
                      onChange={(r) => setField('ralify', r)}
                      onPaletteChange={setColoris}
                      disabled={!reglages}
                      avecApplication
                    />
                  </Card>

                  {/* ============ Cadrage & scène (07/08 soir — demande Mathias :
                      tout le resizing/la scène sous UI, plus rien figé dans le
                      code ; défauts = la recette rodée au banc) ============ */}
                  {cadEff && (
                  <Card id={MOTEUR_ANCHOR('cadrage')}>
                    <CardTitle>Cadrage</CardTitle>
                    {/* Au-dessus de la preview : commutateur Standard/XL du
                        coulissant à gauche, « Réglages par défaut » à droite
                        (placement demandé par Mathias 08/08). */}
                    {/* Règle RATIO (20/08 — tableau croisé du directeur) : vraie
                        largeur + scène proportionnelle, une seule référence par
                        famille. Active par défaut ; Désactivée = ancienne règle
                        (étalon figé + bascule XL) telle quelle. Portillon non
                        concerné (largeur unique). */}
                    {/* Une seule rangée d'en-tête (alignement demandé par Mathias
                        20/08) : interrupteur « Règle ratio » à gauche (+ le
                        commutateur Standard/XL du coulissant quand l'ancienne
                        règle est active), « Réglages par défaut » à droite. */}
                    <div className="flex items-center justify-between gap-3 mb-3 max-w-[640px]">
                      <div className="flex items-center gap-3 flex-wrap">
                        {cadEff.refWidthCm !== null && (
                          <>
                            <span className="text-sm font-bold">Règle ratio</span>
                            <Seg
                              value={cadEff.ratioActif ? 'on' : 'off'}
                              options={[
                                { value: 'on', label: 'Activée' },
                                { value: 'off', label: 'Désactivée' },
                              ]}
                              onChange={(v) => setCadrage({ ratioActif: v === 'on' })}
                              disabled={!reglages}
                            />
                          </>
                        )}
                        {selected === 'terminus' && !cadEff.ratioActif && (
                          <Seg
                            value={vueXl ? 'xl' : 'std'}
                            options={[
                              { value: 'std', label: 'Standard' },
                              { value: 'xl', label: 'XL' },
                            ]}
                            onChange={(v) => setVueXl(v === 'xl')}
                            disabled={!reglages}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isDaKey(selected) && (
                          <button
                            type="button"
                            onClick={() => setVueGlobale(!vueGlobale)}
                            title="Voir toutes les tailles de la liste du moteur, rendues avec le cadrage courant (comme la planche)"
                            className={`rounded-[8px] px-3 py-1.5 text-xs font-bold border transition-colors ${
                              vueGlobale
                                ? 'bg-brand-green border-brand-green text-white'
                                : 'bg-white border-border text-text-secondary hover:border-brand-green hover:text-brand-green'
                            }`}
                          >
                            Vue globale
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setField('cadrageDa', undefined)}
                          disabled={!reglages}
                          title="Efface les modifications : le moteur reprend ses réglages par défaut"
                          className="bg-white border border-border text-text-secondary rounded-[8px] px-3 py-1.5 text-xs font-bold hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
                        >
                          Réglages par défaut
                        </button>
                      </div>
                    </div>
                    {/* Couleurs : ÉDITÉES AU CLIC sur l'aperçu (07/08 soir) —
                        chaque partie ouvre son petit menu RAL/couleur libre.
                        VUE GLOBALE (20/08 soir) : toutes les tailles de la liste
                        du moteur en vignettes, cadrage courant — la planche,
                        dans l'app, par type de produit. */}
                    {vueGlobale && isDaKey(selected) ? (
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 max-w-[980px]">
                        {taillesMesEffectives(selected, reglages?.taillesMes).map((t) => (
                          <div key={`${t.w}x${t.h}`}>
                            <div className="text-xs font-bold text-text-secondary mb-1">
                              {t.w}×{t.h}
                              {tailleDeborde(selected, cadEff, t) && (
                                <span className="text-brand-red"> — sort du cadre</span>
                              )}
                            </div>
                            <ApercuScene moteur={selected} cadrage={cadEff} taille={t} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <ApercuCadrage
                        moteur={isDaKey(selected) ? selected : 'janus'}
                        cadrage={cadEff}
                        vueXl={vueXlEff}
                        hauteurs={
                          isDaKey(selected)
                            ? [
                                ...new Set(
                                  taillesMesEffectives(selected, reglages?.taillesMes).map(
                                    (t) => t.h
                                  )
                                ),
                              ].sort((a, b) => a - b)
                            : undefined
                        }
                        largeurs={
                          isDaKey(selected)
                            ? [
                                ...new Set(
                                  taillesMesEffectives(selected, reglages?.taillesMes).map(
                                    (t) => t.w
                                  )
                                ),
                              ].sort((a, b) => a - b)
                            : undefined
                        }
                        onCouleur={(part, hex) => setCouleurPlan(part, hex)}
                      />
                    )}

                    {/* « Plan nu » retiré (07/08 soir) ; le titre « Resizing »
                        aussi — ces champs règlent le CADRAGE, pas le resizing
                        (remarque Mathias). */}
                    {/* La LARGEUR ÉTALON n'est PAS réglable (décision Mathias 07/08
                        soir : « on garde ça ad vitam ») — figée dans la recette :
                        400 pour battant/coulissant, vraie largeur pour portillon,
                        600 en XL. Les champs restants ne touchent qu'au cadrage. */}
                    {/* Réglages GROUPÉS (retour Mathias 20/08 soir : la rangée à
                        plat mélangeait cadrage et échelle produit — « c'est le
                        bordel ») : « Cadrage de la scène » d'abord, « Échelle du
                        produit » (tournevis) ensuite. En vue XL du coulissant,
                        la scène XL a son propre groupe. */}
                    {!vueXlEff ? (
                      <>
                        <SubHeading>Cadrage de la scène</SubHeading>
                        <div className="flex items-end gap-4 flex-wrap">
                          {/* Règle ratio : ses deux curseurs. Rollback : le zoom
                              caméra les remplace (le zoom est masqué en ratio —
                              doublon du %, remarque Mathias 20/08). */}
                          {cadEff.ratioActif && cadEff.refWidthCm !== null ? (
                            <>
                              <div>
                                <FieldLabel>Portail dans l&apos;image (%)</FieldLabel>
                                <input
                                  type="number"
                                  min={30}
                                  max={95}
                                  value={cadEff.ratioPortailPct}
                                  onChange={(e) => setCadrage({ ratioPortailPct: Number(e.target.value) })}
                                  title="Part de la largeur d'image occupée par le portail — identique pour toutes les tailles. Plus grand = produit plus gros, moins d'air (attention aux alertes hors cadre)."
                                  className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                              </div>
                              <div>
                                <FieldLabel>Sol visible (%)</FieldLabel>
                                <input
                                  type="number"
                                  min={0}
                                  max={60}
                                  value={cadEff.ratioSolPct}
                                  onChange={(e) => setCadrage({ ratioSolPct: Number(e.target.value) })}
                                  title="Part de la hauteur d'image occupée par le sol (trottoir/route) sous le pied du portail"
                                  className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                              </div>
                            </>
                          ) : (
                            <div>
                              <FieldLabel>Zoom caméra (%)</FieldLabel>
                              <input
                                type="number"
                                min={25}
                                max={400}
                                value={cadEff.zoom}
                                onChange={(e) => setCadrage({ zoom: Number(e.target.value) })}
                                title="100 = neutre ; moins de 100 dézoome (la scène s'élargit)"
                                className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                              />
                            </div>
                          )}
                          <div>
                            <FieldLabel>Décalage X (cm)</FieldLabel>
                            <input
                              type="number"
                              min={-200}
                              max={200}
                              value={cadEff.offsetX}
                              onChange={(e) => setCadrage({ offsetX: Number(e.target.value) })}
                              title="+ = le portail glisse vers la droite, − vers la gauche"
                              className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>Décalage Y (cm)</FieldLabel>
                            <input
                              type="number"
                              min={-100}
                              max={100}
                              value={cadEff.offsetY}
                              onChange={(e) => setCadrage({ offsetY: Number(e.target.value) })}
                              title="+ = tout descend (la ligne de sol porte tout)"
                              className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Vue XL du coulissant : SES réglages de scène. */}
                        <SubHeading>Scène XL</SubHeading>
                        <div className="flex items-end gap-4 flex-wrap">
                          <div>
                            <FieldLabel>Zoom XL (%)</FieldLabel>
                            <input
                              type="number"
                              min={25}
                              max={400}
                              value={cadEff.xlZoom}
                              onChange={(e) => setCadrage({ xlZoom: Number(e.target.value) })}
                              className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>Hauteur de scène (cm)</FieldLabel>
                            <input
                              type="number"
                              min={200}
                              max={900}
                              value={cadEff.xlSceneH}
                              onChange={(e) => setCadrage({ xlSceneH: Number(e.target.value) })}
                              className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>Ligne de sol (cm)</FieldLabel>
                            <input
                              type="number"
                              min={0}
                              max={500}
                              value={cadEff.xlGroundY}
                              onChange={(e) => setCadrage({ xlGroundY: Number(e.target.value) })}
                              className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>XL à partir de (cm)</FieldLabel>
                            <input
                              type="number"
                              min={200}
                              max={1000}
                              value={cadEff.xlMinW}
                              onChange={(e) => setCadrage({ xlMinW: Number(e.target.value) })}
                              title="Largeur de produit à partir de laquelle la scène XL s'applique"
                              className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                        </div>
                      </>
                    )}
                    {/* Plafond piliers et seuil alpha : toujours HORS UI (décisions
                        Mathias 07/08 soir) — figés dans les recettes. */}
                    {/* Échelle PRODUIT (07/08 soir) : dilate le rectangle de pose
                        sans toucher à l'échafaudage — tournevis, 100 = fidèle. */}
                    <SubHeading>Échelle du produit (tournevis — 100 = fidèle)</SubHeading>
                    <div className="flex items-end gap-4 flex-wrap">
                      <div>
                        <FieldLabel>Largeur produit (%)</FieldLabel>
                        <input
                          type="number"
                          min={50}
                          max={200}
                          value={cadEff.produitLargeurPct}
                          onChange={(e) => setCadrage({ produitLargeurPct: Number(e.target.value) })}
                          title="100 = fidèle ; 110 = produit 10 % plus large dans la scène (centré)"
                          className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                        />
                      </div>
                      <div>
                        <FieldLabel>Hauteur produit (%)</FieldLabel>
                        <input
                          type="number"
                          min={50}
                          max={200}
                          value={cadEff.produitHauteurPct}
                          onChange={(e) => setCadrage({ produitHauteurPct: Number(e.target.value) })}
                          title="100 = fidèle ; 110 = produit 10 % plus haut, toujours posé sur la ligne de sol"
                          className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                        />
                      </div>
                    </div>

                    {selected === 'terminus' && (
                      <>
                        {/* Seuils de MESURE de la queue (couverture/détection)
                            RETIRÉS de l'UI (08/08 : internes au PNG, la preview
                            ne peut rien en montrer — tournevis de dépannage,
                            comme le seuil alpha). Reste le recouvrement, VISIBLE
                            en transparence sur l'aperçu. */}
                        <SubHeading>Coulissant — refoulement</SubHeading>
                        <div className="flex items-end gap-4 flex-wrap">
                          <div>
                            <FieldLabel>Recouvrement pilier droit (cm)</FieldLabel>
                            <input
                              type="number"
                              min={0}
                              max={60}
                              value={cadEff.recouvrementCm}
                              onChange={(e) => setCadrage({ recouvrementCm: Number(e.target.value) })}
                              title="Longueur de lame CACHÉE sous le pilier droit — montrée en transparence sur l'aperçu"
                              className="w-24 border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                        </div>

                        {/* Les réglages de scène XL ont rejoint la rangée du
                            haut, affichés en vue XL (commutateur). */}
                      </>
                    )}

                    {/* La rangée de pastilles a DISPARU (07/08 soir) : les
                        couleurs s'éditent au clic sur l'aperçu, directement. */}
                  </Card>
                  )}

                  {/* ============ Tailles (20/08 — demande Mathias : le tableau
                      croisé des tailles proposées, géré à la main, une taille
                      hors tableau est refusée au lancement) ============ */}
                  {cadEff && isDaKey(selected) && (
                  <Card id={MOTEUR_ANCHOR('tailles')}>
                    <CardTitle
                      extra={
                        <button
                          type="button"
                          onClick={() => setField('taillesMes', undefined)}
                          disabled={!reglages}
                          title="Efface les modifications : le moteur reprend les tailles du catalogue 2027"
                          className="bg-white border border-border text-text-secondary rounded-[8px] px-3 py-1.5 text-xs font-bold hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
                        >
                          Tailles du catalogue 2027
                        </button>
                      }
                    >
                      Tailles
                    </CardTitle>
                    <p className="text-[13px] text-text-secondary mb-4 max-w-[720px]">
                      La liste des tailles proposées en mise en situation — ajoute ou retire, le
                      tableau croisé en dessous se recompose tout seul. Une taille absente de la
                      liste est <b className="text-text-primary">refusée au lancement</b> avec un
                      message clair.
                    </p>
                    <ListeTailles
                      moteur={isDaKey(selected) ? selected : 'janus'}
                      cadrage={cadEff}
                      tailles={taillesMesEffectives(
                        isDaKey(selected) ? selected : 'janus',
                        reglages?.taillesMes
                      )}
                      onChange={(t) => setField('taillesMes', t)}
                    />
                    <SubHeading>Vue d&apos;ensemble</SubHeading>
                    <TableauCroiseTailles
                      moteur={isDaKey(selected) ? selected : 'janus'}
                      cadrage={cadEff}
                      tailles={taillesMesEffectives(
                        isDaKey(selected) ? selected : 'janus',
                        reglages?.taillesMes
                      )}
                    />
                  </Card>
                  )}

                  <Card id={MOTEUR_ANCHOR('prompts')}>
                    <CardTitle
                      extra={
                        dernierPrompt ? (
                          <span className="text-xs text-text-disabled font-normal">
                            dernier modifié le {fmtDbDate(dernierPrompt.updated)}
                            {dernierPrompt.updatedBy ? ` par ${dernierPrompt.updatedBy}` : ''}
                          </span>
                        ) : undefined
                      }
                    >
                      Prompt System
                    </CardTitle>
                    <p className="text-[13px] text-text-secondary mb-3">
                      La méthode « décor autour » tient en <b className="text-text-primary">un seul appel</b> :
                      le produit est posé à sa vraie échelle sur un plan gris, Nano peint l’entrée tout
                      autour (élévation à plat, produit verrouillé). Ce prompt est TOUT le rendu.
                    </p>
                    {promptRows(promptDefsDa)}
                  </Card>

                  <Card id={MOTEUR_ANCHOR('export')}>
                    <CardTitle>Export &amp; générations</CardTitle>
                    <div className="flex flex-wrap gap-x-8 gap-y-4">
                      <div>
                        <FieldLabel>Qualité Nano</FieldLabel>
                        <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                          2K / 4K — au choix au lancement
                        </span>
                      </div>
                      {/* « Générations par taille » RETIRÉ de la fiche décor autour
                          (07/08 soir) : MES Contrainte génère toujours 1 image —
                          les variantes passent par les VERSIONS (regénération,
                          retours) de la vue en grand. Le réglage restait affiché
                          mais n'était jamais lu : un réglage mort ment. */}
                      <div>
                        <FieldLabel>Générations par image</FieldLabel>
                        <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                          1 — les variantes passent par les versions
                        </span>
                      </div>
                      {/* Juge vision (17/08) : chaque rendu est jugé (produit
                          intact, échelle, scène) — refus flagrant = relance
                          automatique d'une version, 2 relances max. Critères :
                          prompt « Juge des MES » de la carte Prompt System. */}
                      <div>
                        <FieldLabel>Juge vision (relance auto, 2 max)</FieldLabel>
                        <Seg
                          value={reglages?.jugeMes ?? 'off'}
                          options={[
                            { value: 'on', label: 'Activé' },
                            { value: 'off', label: 'Désactivé' },
                          ]}
                          onChange={(v) => setField('jugeMes', v)}
                          disabled={!reglages}
                        />
                      </div>
                      <div>
                        <FieldLabel>Déclinaison Marketplace (2000 × 2000)</FieldLabel>
                        <Seg
                          value={reglages?.marketplace ?? 'choix'}
                          options={[
                            { value: 'choix', label: 'Au choix' },
                            { value: 'toujours', label: 'Automatique' },
                            { value: 'jamais', label: 'Jamais' },
                          ]}
                          onChange={(v) => setField('marketplace', v)}
                          disabled={!reglages}
                        />
                      </div>
                      {/* L'ancien modèle éditable ({MARQUE}-{TAILLE}_…) n'était
                          branché sur RIEN côté MES Contrainte — remplacé par
                          l'affichage du VRAI format, UNE zone par sortie (08/08). */}
                      <div>
                        <FieldLabel>Nom du livrable — WEB</FieldLabel>
                        <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm font-mono text-text-secondary">
                          {'{PRODUIT}_{TAILLE}_{COLORIS}_WEB.jpg'}
                        </span>
                      </div>
                      <div>
                        <FieldLabel>Nom du livrable — MP</FieldLabel>
                        <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm font-mono text-text-secondary">
                          {'{PRODUIT}_{TAILLE}_{COLORIS}_MP.jpg'}
                        </span>
                      </div>
                    </div>
                  </Card>

                  {dirty && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={save}
                        disabled={busy || !reglages}
                        className="bg-brand-green text-white text-sm font-bold rounded-[10px] px-5 py-2.5 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                      >
                        Enregistrer les réglages du moteur
                      </button>
                      <span className="text-xs text-brand-teal">Modifications non enregistrées.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  {/* ============ Détection & coloris ============ */}
                  <Card id={MOTEUR_ANCHOR('detection')}>
                      <CardTitle>Détection &amp; coloris</CardTitle>
                      <SubHeading>Détection du type de produit</SubHeading>
                      <Seg
                        value={reglages?.detectionType ?? 'auto'}
                        options={[
                          { value: 'auto', label: 'Automatique' },
                          { value: 'manuel', label: 'Manuel' },
                        ]}
                        onChange={(v) => setField('detectionType', v)}
                        disabled={!reglages}
                      />

                      <SubHeading>Détourage du produit</SubHeading>
                      <div>
                        <FieldLabel>Moteur de détourage</FieldLabel>
                        <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                          BiRefNet (local)
                        </span>
                      </div>

                      <SubHeading>Reconnaissance du coloris</SubHeading>
                      <div className="flex flex-wrap gap-2">
                        {coloris.map((c) => (
                          <span
                            key={c.key}
                            className="flex items-center gap-2 border border-border rounded-[8px] px-3 py-2 text-sm"
                          >
                            <span
                              className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
                              style={{ background: c.swatch }}
                            />
                            <b>{c.label}</b>
                            {c.ral && <small className="text-text-secondary text-[11.5px]">{c.ral}</small>}
                            {c.custom && (
                              <button
                                type="button"
                                onClick={() => deleteColoris(c)}
                                title="Supprimer ce coloris de la palette"
                                className="text-text-disabled hover:text-brand-red text-xs font-bold"
                              >
                                ✕
                              </button>
                            )}
                          </span>
                        ))}
                        {!colorisForm && (
                          <button
                            type="button"
                            onClick={() => setColorisForm({ label: '', ral: '', swatch: '#9ca3af' })}
                            className="border border-dashed border-border rounded-[8px] px-3 py-2 text-sm font-bold text-brand-green hover:border-brand-green transition-colors"
                          >
                            ＋ Ajouter
                          </button>
                        )}
                      </div>
                      {colorisForm && (
                        <div className="mt-3 flex flex-wrap items-end gap-3 border border-border rounded-[8px] p-3 bg-surface">
                          <div>
                            <FieldLabel>Nom du coloris</FieldLabel>
                            <input
                              type="text"
                              value={colorisForm.label}
                              onChange={(e) => setColorisForm({ ...colorisForm, label: e.target.value })}
                              placeholder="ex. Beige"
                              maxLength={40}
                              className="w-40 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>RAL (facultatif)</FieldLabel>
                            <input
                              type="text"
                              value={colorisForm.ral}
                              onChange={(e) => setColorisForm({ ...colorisForm, ral: e.target.value })}
                              placeholder="ex. RAL 1015"
                              maxLength={20}
                              className="w-32 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>Pastille</FieldLabel>
                            <input
                              type="color"
                              value={colorisForm.swatch}
                              onChange={(e) => setColorisForm({ ...colorisForm, swatch: e.target.value })}
                              title="Couleur de la pastille"
                              className="w-12 h-9 border border-border rounded-[8px] bg-white cursor-pointer"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={submitColoris}
                            disabled={busy || !colorisForm.label.trim()}
                            className="bg-brand-green text-white text-xs font-bold rounded-[8px] px-4 py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                          >
                            Ajouter
                          </button>
                          <button
                            type="button"
                            onClick={() => setColorisForm(null)}
                            className="text-xs text-text-secondary hover:underline py-2"
                          >
                            Annuler
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-text-secondary mt-2">
                        Un coloris ajouté devient disponible partout où l&apos;on choisit un coloris à la
                        main (correction sur la fiche produit). La détection automatique par l&apos;image
                        continue de ne trancher qu&apos;entre les coloris d&apos;origine.
                      </p>
                  </Card>

                  {/* ============ RALify (maquette ralify-v2 validée le 28/07/2026) ============ */}
                  <Card id={MOTEUR_ANCHOR('ralify')}>
                      <CardTitle
                        extra={
                          <Seg
                            value={reglages?.ralify.actif ? 'on' : 'off'}
                            options={[
                              { value: 'on', label: 'Activé' },
                              { value: 'off', label: 'Désactivé' },
                            ]}
                            onChange={(val) =>
                              reglages && setField('ralify', { ...reglages.ralify, actif: val === 'on' })
                            }
                            disabled={!reglages}
                          />
                        }
                      >
                        RALify
                      </CardTitle>
                      <RalifySection
                        moteur={selected}
                        value={reglages?.ralify ?? null}
                        coloris={coloris}
                        onChange={(r) => setField('ralify', r)}
                        onPaletteChange={setColoris}
                        disabled={!reglages}
                      />
                  </Card>

                  {/* ============ Gabarits (ex-page Admin → Gabarits, absorbée) ============ */}
                  <Card id={MOTEUR_ANCHOR('gabarits')}>
                      <CardTitle>Gabarits</CardTitle>
                      <GabaritsManager moteur={selected} embedded />
                  </Card>

                  {/* ============ Gabarits XL (coulissants larges 450-600, 22/07/2026) ============ */}
                  {selected === 'coulissant' && (
                    <Card id={MOTEUR_ANCHOR('gabarits-xl')}>
                      <CardTitle>Gabarits XL</CardTitle>
                      <GabaritsManager moteur="coulissant-xl" embedded />
                    </Card>
                  )}

                  {/* ============ Canny ============ */}
                  <Card id={MOTEUR_ANCHOR('canny')}>
                      <CardTitle>Canny</CardTitle>
                      <div className="flex flex-wrap gap-5 items-start">
                        {/* Aperçu agrandi ×2,5 (retour Mathias 13/07/2026 : 160 px illisible). */}
                        <figure className="w-[400px] max-w-full flex-none">
                          {canny ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/artifacts?p=${encodeURIComponent(canny.relPath)}&v=${canny.version}`}
                              alt="Canny trottoir de référence"
                              className="w-full rounded-[8px] border border-border bg-black"
                            />
                          ) : (
                            <div className="w-full aspect-[2000/1330] rounded-[8px] border border-border bg-surface" />
                          )}
                          <figcaption className="text-[11px] text-text-disabled mt-1 text-center">
                            {canny ? (
                              `Référence ${canny.width ?? '?'}×${canny.height ?? '?'} · ${
                                canny.custom ? 'personnalisée' : 'd’origine'
                              }`
                            ) : (
                              <span className="anim-respire">Chargement…</span>
                            )}
                          </figcaption>
                        </figure>
                        {/* Options en UNE colonne (mise en page Canny XL préférée par
                            Mathias le 22/07/2026, appliquée à tous les moteurs). */}
                        <div className="flex flex-col gap-4 flex-1 min-w-64">
                          <div>
                            <FieldLabel>Alignement des piliers au sol</FieldLabel>
                            <Seg
                              value={reglages?.cannyPlacement ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                                { value: 'off', label: 'Off' },
                              ]}
                              onChange={(v) => setField('cannyPlacement', v)}
                              disabled={!reglages}
                            />
                            {reglages?.cannyPlacement === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={-300}
                                  max={300}
                                  value={reglages.cannyOffsetPx}
                                  onChange={(e) => setField('cannyOffsetPx', Number(e.target.value) || 0)}
                                  title="Décalage manuel de la ligne de sol"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">px · positif = descendu</span>
                              </div>
                            )}
                          </div>
                          <div>
                            <FieldLabel>Largeur du corridor</FieldLabel>
                            <Seg
                              value={reglages?.corridor ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                              ]}
                              onChange={(v) => setField('corridor', v)}
                              disabled={!reglages}
                            />
                            {reglages?.corridor === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={100}
                                  max={800}
                                  value={reglages.corridorWidthCm}
                                  onChange={(e) => setField('corridorWidthCm', Number(e.target.value) || 0)}
                                  title="Largeur imposée du corridor"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">cm</span>
                              </div>
                            )}
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              Auto = plus grande taille active du moteur.
                            </p>
                          </div>
                          <div>
                            <FieldLabel>Image de référence</FieldLabel>
                            <input
                              ref={cannyFileRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                // On vide l'input pour pouvoir re-choisir le MÊME fichier ensuite.
                                e.target.value = ''
                                if (f) uploadCanny(f)
                              }}
                            />
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={cannyBusy || !canny}
                                onClick={() => cannyFileRef.current?.click()}
                                className="bg-white border border-border rounded-[8px] px-3.5 py-1.5 text-xs font-bold text-text-secondary hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
                              >
                                {cannyBusy ? 'Envoi…' : 'Remplacer'}
                              </button>
                              {canny?.custom && (
                                <button
                                  type="button"
                                  disabled={cannyBusy}
                                  onClick={resetCanny}
                                  className="text-xs text-text-secondary hover:underline disabled:opacity-50"
                                >
                                  Revenir à l&apos;image d&apos;origine
                                </button>
                              )}
                            </span>
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              PNG, JPG ou WebP. L&apos;image est utilisée telle quelle par le moteur dès la
                              prochaine génération.
                            </p>
                          </div>
                        </div>
                      </div>
                  </Card>

                  {/* ============ Canny XL (coulissants 450-600, 22/07/2026) — rubrique à
                       part, comme Gabarits XL : le Canny standard ne bouge pas. ============ */}
                  {selected === 'coulissant' && (
                    <Card id={MOTEUR_ANCHOR('canny-xl')}>
                      <CardTitle>Canny XL</CardTitle>
                      <p className="text-xs text-text-secondary mb-4">
                        Utilisé UNIQUEMENT par les tailles et décors XL (coulissants 450 – 600) — il
                        vient en complément, le Canny de la rubrique précédente reste celui du standard.
                      </p>
                      <div className="flex flex-wrap gap-5 items-start">
                        <figure className="w-[400px] max-w-full flex-none">
                          {cannyXl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/artifacts?p=${encodeURIComponent(cannyXl.relPath)}&v=${cannyXl.version}`}
                              alt="Canny XL de référence"
                              className="w-full rounded-[8px] border border-border bg-black"
                            />
                          ) : (
                            <div className="w-full aspect-[2000/1330] rounded-[8px] border border-border bg-surface" />
                          )}
                          <figcaption className="text-[11px] text-text-disabled mt-1 text-center">
                            {cannyXl ? (
                              `Référence XL ${cannyXl.width ?? '?'}×${cannyXl.height ?? '?'} · ${
                                cannyXl.custom ? 'personnalisée' : 'd’origine'
                              }`
                            ) : (
                              <span className="anim-respire">Chargement…</span>
                            )}
                          </figcaption>
                        </figure>
                        <div className="flex flex-col gap-4 flex-1 min-w-64">
                          <div>
                            <FieldLabel>Alignement des piliers au sol</FieldLabel>
                            <Seg
                              value={reglagesXl?.cannyPlacement ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                                { value: 'off', label: 'Off' },
                              ]}
                              onChange={(v) => setFieldXl('cannyPlacement', v)}
                              disabled={!reglagesXl}
                            />
                            {reglagesXl?.cannyPlacement === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={-300}
                                  max={300}
                                  value={reglagesXl.cannyOffsetPx}
                                  onChange={(e) => setFieldXl('cannyOffsetPx', Number(e.target.value) || 0)}
                                  title="Décalage manuel de la ligne de sol (jeu XL)"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">px · positif = descendu</span>
                              </div>
                            )}
                          </div>
                          <div>
                            <FieldLabel>Largeur du corridor</FieldLabel>
                            <Seg
                              value={reglagesXl?.corridor ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                              ]}
                              onChange={(v) => setFieldXl('corridor', v)}
                              disabled={!reglagesXl}
                            />
                            {reglagesXl?.corridor === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={100}
                                  max={800}
                                  value={reglagesXl.corridorWidthCm}
                                  onChange={(e) => setFieldXl('corridorWidthCm', Number(e.target.value) || 0)}
                                  title="Largeur imposée du corridor (jeu XL)"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">cm</span>
                              </div>
                            )}
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              Auto = plus grande taille XL active (600 cm).
                            </p>
                          </div>
                          <div>
                            <FieldLabel>Image de référence</FieldLabel>
                            <input
                              ref={cannyXlFileRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                e.target.value = ''
                                if (f) uploadCannyXl(f)
                              }}
                            />
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={cannyXlBusy || !cannyXl}
                                onClick={() => cannyXlFileRef.current?.click()}
                                className="bg-white border border-border rounded-[8px] px-3.5 py-1.5 text-xs font-bold text-text-secondary hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
                              >
                                {cannyXlBusy ? 'Envoi…' : 'Remplacer'}
                              </button>
                              {cannyXl?.custom && (
                                <button
                                  type="button"
                                  disabled={cannyXlBusy}
                                  onClick={resetCannyXl}
                                  className="text-xs text-text-secondary hover:underline disabled:opacity-50"
                                >
                                  Revenir à l&apos;image d&apos;origine
                                </button>
                              )}
                            </span>
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              Trottoir « caméra reculée » : sert uniquement aux décors XL —
                              remplaçable à tout moment.
                            </p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* ============ Prompt System ============ */}
                  <Card id={MOTEUR_ANCHOR('prompts')}>
                      <CardTitle
                        extra={
                          dernierPrompt ? (
                            <span className="text-xs text-text-disabled font-normal">
                              {promptMetas.length} prompts · dernier modifié le{' '}
                              {fmtDbDate(dernierPrompt.updated)}
                              {dernierPrompt.updatedBy ? ` par ${dernierPrompt.updatedBy}` : ''}
                            </span>
                          ) : undefined
                        }
                      >
                        Prompt System
                      </CardTitle>
                      <div className="space-y-0 divide-y divide-border">
                        <div className="pb-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">1</span>
                            <h3 className="font-semibold text-[15px]">Décor</h3>
                          </div>
                          {promptRows(selected === 'coulissant' ? PROMPTS_DECOR_COULISSANT : PROMPTS_DECOR)}
                        </div>

                        <div className="py-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">2</span>
                            <h3 className="font-semibold text-[15px]">Piliers &amp; murets</h3>
                          </div>
                          {promptRows(PROMPTS_PILIERS)}
                          <div className="mt-3">
                            <FieldLabel>Masquage de la sortie</FieldLabel>
                            <Seg
                              value={reglages?.masking ?? 'off'}
                              options={[
                                { value: 'off', label: 'Brut' },
                                { value: 'pixel-lock', label: 'Pixel-lock' },
                              ]}
                              onChange={(v) => setField('masking', v)}
                              disabled={!reglages}
                            />
                          </div>
                        </div>

                        <div className="py-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">3</span>
                            <h3 className="font-semibold text-[15px]">
                              Intégration {PRODUIT_PAR_MOTEUR[selected]}
                            </h3>
                          </div>
                          {promptRows(promptsIntegration(PRODUIT_PAR_MOTEUR[selected]))}
                          <div className="flex flex-wrap gap-x-8 gap-y-4 mt-3">
                            <div>
                              <FieldLabel>Méthode</FieldLabel>
                              <Seg
                                value={reglages?.integrationMethod ?? 'simple'}
                                options={[
                                  // « Pose + fusion » (chantier 17/07/2026) : le code pose le produit
                                  // au pixel près, UN appel Nano fait stuc + lumière/ombres.
                                  { value: 'pose-fusion', label: 'Pose + fusion' },
                                  { value: 'simple', label: 'Simple' },
                                  // « Verrouillée » = ex-« rectangle » (renommage Mathias 13/07/2026) :
                                  // décor verrouillé au pixel autour du portail + contrôles.
                                  // « Pose directe » (archivée le 09/07) retirée du sélecteur le
                                  // 13/07 (décision Mathias) — toujours réactivable côté code,
                                  // cf. docs/ARCHIVE-methode-pose-directe.md.
                                  { value: 'rectangle', label: 'Verrouillée' },
                                ]}
                                onChange={(v) => setField('integrationMethod', v)}
                                disabled={!reglages}
                              />
                            </div>
                            {reglages?.integrationMethod === 'pose-fusion' && (
                              <>
                                <div>
                                  <FieldLabel>Masquage / composite</FieldLabel>
                                  <Seg
                                    value={reglages.poseFusionComposite ?? 'on'}
                                    options={[
                                      { value: 'on', label: 'Activé' },
                                      { value: 'off', label: 'Désactivé' },
                                    ]}
                                    onChange={(v) => setField('poseFusionComposite', v)}
                                    disabled={!reglages}
                                  />
                                  <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                                    Verrouille le décor au pixel autour du produit (composite pixel-lock,
                                    ou masque du pilier en coulissant). Désactivé = sortie brute de Nano.
                                  </p>
                                </div>
                                <div>
                                  <FieldLabel>Débord sur les piliers</FieldLabel>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min={0}
                                      max={10}
                                      step={0.1}
                                      value={reglages.poseDebordPct}
                                      onChange={(e) => setField('poseDebordPct', Number(e.target.value) || 0)}
                                      title="Débordement du produit sur chaque pilier, en % de la largeur"
                                      className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                    />
                                    <span className="text-xs text-text-disabled">% par côté (2 % validé le 17/07)</span>
                                  </div>
                                </div>
                                <div>
                                  <FieldLabel>Seuil alpha du nettoyage</FieldLabel>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min={1}
                                      max={255}
                                      value={reglages.poseSeuilAlpha}
                                      onChange={(e) => setField('poseSeuilAlpha', Number(e.target.value) || 0)}
                                      title="Alpha minimal conservé au nettoyage du PNG produit"
                                      className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                    />
                                    <span className="text-xs text-text-disabled">1-255 · retire les pixels fantômes (200 validé)</span>
                                  </div>
                                </div>
                                {selected === 'coulissant' && (
                                  <div>
                                    <FieldLabel>Ombre du pilier sur la lame</FieldLabel>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={reglages.ombrePilierPct}
                                        onChange={(e) => setField('ombrePilierPct', Number(e.target.value) || 0)}
                                        title="Opacité maximale de l'ombre au contact du pilier droit — dégradé progressif sur toute la largeur du pilier, l'indice qui fait passer la lame DERRIÈRE"
                                        className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                      />
                                      <span className="text-xs text-text-disabled">% d&apos;opacité au contact · 0 = désactivée</span>
                                    </div>
                                    {/* Aperçu LIVE de la jonction (demande Mathias 28/07/2026) : lame,
                                        dégradé d'ombre très progressif sur 1,5 × la largeur du pilier
                                        (2ᵉ itération du 28/07) puis pilier — l'opacité suit la saisie. */}
                                    <div
                                      className="mt-2 relative w-[220px] h-[110px] rounded-[8px] border border-border overflow-hidden"
                                      style={{ background: '#dce9f2' }}
                                      title="Aperçu de la jonction lame / pilier droit"
                                    >
                                      <div className="absolute" style={{ left: 0, top: 14, width: 130, height: 82, background: '#3f4650' }}>
                                        <div style={{ position: 'absolute', top: '33%', left: 0, right: 0, height: 1, background: '#333a42' }} />
                                        <div style={{ position: 'absolute', top: '66%', left: 0, right: 0, height: 1, background: '#333a42' }} />
                                      </div>
                                      <div
                                        className="absolute"
                                        style={{
                                          left: 40,
                                          top: 14,
                                          width: 90,
                                          height: 82,
                                          background: `linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,${Math.min(100, Math.max(0, reglages.ombrePilierPct)) / 100}))`,
                                        }}
                                      />
                                      <div className="absolute" style={{ left: 130, top: 0, width: 60, height: '100%', background: '#efefec', borderLeft: '1px solid #d8d8d4' }} />
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                            <div>
                              <FieldLabel>Ombres portées</FieldLabel>
                              <Seg
                                value={reglages?.shadows ?? 'auto'}
                                options={[
                                  { value: 'auto', label: 'Auto' },
                                  { value: 'off', label: 'Off' },
                                ]}
                                onChange={(v) => setField('shadows', v)}
                                disabled={!reglages}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="pt-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">4</span>
                            <h3 className="font-semibold text-[15px]">Générations par taille</h3>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <input
                              type="number"
                              min={1}
                              max={6}
                              value={reglages?.generationsParTaille ?? 3}
                              onChange={(e) =>
                                setField(
                                  'generationsParTaille',
                                  Math.min(6, Math.max(1, Math.round(Number(e.target.value) || 1)))
                                )
                              }
                              disabled={!reglages}
                              className="w-20 border border-border bg-white rounded-[8px] px-3 py-2 text-sm text-center tabular-nums focus:outline-none focus:border-brand-green transition-colors disabled:opacity-50"
                            />
                            <span className="text-sm text-text-secondary">génération(s) par taille</span>
                          </div>
                          <p className="text-xs text-text-secondary mt-1.5">
                            Nombre d&apos;images produites pour chaque taille. Au-delà de 1, on en{' '}
                            <b>choisit une</b> (la MES retenue) dans la vue en grand — et seule la
                            retenue peut passer en Marketplace. <b>1</b> = une seule image (classique).
                          </p>
                        </div>

                        <div className="pt-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">5</span>
                            <h3 className="font-semibold text-[15px]">Marketplace — carré 2000×2000</h3>
                          </div>
                          <div className="mb-3">
                            <FieldLabel>Déclinaison en MP</FieldLabel>
                            <Seg
                              value={reglages?.marketplace ?? 'choix'}
                              options={[
                                { value: 'choix', label: 'Au choix' },
                                { value: 'toujours', label: 'Toujours auto' },
                                { value: 'jamais', label: 'Jamais' },
                              ]}
                              onChange={(v) => setField('marketplace', v)}
                              disabled={!reglages}
                            />
                            <p className="text-xs text-text-secondary mt-1.5">
                              <b>Au choix</b> : case à cocher au lancement + bouton 1:1 sur le résultat.{' '}
                              <b>Toujours auto</b> : chaque MES Site est déclinée automatiquement.{' '}
                              <b>Jamais</b> : le MP disparaît de l&apos;interface et l&apos;API le refuse.
                            </p>
                          </div>
                          {promptRows(PROMPTS_MARKETPLACE)}
                          <p className="text-xs text-text-secondary mt-2.5">
                            Recadrage serré sur le {PRODUIT_PAR_MOTEUR[selected]} ; s&apos;il dépasse, les
                            bords sont étendus par outpainting natif de Nano Banana (prompt ci-dessus,
                            propre au moteur).
                          </p>
                        </div>
                      </div>
                  </Card>

                  {/* ============ Export ============ */}
                  <Card id={MOTEUR_ANCHOR('export')}>
                      <CardTitle>Export</CardTitle>
                      <div className="flex flex-wrap gap-x-8 gap-y-4">
                        <div>
                          <FieldLabel>Site produit</FieldLabel>
                          <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                            2000 × 1330
                          </span>
                        </div>
                        <div>
                          <FieldLabel>Marketplace</FieldLabel>
                          <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                            2000 × 2000 ·{' '}
                            {reglages?.marketplace === 'jamais'
                              ? 'désactivé'
                              : reglages?.marketplace === 'toujours'
                                ? 'automatique'
                                : 'au choix au lancement'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-72">
                          <FieldLabel>Nom du livrable</FieldLabel>
                          <input
                            type="text"
                            value={reglages?.livraisonName ?? ''}
                            onChange={(e) => setField('livraisonName', e.target.value)}
                            disabled={!reglages}
                            title="Modèle de nom du livrable"
                            className="w-full border border-border bg-white rounded-[8px] px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-green transition-colors"
                          />
                        </div>
                      </div>
                  </Card>

                  {/* Rappel d'enregistrement en bas de la pile — le bouton principal vit
                      dans le bandeau collant ; les gabarits, eux, s'enregistrent seuls. */}
                  {(dirty || dirtyXl) && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={save}
                        disabled={busy || !reglages}
                        className="bg-brand-green text-white text-sm font-bold rounded-[10px] px-5 py-2.5 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                      >
                        Enregistrer les réglages du moteur
                      </button>
                      <span className="text-xs text-brand-teal">Modifications non enregistrées.</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
