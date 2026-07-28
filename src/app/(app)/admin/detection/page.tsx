'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CANONICAL_COLORIS } from '@/lib/catalogue/colorisPalette'
import { labelForKeyword } from '@/lib/detection/nomenclature'

/**
 * Admin → Détection des images (maquettes atelier-detection-v4 + v5-lots,
 * validées les 24 et 27/07/2026). Deux modes d'atelier :
 *  - UN PAR UN : les cas douteux, questions détaillées (famille → précisions →
 *    coloris) — chaque clic devient un exemple appris ;
 *  - PAR LOTS : grille d'images que l'app croit d'une même vue, on décoche les
 *    erreurs et on valide tout le reste d'un clic.
 * Plus : bande « mes derniers classements » (reclasser une erreur) + Annuler.
 * Volet renommage : noms conformes nomenclature, export de COPIES uniquement.
 */

interface QueueItem {
  imageId: number
  productId: number
  productName: string
  family: string
  relPath: string
  fichier: string
  url: string
  pred: string | null
  predConf: number | null
  predWhy: string | null
}

interface LotItem {
  imageId: number
  productName: string
  relPath: string
  fichier: string
  url: string
  checked: boolean
}

interface RecentItem {
  imageId: number
  productId: number
  productName: string
  family: string
  relPath: string
  fichier: string
  url: string
  vue: string
  coloris: string | null
}

interface Stats {
  images: { total: number; analysees: number; enErreur: number }
  aClasser: number
  exemples: {
    total: number
    parSource: Record<string, number>
    parAxe: Record<string, Array<{ label: string; n: number }>>
  }
}

interface PhaseInfo {
  fait: number
  total: number
  demarreA: number | null
  finiA: number | null
  bilan: string | null
}

interface JournalEntry {
  id: number
  t: number
  phase: string
  niveau: 'info' | 'erreur'
  msg: string
}

interface Progress {
  actif: boolean
  phase: string | null
  fait: number
  total: number
  phaseDemarreA: number | null
  erreur: string | null
  courant: string | null
  phases: Record<string, PhaseInfo> | null
  journal: JournalEntry[] | null
  resume: string | null
}

/** Frise des 4 phases (maquette v7) : clé, nom, pastille de couleur du journal. */
const PHASES_META: Array<{ key: string; nom: string; chip: string }> = [
  { key: 'inventaire', nom: 'Inventaire', chip: 'bg-brand-teal-light text-brand-teal' },
  { key: 'exemples', nom: 'Exemples', chip: 'bg-brand-green-light text-brand-green' },
  { key: 'empreintes', nom: 'Empreintes', chip: 'bg-amber-100 text-amber-700' },
  { key: 'classement', nom: 'Classement', chip: 'bg-purple-100 text-purple-700' },
]
const CHIP_SYSTEME = 'bg-surface text-text-secondary'
const CHIP_ERREUR = 'bg-brand-red-light text-brand-red'

function chipFor(entry: JournalEntry): string {
  if (entry.niveau === 'erreur') return CHIP_ERREUR
  return PHASES_META.find((p) => p.key === entry.phase)?.chip ?? CHIP_SYSTEME
}

interface Proposal {
  imageId: number
  productName: string
  relPath: string
  proposed: string
  manque: string[]
  vueOrigine: 'appris' | 'detecte'
}

/** Familles de l'écran 1 — construisent les mots-clés officiels du listing. */
const FAMILLES: Array<{
  key: string
  label: string
  hint: string
  raccourci: string
  base?: string
  toggles?: Array<{ key: string; label: string }>
  pick?: Array<{ value: string; label: string }>
  instant?: string
  coloris?: boolean
}> = [
  {
    key: 'face', label: 'Face', hint: 'FRONT…', raccourci: '1', base: 'FRONT', coloris: true,
    toggles: [
      { key: 'open', label: 'Ouvert' },
      { key: 'q3l', label: '3/4 gauche' },
      { key: 'q3r', label: '3/4 droite' },
      { key: 'above', label: 'Plongée' },
      { key: 'below', label: 'Contre-plongée' },
    ],
  },
  {
    key: 'dos', label: 'Dos', hint: 'BACK…', raccourci: '2', base: 'BACK', coloris: true,
    toggles: [
      { key: 'open', label: 'Ouvert' },
      { key: 'q3l', label: '3/4 gauche' },
      { key: 'q3r', label: '3/4 droite' },
    ],
  },
  {
    key: 'profil', label: 'Profil', hint: 'LEFT / RIGHT', raccourci: '3',
    pick: [
      { value: 'LEFT', label: 'Profil gauche' },
      { value: 'RIGHT', label: 'Profil droit' },
    ],
  },
  {
    key: 'dessus', label: 'Dessus / Dessous', hint: 'ABOVE / BELOW', raccourci: '4',
    pick: [
      { value: 'ABOVE', label: 'Dessus' },
      { value: 'BELOW', label: 'Dessous' },
      { value: 'BELOW-OPEN', label: 'Dessous ouvert' },
    ],
  },
  { key: 'mes', label: 'MES', hint: 'en situation', raccourci: '5', instant: 'MES' },
  { key: 'zoom', label: 'Zoom détail', hint: 'ZOOM', raccourci: '6', instant: 'ZOOM' },
  { key: 'material', label: 'Matière / texture', hint: 'MATERIAL', raccourci: '7', instant: 'MATERIAL' },
  {
    key: 'technique', label: 'Technique', hint: 'ST / IT', raccourci: '8',
    pick: [
      { value: 'ST', label: 'Schéma technique' },
      { value: 'IT', label: 'Image technique' },
    ],
  },
  {
    key: 'contenu', label: 'Contenu A+ / Notice', hint: 'CONTENT / NOTICE', raccourci: '9',
    pick: [
      { value: 'CONTENT', label: 'Contenu A+' },
      { value: 'NOTICE', label: 'Notice' },
    ],
  },
  { key: 'mood', label: 'Moodboard', hint: 'interne app', raccourci: '0', instant: 'MOODBOARD' },
]

