'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CatalogueSearch,
  familySlug,
  familyTitle,
  invalidateCatalogueCache,
} from '../catalogueUi'
import DetourageStudio from '@/components/DetourageStudio'
import DecorStudio from '@/components/DecorStudio'
import { swatchFor } from '@/lib/catalogue/colorisPalette'

/**
 * Page produit — conforme à la maquette VALIDÉE maquettes/page-produit-v10.html
 * (13/07/2026) : une GRILLE DE VIGNETTES par coloris (esprit grille gabarits),
 * une largeur = UNE ligne, colonnes alignées par hauteur (hauteur absente =
 * case vide), vignettes de taille identique PAR carte coloris. Clic sur une
 * vignette avec MES → galerie plein écran (la 1ʳᵉ MES est celle de face),
 * survol → ↻ remplacer / ＋ générer une MES en plus. Sections Décors et
 * Moodboards séparées ; utilisateur affiché dans les derniers lancements.
 */

interface ColorisSummary {
  coloris: string
  kitRef: string | null
  colorCode: string | null
  jpgCount: number
  pngCount: number
  faceJpg: string | null
  facePng: string | null
  detectedColoris?: string | null
}

interface SizeSummary {
  label: string
  w: number
  h: number
  coloris: ColorisSummary[]
}

interface MesEntry {
  format: string
  file: string
  size: string | null
  coloris: string | null
}

interface Detail {
  id: number
  brand: string
  family: string
  name: string
  serverPath: string
  status: 'detecte' | 'a_completer'
  lastScanAt: string
  summary: {
    sizes: SizeSummary[]
    moodboards: string[]
    mes: MesEntry[]
    warnings: string[]
  }
  colorisOverrides?: Record<string, string>
  /** Références (`coloris|300x140`) apparues au dernier scan (étiquette NOUVEAU). */
  newRefs?: string[]
}

interface ColorisSettings {
  decorId: number | null
  /** 'moteur' (défaut) = suivre le réglage du moteur ; 'off'/'manual' = dérogation. */
  align: 'moteur' | 'off' | 'manual'
  alignPx: number
  formats: { site: boolean; marketplace: boolean }
}

interface DecorEntry {
  id: number
  name: string
  status: string
  gamme: string | null
  file_path: string
}

interface ProductGeneration {
  size: string
  coloris: string
  format: string
  stage: 'pillars' | 'integration'
  status: string
  deliveryPath: string | null
  jobId: number
  batchId: string | null
}

interface LaunchCell {
  coloris: string
  size: string
  format: string
  stage: 'pillars' | 'integration' | 'marketplace'
  status: string
  deliveryPath: string | null
}

interface ProductLaunch {
  batchId: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
  colorisList: string[]
  formats: string[]
  decorId: number | null
  decorName: string | null
  cells: LaunchCell[]
  total: number
  done: number
  running: number
  error: number
}

const FORMATS = [
  { key: '2000x1330', label: 'Site · 2000×1330' },
  { key: '2000x2000', label: 'Marketplace · 2000×2000' },
] as const

const SITE_FORMAT = '2000x1330'
const MARKETPLACE_FORMAT = '2000x2000'

/** Image affichable dans la galerie MES d'une vignette. */
interface CardImage {
  /** URL pleine résolution (zoom / galerie). */
  full: string
  /** URL vignette (grille + bandeau de la galerie). */
  thumb: string
  label: string
}

/** Identifiant de lot partagé par toutes les cases d'un même lancement (bloc 3.4). */
function newBatchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const formatShort = (f: string) => (f === SITE_FORMAT ? 'Site' : 'Marketplace')

