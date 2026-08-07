'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { parseProduitFromFileName, parseSizeFromProductName } from '@/lib/productName'
import { COULISSANT_XL_MIN_W } from '@/lib/gabaritSets'
import Silhouette, {
  PictoIllu,
  SilhouetteMode,
  SilhouetteOrigineIcone,
  type Typo,
} from '../Silhouette'
import MesStudio, { type StudioVariant } from './MesStudio'
import MesLibre from './MesLibre'
import PhraseAttente from '@/components/PhraseAttente'
import { groupMesSlots, displayVariant, slotKeyOf, variantNo } from '@/lib/mesVariants'

/**
 * « Génération » — génération DIRECTE, sans catalogue (maquette generation-v4
 * validée le 13/07/2026). On choisit le mode (Contrainte / Libre), la typologie
 * (moteur), on dépose une ou plusieurs images du MÊME produit, la taille et le
 * coloris sont détectés depuis le nom de fichier (corrigeables), on impose un
 * décor + des formats, puis on génère et on télécharge en direct.
 *
 * LOT 1 : l'écran complet, navigable.
 * LOT 2 (13/07) : câblage moteur — upload → détourage BiRefNet → launchGammeJobs
 *   (piliers + intégration chaînée) → suivi du batch → téléchargement du Site.
 * LOT 3 (13/07) : résultat redessiné (grille adaptative, clic → agrandir, ↻/⬇ en
 *   icônes), ↻ regénérer (sans prompt) et passage Marketplace (MP) après le Site.
 * LOT 4 (à venir) : studio MES — édition par prompt → versions → choix de version.
 * Le mode Libre est un brouillon d'UI (priorité #4 du cadrage).
 */

// —————————————————————————————————————————————— types & données
interface DecorEntry {
  id: number
  file_path: string
  name: string
  slug: string
  gamme: string | null
  // « coulissant-xl » (28/07/2026) : décor à l'échelle XL, réservé aux
  // coulissants ≥ 450 — jamais mélangé avec les décors standards.
  type: 'battant' | 'coulissant' | 'portillon' | 'coulissant-xl'
  status: string
  image_size: string | null
}

interface Img {
  id: string
  file: File
  name: string
  url: string
  color: string
  w: number
  h: number
  detSize: boolean
  editSize: boolean
  editColor: boolean
}

interface Job {
  id: number
  type: string
  status: string
  payload: {
    coloris?: string
    size?: { w: number; h: number }
    rootJobId?: number
    instruction?: string
    /** Moteur du job — absent pour un battant (non-régression JANUS). */
    moteur?: string
    /** Numéro de génération (1..N) — absent = génération unique. */
    variant?: number
    /** Essai du Labo moteur : jamais affiché dans une session de génération. */
    lab?: boolean
  } | null
  result: { deliveryPath?: string; sizeLabel?: string; productPath?: string } | null
  error: string | null
  /** MES retenue de sa taille (générations multiples, 29/07/2026). */
  chosen?: boolean
}

/** Un essai du Labo moteur peut partager le lot d'une session (il réutilise un
 *  job Piliers) : on l'écarte de TOUT l'écran — grille, compteurs, progression. */
function sansEssaisLab(js: Job[]): Job[] {
  return js.filter((j) => j.payload?.lab !== true)
}

/** Job porteur de la MES Site finale : intégration classique ou « pose-fusion »
 *  (chantier 17/07/2026 — un seul job décor+aplats+produit posé → un appel Nano). */
function isMesJob(j: Job): boolean {
  return j.type === 'integration' || j.type === 'pose-fusion'
}

/**
 * Vocabulaire par moteur (règle « moteur = contenu adapté ») : libellés d'écran
 * et LETTRE de la nomenclature produit — 300B140 battant, 300C140 coulissant,
 * 100P140 portillon (convention serveur).
 */
const TYPO_INFO: Record<Typo, { titre: string; moteur: string; lettre: string }> = {
  // Séparation totale (05/08/2026) : ces moteurs portent la méthode legacy —
  // les JANUS/TERMINUS/FORCULUS sans étiquette sont ceux du mode décor autour.
  battant: { titre: 'Portail battant', moteur: 'Battant « JANUS (legacy) »', lettre: 'B' },
  coulissant: {
    titre: 'Portail coulissant',
    moteur: 'Coulissant « TERMINUS (legacy) »',
    lettre: 'C',
  },
  portillon: { titre: 'Portillon', moteur: 'Portillon « FORCULUS (legacy) »', lettre: 'P' },
}

/** Cartes LEGACY (MES Contrainte legacy, MES Décors) masquées le 07/08/2026
 *  (demande Mathias — MES Contrainte nouvelle méthode officielle). Le code et
 *  les flux restent intacts : repasser à true pour les réafficher. */
const AFFICHER_LEGACY = false

/* Les pictos PNG Fluent Emoji (13/07/2026) ont été remplacés le 22/07/2026 par
   les pictos SVG animés PictoIllu (../Silhouette), même langage que les
   illustrations de mode. */

/**
 * Fil d'ariane « chemin » (maquette choix-mode-typologie-v1, variante B validée
 * le 13/07/2026) : bouton retour rond + parents cliquables + position en gras.
 * Un parent sans onClick s'affiche mais ne ramène pas en arrière (ex. Contrainte
 * une fois la génération lancée).
 */
function Chemin({
  onBack,
  parents,
  here,
  sub,
  children,
}: {
  onBack: () => void
  parents: { label: string; onClick?: () => void }[]
  here: string
  sub?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap mb-5">
      <button
        onClick={onBack}
        title="Retour"
        className="w-[34px] h-[34px] rounded-full border border-border bg-white text-text-secondary grid place-items-center shadow-sm mr-2 hover:border-brand-green hover:text-brand-green hover:bg-brand-green-light transition-colors"
      >
        ←
      </button>
      {parents.map((p) => (
        <span key={p.label} className="flex items-center gap-1">
          {p.onClick ? (
            <button
              onClick={p.onClick}
              className="text-sm font-semibold text-text-secondary px-2 py-1 rounded-[8px] hover:text-brand-green hover:bg-brand-green-light transition-colors"
            >
              {p.label}
            </button>
          ) : (
            <span className="text-sm font-semibold text-text-secondary px-2 py-1">{p.label}</span>
          )}
          <span className="text-[#c9cfd6] text-[13px]">›</span>
        </span>
      ))}
      <span className="text-sm font-bold px-2 py-1">
        {here}{' '}
        {sub && <span className="text-[12px] font-semibold text-brand-green">{sub}</span>}
      </span>
      {children}
    </div>
  )
}

// Silhouettes produit : composant partagé ../Silhouette (aussi utilisé par le Catalogue).

/** Lettre de nomenclature du job (son moteur) — battant « B » par défaut. */
function lettreOf(j: Job): string {
  const m = j.payload?.moteur
  return m === 'coulissant' || m === 'portillon' ? TYPO_INFO[m].lettre : 'B'
}

/** Palette du moteur battant (lot 3 : la brancher sur la vraie palette catalogue). */
const COLORS = [
  { name: 'Gris', sw: '#4a4d52' },
  { name: 'Noir', sw: '#1f2937' },
  { name: 'Blanc', sw: '#fdfdfd' },
  { name: 'Teck', sw: '#a37c62' },
]

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

/** Lecture du nom de fichier : taille (300B140, 300C140, 100P140) + coloris (blanc, 7016…). */
function parseName(name: string): { w: number | null; h: number | null; color: string | null } {
  const up = name.toUpperCase()
  const size = parseSizeFromProductName(name)
  let color: string | null = null
  if (/WHITE|BLANC/.test(up)) color = 'Blanc'
  else if (/BLACK|NOIR|9005/.test(up)) color = 'Noir'
  else if (/TECK|TEAK|BOIS/.test(up)) color = 'Teck'
  else if (/GREY|GRAY|GRIS|7016/.test(up)) color = 'Gris'
  return { w: size?.w ?? null, h: size?.h ?? null, color }
}

type Mode = 'con' | 'lib'
/** 'origine' (rework 22/07/2026) : après Contrainte, choix « Depuis le
 *  catalogue / Depuis mes images » — « mes images » va DIRECTEMENT au dépôt,
 *  la typologie est détectée depuis les noms de fichiers (fenêtre par-dessus
 *  si indevinable) ; l'écran « Typologie » a disparu (demande Mathias 22/07). */
type View = 'mode' | 'origine' | 'gen'
type Stage = 'input' | 'proc' | 'result'

/** Libellé d'une MES : « Gris · 300B140 » (la lettre suit le moteur : B/C/P). */
function labelOf(j: Job): string {
  const col = j.payload?.coloris ?? ''
  const w = j.payload?.size?.w
  const h = j.payload?.size?.h
  return w && h ? `${col} · ${w}${lettreOf(j)}${h}` : col || j.result?.sizeLabel || 'MES'
}

/** Nom de fichier livré : « vogel_gris_300C140_site.jpg » (lettre = moteur). */
function fnameOf(j: Job, kind: 'site' | 'marketplace', produit: string): string {
  const col = (j.payload?.coloris || 'mes').toLowerCase()
  const w = j.payload?.size?.w ?? ''
  const h = j.payload?.size?.h ?? ''
  return `${produit}_${col}_${w}${lettreOf(j)}${h}_${kind}.jpg`
}

/**
 * Grille des résultats — même règle que le catalogue (v10, validée) :
 * un bloc par coloris, une largeur = UNE ligne (jamais de repli), colonnes =
 * hauteurs du coloris triées, taille absente = case vide alignée. Toutes les
 * vignettes ont la même taille (colonnes = nb de hauteurs distinctes).
 */
