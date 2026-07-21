'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { parseProduitFromFileName, parseSizeFromProductName } from '@/lib/productName'
import Silhouette, { type Typo } from '../Silhouette'
import MesStudio from './MesStudio'

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
  type: 'battant' | 'coulissant' | 'portillon'
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
    /** Essai du Labo moteur : jamais affiché dans une session de génération. */
    lab?: boolean
  } | null
  result: { deliveryPath?: string; sizeLabel?: string } | null
  error: string | null
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
const TYPO_INFO: Record<Typo, { ic: string; titre: string; moteur: string; lettre: string }> = {
  battant: { ic: 'battant', titre: 'Portail battant', moteur: 'Battant « JANUS »', lettre: 'B' },
  coulissant: {
    ic: 'coulissant',
    titre: 'Portail coulissant',
    moteur: 'Coulissant « TERMINUS »',
    lettre: 'C',
  },
  portillon: { ic: 'portillon', titre: 'Portillon', moteur: 'Portillon « FORCULUS »', lettre: 'P' },
}

/**
 * Pictos 3D de la page (remplacement des emoji, demande Mathias 13/07/2026) :
 * Fluent Emoji 3D de Microsoft (github.com/microsoft/fluentui-emoji, licence MIT),
 * fichiers dans public/pictos/. `ic` de TYPO_INFO = nom de fichier.
 */