const PHASE_LABELS: Record<string, string> = {
  inventaire: 'Inventaire',
  exemples: 'Exemples',
  empreintes: 'Empreintes',
  classement: 'Classement',
}

function dureeRestante(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `~${s} s`
  return `~${Math.round(s / 60)} min`
}

/** Libellé du bouton pendant l'analyse : phase + avancement + temps restant (même motif que le scan catalogue). */
function analyseLabel(p: Progress): string {
  const phase = PHASE_LABELS[p.phase ?? ''] ?? 'Analyse'
  if (p.total === 0 || p.fait === 0 || !p.phaseDemarreA) return `${phase}…`
  const restant = ((Date.now() - p.phaseDemarreA) / p.fait) * (p.total - p.fait)
  return `${phase} ${p.fait}/${p.total} — reste ${dureeRestante(restant)}`
}

export default function AdminDetectionPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [fiabilite, setFiabilite] = useState<number | null>(null)
  const [modeleOk, setModeleOk] = useState(true)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Mode d'atelier (maquette v5) + lots
  const [mode, setMode] = useState<'un' | 'lots'>('un')
  const [vues, setVues] = useState<Array<{ vue: string; n: number }>>([])
  const [lotVue, setLotVue] = useState<string | null>(null)
  const [lotItems, setLotItems] = useState<LotItem[]>([])
  const [lotOffset, setLotOffset] = useState(0)
  const [validating, setValidating] = useState(false)

  // Derniers classements + reclassement d'une erreur
  const [recents, setRecents] = useState<RecentItem[]>([])
  const [manualItem, setManualItem] = useState<QueueItem | null>(null)
  const [peek, setPeek] = useState<{ url: string; cap: string } | null>(null)

  // Étapes du mode un par un
  const [famille, setFamille] = useState<string | null>(null)
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [pick, setPick] = useState<string | null>(null)
  const [askColoris, setAskColoris] = useState<string | null>(null)
  const [autreColoris, setAutreColoris] = useState(false)
  const autreRef = useRef<HTMLInputElement>(null)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }, [])

  const loadStats = useCallback(async () => {
    const r = await fetch('/api/detection/stats').then((x) => x.json()).catch(() => null)
    if (!r) return
    setStats(r.stats ?? null)
    setFiabilite(r.fiabilite?.fiabilite ?? null)
    setModeleOk(r.modeleDisponible !== false)
  }, [])

  const loadQueue = useCallback(async () => {
    const r = await fetch('/api/detection/atelier?limit=12').then((x) => x.json()).catch(() => null)
    if (r?.items) {
      setQueue(r.items)
      setIndex(0)
    }
  }, [])

  const loadProposals = useCallback(async () => {
    const r = await fetch('/api/detection/renommage?limit=8').then((x) => x.json()).catch(() => null)
    if (r?.proposals) setProposals(r.proposals)
  }, [])

  const loadRecents = useCallback(async () => {
    const r = await fetch('/api/detection/recents?limit=20').then((x) => x.json()).catch(() => null)
    if (r?.items) setRecents(r.items)
  }, [])

  const loadLots = useCallback(async (vue?: string | null, offset = 0) => {
    const params = new URLSearchParams()
    if (vue) params.set('vue', vue)
    if (offset > 0) params.set('offset', String(offset))
    const r = await fetch(`/api/detection/lots?${params}`).then((x) => x.json()).catch(() => null)
    if (!r) return
    setVues(r.vues ?? [])
    setLotVue(r.vue ?? null)
    setLotOffset(r.offset ?? 0)
    setLotItems(
      ((r.items ?? []) as Array<Omit<LotItem, 'checked'>>).map((i) => ({ ...i, checked: true }))
    )
  }, [])

  const loadAll = useCallback(() => {
    void loadStats()
    void loadQueue()
    void loadProposals()
    void loadRecents()
    void loadLots()
  }, [loadStats, loadQueue, loadProposals, loadRecents, loadLots])

  useEffect(() => {
    loadAll()
    fetch('/api/detection/analyse').then((x) => x.json()).then((r) => setProgress(r.progress)).catch(() => {})
  }, [loadAll])

  // Suivi de l'analyse en cours.
  useEffect(() => {
    if (!progress?.actif) return
    const t = setInterval(async () => {
      const r = await fetch('/api/detection/analyse').then((x) => x.json()).catch(() => null)
      if (!r) return
      setProgress(r.progress)
      if (!r.progress?.actif) {
        showToast(r.progress?.erreur ? `Analyse en erreur : ${r.progress.erreur}` : 'Analyse terminée ✓')
        loadAll()
      }
    }, 1000)
    return () => clearInterval(t)
  }, [progress?.actif, loadAll, showToast])

  const current = manualItem ?? queue[index] ?? null
  const familleDef = FAMILLES.find((f) => f.key === famille) ?? null

  const resetSteps = useCallback(() => {
    setFamille(null)
    setToggles({})
    setPick(null)
    setAskColoris(null)
    setAutreColoris(false)
  }, [])

  const advance = useCallback(() => {
    resetSteps()
    if (manualItem) {
      setManualItem(null)
    } else if (index + 1 < queue.length) {
      setIndex(index + 1)
    } else {
      void loadQueue()
    }
    void loadStats()
    void loadRecents()
  }, [manualItem, index, queue.length, loadQueue, loadStats, loadRecents, resetSteps])

  /** Mot-clé canonique construit depuis l'étape 2 (ordre du document). */
  const keyword = useCallback((): string => {
    if (!familleDef) return ''
    if (familleDef.instant) return familleDef.instant
    if (familleDef.pick) return pick ?? familleDef.pick[0].value
    let k = familleDef.base ?? ''
    if (k === 'FRONT' && toggles.above) k += '-ABOVE'
    if (k === 'FRONT' && toggles.below) k += '-BELOW'
    if (toggles.open) k += '-OPEN'
    if (toggles.q3l) k += '-3Q-LEFT'
    else if (toggles.q3r) k += '-3Q-RIGHT'
    return k
  }, [familleDef, pick, toggles])

  const classer = useCallback(
    async (vue: string, coloris?: string) => {
      if (!current) return
      const res = await fetch('/api/detection/atelier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: current.imageId, vue, coloris: coloris || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(data?.error ?? 'Classement refusé')
        return
      }
      showToast(
        `Classé « ${labelForKeyword(vue)}${coloris ? ` · ${coloris}` : ''} » — exemple ajouté ✓`
      )
      advance()
    },
    [current, advance, showToast]
  )

  const choisirFamille = useCallback(
    (key: string) => {
      const def = FAMILLES.find((f) => f.key === key)
      if (!def || !current) return
      if (def.instant) {
        void classer(def.instant)
        return
      }
      setFamille(key)
      setToggles({})
      setPick(def.pick ? def.pick[0].value : null)
    },
    [current, classer]
  )

  const validerPrecisions = useCallback(() => {
    if (!familleDef) return
    const k = keyword()
    if (familleDef.coloris) {
      setAskColoris(k)
      return
    }
    void classer(k)
  }, [familleDef, keyword, classer])

  const toggleChip = useCallback((key: string) => {
    setToggles((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      // Paires exclusives : 3/4 gauche/droite, plongée/contre-plongée.
      if (key === 'q3l' && next.q3l) next.q3r = false
      if (key === 'q3r' && next.q3r) next.q3l = false
      if (key === 'above' && next.above) next.below = false
      if (key === 'below' && next.below) next.above = false
      return next
    })
  }, [])

  // ————— mode par lots —————
  const validerLot = useCallback(async () => {
    if (!lotVue || validating) return
    const ids = lotItems.filter((i) => i.checked).map((i) => i.imageId)
    const rejectedIds = lotItems.filter((i) => !i.checked).map((i) => i.imageId)
    if (ids.length === 0 && rejectedIds.length === 0) return
    setValidating(true)
    try {
      const res = await fetch('/api/detection/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vue: lotVue, imageIds: ids, rejectedIds }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(data?.error ?? 'Validation refusée')
        return
      }
      const off = rejectedIds.length
      showToast(
        `${data.done} exemples ${lotVue} ajoutés ✓${off > 0 ? ` — ${off} décochée${off > 1 ? 's' : ''} envoyée${off > 1 ? 's' : ''} en tête du un par un` : ''}`
      )
      // Les validées quittent la file : le lot suivant recommence au début.
      await loadLots(lotVue, 0)
      void loadStats()
      void loadRecents()
      void loadQueue()
    } finally {
      setValidating(false)
    }
  }, [lotVue, lotItems, validating, loadLots, loadStats, loadRecents, loadQueue, showToast])

  const passerLot = useCallback(() => {
    void loadLots(lotVue, lotOffset + lotItems.length)
  }, [lotVue, lotOffset, lotItems.length, loadLots])

  const annulerDernier = useCallback(async () => {
    const dernier = recents[0]
    if (!dernier) return
    const res = await fetch(`/api/detection/atelier?imageId=${dernier.imageId}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast('Annulation impossible')
      return
    }
    showToast(`Classement « ${labelForKeyword(dernier.vue)} » annulé — l'image revient dans la file`)
    void loadRecents()
    void loadStats()
    void loadQueue()
    if (mode === 'lots') void loadLots(lotVue, 0)
  }, [recents, mode, lotVue, loadRecents, loadStats, loadQueue, loadLots, showToast])

  const reclasser = useCallback(
    (r: RecentItem) => {
      setMode('un')
      resetSteps()
      setManualItem({
        imageId: r.imageId,
        productId: r.productId,
        productName: r.productName,
        family: r.family,
        relPath: r.relPath,
        fichier: r.fichier,
        url: r.url,
        pred: r.vue,
        predConf: 1,
        predWhy: `déjà classée « ${labelForKeyword(r.vue)}${r.coloris ? ` · ${r.coloris}` : ''} » — votre nouveau choix remplacera l'ancien`,
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [resetSteps]
  )

  // Raccourcis clavier de l'atelier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (peek) {
        if (e.key === 'Escape') setPeek(null)
        return
      }
      if (mode === 'lots') {
        if (e.key === 'Enter') {
          e.preventDefault()
          void validerLot()
        }
        return
      }
      if (!current) return
      if (askColoris) {
        const map: Record<string, string> = { '1': 'Gris', '2': 'Blanc', '3': 'Noir', '4': 'Teck' }
        if (map[e.key]) {
          e.preventDefault()
          void classer(askColoris, map[e.key])
        }
        return
      }
      if (famille) {
        if (e.key === 'Enter') {
          e.preventDefault()
          validerPrecisions()
        }
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        showToast('Image passée — elle reviendra plus tard')
        advance()
        return
      }
      const def = FAMILLES.find((f) => f.raccourci === e.key)
      if (def) {
        e.preventDefault()
        choisirFamille(def.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, peek, current, askColoris, famille, classer, choisirFamille, validerPrecisions, advance, showToast, validerLot])

  const lancerAnalyse = async () => {
    try {
      const r = await fetch('/api/detection/analyse', { method: 'POST' })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        showToast(data?.error ?? 'Analyse impossible')
        return
      }
      setProgress(
        data.progress ?? {
          actif: true,
          phase: 'inventaire',
          fait: 0,
          total: 0,
          phaseDemarreA: null,
          erreur: null,
        }
      )
    } catch {
      showToast('Analyse impossible — le serveur ne répond pas')
    }
  }

  const exporter = async () => {
    setExporting(true)
    try {
      const r = await fetch('/api/detection/renommage', { method: 'POST' })
      const data = await r.json().catch(() => null)
      if (!r.ok) showToast(data?.error ?? 'Export impossible')
      else
        showToast(
          `${data.copied} copie${data.copied > 1 ? 's' : ''} renommée${data.copied > 1 ? 's' : ''} dans data/exports (${data.incomplete} à compléter)`
        )
    } finally {
      setExporting(false)
    }
  }

  const vuesEx = stats?.exemples.parAxe['vue'] ?? []
  const colorisEx = stats?.exemples.parAxe['coloris'] ?? []
  const famillesEx = stats?.exemples.parAxe['famille'] ?? []
  const gammesEx = stats?.exemples.parAxe['gamme'] ?? []
  const gratuits =
    (stats?.exemples.parSource['nom'] ?? 0) + (stats?.exemples.parSource['dossier'] ?? 0)
  const cochees = lotItems.filter((i) => i.checked).length

  return (
    <div className="max-w-[1020px]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold mb-1">Détection des images</h1>
        <p className="text-sm text-text-secondary max-w-[780px]">
          Deux façons de classer : <b>un par un</b> (les cas douteux, questions détaillées) ou{' '}
          <b>par lots</b> (confirmer en masse ce que l&apos;app croit déjà savoir). Chaque
          validation devient un exemple appris.
        </p>
      </div>

      {!modeleOk && (
        <div className="bg-brand-red-light text-brand-red text-sm font-semibold rounded-[12px] px-4 py-3 mb-4">
          Modèle d&apos;empreintes introuvable (models/dinov2-small.onnx) — la détection ne peut pas
          fonctionner sur ce poste.
        </div>
      )}

      {/* ————— bandeau : analyse + compteurs ————— */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex-1 min-w-[220px] bg-white rounded-[12px] shadow-sm p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Exemples appris
          </p>
          <p className="text-2xl font-bold text-brand-green leading-tight">
            {stats?.exemples.total ?? '—'}
          </p>
          <p className="text-[11.5px] text-text-disabled">
            {gratuits} gratuits (noms &amp; dossiers) · {stats?.exemples.parSource['fiche'] ?? 0}{' '}
            corrections de fiches · {stats?.exemples.parSource['atelier'] ?? 0} clics ici
          </p>
        </div>
        <div className="flex-1 min-w-[200px] bg-white rounded-[12px] shadow-sm p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Fiabilité mesurée
          </p>
          <p className="text-2xl font-bold leading-tight">
            {fiabilite === null ? '—' : `${Math.round(fiabilite * 100)} %`}
          </p>
          <p className="text-[11.5px] text-text-disabled">testée sur les exemples déjà classés</p>
        </div>
        <div className="flex-1 min-w-[200px] bg-white rounded-[12px] shadow-sm p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Images à classer
          </p>
          <p className="text-2xl font-bold leading-tight">{stats?.aClasser ?? '—'}</p>
          <p className="text-[11.5px] text-text-disabled">
            sur {stats?.images.analysees ?? 0} analysées
            {stats && stats.images.enErreur > 0 ? ` · ${stats.images.enErreur} illisibles` : ''}
          </p>
        </div>
        <div className="flex-1 min-w-[240px] bg-white rounded-[12px] shadow-sm p-4 flex flex-col justify-between">
          <button
            onClick={lancerAnalyse}
            disabled={!modeleOk || !!progress?.actif}
            title="Relit toutes les gammes du serveur (lecture seule)"
            className="relative overflow-hidden w-full text-sm font-semibold text-brand-green bg-brand-green-light rounded-full px-4 py-2.5 hover:bg-brand-green hover:text-white transition-colors disabled:pointer-events-none"
          >
            {/* Barre de progression : remplissage DANS le bouton, même motif que le scan catalogue. */}
            {progress?.actif && progress.total > 0 && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-brand-green/25 transition-[width] duration-700"
                style={{ width: `${Math.min(100, (progress.fait / progress.total) * 100)}%` }}
              />
            )}
            <span className="relative">
              {progress?.actif ? analyseLabel(progress) : '↻ Analyser les images'}
            </span>
          </button>
          <p className="text-[11px] text-text-disabled mt-2">
            {progress?.actif
              ? 'lecture seule du serveur — vous pouvez laisser tourner'
              : 'à relancer après une session de tri : propage vos clics à tous les avis (quelques minutes)'}
          </p>
        </div>
      </div>

      {/* ————— ce qui se passe derrière (maquette v7 : phases + journal) ————— */}
      {progress && (progress.actif || (progress.journal?.length ?? 0) > 0) && (
        <div className="bg-white rounded-[12px] shadow-sm p-5 mb-4">
          <h2 className="text-[15px] font-bold mb-0.5">Ce qui se passe derrière</h2>
          <p className="text-[12px] text-text-secondary mb-3.5">
            {progress.actif
              ? "les 4 étapes de l'analyse, en direct"
              : 'récap de la dernière analyse'}
          </p>

          {/* Frise des 4 phases */}
          {progress.phases && (
            <div className="flex mb-3.5">
              {PHASES_META.map((meta, i) => {
                const ph = progress.phases?.[meta.key]
                const done = !!ph?.finiA
                const active = !!ph?.demarreA && !ph?.finiA && progress.actif
                const pct = ph && ph.total > 0 ? Math.min(100, (ph.fait / ph.total) * 100) : 0
                const reste =
                  active && ph && ph.demarreA && ph.fait > 0 && ph.total > 0
                    ? dureeRestante(((Date.now() - ph.demarreA) / ph.fait) * (ph.total - ph.fait))
                    : null
                return (
                  <div
                    key={meta.key}
                    className={`flex-1 border-[1.5px] px-3 py-2 ${i === 0 ? 'rounded-l-[10px]' : 'border-l-0'} ${
                      i === PHASES_META.length - 1 ? 'rounded-r-[10px]' : ''
                    } ${active ? 'border-brand-green ring-2 ring-brand-green-light relative z-[1]' : 'border-border'} ${
                      done ? 'bg-[#fbfdf9]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          done
                            ? 'bg-brand-green text-white'
                            : active
                              ? 'bg-brand-green-light text-brand-green animate-pulse'
                              : 'bg-surface text-text-disabled'
                        }`}
                      >
                        {done ? '✓' : active ? '▶' : i + 1}
                      </span>
                      <span
                        className={`text-[12.5px] font-bold ${
                          done ? 'text-brand-green' : active ? 'text-text-primary' : 'text-text-disabled'
                        }`}
                      >
                        {meta.nom}
                      </span>
                    </div>
                    <p className={`text-[11.5px] ${done || active ? 'text-text-secondary' : 'text-text-disabled'}`}>
                      {done
                        ? ph?.bilan ?? 'faite'
                        : active
                          ? `${ph?.fait.toLocaleString('fr-FR')}/${ph?.total.toLocaleString('fr-FR')}${reste ? ` · reste ${reste}` : ''}`
                          : 'en attente'}
                    </p>
                    {active && (
                      <div className="h-1 bg-surface rounded-full overflow-hidden mt-1.5">
                        <div className="h-full bg-brand-green rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* En ce moment / résumé de fin */}
          {progress.actif && progress.courant && (
            <div className="flex items-center gap-2.5 bg-surface rounded-[8px] px-3.5 py-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-brand-green animate-pulse shrink-0" />
              <span className="text-[12px] font-bold text-text-secondary shrink-0">En ce moment :</span>
              <span className="text-[12px] font-mono text-text-primary truncate">{progress.courant}</span>
            </div>
          )}
          {!progress.actif && progress.resume && (
            <div className="bg-brand-green-light text-brand-green text-[13px] font-bold rounded-[8px] px-3.5 py-2.5 mb-3">
              ✓ {progress.resume}
            </div>
          )}
          {!progress.actif && progress.erreur && (
            <div className="bg-brand-red-light text-brand-red text-[13px] font-bold rounded-[8px] px-3.5 py-2.5 mb-3">
              Analyse arrêtée en erreur : {progress.erreur}
            </div>
          )}

          {/* Journal des événements, le plus récent en haut */}
          {(progress.journal?.length ?? 0) > 0 && (
            <div className="max-h-[260px] overflow-y-auto flex flex-col gap-0.5">
              {[...(progress.journal ?? [])].reverse().map((e) => (
                <div key={e.id} className="flex items-baseline gap-2 text-[12.5px] px-1.5 py-0.5 rounded hover:bg-surface">
                  <span className="font-mono text-[11px] text-text-disabled shrink-0 w-[52px]">
                    {new Date(e.t).toLocaleTimeString('fr-FR')}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-px shrink-0 ${chipFor(e)}`}
                  >
                    {e.niveau === 'erreur' ? 'Erreur' : PHASES_META.find((p) => p.key === e.phase)?.nom ?? 'Système'}
                  </span>
                  <span className="text-text-secondary min-w-0">{e.msg}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-text-disabled mt-2.5">
            Les {progress.journal?.length ?? 0} derniers événements sont conservés · une erreur
            n&apos;arrête jamais l&apos;analyse (image marquée « illisible », retentée la fois suivante)
          </p>
        </div>
      )}

      {/* ————— bascule de mode ————— */}
      <div className="inline-flex bg-white border border-border rounded-full p-1 mb-4 shadow-sm">
        {([
          ['un', 'Un par un'],
          ['lots', 'Par lots'],
        ] as Array<['un' | 'lots', string]>).map(([m, label]) => (
          <button
            key={m}
            onClick={() => {
              setMode(m)
              if (m === 'lots') void loadLots(lotVue, 0)
              else resetSteps()
            }}
            className={`text-[13px] font-bold rounded-full px-5 py-1.5 transition-colors ${
              mode === m ? 'bg-brand-green text-white' : 'text-text-secondary hover:text-brand-green'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ————— atelier : un par un ————— */}
      {mode === 'un' && (
        <div className="bg-white rounded-[12px] shadow-sm p-5 mb-4">
          {current ? (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="lg:w-[400px] shrink-0">
                <div className="border border-border rounded-[8px] overflow-hidden bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${current.url}&w=800`}
                    alt={current.fichier}
                    onDoubleClick={() => setPeek({ url: `${current.url}&w=1600`, cap: current.relPath })}
                    className="block w-full h-auto max-h-[340px] object-contain cursor-zoom-in"
                  />
                </div>
                <p className="text-[11px] text-text-disabled font-mono mt-1.5 truncate" title={current.relPath}>
                  {current.relPath}
                </p>
              </div>

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <span className="text-lg font-bold">{current.productName}</span>
                  <span className="text-[11px] font-bold bg-surface text-text-secondary rounded-full px-2.5 py-0.5">
                    {current.family}
                  </span>
                  {manualItem && (
                    <span className="text-[11px] font-bold bg-brand-teal-light text-brand-teal rounded-full px-2.5 py-0.5">
                      reclassement
                    </span>
                  )}
                </div>
                <div className="bg-surface rounded-[8px] px-3 py-2 mt-2.5 text-[13px] text-text-secondary">
                  Avis actuel de l&apos;app :{' '}
                  <b className="text-text-primary">
                    {current.pred ? labelForKeyword(current.pred) : 'aucun'}
                  </b>
                  {current.pred && !manualItem && (
                    <span className="ml-1.5 text-[10.5px] font-bold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                      {(current.predConf ?? 0) >= 0.75 ? 'plutôt sûr' : 'à vérifier'}
                    </span>
                  )}
                  {current.predWhy && (
                    <span className="block text-[11.5px] text-text-disabled mt-0.5">{current.predWhy}</span>
                  )}
                </div>

                {!famille && !askColoris && (
                  <>
                    <p className="text-[13.5px] font-bold mt-3.5 mb-2">
                      <span className="bg-brand-green text-white text-[10.5px] rounded-full px-2 py-0.5 mr-1.5">1</span>
                      C&apos;est quoi cette image ?
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {FAMILLES.map((f) => (
                        <button
                          key={f.key}
                          onClick={() => choisirFamille(f.key)}
                          className="flex items-center gap-2 border-[1.5px] border-border hover:border-brand-green hover:bg-brand-green-light rounded-[10px] px-3 py-2 text-left text-[13px] font-bold transition-colors"
                        >
                          {f.label}
                          <span className="text-[11px] font-semibold text-text-secondary">{f.hint}</span>
                          <span className="ml-auto text-[10.5px] font-bold text-text-disabled border border-border rounded px-1.5 font-mono">
                            {f.raccourci}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => void classer('AUTRE')}
                        className="border border-border hover:border-brand-red hover:text-brand-red rounded-full text-xs font-bold text-text-secondary px-3.5 py-1.5 transition-colors"
                      >
                        Autre / image inutilisable
                      </button>
                      <button
                        onClick={() => {
                          showToast('Image passée — elle reviendra plus tard')
                          advance()
                        }}
                        className="border border-border hover:border-brand-green hover:text-brand-green rounded-full text-xs font-bold text-text-secondary px-3.5 py-1.5 transition-colors"
                      >
                        Passer
                      </button>
                    </div>
                    <p className="text-[11.5px] text-text-disabled mt-auto pt-3">
                      Raccourcis : <b>1</b>–<b>9</b> et <b>0</b> selon la famille · <b>Espace</b> Passer ·
                      double-clic sur l&apos;image = voir en grand
                    </p>
                  </>
                )}

                {famille && familleDef && !askColoris && (
                  <>
                    <p className="text-[13.5px] font-bold mt-3.5 mb-2">
                      <span className="bg-brand-green text-white text-[10.5px] rounded-full px-2 py-0.5 mr-1.5">2</span>
                      Des précisions ?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {familleDef.toggles?.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => toggleChip(t.key)}
                          className={`rounded-full text-[12.5px] font-bold px-3.5 py-1.5 border-[1.5px] transition-colors ${
                            toggles[t.key]
                              ? 'bg-brand-green border-brand-green text-white'
                              : 'border-border text-text-secondary hover:border-brand-green'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                      {familleDef.pick?.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => setPick(p.value)}
                          className={`rounded-full text-[12.5px] font-bold px-3.5 py-1.5 border-[1.5px] transition-colors ${
                            pick === p.value
                              ? 'bg-brand-green border-brand-green text-white'
                              : 'border-border text-text-secondary hover:border-brand-green'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11.5px] text-text-secondary mt-2.5">
                      Mot-clé officiel :{' '}
                      <span className="font-mono font-bold text-brand-green bg-brand-green-light rounded px-2 py-0.5">
                        {keyword()}
                      </span>
                      <span className="text-text-disabled ml-2">
                        la numérotation (-01…) sera posée à l&apos;export
                      </span>
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={validerPrecisions}
                        className="bg-brand-green hover:opacity-90 text-white text-sm font-bold rounded-[10px] px-4 py-2 transition-opacity"
                      >
                        Valider
                      </button>
                      <button
                        onClick={resetSteps}
                        className="border border-border hover:border-brand-green hover:text-brand-green rounded-full text-xs font-bold text-text-secondary px-3.5 py-1.5 transition-colors"
                      >
                        ← Changer de famille
                      </button>
                    </div>
                  </>
                )}

                {askColoris && (
                  <>
                    <p className="text-[13.5px] font-bold mt-3.5 mb-2">
                      <span className="bg-brand-green text-white text-[10.5px] rounded-full px-2 py-0.5 mr-1.5">3</span>
                      Et quel coloris ? <span className="font-mono text-brand-green">{askColoris}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {CANONICAL_COLORIS.map((c, i) => (
                        <button
                          key={c.key}
                          onClick={() => void classer(askColoris, c.label)}
                          className="flex items-center gap-2.5 border-[1.5px] border-border hover:border-brand-green hover:bg-brand-green-light rounded-[10px] px-3 py-2.5 text-left text-sm font-bold transition-colors"
                        >
                          <span
                            className="w-5 h-5 rounded-[6px] border border-black/10 shrink-0"
                            style={{ background: c.swatch }}
                          />
                          {c.label}
                          {c.ral && (
                            <span className="text-[11px] font-semibold text-text-secondary">{c.ral}</span>
                          )}
                          <span className="ml-auto text-[10.5px] font-bold text-text-disabled border border-border rounded px-1.5 font-mono">
                            {i + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      {autreColoris ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            ref={autreRef}
                            placeholder="Nom du coloris (ajouté en admin)"
                            className="border border-border rounded-[8px] px-3 py-1.5 text-sm w-56"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && autreRef.current?.value.trim()) {
                                void classer(askColoris, autreRef.current.value.trim())
                              }
                            }}
                          />
                          <button
                            onClick={() => {
                              if (autreRef.current?.value.trim())
                                void classer(askColoris, autreRef.current.value.trim())
                            }}
                            className="bg-brand-green text-white text-xs font-bold rounded-[8px] px-3 py-2"
                          >
                            OK
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setAutreColoris(true)}
                          className="border border-border hover:border-brand-green hover:text-brand-green rounded-full text-xs font-bold text-text-secondary px-3.5 py-1.5 transition-colors"
                        >
                          Autre coloris…
                        </button>
                      )}
                      <button
                        onClick={() => void classer(askColoris)}
                        className="border border-border hover:border-brand-green hover:text-brand-green rounded-full text-xs font-bold text-text-secondary px-3.5 py-1.5 transition-colors"
                      >
                        Je ne sais pas
                      </button>
                    </div>
                    <p className="text-[11.5px] text-text-disabled mt-auto pt-3">
                      Raccourcis : <b>1</b> Gris · <b>2</b> Blanc · <b>3</b> Noir · <b>4</b> Teck
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-10">
              <p className="text-sm text-text-secondary">
                {stats && stats.images.analysees === 0
                  ? 'Aucune image analysée pour le moment — lancez « Analyser les images » ci-dessus.'
                  : 'Rien à classer : toutes les images analysées ont leur vue. Relancez une analyse après un ajout sur le serveur.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ————— atelier : par lots ————— */}
      {mode === 'lots' && (
        <div className="bg-white rounded-[12px] shadow-sm p-5 mb-4">
          <div className="flex flex-wrap items-center gap-1.5 mb-3.5">
            <span className="text-[11.5px] font-bold text-text-secondary mr-1">Lots proposés :</span>
            {vues.map((v) => (
              <button
                key={v.vue}
                onClick={() => void loadLots(v.vue, 0)}
                className={`rounded-full border-[1.5px] text-[12px] font-bold font-mono px-3 py-1 transition-colors ${
                  lotVue === v.vue
                    ? 'bg-brand-green border-brand-green text-white'
                    : 'border-border text-text-secondary hover:border-brand-green'
                }`}
              >
                {v.vue} <span className="font-sans font-semibold opacity-70">{v.n}</span>
              </button>
            ))}
          </div>

          {lotItems.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">
              Plus rien à valider pour cette vue — choisissez-en une autre ou relancez une analyse
              pour rafraîchir les avis.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2.5 flex-wrap mb-3">
                <span className="text-[15px] font-bold">
                  Je pense que ces {lotItems.length} images sont des{' '}
                  <span className="font-mono text-brand-green">{lotVue}</span>
                </span>
                <span className="text-[12.5px] text-text-secondary">— décochez celles qui n&apos;en sont pas</span>
                <span className="ml-auto text-[11.5px] text-text-disabled">
                  clic = décocher · double-clic = voir en grand · <b className="font-mono">Entrée</b> = valider
                </span>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 mb-3.5">
                {lotItems.map((item) => (
                  <div
                    key={item.imageId}
                    onClick={() =>
                      setLotItems((prev) =>
                        prev.map((p) => (p.imageId === item.imageId ? { ...p, checked: !p.checked } : p))
                      )
                    }
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      setPeek({ url: `${item.url}&w=1600`, cap: `${item.productName} — ${item.relPath}` })
                    }}
                    title={`${item.productName} — ${item.relPath}`}
                    className={`relative rounded-[8px] overflow-hidden cursor-pointer border-2 transition-all bg-white ${
                      item.checked ? 'border-brand-green' : 'border-brand-red opacity-50'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${item.url}&w=240`}
                      alt={item.fichier}
                      loading="lazy"
                      className="block w-full h-20 object-contain select-none"
                      draggable={false}
                    />
                    <span
                      className={`absolute top-1 right-1 w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center ${
                        item.checked ? 'bg-brand-green' : 'bg-brand-red'
                      }`}
                    >
                      {item.checked ? '✓' : '✕'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  onClick={() => void validerLot()}
                  disabled={validating}
                  className="bg-brand-green hover:opacity-90 disabled:opacity-40 text-white text-sm font-bold rounded-[10px] px-4 py-2.5 transition-opacity"
                >
                  {validating ? 'Validation…' : `✓ Valider ${cochees} image${cochees > 1 ? 's' : ''} comme ${lotVue}`}
                </button>
                <button
                  onClick={passerLot}
                  className="border border-border hover:border-brand-green hover:text-brand-green rounded-full text-xs font-bold text-text-secondary px-3.5 py-2 transition-colors"
                >
                  Passer ce lot
                </button>
                <span className="text-[11.5px] text-text-disabled">
                  les décochées ne reviennent plus en lot — elles passent en tête du un par un
                </span>
                <span className="ml-auto text-[12px] font-semibold text-text-secondary">
                  les plus sûres d&apos;abord
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ————— mes derniers classements ————— */}
      {recents.length > 0 && (
        <div className="bg-white rounded-[12px] shadow-sm p-4 mb-4">
          <div className="flex items-center gap-2 mb-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              Mes derniers classements
            </p>
            <span className="text-[11px] text-text-disabled">— cliquez sur une image pour la reclasser</span>
            <button
              onClick={() => void annulerDernier()}
              className="ml-auto border border-border hover:border-brand-red hover:text-brand-red rounded-full text-[11.5px] font-bold text-text-secondary px-3 py-1 transition-colors"
            >
              ⟲ Annuler le dernier
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {recents.map((r) => (
              <button
                key={`${r.imageId}-${r.vue}`}
                onClick={() => reclasser(r)}
                title={`${r.productName} — ${r.relPath}\nClassée : ${labelForKeyword(r.vue)}${r.coloris ? ` · ${r.coloris}` : ''}`}
                className="shrink-0 w-[76px] group"
              >
                <span className="block border border-border group-hover:border-brand-green rounded-[6px] overflow-hidden bg-white transition-colors">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${r.url}&w=240`}
                    alt={r.fichier}
                    loading="lazy"
                    className="block w-full h-12 object-contain"
                  />
                </span>
                <span className="block text-[9.5px] font-mono font-bold text-text-secondary truncate mt-0.5">
                  {r.vue}
                  {r.coloris ? ` · ${r.coloris}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ————— ce que l'app a appris ————— */}
      <div className="bg-white rounded-[12px] shadow-sm p-5 mb-4">
        <h2 className="text-[15px] font-bold mb-1">Ce que l&apos;app a appris</h2>
        <p className="text-[12.5px] text-text-secondary mb-3 max-w-[760px]">
          Chaque image est convertie en <b>empreinte visuelle</b> par un modèle local (rien n&apos;est
          envoyé, aucun coût). Une nouvelle image prend la catégorie de ses plus proches
          ressemblances — sinon elle atterrit dans la file à classer. Le coloris, lui, se classe par
          couleur mesurée, gamme par gamme.
        </p>
        {([
          ['Mots-clés officiels (vues)', vuesEx, true],
          ['Coloris (sur les vues produit)', colorisEx, false],
          ['Famille — apprise toute seule', famillesEx, false],
          ['Gamme — apprise toute seule', gammesEx, false],
        ] as Array<[string, Array<{ label: string; n: number }>, boolean]>).map(
          ([titre, rows, mono]) => (
            <div key={titre} className="mb-2.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-text-secondary mb-1.5">
                {titre}
              </p>
              {rows.length === 0 ? (
                <p className="text-[12px] text-text-disabled">aucun exemple pour l&apos;instant</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {rows.map((r) => (
                    <span
                      key={r.label}
                      className={`border border-border rounded-full px-3 py-1 text-[12px] font-bold ${mono ? 'font-mono' : ''}`}
                      title={mono ? labelForKeyword(r.label) : undefined}
                    >
                      {r.label} <span className="text-text-secondary font-semibold">{r.n}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        <p className="text-[12px] text-text-secondary mt-3">
          Trois sources d&apos;exemples, sans effort en double : ① le <b>rangement déjà clair</b> du
          serveur (noms conformes, dossiers M.E.S, coloris nommés) · ② vos <b>corrections</b> sur les
          fiches produit · ③ vos <b>clics ici</b>. Les propositions des fiches produit se mettront à
          jour au prochain scan du catalogue.
        </p>
      </div>

      {/* ————— renommage ————— */}
      <div className="bg-white rounded-[12px] shadow-sm p-5 mb-4">
        <h2 className="text-[15px] font-bold mb-1">Aide au renommage — nomenclature HOORTRADE</h2>
        <p className="text-[12.5px] text-text-secondary mb-3 max-w-[780px]">
          Pour chaque image : <b>GAMME-TAILLE _ MOT-CLÉ _ DESTINATION _ RÉF</b>. La réf KIT est
          reprise quand elle est connue, sinon le nom reste « à compléter » — rien n&apos;est jamais
          inventé. <b>Le serveur O:\ n&apos;est jamais modifié</b> : l&apos;export écrit des copies
          dans data/exports/ avec un tableau récapitulatif.
        </p>
        {proposals.length === 0 ? (
          <p className="text-[12px] text-text-disabled mb-3">
            aucune proposition pour l&apos;instant — lancez une analyse d&apos;abord
          </p>
        ) : (
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                  <th className="py-1.5 pr-3 font-bold">Fichier aujourd&apos;hui</th>
                  <th className="py-1.5 pr-3 font-bold">Proposition</th>
                  <th className="py-1.5 font-bold" />
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.imageId} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-mono text-text-secondary truncate max-w-[260px]" title={p.relPath}>
                      {p.relPath.split(/[\\/]/).pop()}
                    </td>
                    <td className="py-1.5 pr-3 font-mono font-bold text-brand-green truncate max-w-[340px]" title={p.proposed}>
                      {p.proposed}
                    </td>
                    <td className="py-1.5 text-[11px] text-text-disabled whitespace-nowrap">
                      {p.productName}
                      {p.vueOrigine === 'detecte' ? ' · vue détectée' : ''}
                      {p.manque.length > 0 && (
                        <span className="ml-1.5 bg-amber-100 text-amber-700 font-bold rounded px-1.5">
                          à compléter : {p.manque.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          onClick={exporter}
          disabled={exporting || proposals.length === 0}
          className="bg-brand-green hover:opacity-90 disabled:opacity-40 text-white text-sm font-bold rounded-[10px] px-4 py-2.5 transition-opacity"
        >
          {exporting ? 'Export en cours…' : 'Exporter les copies renommées'}
        </button>
      </div>

      {/* ————— aperçu grand format ————— */}
      {peek && (
        <div
          onClick={() => setPeek(null)}
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center cursor-zoom-out p-6"
        >
          <div className="bg-white rounded-[12px] overflow-hidden max-w-[860px] w-full shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={peek.url} alt={peek.cap} className="block w-full max-h-[76vh] object-contain" />
            <p className="px-4 py-2 text-[11.5px] font-mono text-text-secondary border-t border-border truncate">
              {peek.cap}
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 bottom-7 -translate-x-1/2 bg-text-primary text-white text-[13px] font-semibold rounded-full px-5 py-2.5 shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
