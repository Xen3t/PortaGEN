'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { parseProduitFromFileName, parseSizeFromProductName } from '@/lib/productName'
import { displayVariant, groupMesSlots, slotKeyOf, variantNo } from '@/lib/mesVariants'
import PhraseAttente from '@/components/PhraseAttente'
import { PictoIllu } from '../../Silhouette'

/**
 * « MES Écrin » (renommage Mathias 05/08 — ex-« MES Contrainte » nouvelle
 * méthode ; l'URL /generation/decor-autour ne change pas) — mode « décor autour »
 * (bascule du 05/08/2026, docs/CADRAGE-DECOR-AUTOUR-2026-08-05.md). Page construite À CÔTÉ
 * du legacy (/generation, jamais modifié) en recombinant deux écrans validés :
 * le dépôt d'images de la page Génération (maquette generation-v4) et les cases
 * avant/après du labo décor autour (maquette decor-autour-app-v2).
 *
 * Flux complet (décision Mathias 05/08) : dépôt → jobs « decor-autour » (un par
 * image = une MES) → cases avant/après (plan gris / rendu) → MP 1:1 →
 * téléchargements Site + MP → session rouvrable depuis l'accueil
 * (/generation/decor-autour?session=…).
 *
 * Générations multiples (05/08/2026, demande Mathias : « 3 générations par
 * taille même pour les nouvelles MES contraintes ») : mêmes règles que le
 * legacy (29/07) — 1 case = la génération retenue (sinon la 1ʳᵉ), galerie +
 * « choisir » dans la vue en grand, MP verrouillé tant qu'aucune retenue.
 */

// —————————————————————————————————————————————— types & données
// Moteurs DÉCOR AUTOUR (séparation totale 05/08 : src/lib/moteursDa.ts) — les
// clés janus/terminus/forculus, jamais celles des moteurs legacy.
type Typo = 'janus' | 'terminus' | 'forculus'

const TYPO_INFO: Record<Typo, { titre: string; moteur: string; lettre: string }> = {
  janus: { titre: 'Portail battant', moteur: 'Battant « JANUS »', lettre: 'B' },
  terminus: { titre: 'Portail coulissant', moteur: 'Coulissant « TERMINUS »', lettre: 'C' },
  forculus: { titre: 'Portillon', moteur: 'Portillon « FORCULUS »', lettre: 'P' },
}

const COLORS = [
  { name: 'Gris', sw: '#4a4d52' },
  { name: 'Noir', sw: '#1f2937' },
  { name: 'Blanc', sw: '#fdfdfd' },
  { name: 'Teck', sw: '#a37c62' },
]

interface Img {
  id: string
  file: File
  name: string
  url: string
  color: string
  w: number
  h: number
  detSize: boolean
}

interface Job {
  id: number
  type: string
  status: string
  /** Génération retenue de sa taille (générations multiples, 05/08/2026). */
  chosen?: boolean
  payload: {
    coloris?: string
    size?: { w: number; h: number }
    rootJobId?: number
    moteur?: string
    lab?: boolean
    /** Numéro de génération (1..N) — absent = lancement mono-génération. */
    variant?: number
  } | null
  result: { deliveryPath?: string; planPath?: string; sizeLabel?: string } | null
  error: string | null
}

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

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

/** Libellé d'une MES : « Gris · 300B140 » (lettre = moteur). */
function labelOf(j: Job, lettre: string): string {
  const col = j.payload?.coloris ?? ''
  const w = j.payload?.size?.w
  const h = j.payload?.size?.h
  return w && h ? `${col} · ${w}${lettre}${h}` : col || j.result?.sizeLabel || 'MES'
}

function fnameOf(j: Job, kind: 'site' | 'marketplace', produit: string, lettre: string): string {
  const col = (j.payload?.coloris || 'mes').toLowerCase()
  const w = j.payload?.size?.w ?? ''
  const h = j.payload?.size?.h ?? ''
  return `${produit}_${col}_${w}${lettre}${h}_${kind}.jpg`
}

type Stage = 'input' | 'proc' | 'result'

// —————————————————————————————————————————————— comparateur avant/après
/** Comparateur à poignée (maquette decor-autour-app-v2 validée le 05/08/2026) :
 *  glisser = comparer, simple clic sans glisser = agrandir (onZoom). */