/** Temps relatif court, à partir d'un datetime SQLite UTC (« 2026-07-13 10:30:00 »). */
function relTime(iso: string): string {
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime()
  if (!Number.isFinite(then)) return ''
  const min = Math.round((Date.now() - then) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'hier'
  if (d < 7) return `il y a ${d} j`
  return new Date(then).toLocaleDateString('fr-FR')
}

/** B battant · C coulissant · P portillon (nomenclature maison). */
function familyLetter(family: string): string {
  const f = family.toUpperCase()
  if (f.includes('BATTANT')) return 'B'
  if (f.includes('COULISSANT')) return 'C'
  if (f.includes('PORTILLON')) return 'P'
  return 'x'
}

interface RefEntry {
  w: number
  h: number
  sizeLabel: string
  kitRef: string | null
  colorCode: string | null
  faceJpg: string | null
  facePng: string | null
  /** true si la taille n'existe que dans ce coloris (MES sans coloris rattachables). */
  soleColoris: boolean
}

interface ColorisGroup {
  /** Clé backend STABLE (coloris tel que scanné) — jamais modifiée. */
  coloris: string
  /** Coloris AFFICHÉ : correction manuelle ▸ deviné de l'image ▸ nom de dossier. */
  displayColoris: string
  entries: RefEntry[]
}

function buildColorisGroups(detail: Detail, overrides: Record<string, string>): ColorisGroup[] {
  const groups = new Map<string, RefEntry[]>()
  const detected = new Map<string, string>()
  for (const size of detail.summary.sizes) {
    for (const c of size.coloris) {
      if (!groups.has(c.coloris)) groups.set(c.coloris, [])
      if (c.detectedColoris && !detected.has(c.coloris)) detected.set(c.coloris, c.detectedColoris)
      groups.get(c.coloris)!.push({
        w: size.w,
        h: size.h,
        sizeLabel: `${size.w}x${size.h}`,
        kitRef: c.kitRef,
        colorCode: c.colorCode,
        faceJpg: c.faceJpg,
        facePng: c.facePng,
        soleColoris: size.coloris.length === 1,
      })
    }
  }
  return Array.from(groups.entries())
    .map(([coloris, entries]) => ({
      coloris,
      displayColoris:
        overrides[coloris] ??
        (coloris === 'non précisé' ? (detected.get(coloris) ?? coloris) : coloris),
      entries: entries.sort((a, b) => a.w - b.w || a.h - b.h),
    }))
    .sort((a, b) => b.entries.length - a.entries.length || a.coloris.localeCompare(b.coloris))
}

/**
 * MES correspondant à une case (coloris × taille × format). Une MES dont le
 * coloris n'est pas identifiable dans le nom de fichier s'affiche quand même
 * (mieux vaut la montrer avec « coloris ? » que la cacher — retour Mathias
 * 12/07/2026), mais UNIQUEMENT sur le coloris « hôte » (le gris, ou le 1ᵉʳ
 * coloris s'il n'y a pas de gris) : l'afficher sur tous les coloris créait des
 * doublons qui polluaient les cartes — retour Mathias 13/07/2026.
 */
function mesForCell(
  mes: MesEntry[],
  entry: RefEntry,
  coloris: string,
  format: string,
  orphanHost: string | null
): MesEntry[] {
  return mes.filter(
    (m) =>
      m.size === entry.sizeLabel &&
      m.format === format &&
      (m.coloris === coloris || (m.coloris === null && coloris === orphanHost))
  )
}

export default function CatalogueProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showWarnings, setShowWarnings] = useState(false)
  const [settings, setSettings] = useState<Record<string, ColorisSettings>>({})
  const [decors, setDecors] = useState<DecorEntry[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<ColorisSettings | null>(null)
  const [saving, setSaving] = useState(false)
  // Génération d'un décor depuis la fenêtre de réglages (bloc 3.5) : panneau de
  // choix (moodboard de la gamme + tirages) puis studio de décor en plein écran.
  const [genDecor, setGenDecor] = useState<{ moodboard: string | null; tirages: number } | null>(null)
  const [genBusy, setGenBusy] = useState(false)
  const [studioJobs, setStudioJobs] = useState<number[] | null>(null)
  const [generations, setGenerations] = useState<ProductGeneration[]>([])
  const [launches, setLaunches] = useState<ProductLaunch[]>([])
  // Fenêtre « Reprendre / Dupliquer » un lancement (bloc 3.4).
  const [relaunch, setRelaunch] = useState<{
    launch: ProductLaunch
    mode: 'reprendre' | 'dupliquer'
    decorId: number | null
  } | null>(null)
  const [busyCells, setBusyCells] = useState<Set<string>>(new Set())
  const [genMsg, setGenMsg] = useState<string | null>(null)
  const [detStatus, setDetStatus] = useState<Record<string, string>>({})
  const [detCount, setDetCount] = useState(0)
  const [detOpen, setDetOpen] = useState(false)
  // Proposition de régénération après changement du décor par défaut d'un coloris.
  const [regenPrompt, setRegenPrompt] = useState<{
    coloris: string
    cells: { coloris: string; w: number; h: number; format: string }[]
    decorName: string
  } | null>(null)
  // Fenêtre de confirmation d'un LOT (« manquantes » d'un coloris ou global).
  const [batchPrompt, setBatchPrompt] = useState<{
    title: string
    groups: {
      coloris: string
      decorName: string | null
      ready: boolean
      cells: { coloris: string; w: number; h: number; format: string }[]
    }[]
    launchable: number
  } | null>(null)
  // Corrections manuelles du coloris ({ colorisOrigine → colorisCorrigé }) et
  // menu déroulant ouvert (clé backend du coloris, ou null).
  const [colorisOverrides, setColorisOverrides] = useState<Record<string, string>>({})
  const [colorisMenu, setColorisMenu] = useState<string | null>(null)
  // Palette complète (origine + coloris ajoutés dans l'admin) pour le menu de correction.
  const [palette, setPalette] = useState<
    { key: string; label: string; ral: string | null; swatch: string }[]
  >([])
  useEffect(() => {
    fetch('/api/coloris')
      .then((r) => r.json())
      .then((d) => setPalette(d.coloris ?? []))
      .catch(() => {})
  }, [])
  // Pastille d'un libellé : palette (origine + ajoutés) d'abord, mots-clés sinon.
  const colorisSwatch = useCallback(
    (label: string) => {
      const q = label.trim().toLowerCase()
      return (
        palette.find((c) => c.key === q || c.label.toLowerCase() === q)?.swatch ?? swatchFor(label)
      )
    },
    [palette]
  )
  // Case en attente d'un décor : rejouée automatiquement après enregistrement des réglages.
  const pendingCell = useRef<{ coloris: string; w: number; h: number; format: string } | null>(null)
  // Galerie MES plein écran (maquette v10) : ouverte au clic sur une vignette avec MES.
  const [gallery, setGallery] = useState<{
    title: string
    sub: string
    coloris: string
    w: number
    h: number
    images: CardImage[]
    index: number
  } | null>(null)
  // Note affichée dans la section Moodboards (ajout/suppression pas encore branchés — serveur en lecture seule).
  const [mbNote, setMbNote] = useState<string | null>(null)

  // Navigation clavier de la galerie : ← → pour parcourir, Échap pour fermer.
  useEffect(() => {
    if (!gallery) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGallery(null)
      if (e.key === 'ArrowLeft')
        setGallery((g) => g && { ...g, index: (g.index + g.images.length - 1) % g.images.length })
      if (e.key === 'ArrowRight')
        setGallery((g) => g && { ...g, index: (g.index + 1) % g.images.length })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [gallery])

  useEffect(() => {
    fetch(`/api/catalogue/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `Erreur ${r.status}`)
        return r.json()
      })
      .then((d: Detail) => {
        setDetail(d)
        setColorisOverrides(d.colorisOverrides ?? {})
      })
      .catch((e) => setError(e.message))
    fetch(`/api/catalogue/${id}/reglages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSettings(d.settings))
  }, [id])

  const loadDecors = useCallback(() => {
    fetch('/api/decors')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setDecors((d.decors as DecorEntry[]).filter((x) => x.status === 'actif'))
        setIsAdmin(d.role === 'admin')
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    loadDecors()
  }, [loadDecors])

  const refreshGenerations = useCallback(() => {
    fetch(`/api/catalogue/${id}/generations`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setGenerations(d.generations as ProductGeneration[]))
      .catch(() => undefined)
  }, [id])

  const refreshLaunches = useCallback(() => {
    fetch(`/api/catalogue/${id}/lancements`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLaunches(d.launches as ProductLaunch[]))
      .catch(() => undefined)
  }, [id])

  const loadDetourage = useCallback(() => {
    fetch(`/api/catalogue/${id}/detourage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const m: Record<string, string> = {}
        let n = 0
        for (const q of d.queue as { coloris: string; size: string; status: string }[]) {
          m[`${q.coloris}|${q.size}`] = q.status
          if (q.status === 'none' || q.status === 'a_valider') n += 1
        }
        setDetStatus(m)
        setDetCount(n)
      })
      .catch(() => undefined)
  }, [id])

  useEffect(() => {
    loadDetourage()
  }, [loadDetourage])

  // Ferme le menu déroulant de coloris au clic ailleurs.
  useEffect(() => {
    if (!colorisMenu) return
    const close = () => setColorisMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [colorisMenu])

  const localGenerable = (coloris: string, size: string) => {
    const s = detStatus[`${coloris}|${size}`]
    return s === 'valide' || s === 'importe'
  }

  useEffect(() => {
    refreshGenerations()
    refreshLaunches()
  }, [refreshGenerations, refreshLaunches])

  // Suivi en direct tant qu'une case est en cours (piliers/intégration).
  const hasActive =
    busyCells.size > 0 ||
    generations.some((x) => x.status === 'queued' || x.status === 'running')
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(() => {
      refreshGenerations()
      refreshLaunches()
    }, 3000)
    return () => clearInterval(t)
  }, [hasActive, refreshGenerations, refreshLaunches])

  const cellKey = (coloris: string, size: string, format: string) => `${coloris}|${size}|${format}`
  const genFor = (coloris: string, size: string, format: string) =>
    generations.find((x) => x.coloris === coloris && x.size === size && x.format === format)

  async function generate(
    coloris: string,
    w: number,
    h: number,
    format: string,
    opts?: { batchId?: string; decorId?: number }
  ) {
    const key = cellKey(coloris, `${w}x${h}`, format)
    setBusyCells((s) => new Set(s).add(key))
    setGenMsg(null)
    try {
      const r = await fetch(`/api/catalogue/${id}/generer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coloris,
          size: { w, h },
          format,
          batchId: opts?.batchId,
          decorId: opts?.decorId,
        }),
      })
      const d = await r.json().catch(() => null)
      if (r.status === 409 && d?.code === 'reglages_manquants') {
        pendingCell.current = { coloris, w, h, format }
        openSettings(coloris)
        setGenMsg(`Choisis un décor par défaut pour ${coloris.toLowerCase()} : la génération partira ensuite.`)
        return
      }
      if (!r.ok) {
        setGenMsg(d?.error ?? 'Échec du lancement de la génération.')
        return
      }
      // Entrée optimiste « en cours » : la case bascule tout de suite, le suivi la remplace.
      setGenerations((prev) => [
        ...prev.filter((x) => !(x.coloris === coloris && x.size === `${w}x${h}` && x.format === format)),
        {
          coloris,
          size: `${w}x${h}`,
          format,
          stage: 'pillars',
          status: 'running',
          deliveryPath: null,
          jobId: d.jobIds?.[0] ?? 0,
          batchId: d.batchId ?? null,
        },
      ])
      refreshLaunches()
    } catch {
      setGenMsg('Erreur réseau — génération non lancée.')
    } finally {
      setBusyCells((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }
  }

  async function refreshProduct() {
    setRefreshing(true)
    try {
      const r = await fetch(`/api/catalogue/${id}`, { method: 'POST' })
      if (r.ok) {
        setDetail(await r.json())
        invalidateCatalogueCache()
      }
    } finally {
      setRefreshing(false)
    }
  }

  const groups = useMemo(
    () => (detail ? buildColorisGroups(detail, colorisOverrides) : []),
    [detail, colorisOverrides]
  )

  // Références apparues au dernier scan → étiquette NOUVEAU (bloc 3.4).
  const newRefSet = useMemo(() => new Set(detail?.newRefs ?? []), [detail])

  // Coloris « hôte » des MES sans coloris identifiable : le gris s'il existe,
  // sinon le coloris le plus fourni (groups est trié par taille décroissante).
  const orphanHost = useMemo(() => {
    if (groups.length === 0) return null
    const gris = groups.find((g) => g.displayColoris.toLowerCase().includes('gris'))
    return (gris ?? groups[0]).coloris
  }, [groups])

  async function correctColoris(colorisKey: string, coloris: string) {
    setColorisMenu(null)
    // Bascule optimiste : le titre change tout de suite, l'API confirme ensuite.
    setColorisOverrides((prev) => ({ ...prev, [colorisKey]: coloris }))
    try {
      const r = await fetch(`/api/catalogue/${id}/coloris`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorisKey, coloris }),
      })
      if (r.ok) {
        const d = await r.json()
        setColorisOverrides((prev) => ({ ...prev, [colorisKey]: d.coloris }))
      }
    } catch {
      // Réseau : on garde la valeur optimiste, le prochain chargement fera foi.
    }
  }

  const stats = useMemo(() => {
    if (!detail) return null
    const mes = detail.summary.mes
    const matched = new Set<string>()
    let done = 0
    let missing = 0
    let toDetour = 0
    for (const g of groups) {
      for (const e of g.entries) {
        if (e.faceJpg && !e.facePng) toDetour += 1
        for (const f of FORMATS) {
          const cell = mesForCell(mes, e, g.coloris, f.key, orphanHost)
          if (cell.length > 0) {
            done += 1
            cell.forEach((m) => matched.add(m.file))
          } else if (e.facePng) {
            missing += 1 // générable : le PNG détouré existe
          }
        }
      }
    }
    const expected = groups.reduce((n, g) => n + g.entries.length, 0) * FORMATS.length
    const unmatched = mes.filter((m) => !matched.has(m.file))
    return { done, expected, missing, toDetour, unmatched }
  }, [detail, groups, orphanHost])

  function settingsFor(coloris: string): ColorisSettings {
    return (
      settings[coloris] ?? {
        decorId: null,
        align: 'moteur',
        alignPx: 0,
        formats: { site: true, marketplace: true },
      }
    )
  }

  function decorName(decorId: number | null): string {
    if (decorId === null) return 'non défini'
    return decors.find((d) => d.id === decorId)?.name ?? `décor n°${decorId}`
  }

  function alignLabel(s: ColorisSettings): string {
    if (s.align === 'off') return 'alignement désactivé'
    if (s.align === 'manual') return `alignement ${s.alignPx > 0 ? '+' : ''}${s.alignPx} px`
    return 'alignement : moteur'
  }

  function openSettings(coloris: string) {
    setEditing(coloris)
    setDraft({ ...settingsFor(coloris), formats: { ...settingsFor(coloris).formats } })
  }

  async function saveSettings() {
    if (!editing || !draft) return
    const coloris = editing
    const prevDecorId = settings[coloris]?.decorId ?? null
    setSaving(true)
    try {
      const r = await fetch(`/api/catalogue/${id}/reglages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coloris, settings: draft }),
      })
      if (r.ok) {
        const d = await r.json()
        const newDecorId = d.settings?.decorId ?? null
        setSettings((prev) => ({ ...prev, [coloris]: d.settings }))
        setEditing(null)
        // Reprise de la case en attente d'un décor (flux « aucun décor par défaut »).
        const p = pendingCell.current
        pendingCell.current = null
        if (p && newDecorId) {
          setGenMsg(null)
          void generate(p.coloris, p.w, p.h, p.format)
        } else if (newDecorId && prevDecorId && prevDecorId !== newDecorId) {
          // Décor changé : les MES déjà générées de ce coloris datent de l'ancien
          // décor → proposer de les régénérer avec le nouveau.
          const cells = generations
            .filter((g) => g.coloris === coloris && g.status === 'done' && g.deliveryPath)
            .map((g) => {
              const [w, h] = g.size.split('x').map(Number)
              return { coloris, w, h, format: g.format }
            })
          if (cells.length > 0) {
            setRegenPrompt({ coloris, cells, decorName: decorName(newDecorId) })
          }
        }
      }
    } finally {
      setSaving(false)
    }
  }

  // — Génération d'un décor depuis la fenêtre de réglages (bloc 3.5) —
  function openGenDecor() {
    const mbs = detail?.summary.moodboards ?? []
    setGenDecor({ moodboard: mbs[0] ?? null, tirages: 3 })
  }

  async function launchGenDecor() {
    if (!genDecor?.moodboard) return
    setGenBusy(true)
    try {
      const r = await fetch(`/api/catalogue/${id}/decor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moodboard: genDecor.moodboard, count: genDecor.tirages }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setGenMsg(d?.error ?? 'Échec du lancement du décor.')
        return
      }
      setGenDecor(null)
      setStudioJobs((d.jobIds as number[]) ?? [])
    } catch {
      setGenMsg('Erreur réseau — décor non lancé.')
    } finally {
      setGenBusy(false)
    }
  }

  // Décor gardé/validé dans le studio → le choisir comme décor par défaut du coloris.
  async function pickGeneratedDecor(decorId: number) {
    setStudioJobs(null)
    try {
      const d = await fetch('/api/decors').then((r) => (r.ok ? r.json() : null))
      if (!d) return
      const active = (d.decors as DecorEntry[]).filter((x) => x.status === 'actif')
      setDecors(active)
      setIsAdmin(d.role === 'admin')
      const found = active.find((x) => x.id === decorId)
      if (found) setDraft((prev) => (prev ? { ...prev, decorId: found.id } : prev))
    } catch {
      // rechargement échoué : le décor reste choisissable manuellement dans la grille
    }
  }

  function regenerateAll() {
    if (!regenPrompt) return
    const cells = regenPrompt.cells
    setRegenPrompt(null)
    setGenMsg(null)
    const batchId = newBatchId()
    cells.forEach((c) => void generate(c.coloris, c.w, c.h, c.format, { batchId }))
  }

  // Cases Site (2000×1330) manquantes ET générables d'un coloris (bloc 3.2).
  // Marketplace exclu (bloc 3.3) ; on ignore les cases déjà faites / en cours.
  function missingSiteCells(coloris: string): { coloris: string; w: number; h: number; format: string }[] {
    if (!detail) return []
    const g = groups.find((gr) => gr.coloris === coloris)
    if (!g) return []
    const out: { coloris: string; w: number; h: number; format: string }[] = []
    for (const e of g.entries) {
      if (mesForCell(detail.summary.mes, e, coloris, SITE_FORMAT, orphanHost).length > 0) continue
      const gen = genFor(coloris, e.sizeLabel, SITE_FORMAT)
      if (gen?.deliveryPath) continue
      if (gen && (gen.status === 'queued' || gen.status === 'running')) continue
      if (busyCells.has(cellKey(coloris, e.sizeLabel, SITE_FORMAT))) continue
      if (!e.facePng && !localGenerable(coloris, e.sizeLabel)) continue
      out.push({ coloris, w: e.w, h: e.h, format: SITE_FORMAT })
    }
    return out
  }

  // Un coloris est « prêt » si son décor par défaut est défini ET encore actif.
  function colorisReady(coloris: string): { ready: boolean; decorName: string | null } {
    const decorId = settingsFor(coloris).decorId
    const decor = decorId ? decors.find((d) => d.id === decorId) : null
    return { ready: !!decor, decorName: decor?.name ?? null }
  }

  function openBatch(coloris: string | null) {
    const targets = coloris ? [coloris] : groups.map((g) => g.coloris)
    const gs = targets
      .map((c) => {
        const { ready, decorName } = colorisReady(c)
        return { coloris: c, decorName, ready, cells: missingSiteCells(c) }
      })
      .filter((gd) => gd.cells.length > 0)
    if (gs.length === 0) return
    const launchable = gs.filter((gd) => gd.ready).reduce((n, gd) => n + gd.cells.length, 0)
    setBatchPrompt({
      title: coloris ? `Générer les manquantes — ${coloris}` : 'Générer toutes les manquantes',
      groups: gs,
      launchable,
    })
  }

  function launchBatch() {
    if (!batchPrompt) return
    const cells = batchPrompt.groups.filter((g) => g.ready).flatMap((g) => g.cells)
    setBatchPrompt(null)
    setGenMsg(null)
    const batchId = newBatchId()
    cells.forEach((c) => void generate(c.coloris, c.w, c.h, c.format, { batchId }))
  }

  // Décor encore actif dans la bibliothèque (sinon on retombe sur le défaut du coloris).
  const decorActive = (decorId: number | null) =>
    decorId != null && decors.some((d) => d.id === decorId)

  // Relance d'un lancement passé (bloc 3.4). Reprendre = mêmes cases avec les
  // réglages par défaut ACTUELS de chaque coloris (pas d'override — correct même
  // pour un lot multi-coloris). Dupliquer = mêmes cases mais UN décor choisi,
  // appliqué aux cases Site, sans toucher au décor par défaut enregistré.
  function confirmRelaunch() {
    if (!relaunch) return
    const { launch, mode, decorId } = relaunch
    setRelaunch(null)
    setGenMsg(null)
    const batchId = newBatchId()
    const override = mode === 'dupliquer' ? (decorId ?? undefined) : undefined
    for (const c of launch.cells) {
      const [w, h] = c.size.split('x').map(Number)
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue
      // L'override décor ne concerne que le Site ; le Marketplace se refait depuis le Site.
      const decorForCell = c.format === SITE_FORMAT ? override : undefined
      void generate(c.coloris, w, h, c.format, { batchId, decorId: decorForCell })
    }
  }

  if (error) return <p className="text-sm text-brand-red">{error}</p>
  if (!detail || !stats) return <p className="text-sm text-text-secondary">Chargement…</p>

  const letter = familyLetter(detail.family)
  const refLabel = (e: RefEntry) => `${detail.name} ${e.w}${letter}${e.h}`
  const fileUrl = (rel: string) => `/api/catalogue/${detail.id}/fichier?p=${encodeURIComponent(rel)}`
  const thumbUrl = (rel: string, w: number) => `${fileUrl(rel)}&w=${w}`
  const artifactUrl = (rel: string, w?: number) =>
    `/api/artifacts?p=${encodeURIComponent(rel)}${w ? `&w=${w}` : ''}`

  // Images d'une vignette (coloris × taille) pour la grille et la galerie.
  // La MES de FACE (Site) est TOUJOURS en premier (règle maquette v8) : MES du
  // serveur (Site puis Marketplace), puis celles générées ici, pas encore rangées.
  const cardImages = (e: RefEntry, coloris: string): CardImage[] => {
    const out: CardImage[] = []
    mesForCell(detail.summary.mes, e, coloris, SITE_FORMAT, orphanHost).forEach((m, i) =>
      out.push({
        full: fileUrl(m.file),
        thumb: thumbUrl(m.file, 480),
        label: i === 0 ? 'Face · Site 2000×1330' : 'Site 2000×1330',
      })
    )
    const siteGen = genFor(coloris, e.sizeLabel, SITE_FORMAT)
    if (siteGen?.deliveryPath)
      out.push({
        full: artifactUrl(siteGen.deliveryPath),
        thumb: artifactUrl(siteGen.deliveryPath, 480),
        label: 'Site 2000×1330 · générée ici',
      })
    for (const m of mesForCell(detail.summary.mes, e, coloris, MARKETPLACE_FORMAT, orphanHost))
      out.push({ full: fileUrl(m.file), thumb: thumbUrl(m.file, 480), label: 'Marketplace 2000×2000' })
    const mpGen = genFor(coloris, e.sizeLabel, MARKETPLACE_FORMAT)
    if (mpGen?.deliveryPath)
      out.push({
        full: artifactUrl(mpGen.deliveryPath),
        thumb: artifactUrl(mpGen.deliveryPath, 480),
        label: 'Marketplace 2000×2000 · générée ici',
      })
    return out
  }
  const gammeDecors = decors.filter(
    (d) => (d.gamme ?? '').trim().toUpperCase() === detail.name.trim().toUpperCase()
  )
  const modalDecors = [...gammeDecors, ...decors.filter((d) => !gammeDecors.includes(d))]
  const globalMissing = groups.reduce((n, g) => n + missingSiteCells(g.coloris).length, 0)
  // Moodboards de la gamme, source de génération d'un décor. Les PDF sont convertis
  // en image côté serveur (aperçu + génération) — bloc 3.5.
  const gammeMoodboards = detail.summary.moodboards

  return (
    <div>
      {/* barre de navigation produit */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Link
          href={`/catalogue/famille/${familySlug(detail.family)}`}
          className="text-sm font-semibold text-text-secondary bg-white border border-border rounded-full px-4 py-2 hover:text-brand-green hover:border-brand-green transition-colors"
        >
          ← {familyTitle(detail.family)}
        </Link>
        <button
          onClick={refreshProduct}
          disabled={refreshing}
          title="Relit uniquement le dossier de cette gamme sur le serveur"
          className="text-sm font-semibold text-text-secondary bg-white border border-border rounded-full px-4 py-2 hover:text-brand-green hover:border-brand-green transition-colors disabled:opacity-50"
        >
          {refreshing ? 'Relecture du dossier…' : '↻ Actualiser ce produit'}
        </button>
        <CatalogueSearch className="flex-1 min-w-64 max-w-md ml-auto" />
      </div>

      {/* en-tête produit */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{detail.name}</h1>
        <span className="text-sm text-text-secondary">
          {familyTitle(detail.family)} · {detail.brand}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {detCount > 0 && (
            <button
              onClick={() => setDetOpen(true)}
              className="bg-white text-amber-700 border border-amber-300 rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-amber-50"
            >
              ✂ Détourer les visuels ({detCount})
            </button>
          )}
          <button
            onClick={() => openBatch(null)}
            disabled={globalMissing === 0}
            title={
              globalMissing === 0
                ? 'Aucune mise en situation Site à générer'
                : 'Générer toutes les MES Site manquantes (chaque coloris avec son décor)'
            }
            className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Générer toutes les manquantes ({globalMissing})
          </button>
        </span>
      </div>
      <div className="flex flex-wrap gap-5 items-baseline mt-2 mb-4 text-[13px] text-text-secondary">
        <span>
          <b className="text-text-primary text-sm">{stats.done}</b>/{stats.expected} MES
        </span>
        <span>
          <b className="text-text-primary text-sm">
            {groups.reduce((n, g) => n + g.entries.length, 0)}
          </b>{' '}
          références
        </span>
        {stats.toDetour > 0 && (
          <span className="text-amber-700 font-bold">✂ {stats.toDetour} visuels à détourer</span>
        )}
        <span>
          <b className="text-text-primary text-sm">{detail.summary.moodboards.length}</b> moodboards
        </span>
      </div>

      {genMsg && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-[10px] px-4 py-2.5 text-sm mb-4">
          <span className="flex-1">{genMsg}</span>
          <button
            onClick={() => setGenMsg(null)}
            className="text-amber-700 font-bold text-lg leading-none"
            title="Fermer"
          >
            ✕
          </button>
        </div>
      )}

      {/* un tableau PAR COLORIS */}
      {groups.map((g) => {
        const s = settingsFor(g.coloris)
        const colorisMissing = missingSiteCells(g.coloris).length
        const widths = Array.from(new Set(g.entries.map((e) => e.w))).sort((a, b) => a - b)
        // Colonnes de la grille = hauteurs détectées DANS CE COLORIS (règle v10) :
        // toutes les vignettes du coloris ont la même taille, une hauteur absente
        // pour une largeur laisse une case vide alignée sous sa colonne.
        const heights = Array.from(new Set(g.entries.map((e) => e.h))).sort((a, b) => a - b)
        return (
          <section key={g.coloris} className="bg-white rounded-[12px] border border-border shadow-sm mb-5 overflow-visible">
            <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-border">
              <span className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setColorisMenu(colorisMenu === g.coloris ? null : g.coloris)
                  }}
                  title="Changer le coloris"
                  className="inline-flex items-center gap-2.5 -mx-1.5 px-1.5 py-1 rounded-lg hover:bg-surface transition-colors group"
                >
                  <span
                    className="w-[15px] h-[15px] rounded border border-border"
                    style={{ background: colorisSwatch(g.displayColoris) }}
                  />
                  <h2 className="text-[15px] font-bold uppercase group-hover:text-brand-green">
                    {g.displayColoris}
                  </h2>
                  <span className="text-[9px] text-text-disabled group-hover:text-brand-green">▾</span>
                </button>
                {colorisMenu === g.coloris && (
                  <div
                    className="absolute top-full left-0 mt-1.5 z-40 w-[200px] bg-white border border-border rounded-[10px] shadow-lg p-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {palette.map((opt) => {
                      const on = g.displayColoris.toUpperCase() === opt.label.toUpperCase()
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => correctColoris(g.coloris, opt.key)}
                          className={`flex items-center gap-2.5 w-full text-left px-2 py-1.5 rounded-md hover:bg-surface ${on ? 'font-bold' : ''}`}
                        >
                          <span
                            className="w-4 h-4 rounded border border-black/20"
                            style={{ background: opt.swatch }}
                          />
                          <span className="flex-1 flex flex-col leading-tight">
                            <span className="text-[13px]">{opt.label}</span>
                            {opt.ral && (
                              <span className="text-[10.5px] text-text-secondary">{opt.ral}</span>
                            )}
                          </span>
                          {on && <span className="text-brand-green font-bold text-xs">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </span>
              <span className="text-xs text-text-secondary">
                {g.entries.length} référence{g.entries.length > 1 ? 's' : ''}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-3">
                <span className="text-xs text-text-secondary">
                  Réglages : décor « {decorName(s.decorId)} » · {alignLabel(s)} ·{' '}
                  <button
                    onClick={() => openSettings(g.coloris)}
                    className="text-brand-green font-bold hover:underline"
                  >
                    ✎ modifier
                  </button>
                </span>
                <button
                  onClick={() => openBatch(g.coloris)}
                  disabled={colorisMissing === 0}
                  title={
                    colorisMissing === 0
                      ? 'Aucune mise en situation Site à générer pour ce coloris'
                      : 'Générer les MES Site manquantes de ce coloris'
                  }
                  className="bg-brand-green text-white rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-brand-green-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Générer les manquantes ({colorisMissing})
                </button>
              </span>
            </div>

            <div className="px-5 py-4">
              {widths.map((w) => (
                <div key={w} className="mb-4 last:mb-0">
                  <h4 className="text-xs font-bold text-text-secondary mb-1.5">Largeur {w} cm</h4>
                  {/* Règle v10 : une largeur = UNE ligne, colonnes = hauteurs du coloris,
                      hauteur absente = case vide alignée sous sa colonne.
                      Largeur de colonne plafonnée : peu de tailles ≠ vignettes géantes. */}
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 500px))` }}
                  >
                    {heights.map((h) => {
                      const e = g.entries.find((x) => x.w === w && x.h === h)
                      if (!e)
                        return (
                          <div
                            key={h}
                            title={`${w}×${h} n'existe pas sur le serveur pour ce coloris`}
                          />
                        )
                      const images = cardImages(e, g.coloris)
                      const siteCell = mesForCell(
                        detail.summary.mes,
                        e,
                        g.coloris,
                        SITE_FORMAT,
                        orphanHost
                      )
                      const mpCell = mesForCell(
                        detail.summary.mes,
                        e,
                        g.coloris,
                        MARKETPLACE_FORMAT,
                        orphanHost
                      )
                      const siteGen = genFor(g.coloris, e.sizeLabel, SITE_FORMAT)
                      const mpGen = genFor(g.coloris, e.sizeLabel, MARKETPLACE_FORMAT)
                      const siteRunning =
                        busyCells.has(cellKey(g.coloris, e.sizeLabel, SITE_FORMAT)) ||
                        siteGen?.status === 'queued' ||
                        siteGen?.status === 'running'
                      const mpRunning =
                        busyCells.has(cellKey(g.coloris, e.sizeLabel, MARKETPLACE_FORMAT)) ||
                        mpGen?.status === 'queued' ||
                        mpGen?.status === 'running'
                      const siteFailed = siteGen?.status === 'error' && !siteGen?.deliveryPath
                      const mpFailed = mpGen?.status === 'error' && !mpGen?.deliveryPath
                      const hasSite = siteCell.length > 0 || !!siteGen?.deliveryPath
                      const needsDetour =
                        !!e.faceJpg && !e.facePng && !localGenerable(g.coloris, e.sizeLabel)
                      const noFace = !e.faceJpg
                      const canGen = !!e.facePng || localGenerable(g.coloris, e.sizeLabel)
                      const isNew = newRefSet.has(`${g.coloris}|${e.sizeLabel}`)
                      const colorisIncertain =
                        !e.soleColoris &&
                        siteCell.length > 0 &&
                        siteCell.every((m) => m.coloris === null)
                      const openCard = () =>
                        setGallery({
                          title: refLabel(e),
                          sub: `${g.displayColoris.toUpperCase()} · ${e.w}×${e.h} cm${e.kitRef ? ` · ${e.kitRef}` : ''}`,
                          coloris: g.coloris,
                          w: e.w,
                          h: e.h,
                          images,
                          index: 0,
                        })
                      return (
                        <div
                          key={h}
                          className={`group bg-white rounded-[12px] shadow-sm p-1.5 border-2 min-w-0 transition-all duration-150 ${
                            isNew ? 'border-brand-green' : 'border-transparent'
                          } ${images.length > 0 ? 'cursor-zoom-in hover:shadow-lg hover:-translate-y-px' : ''}`}
                          onClick={images.length > 0 ? openCard : undefined}
                          title={images.length > 0 ? 'Voir les MES en grand' : undefined}
                        >
                          {images.length > 0 ? (
                            <div className="relative">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={images[0].thumb}
                                alt={refLabel(e)}
                                className="w-full aspect-[3/2] object-cover rounded-[8px] border border-border bg-surface"
                                loading="lazy"
                              />
                              <span className="absolute top-1.5 left-1.5 bg-[rgba(31,41,55,0.72)] text-white text-[10.5px] font-bold rounded-full px-2 py-px">
                                {images.length} MES
                              </span>
                              <span className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(ev) => {
                                    ev.stopPropagation()
                                    void generate(g.coloris, e.w, e.h, SITE_FORMAT)
                                  }}
                                  title="Remplacer les MES — regénérer avec les réglages du coloris"
                                  className="w-[26px] h-[26px] rounded-[7px] bg-white/95 shadow-sm text-[13px] leading-none hover:bg-brand-green hover:text-white transition-colors"
                                >
                                  ↻
                                </button>
                                <button
                                  onClick={(ev) => {
                                    ev.stopPropagation()
                                    void generate(g.coloris, e.w, e.h, SITE_FORMAT)
                                  }}
                                  title="Générer une MES en plus (nouvelle variante, réglages du coloris)"
                                  className="w-[26px] h-[26px] rounded-[7px] bg-white/95 shadow-sm text-[13px] leading-none hover:bg-brand-green hover:text-white transition-colors"
                                >
                                  ＋
                                </button>
                              </span>
                              {siteRunning && (
                                <span className="absolute bottom-1.5 left-1.5 bg-brand-teal/90 text-white text-[10px] font-bold rounded-full px-2 py-px">
                                  ⏳ {siteGen?.stage === 'integration' ? 'pose en cours…' : 'génération…'}
                                </span>
                              )}
                            </div>
                          ) : siteRunning ? (
                            <span className="w-full aspect-[3/2] grid place-items-center rounded-[8px] border border-dashed border-brand-teal/50 bg-brand-teal-light text-xs font-bold text-brand-teal text-center px-2">
                              ⏳ {siteGen?.stage === 'integration' ? 'pose en cours…' : 'préparation…'}
                            </span>
                          ) : needsDetour ? (
                            <button
                              onClick={() => setDetOpen(true)}
                              title="Visuel en JPG sans PNG détouré — ouvrir le détourage"
                              className="w-full aspect-[3/2] grid place-items-center rounded-[8px] border border-[#f3dfb6] bg-amber-50 text-xs font-semibold text-amber-700 text-center px-2 hover:bg-amber-100 transition-colors"
                            >
                              ✂ à détourer d&apos;abord
                            </button>
                          ) : canGen ? (
                            <button
                              onClick={() => void generate(g.coloris, e.w, e.h, SITE_FORMAT)}
                              title={
                                siteFailed
                                  ? 'La génération précédente a échoué — relancer'
                                  : 'Générer cette mise en situation (piliers puis intégration)'
                              }
                              className="w-full aspect-[3/2] grid place-items-center rounded-[8px] border-[1.5px] border-dashed border-[#b7d49a] text-[13px] font-bold text-brand-green text-center px-2 hover:bg-brand-green-light transition-colors"
                            >
                              {siteFailed ? '↻ Réessayer' : isNew ? '⚡ Générer' : '＋ Générer'}
                            </button>
                          ) : (
                            <span
                              className="w-full aspect-[3/2] grid place-items-center rounded-[8px] border border-border bg-surface text-xs text-text-disabled text-center px-2"
                              title={
                                noFace
                                  ? 'Aucun visuel produit de face trouvé sur le serveur pour ce coloris'
                                  : "Générable dès qu'un visuel produit détouré existera"
                              }
                            >
                              {noFace ? 'visuel produit absent' : 'MES non détectée'}
                            </span>
                          )}
                          <div className="px-1 pt-1.5 pb-0.5 leading-tight min-w-0">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <b className="text-[13px] tabular-nums truncate">{refLabel(e)}</b>
                              {isNew && (
                                <span
                                  className="text-[9px] font-bold text-brand-green border border-brand-green rounded px-1 py-px tracking-wide shrink-0"
                                  title="Référence détectée au dernier scan de ce produit"
                                >
                                  NOUVEAU
                                </span>
                              )}
                            </span>
                            <small className="block text-[11.5px] text-text-secondary truncate">
                              {e.w}×{e.h} cm
                              {e.kitRef ? ` · ${e.kitRef}` : e.colorCode ? ` · ${e.colorCode}` : ''}
                            </small>
                            {images.length > 0 && (
                              <span className="flex flex-wrap items-center gap-1 mt-1 text-[10px] font-bold">
                                {siteCell.length > 0 ? (
                                  <i className="not-italic text-brand-green bg-brand-green-light rounded px-1.5 py-px">
                                    Site ✓{siteCell.length > 1 ? ` ×${siteCell.length}` : ''}
                                  </i>
                                ) : siteGen?.deliveryPath ? (
                                  <i
                                    className="not-italic text-brand-teal bg-brand-teal-light rounded px-1.5 py-px"
                                    title="Générée dans PortaGEN — stockée en local, pas encore rangée sur le serveur"
                                  >
                                    Site · ici
                                  </i>
                                ) : null}
                                {mpCell.length > 0 ? (
                                  <i className="not-italic text-brand-green bg-brand-green-light rounded px-1.5 py-px">
                                    Marketplace ✓
                                  </i>
                                ) : mpGen?.deliveryPath ? (
                                  <i
                                    className="not-italic text-brand-teal bg-brand-teal-light rounded px-1.5 py-px"
                                    title="Générée dans PortaGEN — stockée en local, pas encore rangée sur le serveur"
                                  >
                                    Marketplace · ici
                                  </i>
                                ) : mpRunning ? (
                                  <i className="not-italic text-brand-teal bg-brand-teal-light rounded px-1.5 py-px">
                                    ⏳ Marketplace
                                  </i>
                                ) : hasSite ? (
                                  <button
                                    onClick={(ev) => {
                                      ev.stopPropagation()
                                      void generate(g.coloris, e.w, e.h, MARKETPLACE_FORMAT)
                                    }}
                                    title={
                                      mpFailed
                                        ? 'Échec — relancer le Marketplace'
                                        : 'Fabriquer le carré Marketplace à partir du Site (recadrage + génération des bords)'
                                    }
                                    className="text-brand-green border border-dashed border-[#b7d49a] rounded px-1.5 py-px hover:bg-brand-green-light transition-colors"
                                  >
                                    {mpFailed ? '↻ Marketplace' : '＋ Marketplace'}
                                  </button>
                                ) : (
                                  <i
                                    className="not-italic text-text-disabled font-normal"
                                    title="Le Marketplace est fabriqué à partir du Site — génère d'abord le Site"
                                  >
                                    ⋯ Marketplace
                                  </i>
                                )}
                                {colorisIncertain && (
                                  <i
                                    className="not-italic text-text-disabled font-normal"
                                    title="Le coloris n'est pas identifiable dans le nom du fichier — la MES s'affiche sur chaque coloris de la taille"
                                  >
                                    coloris ?
                                  </i>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
      {groups.length === 0 && (
        <div className="bg-white rounded-[12px] border border-border shadow-sm p-6 mb-5 text-sm text-text-secondary">
          Aucune référence reconnue pour cette gamme.
        </div>
      )}

      {/* MES trouvées non rattachées à une case */}
      {stats.unmatched.length > 0 && (
        <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 px-5 mb-4">
          <h5 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-3">
            MES du serveur non rattachées{' '}
            <span className="normal-case tracking-normal font-normal text-xs">
              · {stats.unmatched.length} images (taille ou coloris non identifiés dans le nom)
            </span>
          </h5>
          <div className="flex flex-wrap gap-2.5">
            {stats.unmatched.map((m) => (
              <a key={m.file} href={fileUrl(m.file)} target="_blank" rel="noreferrer" title={m.file}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl(m.file, 240)}
                  alt={m.file.split(/[\\/]/).pop() ?? 'MES'}
                  className="h-14 rounded-[8px] border border-border object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {/* sections calmes */}
      <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 px-5 mb-4">
        <h5 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
          MES libres
        </h5>
        <p className="text-sm text-text-secondary">
          Aucune MES libre pour cette gamme —{' '}
          <span className="opacity-60" title="Les MES libres arrivent avec leur chantier dédié">
            ✦ Nouvelle (bientôt)
          </span>
        </p>
      </section>

      {/* v10 : Décors et Moodboards en DEUX sections distinctes (retour Mathias 13/07) */}
      <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 px-5 mb-4">
        <h5 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-3">
          Décors de la gamme{' '}
          <span className="normal-case tracking-normal font-normal text-xs">
            · {gammeDecors.length} décor{gammeDecors.length > 1 ? 's' : ''}
          </span>
        </h5>
        <div className="flex flex-wrap gap-2.5">
          {gammeDecors.map((d) => (
            <span key={d.id} title={d.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/artifacts?p=${encodeURIComponent(d.file_path)}&w=240`}
                alt={d.name}
                className="h-14 rounded-[8px] border border-border object-cover"
                loading="lazy"
              />
            </span>
          ))}
          {gammeDecors.length === 0 && (
            <span className="text-sm text-text-secondary self-center">
              Aucun décor rattaché à la gamme {detail.name} dans la bibliothèque.
            </span>
          )}
          <button
            onClick={openGenDecor}
            title="Générer un nouveau décor à partir d'un moodboard de la gamme"
            className="h-14 px-3 border-[1.5px] border-dashed border-[#b7d49a] rounded-[8px] text-brand-green text-[11px] font-bold hover:bg-brand-green-light transition-colors"
          >
            ＋ Nouveau décor
          </button>
        </div>
      </section>

      <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 px-5 mb-4">
        <h5 className="flex items-baseline gap-2 text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-3">
          Moodboards de la gamme{' '}
          <span className="normal-case tracking-normal font-normal text-xs">
            · {detail.summary.moodboards.length} fichier
            {detail.summary.moodboards.length > 1 ? 's' : ''}
          </span>
        </h5>
        {mbNote && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-[8px] px-3 py-2 text-xs mb-3">
            <span className="flex-1">{mbNote}</span>
            <button
              onClick={() => setMbNote(null)}
              className="text-amber-700 font-bold leading-none"
              title="Fermer"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2.5">
          {detail.summary.moodboards.map((m) => {
            const label = m.split(/[\\/]/).pop() ?? 'moodboard'
            return (
              <figure key={m} className="relative w-[118px] m-0 group/mb">
                <a href={fileUrl(m)} target="_blank" rel="noreferrer" title={label}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/catalogue/${detail.id}/moodboard-preview?p=${encodeURIComponent(m)}&w=240`}
                    alt={label}
                    className="w-[118px] h-[82px] rounded-[8px] border border-border object-cover bg-surface"
                    loading="lazy"
                  />
                </a>
                <button
                  onClick={() =>
                    setMbNote(
                      'Le serveur de fichiers est en lecture seule pour l’instant — la suppression de moodboards sera activée quand l’écriture sera autorisée.'
                    )
                  }
                  title="Supprimer ce moodboard (bientôt — écrira sur le serveur de fichiers)"
                  className="absolute top-1 right-1 w-5 h-5 rounded-md bg-white/95 shadow-sm text-[11px] leading-none text-text-secondary opacity-0 group-hover/mb:opacity-100 hover:bg-brand-red hover:text-white transition-all"
                >
                  ✕
                </button>
                <figcaption className="text-[11px] text-text-secondary px-0.5 pt-1 truncate">
                  {label}
                </figcaption>
              </figure>
            )
          })}
          {detail.summary.moodboards.length === 0 && (
            <span className="text-sm text-text-secondary self-center">
              Aucun moodboard trouvé dans le dossier de la gamme.
            </span>
          )}
          <button
            onClick={() =>
              setMbNote(
                'Le serveur de fichiers est en lecture seule pour l’instant — l’ajout de moodboards sera activé quand l’écriture sera autorisée.'
              )
            }
            title="Ajouter un moodboard (bientôt — écrira sur le serveur de fichiers)"
            className="w-[118px] h-[82px] border-[1.5px] border-dashed border-[#b7d49a] rounded-[8px] text-brand-green text-[11px] font-bold hover:bg-brand-green-light transition-colors"
          >
            ＋ Ajouter un moodboard
          </button>
        </div>
      </section>

      <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 px-5 mb-4">
        <h5 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
          Derniers lancements
          {launches.length > 0 && (
            <span className="normal-case tracking-normal font-normal text-xs">
              {' '}
              · {launches.length}
            </span>
          )}
        </h5>
        {launches.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Aucun lancement depuis le catalogue pour l&apos;instant.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {launches.map((l) => {
              const coloris =
                l.colorisList.length === 1
                  ? l.colorisList[0].toUpperCase()
                  : `${l.colorisList.length} coloris`
              const formats = l.formats.map(formatShort).join(' + ')
              return (
                <div
                  key={l.batchId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13.5px]"
                >
                  <span className="text-text-disabled text-xs w-[76px] shrink-0">
                    {relTime(l.createdAt)}
                  </span>
                  {l.createdBy && (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-text-secondary bg-surface rounded-full pl-0.5 pr-2.5 py-0.5 shrink-0"
                      title={`Génération lancée par ${l.createdBy}`}
                    >
                      <span className="w-[18px] h-[18px] rounded-full bg-brand-green text-white grid place-items-center text-[9px] font-bold uppercase">
                        {l.createdBy.charAt(0)}
                      </span>
                      {l.createdBy}
                    </span>
                  )}
                  <span className="flex-1 min-w-[220px] text-text-secondary">
                    <b className="text-text-primary font-semibold">
                      {l.total > 1 ? `Lot · ${l.total} MES` : '1 MES'}
                    </b>{' '}
                    · {coloris}
                    {l.decorName && <> · décor «&nbsp;{l.decorName}&nbsp;»</>} · {formats}
                  </span>
                  {l.error > 0 ? (
                    <span className="text-xs font-bold text-brand-red" title="Échec(s) dans ce lancement">
                      ⚠ {l.error} échec{l.error > 1 ? 's' : ''}
                    </span>
                  ) : l.running > 0 ? (
                    <span className="text-xs font-bold text-brand-teal" title="Génération en cours">
                      ⏳ {l.done}/{l.total}
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-brand-green" title="Terminé">
                      ✓ {l.total}
                    </span>
                  )}
                  <span className="flex gap-2">
                    <button
                      onClick={() => setRelaunch({ launch: l, mode: 'reprendre', decorId: l.decorId })}
                      title="Relancer ce lancement à l’identique"
                      className="text-xs font-bold text-brand-green border border-border rounded-[7px] px-2.5 py-1 hover:bg-brand-green-light"
                    >
                      ↺ Reprendre
                    </button>
                    <button
                      onClick={() => setRelaunch({ launch: l, mode: 'dupliquer', decorId: l.decorId })}
                      title="Repartir de ce lancement en changeant le décor"
                      className="text-xs font-bold text-brand-green border border-border rounded-[7px] px-2.5 py-1 hover:bg-brand-green-light"
                    >
                      ⧉ Dupliquer
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* infos discrètes : chemin serveur + éléments non reconnus */}
      <p className="text-xs text-text-secondary mt-4">
        Dernière consultation : {new Date(detail.lastScanAt + 'Z').toLocaleString('fr-FR')} ·{' '}
        <span className="font-mono">{detail.serverPath}</span> (lecture seule)
        {detail.summary.warnings.length > 0 && (
          <>
            {' · '}
            <button onClick={() => setShowWarnings(!showWarnings)} className="text-amber-700 font-semibold">
              {detail.summary.warnings.length} élément(s) non reconnu(s) {showWarnings ? '▾' : '▸'}
            </button>
          </>
        )}
      </p>
      {showWarnings && (
        <ul className="mt-2 list-disc pl-5 space-y-0.5 text-xs text-text-secondary">
          {detail.summary.warnings.map((w, i) => (
            <li key={i} className="break-all">
              {w}
            </li>
          ))}
        </ul>
      )}

      {/* fenêtre réglages par défaut */}
      {editing && draft && (
        <div
          className="fixed inset-0 bg-[rgba(31,41,55,0.45)] z-50 grid place-items-center p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null)
          }}
        >
          <div className="bg-white rounded-[12px] shadow-lg w-[560px] max-w-full">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <span
                className="w-[14px] h-[14px] rounded border border-border"
                style={{ background: colorisSwatch(editing) }}
              />
              <h3 className="text-[15px] font-bold m-0">
                Réglages par défaut — {detail.name} · {editing.toUpperCase()}
              </h3>
              <button
                onClick={() => setEditing(null)}
                className="ml-auto text-text-disabled text-lg leading-none"
                title="Fermer"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 grid gap-4 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                  Décor par défaut
                </label>
                <div className="flex flex-wrap gap-2">
                  {modalDecors.slice(0, 12).map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDraft({ ...draft, decorId: d.id })}
                      className={`w-[100px] border rounded-[8px] overflow-hidden text-left text-[11px] bg-white transition-shadow ${
                        draft.decorId === d.id
                          ? 'border-brand-green ring-2 ring-brand-green-light'
                          : 'border-border'
                      }`}
                      title={d.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/artifacts?p=${encodeURIComponent(d.file_path)}&w=240`}
                        alt={d.name}
                        className="w-full h-[52px] object-cover"
                        loading="lazy"
                      />
                      <span className="block px-2 py-1 font-semibold truncate">{d.name}</span>
                    </button>
                  ))}
                  <button
                    onClick={openGenDecor}
                    title="Générer un nouveau décor à partir d’un moodboard de la gamme"
                    className="w-[100px] min-h-[76px] border-[1.5px] border-dashed border-brand-green rounded-[8px] grid place-items-center text-brand-green font-bold text-[11px] text-center leading-tight px-2 hover:bg-brand-green-light transition-colors"
                  >
                    ＋ Générer
                    <br />
                    un décor
                  </button>
                  {modalDecors.length === 0 && (
                    <span className="text-sm text-text-secondary self-center">
                      Aucun décor actif — génère-en un →
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                  Alignement des piliers au sol
                </label>
                <span className="inline-flex border border-border rounded-[8px] overflow-hidden">
                  {(
                    [
                      // 'moteur' = suivre Admin → Réglages par moteur (défaut, 13/07/2026) ;
                      // Désactivé / Manuel = dérogation propre à CE coloris.
                      ['moteur', 'Suivre le moteur'],
                      ['off', 'Désactivé'],
                      ['manual', 'Manuel'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setDraft({ ...draft, align: val })}
                      className={`px-4 py-1.5 text-xs border-r border-border last:border-r-0 ${
                        draft.align === val
                          ? 'bg-brand-green text-white font-bold'
                          : 'text-text-secondary bg-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </span>
                {draft.align === 'manual' && (
                  <input
                    type="number"
                    value={draft.alignPx}
                    onChange={(e) => setDraft({ ...draft, alignPx: Number(e.target.value) })}
                    className="ml-3 w-24 border border-border rounded-[8px] px-2 py-1.5 text-xs"
                    title="Décalage en pixels"
                  />
                )}
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                  Formats générés
                </label>
                <div className="grid gap-1.5 text-[13px] font-semibold">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.formats.site}
                      onChange={(e) =>
                        setDraft({ ...draft, formats: { ...draft.formats, site: e.target.checked } })
                      }
                    />
                    Site · 2000×1330
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.formats.marketplace}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          formats: { ...draft.formats, marketplace: e.target.checked },
                        })
                      }
                    />
                    Marketplace · 2000×2000
                  </label>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3.5 border-t border-border">
              <span className="text-[11.5px] text-text-disabled">
                S&apos;applique à toutes les prochaines générations du coloris{' '}
                {editing.toLowerCase()}.
              </span>
              <span className="ml-auto flex gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="bg-white text-text-secondary border border-border rounded-[8px] px-3 py-1.5 text-xs font-bold"
                >
                  Annuler
                </button>
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className="bg-brand-green text-white rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-brand-green-hover disabled:opacity-50"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {batchPrompt && (
        <div
          className="fixed inset-0 bg-[rgba(31,41,55,0.45)] z-50 grid place-items-center p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBatchPrompt(null)
          }}
        >
          <div className="bg-white rounded-[12px] shadow-lg w-[520px] max-w-full">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-[15px] font-bold m-0">{batchPrompt.title}</h3>
            </div>
            <div className="px-5 py-4 grid gap-2.5 max-h-[50vh] overflow-y-auto">
              {batchPrompt.groups.map((g) => (
                <div key={g.coloris} className="flex items-center gap-2.5 text-sm flex-wrap">
                  <span
                    className="w-[13px] h-[13px] rounded border border-border"
                    style={{ background: colorisSwatch(g.coloris) }}
                  />
                  <b className="text-text-primary uppercase">{g.coloris}</b>
                  {g.ready ? (
                    <span className="text-text-secondary">
                      {g.cells.length} MES · décor «&nbsp;{g.decorName}&nbsp;»
                    </span>
                  ) : (
                    <span className="text-amber-700 font-semibold">
                      pas de décor par défaut — ignoré ·{' '}
                      <button
                        onClick={() => {
                          setBatchPrompt(null)
                          openSettings(g.coloris)
                        }}
                        className="underline font-bold"
                      >
                        Régler
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border">
              <span className="text-xs text-text-disabled flex-1">
                {batchPrompt.launchable > 0
                  ? `Coût estimé ~ ${(batchPrompt.launchable * 0.27).toFixed(2).replace('.', ',')} € · format Site (le marketplace arrive au bloc suivant).`
                  : 'Aucun coloris prêt — règle un décor par défaut.'}
              </span>
              <span className="flex gap-2">
                <button
                  onClick={() => setBatchPrompt(null)}
                  className="bg-white text-text-secondary border border-border rounded-[8px] px-3 py-1.5 text-xs font-bold"
                >
                  Annuler
                </button>
                <button
                  onClick={launchBatch}
                  disabled={batchPrompt.launchable === 0}
                  className="bg-brand-green text-white rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-brand-green-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Lancer {batchPrompt.launchable} génération{batchPrompt.launchable > 1 ? 's' : ''}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {regenPrompt && (
        <div
          className="fixed inset-0 bg-[rgba(31,41,55,0.45)] z-50 grid place-items-center p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRegenPrompt(null)
          }}
        >
          <div className="bg-white rounded-[12px] shadow-lg w-[480px] max-w-full">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-[15px] font-bold m-0">Décor changé — régénérer les MES ?</h3>
            </div>
            <div className="px-5 py-4 text-sm text-text-secondary">
              Tu as changé le décor par défaut de{' '}
              <b className="text-text-primary">{regenPrompt.coloris}</b> pour «&nbsp;{regenPrompt.decorName}&nbsp;».{' '}
              <b className="text-text-primary">{regenPrompt.cells.length}</b> mise
              {regenPrompt.cells.length > 1 ? 's' : ''} en situation{' '}
              {regenPrompt.cells.length > 1 ? 'ont' : 'a'} été générée
              {regenPrompt.cells.length > 1 ? 's' : ''} avec l&apos;ancien décor. Les régénérer avec le
              nouveau ?
              <span className="block mt-2 text-text-disabled text-xs">
                Coût estimé ~ {(regenPrompt.cells.length * 0.27).toFixed(2).replace('.', ',')} € · les
                anciennes images restent affichées jusqu&apos;à la fin.
              </span>
            </div>
            <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border justify-end">
              <button
                onClick={() => setRegenPrompt(null)}
                className="bg-white text-text-secondary border border-border rounded-[8px] px-3 py-1.5 text-xs font-bold"
              >
                Plus tard
              </button>
              <button
                onClick={regenerateAll}
                className="bg-brand-green text-white rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-brand-green-hover"
              >
                Régénérer les {regenPrompt.cells.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {relaunch &&
        (() => {
          const l = relaunch.launch
          const hasSite = l.formats.includes(SITE_FORMAT)
          const needDecor = relaunch.mode === 'dupliquer' && hasSite
          const canConfirm = !needDecor || (relaunch.decorId != null && decorActive(relaunch.decorId))
          const coloris =
            l.colorisList.length === 1
              ? l.colorisList[0].toUpperCase()
              : `${l.colorisList.length} coloris`
          const formats = l.formats.map(formatShort).join(' + ')
          return (
            <div
              className="fixed inset-0 bg-[rgba(31,41,55,0.45)] z-50 grid place-items-center p-5"
              onClick={(e) => {
                if (e.target === e.currentTarget) setRelaunch(null)
              }}
            >
              <div className="bg-white rounded-[12px] shadow-lg w-[520px] max-w-full">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="text-[15px] font-bold m-0">
                    {relaunch.mode === 'reprendre'
                      ? 'Reprendre ce lancement'
                      : 'Dupliquer ce lancement'}
                  </h3>
                </div>
                <div className="px-5 py-4 grid gap-3 text-sm max-h-[60vh] overflow-y-auto">
                  <p className="text-text-secondary">
                    <b className="text-text-primary">
                      {l.total} MES
                    </b>{' '}
                    · {coloris} · {formats}
                  </p>
                  {relaunch.mode === 'reprendre' ? (
                    <p className="text-text-secondary">
                      Relancées à l&apos;identique — mêmes coloris, tailles et formats, avec les
                      réglages par défaut actuels de chaque coloris.
                    </p>
                  ) : hasSite ? (
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                        Décor à appliquer
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {modalDecors.slice(0, 12).map((d) => (
                          <button
                            key={d.id}
                            onClick={() => setRelaunch({ ...relaunch, decorId: d.id })}
                            className={`w-[100px] border rounded-[8px] overflow-hidden text-left text-[11px] bg-white transition-shadow ${
                              relaunch.decorId === d.id
                                ? 'border-brand-green ring-2 ring-brand-green-light'
                                : 'border-border'
                            }`}
                            title={d.name}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/artifacts?p=${encodeURIComponent(d.file_path)}&w=240`}
                              alt={d.name}
                              className="w-full h-[52px] object-cover"
                              loading="lazy"
                            />
                            <span className="block px-2 py-1 font-semibold truncate">{d.name}</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-[11.5px] text-text-disabled mt-2">
                        Les autres réglages (alignement, formats) restent ceux du coloris. Le décor
                        par défaut enregistré n&apos;est pas modifié.
                      </p>
                    </div>
                  ) : (
                    <p className="text-text-secondary">
                      Le Marketplace est refait à partir du Site — rien à régler.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border">
                  <span className="text-xs text-text-disabled flex-1">
                    Coût estimé ~ {(l.total * 0.27).toFixed(2).replace('.', ',')} €
                  </span>
                  <button
                    onClick={() => setRelaunch(null)}
                    className="bg-white text-text-secondary border border-border rounded-[8px] px-3 py-1.5 text-xs font-bold"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={confirmRelaunch}
                    disabled={!canConfirm}
                    className="bg-brand-green text-white rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-brand-green-hover disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {relaunch.mode === 'reprendre'
                      ? `Reprendre les ${l.total}`
                      : `Lancer ${l.total}`}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* Galerie MES par-dessus l'interface (maquette v10) — la 1ʳᵉ image est la MES de face,
          navigation ‹ › ou flèches clavier, Échap / clic à côté pour fermer. */}
      {gallery && gallery.images.length > 0 && (
        <div
          className="fixed inset-0 z-[60] bg-[rgba(17,22,29,0.88)] flex flex-col p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGallery(null)
          }}
        >
          <div className="flex items-baseline gap-3 text-white pb-3">
            <b className="text-base">{gallery.title}</b>
            <span className="text-[13px] text-white/65">{gallery.sub}</span>
            <span className="ml-auto text-[13px] text-white/65 tabular-nums">
              {gallery.index + 1} / {gallery.images.length}
            </span>
            <button
              onClick={() => setGallery(null)}
              className="text-white/75 hover:text-white text-xl leading-none ml-4"
              title="Fermer (Échap)"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 flex items-center gap-3.5 min-h-0">
            <button
              onClick={() =>
                setGallery({
                  ...gallery,
                  index: (gallery.index + gallery.images.length - 1) % gallery.images.length,
                })
              }
              className="w-11 h-11 rounded-full bg-white/15 text-white text-[22px] leading-none hover:bg-brand-green shrink-0 transition-colors"
              title="Précédente (←)"
            >
              ‹
            </button>
            {/* l'image tient dans l'écran (max-w/max-h) ; un clic À CÔTÉ de l'image ferme
                la galerie — l'original s'ouvre via le bouton « Pleine résolution » en bas */}
            <div
              className="flex-1 h-full min-w-0 flex items-center justify-center cursor-pointer"
              onClick={() => setGallery(null)}
              title="Fermer la galerie"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gallery.images[gallery.index].full}
                alt={`${gallery.title} — ${gallery.images[gallery.index].label}`}
                className="max-w-full max-h-full object-contain cursor-default"
                onClick={(ev) => ev.stopPropagation()}
              />
            </div>
            <button
              onClick={() =>
                setGallery({ ...gallery, index: (gallery.index + 1) % gallery.images.length })
              }
              className="w-11 h-11 rounded-full bg-white/15 text-white text-[22px] leading-none hover:bg-brand-green shrink-0 transition-colors"
              title="Suivante (→)"
            >
              ›
            </button>
          </div>
          <p className="text-center text-[13.5px] text-white/85 pt-2.5 pb-0.5 m-0">
            {gallery.images[gallery.index].label}
          </p>
          <div className="flex items-center gap-4 pt-2 flex-wrap">
            <div className="flex gap-2 flex-1 overflow-x-auto">
              {gallery.images.map((im, i) => (
                <button
                  key={i}
                  onClick={() => setGallery({ ...gallery, index: i })}
                  title={im.label}
                  className={`shrink-0 rounded-[7px] border-2 overflow-hidden transition-opacity ${
                    i === gallery.index
                      ? 'border-brand-green'
                      : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={im.thumb}
                    alt={im.label}
                    className="w-[74px] h-[50px] object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <a
                href={gallery.images[gallery.index].full}
                target="_blank"
                rel="noreferrer"
                title="Ouvrir l'image originale en pleine résolution dans un nouvel onglet"
                className="bg-white/10 text-white border border-white/25 rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-white/20 transition-colors"
              >
                ⤢ Pleine résolution
              </a>
              <button
                onClick={() => {
                  const gal = gallery
                  setGallery(null)
                  void generate(gal.coloris, gal.w, gal.h, SITE_FORMAT)
                }}
                title="Remplacer — regénérer la MES avec les réglages du coloris"
                className="bg-white/10 text-white border border-white/25 rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-white/20 transition-colors"
              >
                ↻ Remplacer cette MES
              </button>
              <button
                onClick={() => {
                  const gal = gallery
                  setGallery(null)
                  void generate(gal.coloris, gal.w, gal.h, SITE_FORMAT)
                }}
                title="Générer une MES en plus (nouvelle variante, réglages du coloris)"
                className="bg-brand-green text-white rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-brand-green-hover transition-colors"
              >
                ＋ Générer une nouvelle MES
              </button>
            </div>
          </div>
        </div>
      )}

      {genDecor && (
        <div
          className="fixed inset-0 bg-[rgba(31,41,55,0.45)] z-50 grid place-items-center p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGenDecor(null)
          }}
        >
          <div className="bg-white rounded-[12px] shadow-lg w-[560px] max-w-full">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
              <h3 className="text-[15px] font-bold m-0 flex-1">🎨 Générer un décor — {detail.name}</h3>
              <button
                onClick={() => setGenDecor(null)}
                className="text-text-disabled text-lg leading-none"
                title="Fermer"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 grid gap-4 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                  À partir d&apos;un moodboard de la gamme
                </label>
                {gammeMoodboards.length === 0 ? (
                  <p className="text-sm text-text-secondary">
                    Aucun moodboard dans cette gamme — ajoute-en un depuis la Bibliothèque.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {gammeMoodboards.map((m) => {
                      const label = (m.split(/[\\/]/).pop() ?? 'moodboard').replace(/\.[^.]+$/, '')
                      const isPdf = /\.pdf$/i.test(m)
                      return (
                        <button
                          key={m}
                          onClick={() => setGenDecor({ ...genDecor, moodboard: m })}
                          title={label}
                          className={`w-[104px] border rounded-[8px] overflow-hidden text-left text-[11px] bg-white transition-shadow ${
                            genDecor.moodboard === m
                              ? 'border-brand-green ring-2 ring-brand-green-light'
                              : 'border-border'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/catalogue/${detail.id}/moodboard-preview?p=${encodeURIComponent(m)}&w=160`}
                            alt={label}
                            className="w-full h-[56px] object-cover bg-surface"
                            loading="lazy"
                          />
                          <span className="block px-2 py-1 font-semibold truncate">
                            {isPdf && <span className="text-text-disabled">PDF · </span>}
                            {label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                  Nombre de tirages
                </label>
                <span className="inline-flex border border-border rounded-[8px] overflow-hidden align-middle">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setGenDecor({ ...genDecor, tirages: n })}
                      className={`px-4 py-1.5 text-xs border-r border-border last:border-r-0 ${
                        genDecor.tirages === n
                          ? 'bg-brand-green text-white font-bold'
                          : 'text-text-secondary bg-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </span>
                <span className="text-xs text-text-disabled ml-3">
                  plusieurs essais, tu gardes le meilleur
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border">
              <span className="text-[11.5px] text-text-disabled flex-1">
                Rattaché à la gamme {detail.name} · le studio s&apos;ouvre pour garder le meilleur.
              </span>
              <button
                onClick={() => setGenDecor(null)}
                className="bg-white text-text-secondary border border-border rounded-[8px] px-3 py-1.5 text-xs font-bold"
              >
                Annuler
              </button>
              <button
                onClick={launchGenDecor}
                disabled={genBusy || !genDecor.moodboard}
                className="bg-brand-green text-white rounded-[8px] px-3 py-1.5 text-xs font-bold hover:bg-brand-green-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {genBusy ? 'Lancement…' : 'Générer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {studioJobs && (
        <DecorStudio
          jobIds={studioJobs}
          isAdmin={isAdmin}
          onClose={() => {
            setStudioJobs(null)
            loadDecors()
          }}
          onChanged={loadDecors}
          onUse={(id) => void pickGeneratedDecor(id)}
        />
      )}

      {detOpen && (
        <DetourageStudio
          productId={detail.id}
          productName={detail.name}
          onClose={(changed) => {
            setDetOpen(false)
            loadDetourage()
            if (changed) refreshGenerations()
          }}
        />
      )}
    </div>
  )
}