function SizeRows({ jobs, render }: { jobs: Job[]; render: (j: Job) => ReactNode }) {
  const byColoris: Job[][] = []
  const idx = new Map<string, number>()
  for (const j of jobs) {
    const k = (j.payload?.coloris ?? '').toLowerCase()
    if (!idx.has(k)) {
      idx.set(k, byColoris.length)
      byColoris.push([])
    }
    byColoris[idx.get(k)!].push(j)
  }
  return (
    <>
      {byColoris.map((js) => {
        const sized = js.filter((j) => j.payload?.size)
        const unsized = js.filter((j) => !j.payload?.size)
        const widths = Array.from(new Set(sized.map((j) => j.payload!.size!.w))).sort(
          (a, b) => a - b
        )
        const heights = Array.from(new Set(sized.map((j) => j.payload!.size!.h))).sort(
          (a, b) => a - b
        )
        const coloris = js[0]?.payload?.coloris ?? ''
        return (
          <div key={coloris || 'sans-coloris'} className="mb-5 last:mb-0">
            {byColoris.length > 1 && (
              <h3 className="text-xs font-bold uppercase text-text-secondary mb-2">
                {coloris || 'Coloris à confirmer'}
              </h3>
            )}
            {widths.map((w) => (
              <div key={w} className="mb-4 last:mb-0">
                <h4 className="text-xs font-bold text-text-secondary mb-1.5">Largeur {w} cm</h4>
                {/* Largeur de colonne plafonnée : peu de tailles ≠ vignettes géantes. */}
                <div
                  className="stagger grid gap-4"
                  style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 500px))` }}
                >
                  {heights.map((h) => {
                    const cell = sized.filter(
                      (j) => j.payload!.size!.w === w && j.payload!.size!.h === h
                    )
                    if (cell.length === 0)
                      return <div key={h} title={`${w}×${h} absent de ce lot`} />
                    return (
                      <div key={h} className="grid gap-4 content-start">
                        {cell.map((j) => render(j))}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {unsized.length > 0 && (
              <div className="stagger grid gap-4 mt-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
                {unsized.map((j) => render(j))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// Ordre d'affichage des cartes (même logique que SizeRows : coloris par ordre
// d'arrivée, puis largeur et hauteur croissantes, tailles inconnues à la fin) —
// les flèches ← / → du Studio MES suivent cet ordre visible à l'écran.
function displayOrder(jobs: Job[]): Job[] {
  const byColoris: Job[][] = []
  const idx = new Map<string, number>()
  for (const j of jobs) {
    const k = (j.payload?.coloris ?? '').toLowerCase()
    if (!idx.has(k)) {
      idx.set(k, byColoris.length)
      byColoris.push([])
    }
    byColoris[idx.get(k)!].push(j)
  }
  const out: Job[] = []
  for (const js of byColoris) {
    const sized = js.filter((j) => j.payload?.size)
    const widths = Array.from(new Set(sized.map((j) => j.payload!.size!.w))).sort((a, b) => a - b)
    const heights = Array.from(new Set(sized.map((j) => j.payload!.size!.h))).sort((a, b) => a - b)
    for (const w of widths)
      for (const h of heights)
        out.push(...sized.filter((j) => j.payload!.size!.w === w && j.payload!.size!.h === h))
    out.push(...js.filter((j) => !j.payload?.size))
  }
  return out
}

// —————————————————————————————————————————————— page
export default function GenerationPage() {
  const [view, setView] = useState<View>('mode')
  const [mode, setMode] = useState<Mode>('con')
  // Accès direct depuis l'Accueil (rework 22/07/2026) : /generation?mode=contrainte
  // ou ?mode=libre présélectionne le mode. Lu au montage — pas de useSearchParams,
  // qui imposerait un <Suspense> à toute la page.
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode')
    if (m === 'contrainte') pickMode('con')
    else if (m === 'libre') pickMode('lib')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Typologie de l'étape 2 → moteur de génération (battant « JANUS », coulissant
  // « TERMINUS », portillon « FORCULUS »). Chaque moteur a ses tailles,
  // gabarits et prompts.
  const [typo, setTypo] = useState<Typo>('battant')
  // Typologie AUTOMATIQUE (demande Mathias 22/07/2026) : false tant qu'elle n'a
  // pas été détectée depuis un nom de fichier ou choisie dans la fenêtre
  // par-dessus (askTypo).
  const [typoKnown, setTypoKnown] = useState(true)
  const [askTypo, setAskTypo] = useState(false)
  const [stage, setStage] = useState<Stage>('input')
  // Nom du produit : détecté depuis le nom de fichier, corrigeable. Il identifie
  // la session sur l'accueil (« Mes sessions », validé 13/07/2026).
  const [produit, setProduit] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [decors, setDecors] = useState<DecorEntry[]>([])
  const [decorId, setDecorId] = useState<number | null>(null)
  // Décor XL (28/07/2026) : dès qu'une image coulissant fait ≥ 450 cm de large,
  // le lot exige AUSSI un décor « coulissant-xl » (échelle caméra reculée) — les
  // images XL partent avec ce décor, les autres avec le décor standard.
  const [decorXlId, setDecorXlId] = useState<number | null>(null)
  // — fenêtre « Choisir un décor » (maquette choix-decor-v1 validée le 13/07/2026,
  //   sans favoris) : recherche + filtre gamme, décors rangés par typologie.
  //   Un décor d'une autre typologie reste sélectionnable, avec avertissement.
  //   pickFor : 'std' = décor du lot, 'xl' = décor des tailles XL (que des décors XL).
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickFor, setPickFor] = useState<'std' | 'xl'>('std')
  const [pickId, setPickId] = useState<number | null>(null)
  const [pickSearch, setPickSearch] = useState('')
  const [pickGamme, setPickGamme] = useState('')
  const [pickTab, setPickTab] = useState<'' | Typo>('')
  const [notice, setNotice] = useState<string | null>(null)
  const [hot, setHot] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  // — suivi de la génération —
  const [batchId, setBatchId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [expected, setExpected] = useState(0)
  const [apiErrors, setApiErrors] = useState<{ name: string; error: string }[]>([])
  const [busyPoll, setBusyPoll] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [studioRoot, setStudioRoot] = useState<number | null>(null)
  const [chosen, setChosen] = useState<Record<number, number>>({})
  // MES dont le passage MP est demandé (bloque le bouton avant même le retour du poll)
  const [mpAskedRoots, setMpAskedRoots] = useState<Set<number>>(new Set())
  const [zipBusy, setZipBusy] = useState<'tout' | 'site' | 'mp' | null>(null)
  // Réglage « Déclinaison en MP » du moteur (Admin → Réglages par moteur) :
  // 'toujours' = automatique, 'jamais' = MP invisible, 'choix' = MP à la demande
  // via le bouton 1:1 des cartes (la case à cocher du lancement a été retirée
  // le 28/07/2026, demande Mathias).
  const [mpMode, setMpMode] = useState<'choix' | 'toujours' | 'jamais'>('choix')

  useEffect(() => {
    let alive = true
    fetch(`/api/moteurs/${typo}/reglages`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setMpMode(d.reglages?.marketplace ?? 'choix')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [typo])

  // — réouverture d'une session (accueil → « Mes sessions », validé 13/07/2026) —
  // /generation?session=<batch> ramène l'écran de résultats tel qu'à la fin de la
  // génération : téléchargements, studio, passage MP. Si des jobs tournent encore,
  // on retombe sur l'écran de progression qui basculera tout seul.
  // Le temps que la session arrive, on masque le choix du mode derrière un
  // écran de chargement (demande Mathias 28/07/2026) — sinon l'écran « Générer »
  // apparaît une seconde avant de sauter aux résultats.
  const [sessionLoading, setSessionLoading] = useState(false)
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get('session')
    if (!sid) return
    let alive = true
    setSessionLoading(true)
    fetch(`/api/generation/sessions/${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setSessionLoading(false)
        if (!d?.session) return
        const s = d.session
        setMode('con')
        setView('gen')
        if (s.moteur === 'battant' || s.moteur === 'coulissant' || s.moteur === 'portillon')
          setTypo(s.moteur)
        setProduit(s.produit ?? '')
        setExpected(s.mesCount ?? 0)
        setBatchId(s.batchId)
        setStage(s.busy ? 'proc' : 'result')
        setBusyPoll(true) // déclenche le chargement des jobs (s'arrête seul si tout est fini)
      })
      .catch(() => {
        if (alive) setSessionLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // — réouverture d'une session MES LIBRE (28/07/2026) — /generation?libre=<batch>
  // ouvre directement le mode Libre sur l'écran de résultats du lot.
  const [libreBatch, setLibreBatch] = useState<string | null>(null)
  useEffect(() => {
    const lb = new URLSearchParams(window.location.search).get('libre')
    if (!lb) return
    setMode('lib')
    setView('gen')
    setLibreBatch(lb)
  }, [])

  // Décor présélectionné par l'URL (« Utiliser ce décor » de la Bibliothèque /
  // du studio, rebranché 20/07/2026) : /generation?decor=<id>.
  // Un décor venu de l'URL est un CHOIX : le décor automatique ne l'écrase pas.
  const decorManual = useRef(false)
  useEffect(() => {
    const d = Number(new URLSearchParams(window.location.search).get('decor'))
    if (Number.isInteger(d) && d > 0) {
      decorManual.current = true
      setDecorId(d)
    }
  }, [])

  // Décor compatible AUTOMATIQUE (demande Mathias 28/07/2026) : tant que le
  // décor n'a pas été choisi à la main (fenêtre ou ?decor=), il suit la
  // typologie détectée — décor le plus récent DU même type (les décors sont
  // déjà triés du plus récent au plus ancien). Aucun décor de ce type → on
  // laisse le défaut (premier décor standard) et son avertissement.
  useEffect(() => {
    if (decorManual.current || !typoKnown || decors.length === 0) return
    const compatible = decors.find((d) => d.type === typo)
    if (compatible) setDecorId(compatible.id)
  }, [typo, typoKnown, decors])

  useEffect(() => {
    fetch('/api/decors')
      .then((r) => r.json())
      .then((d) => {
        const actifs: DecorEntry[] = (d.decors ?? [])
          .filter((x: DecorEntry) => x.status === 'actif')
          .sort((a: DecorEntry, b: DecorEntry) => b.id - a.id)
        setDecors(actifs)
        // La case « décor du lot » ne prend jamais un décor XL : si l'URL
        // (?decor=<id>) en désignait un, il bascule dans la case décor XL.
        const premierStd = actifs.find((x) => x.type !== 'coulissant-xl')?.id ?? null
        setDecorId((cur) => {
          const found = actifs.find((x) => x.id === cur)
          if (found?.type === 'coulissant-xl') {
            setDecorXlId(found.id)
            return premierStd
          }
          return cur ?? premierStd
        })
      })
      .catch(() => {})
  }, [])

  // — suivi du batch (polling tant qu'on est en traitement) —
  // « Fini » = toutes les MES SITE sont sorties. Les jobs Marketplace / retouches
  // (MP automatique…) continuent en arrière-plan : l'écran résultat les suit.
  const finished = (js: Job[]): boolean => {
    const gen = js.filter((j) => j.type === 'pillars' || isMesJob(j))
    if (gen.length === 0) return false
    if (gen.some((j) => j.status === 'queued' || j.status === 'running')) return false
    const donePillars = gen.filter((j) => j.type === 'pillars' && j.status === 'done').length
    const integ = gen.filter((j) => isMesJob(j)).length
    return integ >= donePillars
  }
  useEffect(() => {
    if (!batchId || (stage !== 'proc' && !busyPoll)) return
    let alive = true
    const tick = async () => {
      try {
        const d = await fetch(`/api/gamme/${batchId}`).then((r) => r.json())
        if (!alive || !Array.isArray(d.jobs)) return
        const js = sansEssaisLab(d.jobs)
        setJobs(js)
        const active = js.some((j: Job) => j.status === 'queued' || j.status === 'running')
        if (stage === 'proc' && finished(js)) {
          setStage('result')
          // Des jobs (MP automatique) tournent encore → on continue à suivre.
          if (active) setBusyPoll(true)
        }
        if (busyPoll && !active) setBusyPoll(false)
      } catch {
        // réseau : on réessaie au prochain tick
      }
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [stage, batchId, busyPoll])

  // Échap pour fermer l'aperçu en grand
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  function addFiles(list: FileList | null) {
    if (!list?.length) return
    // Typologie AUTOMATIQUE (demande Mathias 22/07/2026) : au premier dépôt, la
    // lettre de la nomenclature décide (300B140 battant, 300C140 coulissant,
    // 100P140 portillon). Aucune lettre, ou plusieurs différentes → la fenêtre
    // par-dessus demande la typologie.
    let effTypo = typo
    if (!typoKnown) {
      const lettres = new Set<string>()
      for (const f of Array.from(list)) {
        const m = f.name.toUpperCase().match(/\d{2,3}([BCP])\d{2,3}/)
        if (m) lettres.add(m[1])
      }
      if (lettres.size === 1) {
        const lettre = [...lettres][0]
        effTypo = lettre === 'C' ? 'coulissant' : lettre === 'P' ? 'portillon' : 'battant'
        setTypo(effTypo)
        setTypoKnown(true)
      } else {
        setAskTypo(true)
      }
    }
    const next: Img[] = Array.from(list).map((f) => {
      const p = parseName(f.name)
      return {
        id: `img-${seq.current++}`,
        file: f,
        name: f.name,
        url: URL.createObjectURL(f),
        color: p.color ?? 'Gris',
        // Taille non lue dans le nom → taille la plus courante DU moteur.
        w: p.w ?? (effTypo === 'portillon' ? 100 : 300),
        h: p.h ?? 140,
        detSize: p.w != null && p.h != null,
        editSize: false,
        editColor: false,
      }
    })
    setImages((cur) => [...cur, ...next])
    // Nom du produit : première détection gagnante, jamais écrasée si déjà saisi.
    // Lecture IMMÉDIATE obligatoire : le FileList d'un glisser-déposer se vide
    // dès que le gestionnaire d'événement rend la main — trop tard dans setProduit.
    let detProduit = ''
    for (const f of Array.from(list)) {
      const p = parseProduitFromFileName(f.name)
      if (p) {
        detProduit = p
        break
      }
    }
    if (detProduit) setProduit((cur) => cur || detProduit)
  }
  function removeImg(id: string) {
    setImages((cur) => {
      const it = cur.find((x) => x.id === id)
      if (it) URL.revokeObjectURL(it.url)
      return cur.filter((x) => x.id !== id)
    })
  }
  function patchImg(id: string, patch: Partial<Img>) {
    setImages((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  const resetImages = useCallback(() => {
    setImages((cur) => {
      cur.forEach((i) => URL.revokeObjectURL(i.url))
      return []
    })
  }, [])

  function goMode() {
    setView('mode')
  }
  function pickMode(m: Mode) {
    setMode(m)
    // Contrainte passe d'abord par le choix du point de départ (rework 22/07/2026) :
    // « Depuis le catalogue » ou « Depuis mes images » (= le flux historique).
    setView(m === 'con' ? 'origine' : 'gen')
    setStage('input')
  }
  /** « Depuis mes images » (demande Mathias 22/07/2026) : on dépose D'ABORD —
   *  la typologie est détectée depuis la lettre de la nomenclature (300B140 /
   *  300C140 / 100P140) ; indevinable → la fenêtre par-dessus (askTypo). */
  function startImages() {
    resetImages()
    setProduit('')
    setNotice(null)
    setTypoKnown(false)
    setAskTypo(false)
    setStage('input')
    setView('gen')
  }
  function newGeneration() {
    resetImages()
    setProduit('')
    // Une session rouverte (?session=…) redevient une page de lancement normale.
    if (window.location.search) window.history.replaceState(null, '', '/generation')
    setJobs([])
    setBatchId(null)
    setApiErrors([])
    setBusyPoll(false)
    setStudioRoot(null)
    setChosen({})
    setMpAskedRoots(new Set())
    setZipBusy(null)
    setNotice(null)
    setStage('input')
  }

  /** Générations (variantes) d'une taille = les MES sœurs (même taille/coloris). */
  const slotVariantsOf = (root: Job): Job[] =>
    jobs
      .filter((j) => isMesJob(j) && slotKeyOf(j) === slotKeyOf(root))
      .sort((a, b) => variantNo(a) - variantNo(b) || a.id - b.id)
  /** La case a-t-elle une génération RETENUE (ou une seule génération) → MP possible. */
  const mpReadyFor = (root: Job): boolean => {
    const vs = slotVariantsOf(root)
    return vs.length <= 1 || vs.some((v) => v.chosen)
  }

  /** Versions d'une MES = ses jobs du batch (intégration V1 + retouches mes-fix). */
  const versionsOf = (rootId: number): Job[] =>
    jobs
      .filter((j) => j.id === rootId || (j.type === 'mes-fix' && j.payload?.rootJobId === rootId))
      .sort((a, b) => a.id - b.id)

  /** Version affichée d'une MES : celle choisie dans le studio, sinon l'originale (V1). */
  const displayedJob = (root: Job): Job => {
    const ch = chosen[root.id]
    return (ch ? versionsOf(root.id).find((v) => v.id === ch) : undefined) ?? root
  }

  async function closeStudio() {
    setStudioRoot(null)
    if (!batchId) return
    try {
      const d = await fetch(`/api/gamme/${batchId}`).then((r) => r.json())
      if (Array.isArray(d.jobs)) {
        const js = sansEssaisLab(d.jobs)
        setJobs(js)
        // Une retouche lancée dans le studio continue après sa fermeture : on
        // relance le suivi pour que la carte montre « nouvelle version… » puis
        // se mette à jour toute seule (demande Mathias 28/07/2026).
        if (js.some((j) => j.status === 'queued' || j.status === 'running')) setBusyPoll(true)
      }
    } catch {
      // pas grave : la prochaine action rafraîchira
    }
  }
  function chooseVersion(versionJobId: number) {
    if (studioRoot == null) return
    setChosen((prev) => ({ ...prev, [studioRoot]: versionJobId }))
  }

  /**
   * Générations multiples (29/07/2026) : désigne une génération comme la MES
   * retenue de sa taille (persisté en base). On met à jour l'état local tout de
   * suite (chosen sur la variante, retiré de ses sœurs) puis on recharge le lot.
   */
  async function chooseVariant(variantJobId: number) {
    const target = jobs.find((j) => j.id === variantJobId)
    if (!target) return
    const slot = slotKeyOf(target)
    setJobs((prev) =>
      prev.map((j) =>
        isMesJob(j) && slotKeyOf(j) === slot ? { ...j, chosen: j.id === variantJobId } : j
      )
    )
    try {
      const res = await fetch(`/api/jobs/${variantJobId}/choose`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setNotice(d?.error ?? 'Choix impossible.')
      }
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  /** Une MES est-elle déjà passée (ou en train de passer) en MP ? */
  const mpDoneFor = (rootId: number): boolean =>
    mpAskedRoots.has(rootId) ||
    jobs.some((j) => j.type === 'marketplace' && j.payload?.rootJobId === rootId)

  /** Passe des MES (versions choisies) en Marketplace (MP) — recadrage 1:1 + bords. */
  async function mpJobs(ids: number[]): Promise<boolean> {
    if (ids.length === 0) return false
    setNotice(null)
    try {
      const res = await fetch('/api/generation/mp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: ids }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setNotice(d?.error ?? 'Passage Marketplace impossible.')
        return false
      }
      setBusyPoll(true)
      return true
    } catch {
      setNotice('Impossible de contacter le serveur.')
      return false
    }
  }

  /** ↻ Relance le job de la MES affichée : même réglages, nouvelle image. */
  async function regenRoot(root: Job) {
    const d = displayedJob(root)
    if (d.status === 'queued' || d.status === 'running') return
    try {
      const res = await fetch(`/api/jobs/${d.id}/regen`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice(body?.error ?? 'Relance impossible.')
        return
      }
      // La carte repasse « en cours » tout de suite, le polling prend le relais.
      setJobs((prev) => prev.map((j) => (j.id === d.id ? { ...j, status: 'queued', error: null } : j)))
      setBusyPoll(true)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  /** Passe une MES (sa version choisie) en MP, en bloquant son bouton aussitôt. */
  async function mpRoot(root: Job) {
    // Générations multiples : le MP est bloqué tant qu'aucune génération n'est
    // retenue pour cette taille (règle Mathias 29/07/2026).
    if (!mpReadyFor(root)) {
      setNotice('Choisis d’abord une génération pour cette taille avant de la décliner en Marketplace.')
      return
    }
    const d = displayedJob(root)
    if (d.status !== 'done' || !d.result?.deliveryPath || mpDoneFor(root.id)) return
    setMpAskedRoots((prev) => new Set(prev).add(root.id))
    const ok = await mpJobs([d.id])
    if (!ok) {
      setMpAskedRoots((prev) => {
        const next = new Set(prev)
        next.delete(root.id)
        return next
      })
    }
  }

  /** Télécharge un ZIP : MES Site dans WEB/, MES Marketplace dans MP/ (ou l'un des deux). */
  async function downloadZip(kind: 'tout' | 'site' | 'mp') {
    const items: { p: string; name: string; folder: 'WEB' | 'MP' }[] = []
    if (kind !== 'mp') {
      // Une génération par taille : la retenue (chosen) sinon la 1ʳᵉ — jamais les 3.
      const slotDisplay = [...groupMesSlots(jobs).values()]
        .map((v) => displayVariant(v))
        .filter((j): j is Job => !!j)
      slotDisplay.forEach((root) => {
        const d = displayedJob(root)
        if (d.status === 'done' && d.result?.deliveryPath) {
          items.push({ p: d.result.deliveryPath, name: fnameOf(root, 'site', typo), folder: 'WEB' })
        }
      })
    }
    if (kind !== 'site') {
      jobs
        .filter((j) => j.type === 'marketplace' && j.status === 'done' && j.result?.deliveryPath)
        .forEach((j) => {
          items.push({ p: j.result!.deliveryPath!, name: fnameOf(j, 'marketplace', typo), folder: 'MP' })
        })
    }
    if (items.length === 0 || zipBusy) return
    setZipBusy(kind)
    setNotice(null)
    try {
      const res = await fetch('/api/generation/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setNotice(d?.error ?? 'Téléchargement groupé impossible.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        kind === 'site' ? 'MES_WEB.zip' : kind === 'mp' ? 'MES_MP.zip' : 'MES_WEB+MP.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setZipBusy(null)
    }
  }

  // Tailles XL du lot (28/07/2026) : coulissants ≥ 450 cm — ils exigent un
  // décor « coulissant-xl » et partent avec, les autres avec le décor standard.
  const xlCount =
    typo === 'coulissant' ? images.filter((i) => i.w >= COULISSANT_XL_MIN_W).length : 0
  const stdCount = images.length - xlCount

  // Décor XL automatique (même demande 28/07/2026) : des tailles XL sans décor
  // XL choisi → le plus récent décor « coulissant-xl » est présélectionné.
  useEffect(() => {
    if (xlCount === 0 || decorXlId != null) return
    const premierXl = decors.find((d) => d.type === 'coulissant-xl')
    if (premierXl) setDecorXlId(premierXl.id)
  }, [xlCount, decorXlId, decors])

  async function generate() {
    if (!canGenerate) return
    setNotice(null)
    const fd = new FormData()
    if (stdCount > 0 && decorId != null) fd.append('decorId', String(decorId))
    if (xlCount > 0 && decorXlId != null) fd.append('decorXlId', String(decorXlId))
    fd.append('moteur', typo)
    fd.append('produit', produit.trim())
    fd.append('meta', JSON.stringify(images.map((i) => ({ w: i.w, h: i.h, coloris: i.color }))))
    images.forEach((i) => fd.append('files', i.file, i.name))

    setStage('proc')
    setJobs([])
    setBatchId(null)
    try {
      const res = await fetch('/api/generation', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice(data?.error ?? 'Échec du lancement de la génération.')
        setStage('input')
        return
      }
      setExpected(data.count ?? images.length)
      setApiErrors(Array.isArray(data.errors) ? data.errors : [])
      setBatchId(data.batchId)
    } catch {
      setNotice('Impossible de contacter le serveur.')
      setStage('input')
    }
  }

  // Chaque « côté » du lot exige son décor : standard s'il y a des tailles
  // standards, XL s'il y a des tailles XL.
  const canGenerate =
    images.length > 0 && (stdCount === 0 || decorId != null) && (xlCount === 0 || decorXlId != null)

  // — sélecteur de décor : un bouton dans le panneau, tout se passe dans la
  //   fenêtre de sélection (demande Mathias 22/07/2026) —
  const selectedDecor = decors.find((d) => d.id === decorId) ?? null
  const selectedDecorXl = decors.find((d) => d.id === decorXlId) ?? null
  const decorsXl = decors.filter((d) => d.type === 'coulissant-xl')

  function openPicker(target: 'std' | 'xl' = 'std') {
    setPickFor(target)
    setPickId(target === 'xl' ? decorXlId : decorId)
    setPickSearch('')
    setPickGamme('')
    setPickTab('')
    setPickerOpen(true)
  }

  // La fenêtre ne mélange jamais les échelles : cible XL → que des décors XL,
  // cible standard → tout sauf les XL.
  const pickList = decors.filter((d) => {
    if ((d.type === 'coulissant-xl') !== (pickFor === 'xl')) return false
    const q = pickSearch.trim().toLowerCase()
    if (q && !`${d.name} ${d.slug} ${d.gamme ?? ''}`.toLowerCase().includes(q)) return false
    if (pickGamme && (d.gamme ?? '') !== pickGamme) return false
    return true
  })
  const pickGammes = [...new Set(decors.map((d) => d.gamme).filter((g): g is string => !!g))].sort(
    (a, b) => a.localeCompare(b, 'fr')
  )
  // La typologie de la génération en cours s'affiche en premier dans la fenêtre.
  const typoOrder: Typo[] = [
    typo,
    ...(Object.keys(TYPO_INFO) as Typo[]).filter((t) => t !== typo),
  ]
  const picked = decors.find((d) => d.id === pickId) ?? null

  // —————————————————————————————————————————————— rendu
  return (
    <div className="max-w-6xl mx-auto">
      {/* Réouverture d'une session : écran de chargement basique le temps que la
          session arrive, pour ne jamais montrer le choix du mode entre-temps. */}
      {sessionLoading && (
        <section className="min-h-[60vh] grid place-items-center animate-fade-in-up">
          <div className="text-center">
            <span className="inline-block w-10 h-10 rounded-full border-4 border-brand-green-light border-t-brand-green animate-spin mb-4" />
            <p className="text-sm font-semibold text-text-secondary anim-respire">Chargement de la session…</p>
          </div>
        </section>
      )}

      {/* ÉTAPE 1 — MODE */}
      {!sessionLoading && view === 'mode' && (
        <section className="animate-fade-in-up">
          <h1 className="text-[34px] leading-tight font-bold tracking-tight mb-7">Générer</h1>
          {/* Maquette choix-mode-typologie-v1 validée le 13/07/2026 : panneaux
              typographiques (variante A) avec les textes condensés de la variante B.
              Retouches 15/07 : plus de liseré ni de badge d'état, tout en vert.
              22/07 (rework validé) : 3ᵉ panneau « MES Décors » — la gestion des
              décors est ici et sur l'Accueil depuis que « Décors » a quitté la nav.
              22/07 : illustrations SilhouetteMode en tête de panneau, même langage
              que les silhouettes typologie ; plus de bouton, la carte entière
              est cliquable. */}
          {/* Bascule « décor autour » (05/08/2026) : 4 cartes SUR UNE LIGNE
              (demande Mathias). L'ancien mode Contrainte et l'ancien MES Décors
              sont conservés TELS QUELS et simplement étiquetés « (legacy) » —
              on n'écrase jamais l'ancien. Ordre (demande Mathias 05/08) : la
              nouvelle méthode « Décor Écrin » d'abord, les legacy regroupés
              côte à côte en fin de ligne. */}
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-[18px]">
            {/* MES Contrainte (NOUVEAU) — méthode « décor autour » : flux in-app
                complet (dépôt → jobs → avant/après → MP → téléchargements). Le
                labo /decor-autour reste accessible à part pour les essais. La PAGE
                s'appelle « MES Écrin » (renommage Mathias 05/08) ; le renommage de
                la carte a été annulé par Mathias (« retour en arrière » 05/08). */}
            <Link
              href="/generation/decor-autour"
              className="group relative text-left bg-white rounded-[12px] border border-border shadow-sm pb-[26px] overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              <div className="border-b border-border px-6 pt-5 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                <SilhouetteMode mode="decor-autour" />
              </div>
              <div className="px-5 pt-4">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-brand-green mb-2.5 whitespace-nowrap">
                  <span className="w-[7px] h-[7px] rounded-full bg-current" />
                  vraie échelle
                </span>
                <h3 className="text-[20px] leading-[1.15] font-bold tracking-tight mb-1.5 whitespace-nowrap">
                  MES Contrainte
                </h3>
                <p className="text-sm text-text-secondary">
                  Le produit est posé à sa vraie échelle, Nano peint tout le décor autour.
                  Nouvelle méthode — <b className="text-text-primary">bascule en cours</b>.
                </p>
              </div>
            </Link>

            <button
              onClick={() => pickMode('lib')}
              className="group flex flex-col text-left bg-white rounded-[12px] border border-border shadow-sm pb-[26px] overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              <div className="border-b border-border px-6 pt-5 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                <SilhouetteMode mode="libre" />
              </div>
              <div className="px-5 pt-4">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-brand-green mb-2.5 whitespace-nowrap">
                  <span className="w-[7px] h-[7px] rounded-full bg-current" />
                  Scène décrite · formulaire
                </span>
                <h3 className="text-[20px] leading-[1.15] font-bold tracking-tight mb-1.5 whitespace-nowrap">MES Libre</h3>
                <p className="text-sm text-text-secondary">
                  Ambiance, angle, lumière — peu de règles, plusieurs variantes générées,{' '}
                  <b className="text-text-primary">tu choisis</b>. Le produit reste verrouillé.
                </p>
              </div>
            </button>

            {/* MES Contrainte (LEGACY) — décor Canny + piliers + pose/fusion,
                inchangé. MASQUÉ le 07/08 (demande Mathias) : code conservé,
                repasser AFFICHER_LEGACY à true pour le revoir. */}
            {AFFICHER_LEGACY && (
            <button
              onClick={() => pickMode('con')}
              className="group flex flex-col text-left bg-white rounded-[12px] border border-border shadow-sm pb-[26px] overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              <div className="border-b border-border px-6 pt-5 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                <SilhouetteMode mode="contrainte" />
              </div>
              <div className="px-5 pt-4">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-text-secondary mb-2.5 whitespace-nowrap">
                  <span className="w-[7px] h-[7px] rounded-full bg-current" />
                  Effet catalogue · gabarits
                </span>
                <h3 className="text-[20px] leading-[1.15] font-bold tracking-tight mb-1.5 whitespace-nowrap">
                  MES Contrainte{' '}
                  <span className="text-[12px] font-semibold text-text-disabled align-middle">(legacy)</span>
                </h3>
                <p className="text-sm text-text-secondary">
                  Proportions cohérentes entre les tailles, décor imposé, produit posé précisément,
                  perspective réglée. Livraison <b className="text-text-primary">Site + Marketplace</b>.
                </p>
              </div>
            </button>
            )}

            {/* MES Décors (LEGACY) — bibliothèque de décors, remplacée à terme par
                « Nano peint autour ». Conservée telle quelle, MASQUÉE le 07/08. */}
            {AFFICHER_LEGACY && (
            <Link
              href="/decors"
              className="group text-left bg-white rounded-[12px] border border-border shadow-sm pb-[26px] overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              <div className="border-b border-border px-6 pt-5 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                <SilhouetteMode mode="decors" />
              </div>
              <div className="px-5 pt-4">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-text-secondary mb-2.5 whitespace-nowrap">
                  <span className="w-[7px] h-[7px] rounded-full bg-current" />
                  Arrière-plans · bibliothèque
                </span>
                <h3 className="text-[20px] leading-[1.15] font-bold tracking-tight mb-1.5 whitespace-nowrap">
                  MES Décors{' '}
                  <span className="text-[12px] font-semibold text-text-disabled align-middle">(legacy)</span>
                </h3>
                <p className="text-sm text-text-secondary">
                  Créer et gérer les décors dans lesquels les produits sont posés — génération,
                  corrections, décors <b className="text-text-primary">XL</b> des coulissants.
                </p>
              </div>
            </Link>
            )}
          </div>
        </section>
      )}

      {/* ÉTAPE 1bis — POINT DE DÉPART (Contrainte, rework 22/07/2026) : depuis le
          catalogue (nouveau flux /generation/catalogue) ou depuis ses images (le
          flux historique, inchangé). */}
      {view === 'origine' && (
        <section className="animate-fade-in-up">
          <Chemin onBack={goMode} parents={[{ label: 'Générer', onClick: goMode }]} here="Contrainte" />
          <div className="flex items-baseline gap-3 flex-wrap mb-4">
            <h1 className="text-2xl font-bold tracking-tight">Le point de départ</h1>
            <span className="text-sm text-text-secondary">d&apos;où part la mise en situation ?</span>
          </div>
          <div className="grid md:grid-cols-2 gap-[18px] max-w-3xl">
            <Link
              href="/generation/catalogue"
              className="group text-left bg-white rounded-[12px] border-[1.5px] border-border shadow-sm px-6 py-6 transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-brand-green"
            >
              <div className="flex items-center gap-3 mb-2">
                {/* Icônes SilhouetteOrigineIcone à la place des pictos PNG (22/07) */}
                <SilhouetteOrigineIcone origine="catalogue" className="block w-[40px] h-[40px] shrink-0" />
                <h3 className="text-[19px] font-bold">Depuis le catalogue</h3>
              </div>
              <p className="text-[13px] text-text-secondary">
                Le produit est référencé : tailles, coloris et visuels détourés déjà là. Tu coches
                les tailles à mettre en situation, les MES existantes sont signalées.
              </p>
              <span className="inline-flex items-center gap-1.5 mt-3.5 text-[13px] font-bold text-brand-green group-hover:underline">
                Choisir un produit →
              </span>
            </Link>
            <button
              onClick={startImages}
              className="group text-left bg-white rounded-[12px] border-[1.5px] border-border shadow-sm px-6 py-6 transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-brand-green"
            >
              <div className="flex items-center gap-3 mb-2">
                <SilhouetteOrigineIcone origine="images" className="block w-[40px] h-[40px] shrink-0" />
                <h3 className="text-[19px] font-bold">Depuis mes images</h3>
              </div>
              <p className="text-[13px] text-text-secondary">
                Le produit n&apos;est pas (encore) référencé : dépose tes images, taille et coloris
                sont détectés depuis le nom de fichier, corrigeables.
              </p>
              <span className="inline-flex items-center gap-1.5 mt-3.5 text-[13px] font-bold text-brand-green group-hover:underline">
                Déposer des images →
              </span>
            </button>
          </div>
        </section>
      )}

      {/* (L'écran « Typologie » a disparu le 22/07/2026 : la typologie est
          détectée au dépôt des images, corrigeable via « ✎ changer » ou la
          fenêtre askTypo si les noms de fichiers ne permettent pas de trancher.) */}

      {/* ÉTAPE 3 — GÉNÉRATION (Contrainte) */}
      {view === 'gen' && mode === 'con' && (
        <section className="animate-fade-in-up">
          {/* Une fois la génération lancée, « Contrainte » ne ramène plus au choix de
              typologie (comme l'ancien pill « ← Typologie » réservé à la saisie). */}
          <Chemin
            onBack={() => (stage === 'input' ? setView('origine') : goMode())}
            parents={[
              { label: 'Générer', onClick: goMode },
              {
                label: 'Contrainte',
                onClick: stage === 'input' ? () => setView('origine') : undefined,
              },
            ]}
            here={typoKnown ? TYPO_INFO[typo].titre : 'Depuis mes images'}
            sub={typoKnown ? `· ${TYPO_INFO[typo].moteur}` : undefined}
          >
            {typoKnown && stage === 'input' && (
              <button
                onClick={() => setAskTypo(true)}
                title="Changer la typologie détectée"
                className="text-[12px] font-semibold text-text-secondary border border-border rounded-full px-2.5 py-0.5 ml-1 hover:text-brand-green hover:border-brand-green transition-colors"
              >
                ✎ changer
              </button>
            )}
          </Chemin>

          {/* ---- saisie ---- */}
          {stage === 'input' && (
            <>
              <div className="flex items-baseline gap-3 flex-wrap mb-4">
                <h1 className="text-2xl font-bold tracking-tight">Nouvelle génération</h1>
                <span className="text-sm text-text-secondary">une ou plusieurs images du même produit</span>
              </div>

              {notice && (
                <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5 flex justify-between gap-4">
                  <span>{notice}</span>
                  <button onClick={() => setNotice(null)} className="text-brand-red/60 hover:text-brand-red">
                    ✕
                  </button>
                </div>
              )}
              <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
                {/* colonne images */}
                <div>
                  {images.length === 0 ? (
                    <button
                      onClick={() => fileInput.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setHot(true)
                      }}
                      onDragLeave={() => setHot(false)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setHot(false)
                        addFiles(e.dataTransfer.files)
                      }}
                      className={`w-full min-h-80 rounded-[12px] border-2 border-dashed flex flex-col items-center justify-center gap-3 text-center p-8 transition-colors ${
                        hot ? 'border-brand-green bg-brand-green-light' : 'border-[#c8d3bb] bg-white hover:border-brand-green hover:bg-[#fbfdf8]'
                      }`}
                    >
                      <PictoIllu name="photos" size={48} />
                      <span className="text-base font-bold">Dépose la ou les images du produit</span>
                      <span className="text-xs text-text-disabled">— ou —</span>
                      <span className="bg-white border border-border text-text-secondary rounded-[8px] px-3.5 py-2 text-sm font-bold">
                        Choisir des fichiers
                      </span>
                    </button>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2.5 flex-wrap text-xs text-text-secondary">
                        <b className="text-text-primary text-[13.5px]">{images.length}</b> image
                        {images.length > 1 ? 's' : ''} · même produit
                        {images.length > 1 && (
                          <span className="ml-auto text-brand-red font-semibold">
                            ⚠ un produit différent dans le lot = résultat raté
                          </span>
                        )}
                      </div>
                      {images.map((im) => {
                        const c = COLORS.find((x) => x.name === im.color) ?? COLORS[0]
                        return (
                          <div
                            key={im.id}
                            className="flex items-center gap-3 bg-white border border-border rounded-[12px] shadow-sm px-3 py-2.5"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={im.url}
                              alt=""
                              className="w-[74px] h-14 rounded-[8px] border border-border object-contain bg-surface shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-[13.5px] flex items-center gap-2">
                                <span className="truncate">{im.name}</span>
                              </div>
                              <div className="flex items-center gap-2.5 flex-wrap mt-1.5">
                                <span className="text-[11px] text-text-secondary font-semibold flex items-center gap-1">
                                  <span className="w-3.5 h-3.5 rounded border border-black/20 inline-block" style={{ background: c.sw }} />
                                  coloris
                                </span>
                                <select
                                  title="Coloris détecté — corrigeable"
                                  value={im.color}
                                  onChange={(e) => patchImg(im.id, { color: e.target.value, editColor: true })}
                                  className="border border-border bg-white rounded-[8px] px-2 py-1.5 text-[13px]"
                                >
                                  {COLORS.map((o) => (
                                    <option key={o.name}>{o.name}</option>
                                  ))}
                                </select>
                                <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${im.editColor ? 'bg-surface text-text-secondary' : 'bg-brand-green-light text-brand-green'}`}>
                                  {im.editColor ? '✎ corrigé' : '✓ détecté'}
                                </span>

                                <span className="text-[11px] text-text-secondary font-semibold ml-1">taille</span>
                                <span className="inline-flex items-center gap-1.5">
                                  <input
                                    title="Largeur"
                                    value={im.w}
                                    onChange={(e) => patchImg(im.id, { w: Number(e.target.value.replace(/\D/g, '')) || 0, editSize: true })}
                                    className="w-[52px] border border-border rounded-[8px] px-2 py-1.5 text-[13px] text-right tabular-nums"
                                  />
                                  <span className="text-text-disabled text-xs">×</span>
                                  <input
                                    title="Hauteur"
                                    value={im.h}
                                    onChange={(e) => patchImg(im.id, { h: Number(e.target.value.replace(/\D/g, '')) || 0, editSize: true })}
                                    className="w-[52px] border border-border rounded-[8px] px-2 py-1.5 text-[13px] text-right tabular-nums"
                                  />
                                  <span className="text-text-disabled text-xs">cm</span>
                                </span>
                                <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${im.editSize ? 'bg-surface text-text-secondary' : 'bg-brand-green-light text-brand-green'}`}>
                                  {im.editSize ? '✎ corrigé' : '✓ détecté'}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => removeImg(im.id)}
                              title="Retirer"
                              className="text-text-disabled hover:text-text-primary text-lg leading-none self-start"
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}

                      <button
                        onClick={() => fileInput.current?.click()}
                        className="w-full rounded-[8px] border-2 border-dashed border-[#c8d3bb] hover:border-brand-green hover:bg-[#fbfdf8] py-3.5 text-sm font-bold text-brand-green transition-colors"
                      >
                        ＋ Ajouter des images
                      </button>
                    </div>
                  )}
                </div>

                {/* colonne réglages */}
                <div className="bg-white border border-border rounded-[12px] shadow-sm">
                  <div className="p-4 space-y-5">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                        Nom de la session
                      </label>
                      <input
                        value={produit}
                        onChange={(e) => setProduit(e.target.value)}
                        placeholder="ex. VOGEL"
                        maxLength={60}
                        className="w-full border border-border bg-white rounded-[8px] px-3 py-2 text-[13.5px]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                        Décor
                      </label>
                      {(stdCount > 0 || images.length === 0) &&
                        (decors.length > 0 ? (
                          <button
                            onClick={() => openPicker('std')}
                            className="w-full rounded-[8px] border border-border bg-white px-3 py-2.5 text-[13px] font-bold text-text-secondary hover:text-brand-green hover:border-brand-green transition-colors"
                          >
                            {selectedDecor
                              ? `Décor : ${selectedDecor.name} — changer`
                              : `Choisir un décor`}
                          </button>
                        ) : (
                          <p className="text-[11.5px] text-text-disabled mt-1.5">
                            Aucun décor actif —{' '}
                            <Link href="/decors" className="text-brand-green font-bold">
                              crées-en un depuis la page Décors ↗
                            </Link>
                          </p>
                        ))}
                      {selectedDecor && TYPO_INFO[selectedDecor.type as Typo] && selectedDecor.type !== typo && (
                        <p className="text-[11.5px] font-semibold text-amber-700 bg-amber-100 rounded-[8px] px-2.5 py-1.5 mt-2">
                          ⚠ Décor pensé pour un {TYPO_INFO[selectedDecor.type as Typo].titre.toLowerCase()},
                          pas pour un {TYPO_INFO[typo].titre.toLowerCase()} — le cadrage peut être
                          raté.
                        </p>
                      )}
                      {/* Tailles XL détectées (28/07/2026) : le lot exige aussi un décor
                          à l'échelle XL — les images ≥ 450 partiront avec lui. */}
                      {xlCount > 0 && (
                        <div className="mt-2">
                          <p className="text-[11.5px] font-semibold text-amber-700 bg-amber-100 rounded-[8px] px-2.5 py-1.5 mb-2">
                            ⚠ {xlCount} taille{xlCount > 1 ? 's' : ''} XL détectée
                            {xlCount > 1 ? 's' : ''} (largeur ≥ {COULISSANT_XL_MIN_W} cm) — ces
                            images ont besoin d&apos;un décor XL (échelle adaptée aux grandes
                            lames).
                          </p>
                          {decorsXl.length > 0 ? (
                            <button
                              onClick={() => openPicker('xl')}
                              className="w-full rounded-[8px] border border-border bg-white px-3 py-2.5 text-[13px] font-bold text-text-secondary hover:text-brand-green hover:border-brand-green transition-colors"
                            >
                              {selectedDecorXl
                                ? `Décor XL : ${selectedDecorXl.name} — changer`
                                : `Choisir un décor XL (${decorsXl.length})`}
                            </button>
                          ) : (
                            <p className="text-[11.5px] text-text-disabled">
                              Aucun décor XL actif —{' '}
                              <Link href="/decors" className="text-brand-green font-bold">
                                crées-en un depuis la page Décors (Coulissant XL) ↗
                              </Link>
                            </p>
                          )}
                        </div>
                      )}
                      <p className="text-[11.5px] text-text-disabled mt-1.5">
                        {xlCount > 0 && stdCount > 0
                          ? 'Un décor pour les tailles standards, un décor XL pour les grandes — chaque image part avec le sien.'
                          : 'Même décor pour toutes les images — c’est ce qui donne l’effet catalogue.'}
                      </p>
                    </div>

                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3.5 flex-wrap mt-5">
                <button
                  onClick={generate}
                  disabled={!canGenerate}
                  className="group bg-brand-green text-white rounded-[12px] px-6 py-3 text-[15px] font-bold hover:bg-brand-green-hover hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <PictoIllu name="generer" size={16} className="mr-1.5" />
                  Générer{images.length ? ` (${images.length})` : ''}
                </button>
                <span className="text-xs text-text-disabled">
                  {images.length === 0
                    ? 'Dépose d’abord au moins une image.'
                    : stdCount > 0 && decorId == null
                      ? 'Choisis un décor.'
                      : xlCount > 0 && decorXlId == null
                        ? `Choisis un décor XL pour les tailles ≥ ${COULISSANT_XL_MIN_W} cm.`
                        : `≈ ${images.length} MES Site à générer · le produit d’origine n’est pas modifié`}
                </span>
              </div>
            </>
          )}

          {/* ---- traitement ---- */}
          {stage === 'proc' &&
            (() => {
              // Générations multiples : on compte et on affiche PAR TAILLE (une case
              // par taille = la génération retenue sinon la 1ʳᵉ), pas par variante.
              const procSlots = [...groupMesSlots(jobs).values()]
                .map((v) => displayVariant(v))
                .filter((j): j is Job => !!j)
              const doneN = procSlots.filter((j) => j.status === 'done').length
              const failN = jobs.filter((j) => j.status === 'error').length
              const total = expected || images.length || 1
              const ready = procSlots.filter(
                (j) => j.status === 'done' && j.result?.deliveryPath
              )
              return (
                <div className="animate-fade-in-up">
                  <h1 className="text-2xl font-bold tracking-tight mb-1">Génération en cours…</h1>
                  <p className="text-sm text-text-secondary mb-6">
                    moteur {TYPO_INFO[typo].moteur} · détourage → décor →
                    piliers &amp; murets → intégration → livraison Site
                  </p>
                  <div className="bg-white border border-border rounded-[12px] shadow-sm p-8 flex flex-col items-center gap-4 text-center">
                    <span className="w-10 h-10 rounded-full border-4 border-brand-green-light border-t-brand-green animate-spin" />
                    <p className="font-bold text-lg">
                      {doneN} / {total} mise{total > 1 ? 's' : ''} en situation prête{doneN > 1 ? 's' : ''}
                    </p>
                    <p className="text-sm text-text-secondary max-w-md">
                      <PhraseAttente />
                      {failN > 0 && <span className="block text-brand-red mt-1">{failN} en erreur (détail à la fin).</span>}
                    </p>
                  </div>

                  {/* Les MES déjà prêtes s'affichent au fil de l'eau, même grille que le résultat. */}
                  {ready.length > 0 && (
                    <div className="mt-6">
                      <h2 className="text-[13px] font-bold flex items-center gap-2 mb-3">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-green-light text-brand-green">
                          WEB
                        </span>
                        Déjà prête{ready.length > 1 ? 's' : ''}{' '}
                        <span className="text-text-secondary font-normal text-[12.5px]">
                          · les suivantes arrivent…
                        </span>
                      </h2>
                      <SizeRows
                        jobs={ready}
                        render={(j) => {
                          const dp = j.result!.deliveryPath!
                          return (
                            <div
                              key={j.id}
                              className="bg-white border border-border rounded-[12px] shadow-sm overflow-hidden animate-fade-in-up"
                            >
                              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                                <span className="font-bold text-[13px]">{labelOf(j)}</span>
                                <span className="ml-auto text-[11.5px] text-text-secondary tabular-nums">
                                  2000×1330
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setLightbox(imgUrl(dp))}
                                className="block w-full cursor-zoom-in"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imgUrl(dp, 960)}
                                  alt={labelOf(j)}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full aspect-[3/2] object-cover bg-surface"
                                />
                              </button>
                            </div>
                          )
                        }}
                      />
                    </div>
                  )}
                </div>
              )
            })()}

          {/* ---- résultat ---- */}
          {stage === 'result' &&
            (() => {
              // Générations multiples (29/07/2026) : une CASE par taille — la
              // génération retenue (chosen) sinon la 1ʳᵉ. Les sœurs vivent dans le
              // studio (galerie). La grille reste « une largeur = une ligne ».
              const slots = groupMesSlots(jobs)
              const integ = [...slots.values()]
                .map((v) => displayVariant(v))
                .filter((j): j is Job => !!j)
              const doneSites = integ.filter((j) => j.status === 'done' && j.result?.deliveryPath)
              const mkt = jobs.filter((j) => j.type === 'marketplace')
              const failed = jobs.filter((j) => j.status === 'error')
              const busySite = jobs.some((j) => isMesJob(j) && (j.status === 'queued' || j.status === 'running'))
              const busyMkt = mkt.some((j) => j.status === 'queued' || j.status === 'running')
              const doneMkt = mkt.filter((j) => j.status === 'done' && j.result?.deliveryPath)

              return (
                <div className="animate-fade-in-up">
                  <div className="flex items-center gap-3.5 flex-wrap mb-5">
                    <span className="w-10 h-10 rounded-full bg-brand-green-light text-brand-green text-xl grid place-items-center shrink-0">
                      ✓
                    </span>
                    <div>
                      <h1 className="text-xl font-bold">
                        {doneSites.length > 0 ? 'Mise(s) en situation prête(s)' : 'Génération terminée'}
                      </h1>
                      <p className="text-sm text-text-secondary">
                        {produit ? `${produit} · ` : ''}
                        {TYPO_INFO[typo].titre} · {doneSites.length} MES Site ·
                        téléchargement direct — rien n&apos;est rangé au catalogue
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2 flex-wrap">
                      {doneSites.length > 0 && (
                        <>
                          {/* Tout télécharger : ZIP avec WEB/ (Site) + MP/ (Marketplace) */}
                          <button
                            type="button"
                            onClick={() => void downloadZip('tout')}
                            disabled={zipBusy != null}
                            title="ZIP : MES Site dans WEB/ + MES Marketplace dans MP/"
                            className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                          >
                            {zipBusy === 'tout' ? '⏳ ZIP en cours…' : '⬇ Tout télécharger'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void downloadZip('site')}
                            disabled={zipBusy != null}
                            title="ZIP : uniquement les MES Site (dossier WEB/)"
                            className="pill disabled:opacity-50"
                          >
                            {zipBusy === 'site' ? '⏳…' : '⬇ WEB seul'}
                          </button>
                          {doneMkt.length > 0 && (
                            <button
                              type="button"
                              onClick={() => void downloadZip('mp')}
                              disabled={zipBusy != null}
                              title="ZIP : uniquement les MES Marketplace (dossier MP/)"
                              className="pill disabled:opacity-50"
                            >
                              {zipBusy === 'mp' ? '⏳…' : '⬇ MP seul'}
                            </button>
                          )}
                        </>
                      )}
                      <button onClick={newGeneration} className="pill">
                        ↻ Nouvelle génération
                      </button>
                    </div>
                  </div>

                  {notice && (
                    <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5 flex justify-between gap-4">
                      <span>{notice}</span>
                      <button onClick={() => setNotice(null)} className="text-brand-red/60 hover:text-brand-red">
                        ✕
                      </button>
                    </div>
                  )}

                  {/* Grille Site adaptative : plus il y a de place, plus les MES sont grandes */}
                  {integ.length > 0 && (
                    <>
                      <h2 className="text-[13px] font-bold flex items-center gap-2 mb-3">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-green-light text-brand-green">
                          WEB
                        </span>
                        Format Site{' '}
                        <span className="text-text-secondary font-normal text-[12.5px]">
                          · 2000×1330{busySite ? ' · en cours…' : ''}
                        </span>
                      </h2>
                    <SizeRows
                      jobs={integ}
                      render={(root) => {
                        const disp = displayedJob(root)
                        const vs = versionsOf(root.id)
                        const vnum = vs.findIndex((v) => v.id === disp.id) + 1
                        const dp = disp.result?.deliveryPath
                        const dispDone = disp.status === 'done' && !!dp
                        // Une retouche (mes-fix) tourne pour cette MES : la carte le dit
                        // dans son en-tête, sans rien poser sur l'image affichée.
                        const fixBusy = vs.some(
                          (v) => v.status === 'queued' || v.status === 'running'
                        )
                        // PNG produit d'origine (détouré) — porté par le job MES racine,
                        // identique pour toutes les versions.
                        const pp = root.result?.productPath
                        const fname = fnameOf(root, 'site', typo)
                        // Générations multiples (29/07/2026) : nb de générations de la
                        // taille + MP verrouillé tant qu'aucune n'est retenue.
                        const nVar = slotVariantsOf(root).length
                        const mpReady = mpReadyFor(root)
                        return (
                          <div key={root.id} className="bg-white border border-border rounded-[12px] shadow-sm overflow-hidden">
                            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                              <span className="font-bold text-[13px]">{labelOf(root)}</span>
                              {nVar > 1 && (
                                <span
                                  title={`${nVar} générations — ouvre pour comparer et en choisir une`}
                                  className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${
                                    root.chosen ? 'bg-brand-green-light text-brand-green' : 'bg-surface text-text-secondary'
                                  }`}
                                >
                                  {root.chosen ? `✓ retenue · ${nVar} gén.` : `▦ ${nVar} générations`}
                                </span>
                              )}
                              {vnum > 1 && (
                                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-brand-green-light text-brand-green">
                                  V{vnum}
                                </span>
                              )}
                              {fixBusy && dispDone && (
                                <span
                                  title="Une retouche se génère pour cette MES — la version affichée ne bouge pas"
                                  className="flex items-center gap-1.5 text-[10.5px] font-bold text-brand-green"
                                >
                                  <span className="w-3 h-3 rounded-full border-2 border-brand-green-light border-t-brand-green animate-spin" />
                                  nouvelle version…
                                </span>
                              )}
                              <span className="ml-auto text-[11.5px] text-text-secondary tabular-nums">2000×1330</span>
                            </div>
                            {dispDone ? (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setStudioRoot(root.id)}
                                  title="Retours & versions"
                                  className="block w-full cursor-pointer group relative"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={imgUrl(dp!, 960)} alt={labelOf(root)} loading="lazy" decoding="async" className="w-full aspect-[3/2] object-cover bg-surface" />
                                  <span className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/30 opacity-0 group-hover:opacity-100 text-white text-[13px] font-bold transition-all">
                                    <span className="flex items-center gap-1.5">
                                      <PictoIllu name="loupe" size={15} />
                                      Ouvrir · retours &amp; versions
                                    </span>
                                  </span>
                                </button>
                                {/* PNG produit lié — vignette en bas à droite de la MES,
                                    juste au-dessus du bouton MP ; clic = aperçu en grand */}
                                {pp && (
                                  <button
                                    type="button"
                                    onClick={() => setLightbox(imgUrl(pp))}
                                    title="PNG produit d'origine — cliquer pour agrandir"
                                    className="absolute bottom-2 right-2 z-10 w-20 rounded-[8px] border border-border bg-white/95 shadow-sm p-1 cursor-zoom-in hover:border-brand-green transition-colors"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={imgUrl(pp, 240)}
                                      alt="PNG produit d'origine"
                                      loading="lazy"
                                      decoding="async"
                                      className="w-full h-12 object-contain"
                                    />
                                  </button>
                                )}
                              </div>
                            ) : root.status === 'error' ? (
                              <div className="aspect-[3/2] bg-brand-red-light grid place-items-center text-brand-red text-sm px-4 text-center">
                                Échec — {root.error ?? 'erreur'}
                              </div>
                            ) : (
                              <div className="aspect-[3/2] bg-surface grid place-items-center">
                                <span className="w-8 h-8 rounded-full border-4 border-brand-green-light border-t-brand-green animate-spin" />
                              </div>
                            )}
                            <div className="flex items-center gap-2 px-3.5 py-2.5">
                              <span className="text-[11.5px] text-text-secondary font-mono truncate">{fname}</span>
                              <div className="ml-auto flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void regenRoot(root)}
                                  disabled={disp.status === 'queued' || disp.status === 'running'}
                                  title="Relancer le job (même réglages, nouvelle image)"
                                  className="w-8 h-8 rounded-[8px] border border-border text-text-secondary hover:border-brand-green hover:text-brand-green hover:bg-brand-green-light grid place-items-center disabled:opacity-40 transition-colors"
                                >
                                  ↻
                                </button>
                                {/* Passage MP de CETTE MES (1:1) — bloqué une fois demandé,
                                    invisible si le moteur interdit le MP (réglage 'jamais') */}
                                {mpMode !== 'jamais' && (
                                  <button
                                    type="button"
                                    onClick={() => void mpRoot(root)}
                                    disabled={!dispDone || mpDoneFor(root.id) || !mpReady}
                                    title={
                                      mpDoneFor(root.id)
                                        ? 'Déjà passée en Marketplace'
                                        : !mpReady
                                          ? 'Choisis d’abord une génération (ouvre la case) pour débloquer le MP'
                                          : 'Passer en Marketplace (recadrage 1:1 + bords)'
                                    }
                                    className="w-8 h-8 rounded-[8px] border grid place-items-center text-[11px] font-bold tabular-nums disabled:opacity-40 transition-colors"
                                    style={{ borderColor: '#c9bfe4', color: '#6d5bb5' }}
                                  >
                                    {mpDoneFor(root.id) ? '✓' : !mpReady ? '🔒' : '1:1'}
                                  </button>
                                )}
                                {dispDone ? (
                                  <a
                                    href={imgUrl(dp!)}
                                    download={fname}
                                    title="Télécharger la version choisie"
                                    className="w-8 h-8 rounded-[8px] bg-brand-green text-white hover:bg-brand-green-hover grid place-items-center transition-colors"
                                  >
                                    ⬇
                                  </a>
                                ) : (
                                  <span className="w-8 h-8 rounded-[8px] bg-brand-green/40 text-white grid place-items-center">⬇</span>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      }}
                    />
                    </>
                  )}

                  {/* Marketplace (MP) — via le bouton 1:1 des cartes ou l'option automatique */}
                  {mkt.length > 0 && (
                      <div className="mt-6">
                        <h2 className="text-[13px] font-bold flex items-center gap-2 mb-3">
                          <span
                            className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: '#ede8f6', color: '#6d5bb5' }}
                          >
                            MP
                          </span>
                          Format Marketplace{' '}
                          <span className="text-text-secondary font-normal text-[12.5px]">
                            · 2000×2000{busyMkt ? ' · en cours…' : ''}
                          </span>
                        </h2>
                        <SizeRows
                          jobs={mkt}
                          render={(j) => {
                            const working = j.status === 'queued' || j.status === 'running'
                            const dp = j.result?.deliveryPath
                            const fname = fnameOf(j, 'marketplace', typo)
                            return (
                              <div key={j.id} className="bg-white border border-border rounded-[12px] shadow-sm overflow-hidden">
                                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                                  <span className="font-bold text-[13px]">{labelOf(j)}</span>
                                  <span className="ml-auto text-[11.5px] text-text-secondary tabular-nums">2000×2000</span>
                                </div>
                                {dp && !working ? (
                                  <button type="button" onClick={() => setLightbox(imgUrl(dp))} className="block w-full cursor-zoom-in">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={imgUrl(dp, 960)} alt={labelOf(j)} loading="lazy" decoding="async" className="w-full aspect-square object-cover bg-surface" />
                                  </button>
                                ) : j.status === 'error' ? (
                                  <div className="aspect-square bg-brand-red-light grid place-items-center text-brand-red text-sm px-4 text-center">
                                    Échec — {j.error ?? 'erreur'}
                                  </div>
                                ) : (
                                  <div className="aspect-square bg-surface grid place-items-center">
                                    <span className="w-8 h-8 rounded-full border-4 border-brand-green-light border-t-brand-green animate-spin" />
                                  </div>
                                )}
                                <div className="flex items-center gap-2 px-3.5 py-2.5">
                                  <span className="text-[11.5px] text-text-secondary font-mono truncate">{fname}</span>
                                  {dp && !working && (
                                    <a
                                      href={imgUrl(dp)}
                                      download={fname}
                                      title="Télécharger"
                                      className="ml-auto w-8 h-8 rounded-[8px] bg-brand-green text-white hover:bg-brand-green-hover grid place-items-center transition-colors"
                                    >
                                      ⬇
                                    </a>
                                  )}
                                </div>
                              </div>
                            )
                          }}
                        />
                      </div>
                  )}

                  {(failed.length > 0 || apiErrors.length > 0) && (
                    <div className="mt-5 bg-brand-red-light border border-brand-red/30 rounded-[12px] px-4 py-3 text-sm">
                      <p className="font-bold text-brand-red mb-1">Quelques éléments n&apos;ont pas abouti :</p>
                      <ul className="list-disc pl-5 text-text-secondary space-y-0.5">
                        {apiErrors.map((e, i) => (
                          <li key={`ae-${i}`}>
                            {e.name} — {e.error}
                          </li>
                        ))}
                        {failed.map((j) => (
                          <li key={j.id}>
                            {j.payload?.size ? `${j.payload.size.w}B${j.payload.size.h}` : `Job ${j.id}`} —{' '}
                            {j.error ?? 'erreur'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                </div>
              )
            })()}
        </section>
      )}

      {/* ÉTAPE 3 — LIBRE : studio visuel adaptatif (maquette mes-libre-v11 validée
          le 28/07/2026) — produit en références, scène décrite au formulaire,
          aperçu vivant, jobs « libre » par variante. */}
      {view === 'gen' && mode === 'lib' && (
        <section className="animate-fade-in-up">
          <Chemin onBack={goMode} parents={[{ label: 'Générer', onClick: goMode }]} here="MES Libre" />
          <MesLibre initialBatch={libreBatch} />
        </section>
      )}

      {/* Studio MES : clic sur une MES → grand + retours + versions.
          ← / → passent à la MES précédente / suivante du lot (ordre de la grille). */}
      {studioRoot != null &&
        batchId &&
        (() => {
          // La génération affichée + ses sœurs (variantes de la même taille).
          const studioJob = jobs.find((j) => j.id === studioRoot)
          const slotVariants = studioJob ? slotVariantsOf(studioJob) : []
          const studioVariants: StudioVariant[] = slotVariants.map((v) => ({
            id: v.id,
            n: variantNo(v),
            status: v.status,
            deliveryPath: v.result?.deliveryPath,
            chosen: !!v.chosen,
          }))
          const chosenVariantId = slotVariants.find((v) => v.chosen)?.id ?? null
          // Navigation ← / → PAR TAILLE (une case = une génération affichée).
          const roots = displayOrder(
            [...groupMesSlots(jobs).values()].map((v) => displayVariant(v)).filter((j): j is Job => !!j)
          )
          const curKey = studioJob ? slotKeyOf(studioJob) : ''
          const pos = roots.findIndex((r) => slotKeyOf(r) === curKey)
          return (
            <MesStudio
              key={studioRoot}
              batchId={batchId}
              produit={typo}
              mpEnabled={mpMode !== 'jamais'}
              rootJobId={studioRoot}
              chosenJobId={chosen[studioRoot] ?? null}
              variants={studioVariants}
              chosenVariantId={chosenVariantId}
              onChoose={chooseVersion}
              onChooseVariant={(id) => void chooseVariant(id)}
              onSelectVariant={(id) => setStudioRoot(id)}
              onMP={(id) => {
                setMpAskedRoots((prev) => new Set(prev).add(studioRoot))
                void mpJobs([id])
              }}
              onClose={closeStudio}
              onPrev={pos > 0 ? () => setStudioRoot(roots[pos - 1].id) : undefined}
              onNext={
                pos >= 0 && pos < roots.length - 1
                  ? () => setStudioRoot(roots[pos + 1].id)
                  : undefined
              }
            />
          )
        })()}

      {/* Fenêtre « Choisir un décor » — tous les décors rangés par typologie,
          recherche + filtre gamme. Sélection puis « Utiliser ce décor ». */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-5"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-surface rounded-[16px] shadow-2xl w-[min(1500px,100%)] h-[min(920px,calc(100vh-40px))] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white border-b border-border px-5 pt-4">
              <div className="flex items-center gap-3">
                <h3 className="text-[17px] font-bold m-0">
                  {pickFor === 'xl' ? 'Choisir un décor XL' : 'Choisir un décor'}
                </h3>
                <span className="text-xs text-text-secondary">
                  {pickList.length} décor{pickList.length > 1 ? 's' : ''} actif
                  {pickList.length > 1 ? 's' : ''}
                </span>
                {pickFor === 'xl' && (
                  <span className="text-[10px] font-bold uppercase tracking-wide bg-brand-green-light text-brand-green rounded-full px-2 py-0.5">
                    échelle XL · coulissants ≥ {COULISSANT_XL_MIN_W} cm
                  </span>
                )}
                <button
                  onClick={() => setPickerOpen(false)}
                  className="ml-auto text-text-disabled hover:text-text-primary text-xl leading-none"
                  title="Fermer"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap py-3">
                <div className="relative flex-1 min-w-[220px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2">
                    <PictoIllu name="loupe" size={15} className="text-text-secondary" />
                  </span>
                  <input
                    value={pickSearch}
                    onChange={(e) => setPickSearch(e.target.value)}
                    placeholder="Rechercher un décor, une gamme…"
                    autoFocus
                    className="w-full border border-border bg-surface rounded-[8px] pl-9 pr-3 py-2 text-[13.5px] focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                  />
                </div>
                <select
                  value={pickGamme}
                  onChange={(e) => setPickGamme(e.target.value)}
                  title="Filtrer par gamme"
                  className="border border-border bg-white rounded-[8px] px-2.5 py-2 text-[13px]"
                >
                  <option value="">Toutes les gammes</option>
                  {pickGammes.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </div>
              {/* Les onglets typologie n'ont pas de sens pour les décors XL :
                  la fenêtre XL montre une seule liste. */}
              {pickFor === 'std' && (
              <div className="flex gap-1">
                <button
                  onClick={() => setPickTab('')}
                  className={`px-4 py-2 text-[13px] border-b-[2.5px] -mb-px ${
                    pickTab === ''
                      ? 'text-brand-green border-brand-green font-bold'
                      : 'text-text-secondary border-transparent font-semibold'
                  }`}
                >
                  Toutes <span className="text-[11px] text-text-disabled">{pickList.length}</span>
                </button>
                {typoOrder.map((t) => {
                  const n = pickList.filter((d) => d.type === t).length
                  return (
                    <button
                      key={t}
                      onClick={() => setPickTab(t)}
                      className={`px-4 py-2 text-[13px] border-b-[2.5px] -mb-px ${
                        pickTab === t
                          ? 'text-brand-green border-brand-green font-bold'
                          : 'text-text-secondary border-transparent font-semibold'
                      }`}
                    >
                      <PictoIllu name={t} size={15} className="mr-1" />
                      {TYPO_INFO[t].titre}{' '}
                      <span className="text-[11px] text-text-disabled">{n}</span>
                    </button>
                  )
                })}
              </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-10 py-6">
              {pickList.length === 0 ? (
                <div className="text-center text-text-secondary text-[13.5px] py-10">
                  <p className="text-[15px] font-bold text-text-primary mb-1">
                    Aucun décor ne correspond
                  </p>
                  Modifie la recherche ou les filtres — ou crée un nouveau décor.
                </div>
              ) : (
                (pickFor === 'xl'
                  ? (['xl'] as ('xl' | Typo)[])
                  : typoOrder.filter((t) => !pickTab || pickTab === t)
                ).map((t) => {
                    const items = t === 'xl' ? pickList : pickList.filter((d) => d.type === t)
                    if (items.length === 0 && pickTab !== t) return null
                    return (
                      <div key={t} className="mb-5 last:mb-0">
                        <div className="flex items-center gap-2 mb-2.5 text-[13.5px] font-bold">
                          {t === 'xl' ? (
                            <>
                              <PictoIllu name="coulissant" size={16} />
                              Décors XL{' '}
                              <span className="text-xs text-text-secondary font-normal">
                                · {items.length}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-wide bg-brand-green-light text-brand-green rounded-full px-2 py-0.5">
                                pour les coulissants ≥ {COULISSANT_XL_MIN_W} cm
                              </span>
                            </>
                          ) : (
                            <>
                              <PictoIllu name={t} size={16} />
                              {TYPO_INFO[t].titre}{' '}
                              <span className="text-xs text-text-secondary font-normal">
                                · {items.length}
                              </span>
                              {t === typo ? (
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-brand-green-light text-brand-green rounded-full px-2 py-0.5">
                                  typologie en cours
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                                  ⚠ pas prévu pour un {TYPO_INFO[typo].titre.toLowerCase()}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                          {items.map((d) => {
                            const on = d.id === pickId
                            return (
                              <button
                                key={d.id}
                                onClick={() => setPickId(d.id)}
                                title={d.name}
                                className={`relative rounded-[12px] overflow-hidden border-[1.5px] text-left bg-white shadow-sm transition-transform duration-150 hover:scale-[1.3] hover:z-20 hover:shadow-2xl ${
                                  on
                                    ? 'border-brand-green ring-2 ring-brand-green-light'
                                    : 'border-border'
                                }`}
                              >
                                {on && (
                                  <span className="absolute top-1.5 left-2 w-5 h-5 rounded-full bg-brand-green text-white text-[11px] font-bold grid place-items-center">
                                    ✓
                                  </span>
                                )}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imgUrl(d.file_path, 480)}
                                  alt={d.name}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-[150px] object-cover"
                                />
                                <span className="block px-2.5 pt-1.5 pb-2">
                                  <span className="block text-[12.5px] font-bold leading-tight truncate">
                                    {d.name}
                                  </span>
                                  {d.gamme && (
                                    <span className="inline-block mt-1 text-[10.5px] font-bold bg-surface text-text-secondary rounded-full px-2 py-px">
                                      {d.gamme}
                                    </span>
                                  )}
                                </span>
                              </button>
                            )
                          })}
                          <Link
                            href="/decors"
                            className="rounded-[12px] border-[1.5px] border-dashed border-brand-green grid place-items-center min-h-[140px] text-brand-green font-bold text-center text-xs px-2 bg-white"
                          >
                            ＋ Créer un décor ↗
                          </Link>
                        </div>
                      </div>
                    )
                  })
              )}
            </div>

            <div className="bg-white border-t border-border px-5 py-3 flex items-center gap-3 flex-wrap">
              {picked && pickFor === 'std' && picked.type !== typo && TYPO_INFO[picked.type as Typo] ? (
                <span className="text-xs font-semibold text-amber-700 bg-amber-100 rounded-[8px] px-2.5 py-1.5">
                  ⚠ Décor pensé pour un {TYPO_INFO[picked.type as Typo].titre.toLowerCase()}, pas pour un{' '}
                  {TYPO_INFO[typo].titre.toLowerCase()} — le cadrage peut être raté.
                </span>
              ) : (
                <span className="text-xs text-text-disabled">
                  {pickFor === 'xl'
                    ? `Ce décor sera utilisé pour les ${xlCount} image${xlCount > 1 ? 's' : ''} XL du lot.`
                    : stdCount > 0 && xlCount > 0
                      ? 'Ce décor s’applique aux tailles standards du lot.'
                      : 'Le décor choisi s’applique à tout le lot.'}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <button
                  onClick={() => setPickerOpen(false)}
                  className="rounded-[8px] border border-border bg-white px-3.5 py-1.5 text-xs font-bold text-text-secondary hover:text-brand-green hover:border-brand-green transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    if (pickId != null) {
                      // Choix à la main : le décor automatique ne l'écrase plus.
                      if (pickFor === 'std') decorManual.current = true
                      ;(pickFor === 'xl' ? setDecorXlId : setDecorId)(pickId)
                    }
                    setPickerOpen(false)
                  }}
                  disabled={picked == null}
                  className="rounded-[8px] bg-brand-green hover:bg-brand-green-hover text-white px-3.5 py-1.5 text-xs font-bold disabled:opacity-45"
                >
                  Utiliser ce décor
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Aperçu en grand (MP) */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* Fond blanc : les PNG produit détourés resteraient invisibles sur le voile noir */}
          <img src={lightbox} alt="Aperçu en grand" className="max-w-full max-h-full object-contain rounded-[8px] bg-white" />
        </div>
      )}

      {/* Typologie indevinable depuis les noms de fichiers → fenêtre PAR-DESSUS
          le reste (demande Mathias 22/07/2026) : on choisit, tout est conservé. */}
      {askTypo && (
        <div className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-4">
          <div className="bg-white rounded-[16px] shadow-xl w-full max-w-3xl p-6">
            <h2 className="text-xl font-bold mb-1">Quelle typologie de produit ?</h2>
            <p className="text-sm text-text-secondary mb-5">
              Impossible de la deviner depuis les noms de fichiers (aucune lettre B/C/P, ou
              plusieurs différentes). Choisis — tes images et le reste sont conservés.
            </p>
            <div className="grid md:grid-cols-3 gap-[14px]">
              {(['battant', 'coulissant', 'portillon'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setTypo(k)
                    setTypoKnown(true)
                    setAskTypo(false)
                  }}
                  className="group text-left bg-white rounded-[12px] border-[1.5px] border-border shadow-sm pb-3.5 overflow-hidden transition-all hover:shadow-lg hover:border-brand-green"
                >
                  <div className="border-b border-border px-4 pt-4 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                    <Silhouette typo={k} />
                  </div>
                  <div className="px-4 pt-2.5">
                    <span className="block text-[15px] font-bold">{TYPO_INFO[k].titre}</span>
                    <span className="block text-[11px] font-bold uppercase tracking-[.07em] text-brand-green">
                      Moteur {TYPO_INFO[k].moteur}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                resetImages()
                setAskTypo(false)
              }}
              className="mt-4 text-sm font-semibold text-text-secondary hover:text-brand-red transition-colors"
            >
              Annuler le dépôt
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