function Comparateur({ avant, apres, onZoom }: { avant: string; apres: string; onZoom?: () => void }) {
  const [pos, setPos] = useState(52)
  const ref = useRef<HTMLDivElement>(null)
  const st = useRef({ down: false, moved: false, x: 0 })
  const move = useCallback((clientX: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(Math.max(3, Math.min(97, ((clientX - r.left) / r.width) * 100)))
  }, [])
  return (
    <div
      ref={ref}
      className="absolute inset-0 select-none"
      style={{ cursor: onZoom ? 'zoom-in' : 'ew-resize' }}
      onMouseDown={(e) => {
        st.current = { down: true, moved: false, x: e.clientX }
      }}
      onMouseMove={(e) => {
        if (!st.current.down) return
        if (Math.abs(e.clientX - st.current.x) > 4) st.current.moved = true
        if (st.current.moved) move(e.clientX)
      }}
      onMouseUp={() => {
        const wasClick = st.current.down && !st.current.moved
        st.current.down = false
        if (wasClick && onZoom) onZoom()
      }}
      onMouseLeave={() => {
        st.current.down = false
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={apres} alt="après" className="absolute inset-0 w-full h-full object-cover" />
      <div
        className="absolute top-0 left-0 h-full overflow-hidden border-r-2 border-white"
        style={{ width: `${pos}%` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avant}
          alt="avant"
          className="absolute top-0 left-0 h-full max-w-none object-cover"
          style={{ width: `${(10000 / pos).toFixed(2)}%` }}
        />
      </div>
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow -translate-x-px"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white shadow grid place-items-center text-[11px] text-text-secondary">
          ⟺
        </span>
      </div>
      <span className="absolute bottom-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wide text-white bg-black/40 rounded-full px-1.5 pointer-events-none">
        avant
      </span>
      <span className="absolute bottom-1.5 right-1.5 text-[9px] font-bold uppercase tracking-wide text-white bg-black/40 rounded-full px-1.5 pointer-events-none">
        après
      </span>
    </div>
  )
}

// —————————————————————————————————————————————— page
export default function DecorAutourGenerationPage() {
  const [stage, setStage] = useState<Stage>('input')
  const [typo, setTypo] = useState<Typo>('janus')
  const [typoDetected, setTypoDetected] = useState(false)
  const [produit, setProduit] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [imageSize, setImageSize] = useState<'2K' | '4K'>('2K')
  const [notice, setNotice] = useState<string | null>(null)
  const [hot, setHot] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  // — suivi du lot —
  const [batchId, setBatchId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [expected, setExpected] = useState(0)
  const [apiErrors, setApiErrors] = useState<{ name: string; error: string }[]>([])
  const [busyPoll, setBusyPoll] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  // Vue en grand PAR JOB (générations multiples) : la galerie des variantes et le
  // bouton « choisir » se nourrissent de l'état vivant du lot, pas d'URLs figées.
  const [lightbox, setLightbox] = useState<{ jobId: number } | null>(null)
  const [mpAskedRoots, setMpAskedRoots] = useState<Set<number>>(new Set())
  const [zipBusy, setZipBusy] = useState<'tout' | 'site' | 'mp' | null>(null)
  const [mpMode, setMpMode] = useState<'choix' | 'toujours' | 'jamais'>('choix')
  // Nombre de générations par taille (réglage du moteur) — affiché sur le bouton
  // Générer : le coût réel est de N appels Nano par image.
  const [nGen, setNGen] = useState(1)

  useEffect(() => {
    let alive = true
    fetch(`/api/moteurs/${typo}/reglages`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setMpMode(d.reglages?.marketplace ?? 'choix')
        setNGen(Math.max(1, Math.round(d.reglages?.generationsParTaille ?? 1)))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [typo])

  // — réouverture d'une session (accueil → carte « Décor autour ») —
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
        if (s.moteur === 'janus' || s.moteur === 'terminus' || s.moteur === 'forculus')
          setTypo(s.moteur)
        setProduit(s.produit ?? '')
        setExpected(s.mesCount ?? 0)
        setBatchId(s.batchId)
        setStage(s.busy ? 'proc' : 'result')
        setBusyPoll(true)
      })
      .catch(() => {
        if (alive) setSessionLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // — polling du lot — « fini » = tous les jobs decor-autour sortis (done/error).
  const mesJobs = (js: Job[]): Job[] => js.filter((j) => j.type === 'decor-autour' && j.payload?.lab !== true)
  const finished = (js: Job[]): boolean => {
    const gen = mesJobs(js)
    if (gen.length === 0) return false
    return gen.every((j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')
  }
  useEffect(() => {
    if (!batchId || (stage !== 'proc' && !busyPoll)) return
    let alive = true
    const tick = async () => {
      try {
        const d = await fetch(`/api/gamme/${batchId}`).then((r) => r.json())
        if (!alive || !Array.isArray(d.jobs)) return
        const js: Job[] = d.jobs
        setJobs(js)
        const active = js.some((j) => j.status === 'queued' || j.status === 'running')
        if (stage === 'proc' && finished(js)) {
          setStage('result')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, batchId, busyPoll])

  // Échap ferme l'aperçu en grand
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  // — dépôt d'images (repris du flux legacy : typologie détectée par la lettre) —
  function addFiles(list: FileList | null) {
    if (!list?.length) return
    if (!typoDetected) {
      const lettres = new Set<string>()
      for (const f of Array.from(list)) {
        const m = f.name.toUpperCase().match(/\d{2,3}([BCP])\d{2,3}/)
        if (m) lettres.add(m[1])
      }
      if (lettres.size === 1) {
        const lettre = [...lettres][0]
        setTypo(lettre === 'C' ? 'terminus' : lettre === 'P' ? 'forculus' : 'janus')
        setTypoDetected(true)
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
        w: p.w ?? (typo === 'forculus' ? 100 : 300),
        h: p.h ?? 140,
        detSize: p.w != null && p.h != null,
      }
    })
    setImages((cur) => [...cur, ...next])
    let det = ''
    for (const f of Array.from(list)) {
      det = parseProduitFromFileName(f.name)
      if (det) break
    }
    if (det) setProduit((cur) => cur || det)
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

  async function generate() {
    if (images.length === 0) return
    setNotice(null)
    const fd = new FormData()
    fd.append('moteur', typo)
    fd.append('produit', produit.trim())
    fd.append('imageSize', imageSize)
    fd.append('meta', JSON.stringify(images.map((i) => ({ w: i.w, h: i.h, coloris: i.color }))))
    images.forEach((i) => fd.append('files', i.file, i.name))
    setStage('proc')
    setJobs([])
    setBatchId(null)
    try {
      const res = await fetch('/api/generation/decor-autour', { method: 'POST', body: fd })
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

  function newGeneration() {
    setImages((cur) => {
      cur.forEach((i) => URL.revokeObjectURL(i.url))
      return []
    })
    setProduit('')
    if (window.location.search)
      window.history.replaceState(null, '', '/generation/decor-autour')
    setJobs([])
    setBatchId(null)
    setApiErrors([])
    setBusyPoll(false)
    setMpAskedRoots(new Set())
    setZipBusy(null)
    setNotice(null)
    setTypoDetected(false)
    setStage('input')
  }

  // — générations multiples (05/08/2026, même mécanique que le legacy) —
  /** Générations (variantes) d'une taille = les MES sœurs (même taille/coloris). */
  const slotVariantsOf = (root: Job): Job[] =>
    mesJobs(jobs)
      .filter((j) => slotKeyOf(j) === slotKeyOf(root))
      .sort((a, b) => variantNo(a) - variantNo(b) || a.id - b.id)
  /** La case a-t-elle une génération RETENUE (ou une seule génération) → MP possible. */
  const mpReadyFor = (root: Job): boolean => {
    const vs = slotVariantsOf(root)
    return vs.length <= 1 || vs.some((v) => v.chosen)
  }
  /**
   * Désigne une génération comme la MES retenue de sa taille (persistée en base
   * via l'API de choix). État local mis à jour tout de suite — ses sœurs
   * repassent à non retenues, le prochain chargement du lot confirme.
   */
  async function chooseVariant(variantJobId: number) {
    const target = jobs.find((j) => j.id === variantJobId)
    if (!target) return
    const slot = slotKeyOf(target)
    setJobs((prev) =>
      prev.map((j) =>
        j.type === 'decor-autour' && slotKeyOf(j) === slot
          ? { ...j, chosen: j.id === variantJobId }
          : j
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

  // — MP —
  const mpDoneFor = (rootId: number): boolean =>
    mpAskedRoots.has(rootId) ||
    jobs.some((j) => j.type === 'marketplace' && j.payload?.rootJobId === rootId)
  async function mpRoot(j: Job) {
    // MP bloqué tant qu'aucune génération n'est retenue pour cette taille
    // (règle Mathias 29/07/2026, reprise au décor autour).
    if (!mpReadyFor(j)) {
      setNotice('Choisis d’abord une génération pour cette taille avant de la décliner en Marketplace.')
      return
    }
    if (j.status !== 'done' || !j.result?.deliveryPath || mpDoneFor(j.id)) return
    setMpAskedRoots((prev) => new Set(prev).add(j.id))
    setNotice(null)
    try {
      const res = await fetch('/api/generation/mp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [j.id] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setNotice(d?.error ?? 'Passage Marketplace impossible.')
        setMpAskedRoots((prev) => {
          const next = new Set(prev)
          next.delete(j.id)
          return next
        })
        return
      }
      setBusyPoll(true)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  // — ↻ regénérer (même payload, nouvelle image) —
  async function regen(j: Job) {
    if (j.status === 'queued' || j.status === 'running') return
    try {
      const res = await fetch(`/api/jobs/${j.id}/regen`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice(body?.error ?? 'Relance impossible.')
        return
      }
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, status: 'queued', error: null } : x)))
      setBusyPoll(true)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  // — téléchargement ZIP (Site dans WEB/, MP dans MP/) —
  async function downloadZip(kind: 'tout' | 'site' | 'mp') {
    const lettre = TYPO_INFO[typo].lettre
    const items: { p: string; name: string; folder: 'WEB' | 'MP' }[] = []
    if (kind !== 'mp') {
      // Une génération par taille : la retenue (chosen) sinon la 1ʳᵉ — jamais les N.
      displayJobs
        .filter((j) => j.status === 'done' && j.result?.deliveryPath)
        .forEach((j) => {
          items.push({ p: j.result!.deliveryPath!, name: fnameOf(j, 'site', typo, lettre), folder: 'WEB' })
        })
    }
    if (kind !== 'site') {
      jobs
        .filter((j) => j.type === 'marketplace' && j.status === 'done' && j.result?.deliveryPath)
        .forEach((j) => {
          items.push({ p: j.result!.deliveryPath!, name: fnameOf(j, 'marketplace', typo, lettre), folder: 'MP' })
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
      a.download = kind === 'site' ? 'MES_WEB.zip' : kind === 'mp' ? 'MES_MP.zip' : 'MES_WEB+MP.zip'
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

  // — grille : un bloc par coloris, une largeur = UNE ligne (règle validée) —
  function SizeRows({ list, render }: { list: Job[]; render: (j: Job) => ReactNode }) {
    const byColoris: Job[][] = []
    const idx = new Map<string, number>()
    for (const j of list) {
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
          const widths = Array.from(new Set(sized.map((j) => j.payload!.size!.w))).sort((a, b) => a - b)
          const heights = Array.from(new Set(sized.map((j) => j.payload!.size!.h))).sort((a, b) => a - b)
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
                  <div
                    className="stagger grid gap-4"
                    style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 500px))` }}
                  >
                    {heights.map((h) => {
                      const cell = sized.filter((j) => j.payload!.size!.w === w && j.payload!.size!.h === h)
                      if (cell.length === 0) return <div key={h} title={`${w}×${h} absent de ce lot`} />
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

  const gen = mesJobs(jobs)
  // Générations multiples : la grille et les comptes raisonnent PAR CASE
  // (taille/coloris) — on n'affiche que la retenue (chosen) sinon la 1ʳᵉ.
  const displayJobs = [...groupMesSlots(gen).values()]
    .map((vs) => displayVariant(vs))
    .filter((j): j is Job => j !== undefined)
  const doneCount = displayJobs.filter((j) => j.status === 'done').length
  const lettre = TYPO_INFO[typo].lettre

  // —————————————————————————————————————————————— rendu
  return (
    <div className="max-w-6xl mx-auto">
      {sessionLoading && (
        <section className="min-h-[60vh] grid place-items-center animate-fade-in-up">
          <div className="text-center">
            <span className="inline-block w-10 h-10 rounded-full border-4 border-brand-green-light border-t-brand-green animate-spin mb-4" />
            <p className="text-sm font-semibold text-text-secondary anim-respire">Chargement de la session…</p>
          </div>
        </section>
      )}

      {!sessionLoading && (
        <section className="animate-fade-in-up">
          {/* fil d'ariane */}
          <div className="flex items-center gap-1 flex-wrap mb-5">
            <Link
              href="/generation"
              title="Retour"
              className="w-[34px] h-[34px] rounded-full border border-border bg-white text-text-secondary grid place-items-center shadow-sm mr-2 hover:border-brand-green hover:text-brand-green hover:bg-brand-green-light transition-colors"
            >
              ←
            </Link>
            <Link
              href="/generation"
              className="text-sm font-semibold text-text-secondary px-2 py-1 rounded-[8px] hover:text-brand-green hover:bg-brand-green-light transition-colors"
            >
              Générer
            </Link>
            <span className="text-[#c9cfd6] text-[13px]">›</span>
            <span className="text-sm font-bold px-2 py-1">
              MES Écrin{' '}
              <span className="text-[12px] font-semibold text-brand-green">
                · {TYPO_INFO[typo].moteur}
              </span>
            </span>
            {stage === 'input' && (
              <select
                value={typo}
                onChange={(e) => {
                  setTypo(e.target.value as Typo)
                  setTypoDetected(true)
                }}
                title="Typologie (détectée depuis les noms de fichiers, corrigeable)"
                className="text-[12px] font-semibold text-text-secondary border border-border rounded-full px-2.5 py-0.5 ml-1 bg-white"
              >
                {(Object.keys(TYPO_INFO) as Typo[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPO_INFO[t].titre}
                  </option>
                ))}
              </select>
            )}
          </div>

          {notice && (
            <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5 flex justify-between gap-4">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)} className="text-brand-red/60 hover:text-brand-red">
                ✕
              </button>
            </div>
          )}

          {/* ---- saisie ---- */}
          {stage === 'input' && (
            <>
              <div className="flex items-baseline gap-3 flex-wrap mb-1">
                <h1 className="text-2xl font-bold tracking-tight">Nouvelle génération — MES Écrin</h1>
                <span className="text-sm text-text-secondary">une ou plusieurs images du même produit</span>
              </div>
              <p className="text-[13px] text-text-secondary mb-4">
                Pas de décor à choisir : le produit est posé à sa vraie échelle sur un plan gris et{' '}
                <b className="text-text-primary">Nano peint l’entrée tout autour</b> (maison française de face, ciel bleu).
              </p>

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
                        hot
                          ? 'border-brand-green bg-brand-green-light'
                          : 'border-[#c8d3bb] bg-white hover:border-brand-green hover:bg-[#fbfdf8]'
                      }`}
                    >
                      {/* Même picto que la zone de dépôt legacy (langage PictoIllu, 22/07). */}
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
                              <div className="font-bold text-[13.5px] truncate">{im.name}</div>
                              <div className="flex items-center gap-2.5 flex-wrap mt-1.5">
                                <span className="text-[11px] text-text-secondary font-semibold flex items-center gap-1">
                                  <span
                                    className="w-3.5 h-3.5 rounded border border-black/20 inline-block"
                                    style={{ background: c.sw }}
                                  />
                                  coloris
                                </span>
                                <select
                                  value={im.color}
                                  onChange={(e) => patchImg(im.id, { color: e.target.value })}
                                  className="border border-border bg-white rounded-[8px] px-2 py-1.5 text-[13px]"
                                >
                                  {COLORS.map((o) => (
                                    <option key={o.name}>{o.name}</option>
                                  ))}
                                </select>
                                <span className="text-[11px] text-text-secondary font-semibold ml-1">taille</span>
                                <span className="inline-flex items-center gap-1.5">
                                  <input
                                    title="Largeur"
                                    value={im.w}
                                    onChange={(e) =>
                                      patchImg(im.id, { w: Number(e.target.value.replace(/\D/g, '')) || 0 })
                                    }
                                    className="w-[52px] border border-border rounded-[8px] px-2 py-1.5 text-[13px] text-right tabular-nums"
                                  />
                                  <span className="text-text-disabled text-xs">×</span>
                                  <input
                                    title="Hauteur"
                                    value={im.h}
                                    onChange={(e) =>
                                      patchImg(im.id, { h: Number(e.target.value.replace(/\D/g, '')) || 0 })
                                    }
                                    className="w-[52px] border border-border rounded-[8px] px-2 py-1.5 text-[13px] text-right tabular-nums"
                                  />
                                  <span className="text-[11px] text-text-disabled">cm</span>
                                </span>
                                <span
                                  className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${
                                    im.detSize
                                      ? 'bg-brand-green-light text-brand-green'
                                      : 'bg-surface text-text-secondary'
                                  }`}
                                >
                                  {im.detSize ? '✓ détectée' : 'à confirmer'}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => removeImg(im.id)}
                              title="Retirer"
                              className="text-text-disabled hover:text-brand-red text-lg px-1"
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}
                      <button
                        onClick={() => fileInput.current?.click()}
                        className="w-full border-2 border-dashed border-border rounded-[12px] py-3 text-sm font-bold text-text-secondary hover:border-brand-green hover:text-brand-green transition-colors"
                      >
                        + Ajouter des images
                      </button>
                    </div>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      addFiles(e.target.files)
                      e.target.value = ''
                    }}
                  />
                </div>

                {/* panneau lancement */}
                <aside className="bg-white border border-border rounded-[12px] shadow-sm p-5 space-y-4">
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block mb-1.5">
                      Produit
                    </label>
                    <input
                      value={produit}
                      onChange={(e) => setProduit(e.target.value)}
                      placeholder="détecté depuis le nom de fichier"
                      className="w-full border border-border rounded-[8px] px-3 py-2 text-sm"
                    />
                    <p className="text-[11.5px] text-text-disabled mt-1">Nomme la session sur l’accueil.</p>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block mb-1.5">
                      Qualité Nano
                    </label>
                    <div className="inline-flex border border-border rounded-[8px] overflow-hidden">
                      {(['2K', '4K'] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setImageSize(s)}
                          className={`px-4 py-2 text-sm font-bold ${
                            imageSize === s ? 'bg-brand-green text-white' : 'bg-white text-text-secondary'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-surface rounded-[8px] px-3 py-2.5 text-[12.5px] text-text-secondary">
                    🔒 <b className="text-text-primary">Élévation à plat, de face</b> — le prompt du moteur
                    verrouille la vue et le produit (éditable dans Admin → Prompt System).
                  </div>
                  <button
                    onClick={generate}
                    disabled={images.length === 0}
                    className="w-full bg-brand-green hover:bg-brand-green-hover text-white font-bold rounded-[10px] py-3 text-[14.5px] disabled:opacity-60"
                  >
                    <PictoIllu name="generer" size={16} className="mr-1.5" />
                    Générer ({images.length} image{images.length > 1 ? 's' : ''} ·{' '}
                    {nGen > 1 ? `${nGen} générations chacune` : '1 appel chacune'})
                  </button>
                </aside>
              </div>
            </>
          )}

          {/* ---- traitement ---- */}
          {stage === 'proc' && (
            <div className="min-h-[50vh] grid place-items-center">
              <div className="text-center max-w-md">
                <span className="inline-block w-10 h-10 rounded-full border-4 border-brand-green-light border-t-brand-green animate-spin mb-4" />
                <p className="text-base font-bold mb-1">
                  Nano peint le décor autour… {doneCount}/{expected || displayJobs.length || '?'}
                </p>
                <PhraseAttente />
                {apiErrors.length > 0 && (
                  <div className="mt-4 text-left bg-brand-red-light text-brand-red text-[12.5px] rounded-[8px] px-3 py-2">
                    {apiErrors.map((e) => (
                      <div key={e.name}>
                        {e.name} : {e.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- résultats ---- */}
          {stage === 'result' && (
            <>
              <div className="flex items-center gap-3 flex-wrap mb-1.5">
                <h1 className="text-2xl font-bold tracking-tight">Rendus</h1>
                <span className="text-sm text-text-disabled font-semibold">
                  {doneCount}/{displayJobs.length} MES
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => downloadZip('site')}
                  disabled={zipBusy !== null || doneCount === 0}
                  className="bg-white border border-border text-text-secondary hover:text-brand-green hover:border-brand-green font-bold text-[13px] rounded-[10px] px-3.5 py-2 disabled:opacity-50"
                >
                  {zipBusy === 'site' ? '⏳' : '⬇'} Site
                </button>
                <button
                  onClick={() => downloadZip('mp')}
                  disabled={
                    zipBusy !== null ||
                    !jobs.some((j) => j.type === 'marketplace' && j.status === 'done')
                  }
                  className="bg-white border border-border text-text-secondary hover:text-brand-green hover:border-brand-green font-bold text-[13px] rounded-[10px] px-3.5 py-2 disabled:opacity-50"
                >
                  {zipBusy === 'mp' ? '⏳' : '⬇'} Marketplace
                </button>
                <button
                  onClick={() => downloadZip('tout')}
                  disabled={zipBusy !== null || doneCount === 0}
                  className="bg-brand-green hover:bg-brand-green-hover text-white font-bold text-[13px] rounded-[10px] px-3.5 py-2 disabled:opacity-50"
                >
                  {zipBusy === 'tout' ? '⏳' : '⬇'} Tout
                </button>
                <button
                  onClick={newGeneration}
                  className="bg-white border border-border text-text-secondary hover:text-brand-green hover:border-brand-green font-bold text-[13px] rounded-[10px] px-3.5 py-2"
                >
                  + Nouvelle génération
                </button>
              </div>
              <p className="text-[12.5px] text-text-secondary mb-4">
                Rendu brut de Nano — glisse la poignée pour l’avant/après (plan gris envoyé / MES), clic = agrandir.
              </p>

              <SizeRows
                list={displayJobs}
                render={(j) => {
                  const done = j.status === 'done' && j.result?.deliveryPath
                  const running = j.status === 'queued' || j.status === 'running'
                  const mpBusy = mpDoneFor(j.id)
                  // Générations multiples : nb de générations de la taille + MP
                  // verrouillé tant qu'aucune n'est retenue.
                  const nVar = slotVariantsOf(j).length
                  const mpReady = mpReadyFor(j)
                  return (
                    <div
                      key={j.id}
                      className="bg-white border border-border rounded-[12px] shadow-sm overflow-hidden"
                    >
                      <div className="relative aspect-[3/2] bg-surface">
                        {done && j.result?.planPath ? (
                          <Comparateur
                            avant={imgUrl(j.result.planPath, 560)}
                            apres={imgUrl(j.result.deliveryPath!, 560)}
                            onZoom={() => setLightbox({ jobId: j.id })}
                          />
                        ) : done ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imgUrl(j.result!.deliveryPath!, 560)}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 grid place-items-center text-text-disabled text-[12.5px]">
                            {running ? (
                              <span className="inline-flex items-center gap-2">
                                <span className="inline-block w-4 h-4 rounded-full border-2 border-brand-green-light border-t-brand-green animate-spin" />
                                Nano peint autour…
                              </span>
                            ) : j.status === 'error' ? (
                              <span className="text-brand-red font-bold px-4 text-center">⚠ {j.error}</span>
                            ) : (
                              'en attente'
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <b className="text-[13px] truncate">{labelOf(j, lettre)}</b>
                        {nVar > 1 && (
                          <span
                            title={`${nVar} générations — clique la case pour comparer et en choisir une`}
                            className={`shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full ${
                              j.chosen
                                ? 'bg-brand-green-light text-brand-green'
                                : 'bg-surface text-text-secondary'
                            }`}
                          >
                            {j.chosen ? `✓ retenue · ${nVar} gén.` : `▦ ${nVar} gén.`}
                          </span>
                        )}
                        <div className="flex-1" />
                        {done && (
                          <>
                            <a
                              href={imgUrl(j.result!.deliveryPath!)}
                              download={fnameOf(j, 'site', typo, lettre)}
                              title="Télécharger la MES Site"
                              className="text-text-secondary hover:text-brand-green text-[15px]"
                            >
                              ⬇
                            </a>
                            <button
                              onClick={() => regen(j)}
                              title="Regénérer (mêmes réglages, nouvelle image)"
                              className="text-text-secondary hover:text-brand-green text-[15px]"
                            >
                              ↻
                            </button>
                            {mpMode !== 'jamais' && (
                              <button
                                onClick={() => mpRoot(j)}
                                disabled={mpBusy || !mpReady}
                                title={
                                  mpBusy
                                    ? 'Déclinaison MP lancée'
                                    : !mpReady
                                      ? 'Choisis d’abord une génération (clique la case) pour débloquer le MP'
                                      : 'Décliner en Marketplace (1:1)'
                                }
                                className={`text-[11px] font-bold rounded-full px-2 py-0.5 border disabled:opacity-60 ${
                                  mpBusy
                                    ? 'bg-brand-green-light text-brand-green border-transparent'
                                    : 'bg-white text-text-secondary border-border hover:text-brand-green hover:border-brand-green'
                                }`}
                              >
                                {mpBusy ? '✓ 1:1' : !mpReady ? '🔒 1:1' : '1:1'}
                              </button>
                            )}
                          </>
                        )}
                        {j.status === 'error' && (
                          <button
                            onClick={() => regen(j)}
                            className="text-[11px] font-bold rounded-full px-2 py-0.5 border bg-white text-brand-red border-brand-red/40 hover:bg-brand-red-light"
                          >
                            ↻ réessayer
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }}
              />
            </>
          )}
        </section>
      )}

      {/* ---- visionneuse plein écran : avant/après + galerie des générations ---- */}
      {lightbox &&
        (() => {
          const cur = jobs.find((x) => x.id === lightbox.jobId)
          if (!cur) return null
          const vs = slotVariantsOf(cur)
          const multi = vs.length > 1
          const chosenId = vs.find((v) => v.chosen)?.id ?? null
          const curDone = cur.status === 'done' && !!cur.result?.deliveryPath
          const avant = cur.result?.planPath ? imgUrl(cur.result.planPath) : null
          const apres = curDone ? imgUrl(cur.result!.deliveryPath!) : null
          return (
            <div
              className="fixed inset-0 z-[80] bg-[#0f1216]/85 flex items-center justify-center p-6"
              onClick={() => setLightbox(null)}
            >
              <div className="flex flex-col gap-2.5 max-w-[96vw]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3 text-white">
                  <b className="text-[15px]">
                    {labelOf(cur, lettre)}
                    {multi ? ` — Génération ${variantNo(cur)}` : ''}
                  </b>
                  <div className="flex-1" />
                  {avant && (
                    <a
                      href={avant}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#cfe0ec] text-[12.5px] font-bold hover:underline"
                    >
                      plan gris ↗
                    </a>
                  )}
                  {apres && (
                    <a
                      href={apres}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#cfe0ec] text-[12.5px] font-bold hover:underline"
                    >
                      rendu ↗
                    </a>
                  )}
                  <button
                    onClick={() => setLightbox(null)}
                    title="Fermer (Échap)"
                    className="bg-white/15 hover:bg-white/25 text-white w-[30px] h-[30px] rounded-[8px] text-[15px]"
                  >
                    ✕
                  </button>
                </div>
                <div
                  className={`relative aspect-[3/2] rounded-[10px] overflow-hidden shadow-2xl bg-[#181d23] ${
                    multi ? 'w-[min(94vw,calc(72vh*1.5))]' : 'w-[min(94vw,calc(86vh*1.5))]'
                  }`}
                >
                  {curDone && avant && apres ? (
                    <Comparateur avant={avant} apres={apres} />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-white/80 text-sm">
                      {cur.status === 'error' ? (
                        <span className="text-brand-red font-bold px-6 text-center">⚠ {cur.error}</span>
                      ) : (
                        <span className="inline-flex items-center gap-2.5">
                          <span className="inline-block w-5 h-5 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                          Nano peint autour…
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {/* Galerie des GÉNÉRATIONS (générations multiples, 05/08/2026) :
                    les variantes de la taille, clic pour comparer, une seule retenue. */}
                {multi && (
                  <div className="flex items-center gap-2.5 overflow-x-auto">
                    {vs.map((v) => {
                      const vdone = v.status === 'done' && v.result?.deliveryPath
                      const vworking = v.status === 'queued' || v.status === 'running'
                      const on = v.id === cur.id
                      const isChosenV = v.id === chosenId
                      return (
                        <button
                          key={v.id}
                          onClick={() => setLightbox({ jobId: v.id })}
                          className={`shrink-0 w-[132px] rounded-[8px] overflow-hidden border-2 text-left bg-white relative ${
                            on
                              ? 'border-brand-teal'
                              : isChosenV
                                ? 'border-brand-green'
                                : 'border-border hover:border-brand-green/50'
                          }`}
                          title={`Génération ${variantNo(v)}`}
                        >
                          {vdone ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imgUrl(v.result!.deliveryPath!, 240)}
                              alt={`Génération ${variantNo(v)}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-[74px] object-cover"
                            />
                          ) : (
                            <span className="w-full h-[74px] grid place-items-center bg-surface text-[11px] text-text-disabled">
                              {vworking ? 'En cours…' : v.status === 'error' ? 'Échec' : `Génération ${variantNo(v)}`}
                            </span>
                          )}
                          {isChosenV && (
                            <span className="absolute top-1 right-1 bg-brand-green text-white text-[10px] font-bold px-1.5 py-px rounded-full">
                              Choisie
                            </span>
                          )}
                          <span className="block px-2 py-1 text-[11px]">
                            <b>Génération {variantNo(v)}</b>
                            <span className="block text-text-disabled truncate">
                              {on ? 'affichée' : isChosenV ? 'retenue' : 'voir'}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                    <div className="flex-1" />
                    <button
                      onClick={() => curDone && cur.id !== chosenId && void chooseVariant(cur.id)}
                      disabled={!curDone || cur.id === chosenId}
                      className="shrink-0 bg-brand-green hover:bg-brand-green-hover text-white font-bold text-[13px] rounded-[10px] px-4 py-2.5 disabled:opacity-50"
                    >
                      {cur.id === chosenId ? '✓ Génération retenue' : 'Choisir cette génération'}
                    </button>
                  </div>
                )}
                <p className="text-white/70 text-[11.5px] text-center">
                  {multi
                    ? 'Glisse pour comparer · une seule génération retenue par taille — c’est elle qu’on décline en Marketplace'
                    : 'Glisse pour comparer · Échap ou clic autour pour fermer'}
                </p>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