function Pic({ name, size, className }: { name: string; size: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/pictos/${name}.png`}
      alt=""
      width={size}
      height={size}
      className={`inline-block align-[-0.18em] ${className ?? ''}`}
    />
  )
}

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
type View = 'mode' | 'typo' | 'gen'
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
                  className="grid gap-4"
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
              <div className="grid gap-4 mt-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
                {unsized.map((j) => render(j))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// —————————————————————————————————————————————— page
export default function GenerationPage() {
  const [view, setView] = useState<View>('mode')
  const [mode, setMode] = useState<Mode>('con')
  // Typologie de l'étape 2 → moteur de génération (battant « JANUS », coulissant
  // « TERMINUS », portillon « FORCULUS »). Chaque moteur a ses tailles,
  // gabarits et prompts.
  const [typo, setTypo] = useState<Typo>('battant')
  const [stage, setStage] = useState<Stage>('input')
  // Nom du produit : détecté depuis le nom de fichier, corrigeable. Il identifie
  // la session sur l'accueil (« Mes sessions », validé 13/07/2026).
  const [produit, setProduit] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [decors, setDecors] = useState<DecorEntry[]>([])
  const [decorId, setDecorId] = useState<number | null>(null)
  // — fenêtre « Choisir un décor » (maquette choix-decor-v1 validée le 13/07/2026,
  //   sans favoris) : recherche + filtre gamme, décors rangés par typologie.
  //   Un décor d'une autre typologie reste sélectionnable, avec avertissement.
  const [pickerOpen, setPickerOpen] = useState(false)
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
  // Décliner automatiquement chaque MES Site en MP (2000×2000), sans attendre la review
  const [autoMp, setAutoMp] = useState(false)
  // Réglage « Déclinaison en MP » du moteur (Admin → Réglages par moteur) :
  // 'choix' = case à cocher, 'toujours' = automatique, 'jamais' = MP invisible.
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
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get('session')
    if (!sid) return
    let alive = true
    fetch(`/api/generation/sessions/${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.session) return
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
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Décor présélectionné par l'URL (« Utiliser ce décor » de la Bibliothèque /
  // du studio, rebranché 20/07/2026) : /generation?decor=<id>.
  useEffect(() => {
    const d = Number(new URLSearchParams(window.location.search).get('decor'))
    if (Number.isInteger(d) && d > 0) setDecorId(d)
  }, [])

  useEffect(() => {
    fetch('/api/decors')
      .then((r) => r.json())
      .then((d) => {
        const actifs: DecorEntry[] = (d.decors ?? [])
          .filter((x: DecorEntry) => x.status === 'actif')
          .sort((a: DecorEntry, b: DecorEntry) => b.id - a.id)
        setDecors(actifs)
        setDecorId((cur) => cur ?? actifs[0]?.id ?? null)
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
    const next: Img[] = Array.from(list).map((f) => {
      const p = parseName(f.name)
      return {
        id: `img-${seq.current++}`,
        file: f,
        name: f.name,
        url: URL.createObjectURL(f),
        color: p.color ?? 'Gris',
        // Taille non lue dans le nom → taille la plus courante DU moteur.
        w: p.w ?? (typo === 'portillon' ? 100 : 300),
        h: p.h ?? 140,
        detSize: p.w != null && p.h != null,
        editSize: false,
        editColor: false,
      }
    })
    setImages((cur) => [...cur, ...next])
    // Nom du produit : première détection gagnante, jamais écrasée si déjà saisi.
    setProduit((cur) => {
      if (cur) return cur
      for (const f of Array.from(list)) {
        const p = parseProduitFromFileName(f.name)
        if (p) return p
      }
      return cur
    })
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
    setView(m === 'con' ? 'typo' : 'gen')
    setStage('input')
  }
  function startCon(m: Typo) {
    setTypo(m)
    resetImages()
    setProduit('')
    setNotice(null)
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
      if (Array.isArray(d.jobs)) setJobs(sansEssaisLab(d.jobs))
    } catch {
      // pas grave : la prochaine action rafraîchira
    }
  }
  function chooseVersion(versionJobId: number) {
    if (studioRoot == null) return
    setChosen((prev) => ({ ...prev, [studioRoot]: versionJobId }))
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
      jobs
        .filter(isMesJob)
        .forEach((root) => {
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

  async function generate() {
    if (!decorId || images.length === 0) return
    setNotice(null)
    const fd = new FormData()
    fd.append('decorId', String(decorId))
    fd.append('moteur', typo)
    fd.append('produit', produit.trim())
    fd.append('autoMp', autoMp ? '1' : '0')
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

  const detCount = images.filter((i) => i.detSize).length
  const canGenerate = images.length > 0 && decorId != null

  // — sélecteur de décor : 3 vignettes max dans le panneau (le décor choisi
  //   remonte en premier, puis les plus récents), le reste via la fenêtre —
  const selectedDecor = decors.find((d) => d.id === decorId) ?? null
  const shortlist = [
    ...(selectedDecor ? [selectedDecor] : []),
    ...decors.filter((d) => d.id !== decorId),
  ].slice(0, 3)

  function openPicker() {
    setPickId(decorId)
    setPickSearch('')
    setPickGamme('')
    setPickTab('')
    setPickerOpen(true)
  }

  const pickList = decors.filter((d) => {
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
      {/* ÉTAPE 1 — MODE */}
      {view === 'mode' && (
        <section className="animate-fade-in-up">
          <h1 className="text-[34px] leading-tight font-bold tracking-tight mb-7">Génération</h1>
          {/* Maquette choix-mode-typologie-v1 validée le 13/07/2026 : panneaux
              typographiques (variante A) avec les textes condensés de la variante B.
              Retouches 15/07 : plus de liseré ni de badge d'état, tout en vert. */}
          <div className="grid md:grid-cols-2 gap-[18px]">
            <button
              onClick={() => pickMode('con')}
              className="group text-left bg-white rounded-[12px] border border-border shadow-sm px-7 py-[26px] transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              <span className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[.1em] text-brand-green mb-2.5">
                <span className="w-[7px] h-[7px] rounded-full bg-current" />
                Effet catalogue · gabarits
              </span>
              <h3 className="text-[26px] leading-[1.15] font-bold tracking-tight mb-1.5">
                MES Contrainte
              </h3>
              <p className="text-sm text-text-secondary">
                Proportions cohérentes entre les tailles, décor imposé, produit posé précisément,
                perspective réglée. Livraison <b className="text-text-primary">Site + Marketplace</b>.
              </p>
              <span className="inline-flex items-center gap-1.5 mt-[18px] text-[13.5px] font-bold text-white bg-brand-green rounded-[10px] px-[18px] py-[9px] transition-colors group-hover:bg-brand-green-hover">
                Générer →
              </span>
            </button>

            <button
              onClick={() => pickMode('lib')}
              className="group text-left bg-white rounded-[12px] border border-border shadow-sm px-7 py-[26px] transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              <span className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[.1em] text-brand-green mb-2.5">
                <span className="w-[7px] h-[7px] rounded-full bg-current" />
                Scène décrite · formulaire
              </span>
              <h3 className="text-[26px] leading-[1.15] font-bold tracking-tight mb-1.5">MES Libre</h3>
              <p className="text-sm text-text-secondary">
                Ambiance, angle, lumière — peu de règles, plusieurs variantes générées,{' '}
                <b className="text-text-primary">tu choisis</b>. Le produit reste verrouillé.
              </p>
              <span className="inline-flex items-center gap-1.5 mt-[18px] text-[13.5px] font-bold text-brand-green bg-white border-[1.5px] border-brand-green rounded-[10px] px-[17px] py-2 transition-colors group-hover:bg-brand-green-light">
                Voir le brouillon →
              </span>
            </button>
          </div>
        </section>
      )}

      {/* ÉTAPE 2 — TYPOLOGIE */}
      {view === 'typo' && (
        <section className="animate-fade-in-up">
          <Chemin onBack={goMode} parents={[{ label: 'Génération', onClick: goMode }]} here="Contrainte" />
          <div className="flex items-baseline gap-3 flex-wrap mb-4">
            <h1 className="text-2xl font-bold tracking-tight">Typologie de produit</h1>
            <span className="text-sm text-text-secondary">chaque typologie a son moteur</span>
          </div>
          {/* Maquette choix-mode-typologie-v1 validée le 13/07/2026 : cartes silhouette
              (variante A) — le visuel EST le produit, le moteur a sa propre ligne. */}
          <div className="grid md:grid-cols-3 gap-[18px]">
            {(
              [
                {
                  key: 'battant' as const,
                  mot: '« JANUS »',
                  s: 'Deux vantaux entre les piliers.',
                },
                {
                  key: 'coulissant' as const,
                  mot: '« TERMINUS »',
                  s: 'Une lame d’un seul tenant, le bord droit caché derrière le pilier.',
                },
                {
                  key: 'portillon' as const,
                  mot: '« FORCULUS »',
                  s: 'Un vantail piéton entre les piliers.',
                },
              ]
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => startCon(m.key)}
                className="group text-left bg-white rounded-[12px] border-[1.5px] border-border shadow-sm pb-[18px] overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-brand-green"
              >
                <div className="border-b border-border px-[18px] pt-[18px] bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                  <Silhouette typo={m.key} />
                </div>
                <div className="px-[18px] pt-3.5">
                  <h3 className="text-[17px] font-bold">{TYPO_INFO[m.key].titre}</h3>
                  <div className="text-[11px] font-bold uppercase tracking-[.07em] text-brand-green mb-1.5">
                    Moteur {m.mot}
                  </div>
                  <p className="text-[12.5px] text-text-secondary">{m.s}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 mx-[18px] mt-3 text-[13px] font-bold text-brand-green group-hover:underline">
                  Générer →
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ÉTAPE 3 — GÉNÉRATION (Contrainte) */}
      {view === 'gen' && mode === 'con' && (
        <section className="animate-fade-in-up">
          {/* Une fois la génération lancée, « Contrainte » ne ramène plus au choix de
              typologie (comme l'ancien pill « ← Typologie » réservé à la saisie). */}
          <Chemin
            onBack={() => (stage === 'input' ? setView('typo') : goMode())}
            parents={[
              { label: 'Génération', onClick: goMode },
              {
                label: 'Contrainte',
                onClick: stage === 'input' ? () => setView('typo') : undefined,
              },
            ]}
            here={TYPO_INFO[typo].titre}
            sub={`· ${TYPO_INFO[typo].moteur}`}
          />

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
                      <Pic name="image" size={48} />
                      <span className="text-base font-bold">Dépose la ou les images du produit</span>
                      <span className="text-sm text-text-secondary max-w-md">
                        Photos de face, même produit (une par taille / coloris). Le moteur lit la taille et le
                        coloris dans le nom, détoure (BiRefNet), et pose{' '}
                        {typo === 'coulissant'
                          ? 'la lame devant l’ouverture, bord droit derrière le pilier'
                          : typo === 'portillon'
                            ? 'le portillon entre les piliers'
                            : 'le portail entre les piliers'}
                        .
                      </span>
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
                      <div className="bg-brand-green-light text-brand-green/90 text-xs rounded-[8px] px-3 py-2">
                        <Pic name="mes-contrainte" size={15} className="mr-1" />
                        Taille lue dans le nom de fichier → pilote le <b>gabarit</b> du moteur{' '}
                        {TYPO_INFO[typo].moteur}.{' '}
                        <b>
                          {detCount}/{images.length} détectée{detCount > 1 ? 's' : ''} automatiquement
                        </b>{' '}
                        — corrige toute valeur si besoin.
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
                  <div className="px-4 py-3 border-b border-border text-[11px] uppercase tracking-wide text-text-secondary font-bold">
                    Réglages partagés (tout le lot)
                  </div>
                  <div className="p-4 space-y-5">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                        Produit
                      </label>
                      <input
                        value={produit}
                        onChange={(e) => setProduit(e.target.value)}
                        placeholder="ex. VOGEL"
                        maxLength={60}
                        className="w-full border border-border bg-white rounded-[8px] px-3 py-2 text-[13.5px]"
                      />
                      <p className="text-[11.5px] text-text-disabled mt-1.5">
                        Détecté depuis le nom de fichier — corrige si besoin. C&apos;est le nom de la
                        session sur l&apos;accueil.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                        Décor
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {shortlist.map((d) => {
                          const on = d.id === decorId
                          return (
                            <button
                              key={d.id}
                              onClick={() => setDecorId(d.id)}
                              title={d.name}
                              className={`rounded-[8px] overflow-hidden border-[1.5px] text-left bg-white ${
                                on ? 'border-brand-green ring-2 ring-brand-green-light' : 'border-border'
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={imgUrl(d.file_path, 480)} alt={d.name} loading="lazy" decoding="async" className="w-full aspect-[3/2] object-cover" />
                              <span className="block px-2 py-1 text-[11px] font-medium truncate">{d.name}</span>
                            </button>
                          )
                        })}
                      </div>
                      {decors.length > 0 ? (
                        <button
                          onClick={openPicker}
                          className="w-full mt-2 rounded-[8px] border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:text-brand-green hover:border-brand-green transition-colors"
                        >
                          Choisir un décor ({decors.length})
                        </button>
                      ) : (
                        <p className="text-[11.5px] text-text-disabled mt-1.5">
                          Aucun décor actif —{' '}
                          <Link href="/bibliotheque" className="text-brand-green font-bold">
                            crées-en un depuis la page Décors ↗
                          </Link>
                        </p>
                      )}
                      {selectedDecor && selectedDecor.type !== typo && (
                        <p className="text-[11.5px] font-semibold text-amber-700 bg-amber-100 rounded-[8px] px-2.5 py-1.5 mt-2">
                          ⚠ Décor pensé pour un {TYPO_INFO[selectedDecor.type].titre.toLowerCase()},
                          pas pour un {TYPO_INFO[typo].titre.toLowerCase()} — le cadrage peut être
                          raté.
                        </p>
                      )}
                      <p className="text-[11.5px] text-text-disabled mt-1.5">
                        Même décor pour toutes les images — c&apos;est ce qui donne l&apos;effet catalogue.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                        Livraison
                      </label>
                      <div className="flex items-center gap-2 text-[13.5px] font-semibold mb-2">
                        <Pic name="image" size={18} /> Format Site (WEB) · 2000×1330{' '}
                        <span className="text-[11px] text-text-disabled font-normal">— toujours généré</span>
                      </div>
                      {mpMode === 'choix' && (
                        <label className="flex items-start gap-2.5 text-[13.5px] font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoMp}
                            onChange={(e) => setAutoMp(e.target.checked)}
                            className="mt-0.5 w-4 h-4 accent-[#6d5bb5]"
                          />
                          <span>
                            <Pic name="marketplace" size={18} className="mr-1" />
                            Format Marketplace (MP) · 2000×2000{' '}
                            <span className="text-[11px] text-text-disabled font-normal">— automatique si coché</span>
                            <span className="block text-[11.5px] text-text-disabled font-normal mt-0.5">
                              Chaque MES Site est déclinée en carré 1:1 dès qu&apos;elle est prête, sans attendre
                              ta review. Sinon, le passage MP reste possible après, sur le résultat (bouton 1:1).
                            </span>
                          </span>
                        </label>
                      )}
                      {mpMode === 'toujours' && (
                        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                          <Pic name="marketplace" size={18} /> Format Marketplace (MP) · 2000×2000{' '}
                          <span className="text-[11px] text-text-disabled font-normal">
                            — toujours généré (réglage moteur)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3.5 flex-wrap mt-5">
                <button
                  onClick={generate}
                  disabled={!canGenerate}
                  className="bg-brand-green text-white rounded-[12px] px-6 py-3 text-[15px] font-bold hover:bg-brand-green-hover hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Pic name="generer" size={16} className="mr-1.5" />
                  Générer{images.length ? ` (${images.length})` : ''}
                </button>
                <span className="text-xs text-text-disabled">
                  {images.length === 0
                    ? 'Dépose d’abord au moins une image.'
                    : decorId == null
                      ? 'Choisis un décor.'
                      : `≈ ${images.length} MES Site à générer · le produit d’origine n’est pas modifié`}
                </span>
              </div>
            </>
          )}

          {/* ---- traitement ---- */}
          {stage === 'proc' &&
            (() => {
              const doneN = jobs.filter((j) => isMesJob(j) && j.status === 'done').length
              const failN = jobs.filter((j) => j.status === 'error').length
              const total = expected || images.length || 1
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
                      Le produit d&apos;origine n&apos;est jamais modifié — le moteur crée de nouvelles images.
                      {failN > 0 && <span className="block text-brand-red mt-1">{failN} en erreur (détail à la fin).</span>}
                    </p>
                  </div>
                </div>
              )
            })()}

          {/* ---- résultat ---- */}
          {stage === 'result' &&
            (() => {
              const integ = jobs.filter(isMesJob)
              const doneSites = integ.filter((j) => j.status === 'done' && j.result?.deliveryPath)
              const mkt = jobs.filter((j) => j.type === 'marketplace')
              const failed = jobs.filter((j) => j.status === 'error')
              const busySite = integ.some((j) => j.status === 'queued' || j.status === 'running')
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
                        const fname = fnameOf(root, 'site', typo)
                        return (
                          <div key={root.id} className="bg-white border border-border rounded-[12px] shadow-sm overflow-hidden">
                            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                              <span className="font-bold text-[13px]">{labelOf(root)}</span>
                              {vnum > 1 && (
                                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-brand-green-light text-brand-green">
                                  V{vnum}
                                </span>
                              )}
                              <span className="ml-auto text-[11.5px] text-text-secondary tabular-nums">2000×1330</span>
                            </div>
                            {dispDone ? (
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
                                    <Pic name="loupe" size={15} />
                                    Ouvrir · retours &amp; versions
                                  </span>
                                </span>
                              </button>
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
                                    disabled={!dispDone || mpDoneFor(root.id)}
                                    title={
                                      mpDoneFor(root.id)
                                        ? 'Déjà passée en Marketplace'
                                        : 'Passer en Marketplace (recadrage 1:1 + bords)'
                                    }
                                    className="w-8 h-8 rounded-[8px] border grid place-items-center text-[11px] font-bold tabular-nums disabled:opacity-40 transition-colors"
                                    style={{ borderColor: '#c9bfe4', color: '#6d5bb5' }}
                                  >
                                    {mpDoneFor(root.id) ? '✓' : '1:1'}
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

      {/* ÉTAPE 3 — LIBRE (brouillon) */}
      {view === 'gen' && mode === 'lib' && (
        <section className="animate-fade-in-up">
          <Chemin onBack={goMode} parents={[{ label: 'Génération', onClick: goMode }]} here="MES Libre">
            <span
              className="pill ml-2"
              style={{ borderColor: 'var(--color-brand-red)', color: 'var(--color-brand-red)', cursor: 'default' }}
            >
              <Pic name="wip" size={14} className="mr-1" />
              Work in progress
            </span>
          </Chemin>
          <div className="bg-brand-red-light border border-brand-red/30 rounded-[12px] px-5 py-4 flex items-center gap-3.5">
            <Pic name="wip" size={26} />
            <div className="text-sm text-text-secondary">
              <b className="text-brand-red">Écran en réflexion — pas encore construit.</b> Le mode Libre viendra
              après les battants (priorité #4 du cadrage) : formulaire (angle de vue, profondeur de champ,
              lumière) + plusieurs variantes → tu choisis. Pas de gabarits ni de tailles.
            </div>
          </div>
          <button onClick={goMode} className="pill mt-5">
            ← Revenir au choix du mode
          </button>
        </section>
      )}

      {/* Studio MES : clic sur une MES → grand + retours + versions */}
      {studioRoot != null && batchId && (
        <MesStudio
          batchId={batchId}
          produit={typo}
          mpEnabled={mpMode !== 'jamais'}
          rootJobId={studioRoot}
          chosenJobId={chosen[studioRoot] ?? null}
          onChoose={chooseVersion}
          onMP={(id) => {
            setMpAskedRoots((prev) => new Set(prev).add(studioRoot))
            void mpJobs([id])
          }}
          onClose={closeStudio}
        />
      )}

      {/* Fenêtre « Choisir un décor » — tous les décors rangés par typologie,
          recherche + filtre gamme. Sélection puis « Utiliser ce décor ». */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-5"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-surface rounded-[16px] shadow-2xl w-[960px] max-w-full max-h-[min(720px,calc(100vh-40px))] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white border-b border-border px-5 pt-4">
              <div className="flex items-center gap-3">
                <h3 className="text-[17px] font-bold m-0">Choisir un décor</h3>
                <span className="text-xs text-text-secondary">
                  {pickList.length} décor{pickList.length > 1 ? 's' : ''} actif
                  {pickList.length > 1 ? 's' : ''}
                </span>
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
                    <Pic name="loupe" size={15} />
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
                      <Pic name={TYPO_INFO[t].ic} size={15} className="mr-1" />
                      {TYPO_INFO[t].titre}{' '}
                      <span className="text-[11px] text-text-disabled">{n}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {pickList.length === 0 ? (
                <div className="text-center text-text-secondary text-[13.5px] py-10">
                  <p className="text-[15px] font-bold text-text-primary mb-1">
                    Aucun décor ne correspond
                  </p>
                  Modifie la recherche ou les filtres — ou crée un nouveau décor.
                </div>
              ) : (
                typoOrder
                  .filter((t) => !pickTab || pickTab === t)
                  .map((t) => {
                    const items = pickList.filter((d) => d.type === t)
                    if (items.length === 0 && pickTab !== t) return null
                    return (
                      <div key={t} className="mb-5 last:mb-0">
                        <div className="flex items-center gap-2 mb-2.5 text-[13.5px] font-bold">
                          <Pic name={TYPO_INFO[t].ic} size={16} />
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
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                          {items.map((d) => {
                            const on = d.id === pickId
                            return (
                              <button
                                key={d.id}
                                onClick={() => setPickId(d.id)}
                                title={d.name}
                                className={`relative rounded-[12px] overflow-hidden border-[1.5px] text-left bg-white shadow-sm transition-all ${
                                  on
                                    ? 'border-brand-green ring-2 ring-brand-green-light'
                                    : 'border-border hover:shadow-lg'
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
                                  className="w-full h-[92px] object-cover"
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
                            href="/bibliotheque"
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
              {picked && picked.type !== typo ? (
                <span className="text-xs font-semibold text-amber-700 bg-amber-100 rounded-[8px] px-2.5 py-1.5">
                  ⚠ Décor pensé pour un {TYPO_INFO[picked.type].titre.toLowerCase()}, pas pour un{' '}
                  {TYPO_INFO[typo].titre.toLowerCase()} — le cadrage peut être raté.
                </span>
              ) : (
                <span className="text-xs text-text-disabled">
                  Le décor choisi s&apos;applique à tout le lot.
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
                    if (pickId != null) setDecorId(pickId)
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
          <img src={lightbox} alt="Aperçu en grand" className="max-w-full max-h-full object-contain rounded-[8px]" />
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
