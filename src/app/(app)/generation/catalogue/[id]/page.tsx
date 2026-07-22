'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { familyTitle } from '../../../catalogue/catalogueUi'
import { PictoIllu } from '../../../Silhouette'

/**
 * « Depuis le catalogue » — étape 2 : quelles tailles ? (rework 22/07/2026,
 * maquette generer-depuis-catalogue-v3 validée par Mathias).
 *
 * On coche les tailles à mettre en situation, coloris par coloris. RÈGLE
 * PERMANENTE (rappel Mathias 22/07) : une largeur = UNE ligne, retour à la
 * ligne quand la largeur change, colonnes alignées par hauteur, taille absente
 * = case vide alignée — libellés en nomenclature (300B140). Les cases qui ont
 * déjà une MES portent un badge « n MES » + aperçu au survol ; une nouvelle
 * génération REMPLACE la MES locale affichée sur la fiche (modèle actuel).
 *
 * Le lancement réutilise l'API de la fiche produit (/api/catalogue/[id]/generer,
 * une case = un appel, batchId partagé = une seule session sur l'Accueil), puis
 * ouvre la session (/production/gamme/[batchId]).
 */

interface ColorisSummary {
  coloris: string
  kitRef: string | null
  colorCode: string | null
  faceJpg: string | null
  facePng: string | null
  detectedColoris?: string | null
}
interface SizeSummary {
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
  family: string
  name: string
  summary: { sizes: SizeSummary[]; mes: MesEntry[] }
  colorisOverrides?: Record<string, string>
}
interface ProductGeneration {
  size: string
  coloris: string
  format: string
  status: string
  deliveryPath: string | null
  updatedAt: string | null
}
interface DecorEntry {
  id: number
  name: string
  status: string
  type: string
}
interface ColorisSettings {
  decorId: number | null
  decorXlId: number | null
}

const SITE_FORMAT = '2000x1330'

/** B battant · C coulissant · P portillon (nomenclature maison). */
function familyLetter(family: string): string {
  const f = family.toUpperCase()
  if (f.includes('COULISSANT')) return 'C'
  if (f.includes('PORTILLON')) return 'P'
  return 'B'
}

/** Identifiant de lot partagé par toutes les cases du lancement (comme la fiche). */
function newBatchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Temps relatif court depuis un datetime SQLite UTC. */
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

interface CellRef {
  w: number
  h: number
  sizeLabel: string
  faceJpg: string | null
  facePng: string | null
}
interface Group {
  coloris: string
  displayColoris: string
  cells: Map<string, CellRef> // clé « WxH »
  widths: number[]
  heights: number[]
}

export default function GenerationDepuisCataloguePage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(props.params)
  const router = useRouter()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generations, setGenerations] = useState<ProductGeneration[]>([])
  const [decors, setDecors] = useState<DecorEntry[]>([])
  const [detStatus, setDetStatus] = useState<Record<string, string>>({})
  const [selection, setSelection] = useState<Set<string>>(new Set()) // « coloris|WxH »
  // Réglages par défaut de la fiche (décor par coloris) + choix du décor PAR
  // COLORIS pour ce lancement (demande Mathias 22/07 : « réglage coloris blanc,
  // réglage coloris gris » en tête de carte — pas un réglage global).
  const [reglages, setReglages] = useState<Record<string, ColorisSettings>>({})
  const [decorParColoris, setDecorParColoris] = useState<Record<string, 'defaut' | number>>({})
  const [launching, setLaunching] = useState(false)
  const [launchErrors, setLaunchErrors] = useState<string[]>([])
  const [launchedBatch, setLaunchedBatch] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/catalogue/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `Erreur ${r.status}`)
        return r.json()
      })
      .then((d: Detail) => setDetail(d))
      .catch((e) => setError(e.message))
    fetch(`/api/catalogue/${id}/generations`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setGenerations(d.generations as ProductGeneration[]))
      .catch(() => undefined)
    fetch('/api/decors')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDecors((d.decors as DecorEntry[]).filter((x) => x.status === 'actif')))
      .catch(() => undefined)
    fetch(`/api/catalogue/${id}/reglages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setReglages(d.settings as Record<string, ColorisSettings>))
      .catch(() => undefined)
    fetch(`/api/catalogue/${id}/detourage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const m: Record<string, string> = {}
        for (const q of d.queue as { coloris: string; size: string; status: string }[]) {
          m[`${q.coloris}|${q.size}`] = q.status
        }
        setDetStatus(m)
      })
      .catch(() => undefined)
  }, [id])

  /* ——— regroupement par coloris (même logique que la fiche, simplifiée) ——— */
  const groups: Group[] = useMemo(() => {
    if (!detail) return []
    const byColoris = new Map<string, Map<string, CellRef>>()
    const detected = new Map<string, string>()
    for (const size of detail.summary.sizes) {
      for (const c of size.coloris) {
        if (!byColoris.has(c.coloris)) byColoris.set(c.coloris, new Map())
        if (c.detectedColoris && !detected.has(c.coloris)) detected.set(c.coloris, c.detectedColoris)
        byColoris.get(c.coloris)!.set(`${size.w}x${size.h}`, {
          w: size.w,
          h: size.h,
          sizeLabel: `${size.w}x${size.h}`,
          faceJpg: c.faceJpg,
          facePng: c.facePng,
        })
      }
    }
    const overrides = detail.colorisOverrides ?? {}
    return Array.from(byColoris.entries())
      .map(([coloris, cells]) => {
        const widths = [...new Set([...cells.values()].map((c) => c.w))].sort((a, b) => a - b)
        const heights = [...new Set([...cells.values()].map((c) => c.h))].sort((a, b) => a - b)
        return {
          coloris,
          displayColoris:
            overrides[coloris] ??
            (coloris === 'non précisé' ? (detected.get(coloris) ?? coloris) : coloris),
          cells,
          widths,
          heights,
        }
      })
      .sort((a, b) => b.cells.size - a.cells.size || a.coloris.localeCompare(b.coloris))
  }, [detail])

  /** Coloris « hôte » des MES serveur sans coloris identifiable (règle fiche 13/07). */
  const orphanHost = useMemo(() => {
    const gris = groups.find((g) => /gris/i.test(g.displayColoris))
    return gris?.coloris ?? groups[0]?.coloris ?? null
  }, [groups])

  /** MES existantes d'une case : la locale (générée par PortaGEN) + celles du serveur. */
  const mesOfCell = useCallback(
    (coloris: string, sizeLabel: string) => {
      const local = generations.find(
        (g) =>
          g.coloris === coloris &&
          g.size === sizeLabel &&
          g.format === SITE_FORMAT &&
          g.status === 'done' &&
          g.deliveryPath
      )
      const server = (detail?.summary.mes ?? []).filter(
        (m) =>
          m.format === SITE_FORMAT &&
          m.size === sizeLabel &&
          (m.coloris === coloris || (m.coloris === null && coloris === orphanHost))
      )
      const count = server.length + (local ? 1 : 0)
      const preview = local
        ? {
            url: `/api/artifacts?p=${encodeURIComponent(local.deliveryPath!)}&w=240`,
            note: local.updatedAt ? `générée ${relTime(local.updatedAt)}` : 'générée par PortaGEN',
          }
        : server[0]
          ? {
              url: `/api/catalogue/${id}/fichier?p=${encodeURIComponent(server[0].file)}&w=240`,
              note: 'MES du serveur',
            }
          : null
      return { count, preview }
    },
    [generations, detail, orphanHost, id]
  )

  const generable = useCallback(
    (coloris: string, cell: CellRef) => {
      const s = detStatus[`${coloris}|${cell.sizeLabel}`]
      return s === 'valide' || s === 'importe' || cell.facePng !== null
    },
    [detStatus]
  )

  const cellKey = (coloris: string, sizeLabel: string) => `${coloris}|${sizeLabel}`

  function basculer(coloris: string, sizeLabel: string) {
    setSelection((cur) => {
      const n = new Set(cur)
      const k = cellKey(coloris, sizeLabel)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }

  function toutColoris(g: Group) {
    setSelection((cur) => {
      const n = new Set(cur)
      for (const cell of g.cells.values()) {
        if (generable(g.coloris, cell)) n.add(cellKey(g.coloris, cell.sizeLabel))
      }
      return n
    })
  }

  const avecMes = useMemo(
    () =>
      [...selection].filter((k) => {
        const [coloris, sizeLabel] = k.split('|')
        return mesOfCell(coloris, sizeLabel).count > 0
      }).length,
    [selection, mesOfCell]
  )

  /* ——— lancement : un appel par case, batch partagé, puis la session ——— */
  async function lancer() {
    if (selection.size === 0 || launching) return
    setLaunching(true)
    setLaunchErrors([])
    setLaunchedBatch(null)
    const batchId = newBatchId()
    const errors: string[] = []
    let launched = 0
    for (const k of selection) {
      const [coloris, sizeLabel] = k.split('|')
      const [w, h] = sizeLabel.split('x').map(Number)
      const choix = decorParColoris[coloris] ?? 'defaut'
      try {
        const r = await fetch(`/api/catalogue/${id}/generer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coloris,
            size: { w, h },
            format: SITE_FORMAT,
            batchId,
            decorId: choix !== 'defaut' ? choix : undefined,
          }),
        })
        const d = await r.json().catch(() => null)
        if (!r.ok) {
          errors.push(
            d?.code === 'reglages_manquants'
              ? `${coloris} · ${sizeLabel} : pas de décor — choisis-en un en tête de la carte ${coloris.toLowerCase()}.`
              : `${coloris} · ${sizeLabel} : ${d?.error ?? 'échec du lancement.'}`
          )
        } else {
          launched += 1
        }
      } catch {
        errors.push(`${coloris} · ${sizeLabel} : erreur réseau.`)
      }
    }
    setLaunching(false)
    if (errors.length === 0 && launched > 0) {
      router.push(`/production/gamme/${batchId}`)
      return
    }
    setLaunchErrors(errors)
    if (launched > 0) setLaunchedBatch(batchId)
  }

  if (error) {
    return (
      <p className="text-text-secondary">
        {error}{' '}
        <Link href="/generation/catalogue" className="text-brand-teal hover:underline">
          ← Retour au choix de la gamme
        </Link>
      </p>
    )
  }
  if (!detail) return <p className="text-sm text-text-secondary">Chargement…</p>

  const lettre = familyLetter(detail.family)
  const nomen = (w: number, h: number) => `${w}${lettre}${h}`

  return (
    <div className="max-w-6xl mx-auto">
      {/* chemin */}
      <div className="flex items-center gap-1 flex-wrap mb-5">
        <Link
          href="/generation/catalogue"
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
        <Link
          href="/generation/catalogue"
          className="text-sm font-semibold text-text-secondary px-2 py-1 rounded-[8px] hover:text-brand-green hover:bg-brand-green-light transition-colors"
        >
          Depuis le catalogue
        </Link>
        <span className="text-[#c9cfd6] text-[13px]">›</span>
        <span className="text-sm font-semibold text-text-secondary px-2 py-1">
          {familyTitle(detail.family)}
        </span>
        <span className="text-[#c9cfd6] text-[13px]">›</span>
        <span className="text-sm font-bold px-2 py-1">{detail.name}</span>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          {detail.name} <span className="text-brand-green">— quelles tailles ?</span>
        </h1>
        <Link
          href={`/catalogue/${id}`}
          target="_blank"
          className="text-sm font-semibold text-text-secondary bg-white border border-border rounded-full px-4 py-2 hover:text-brand-green hover:border-brand-green transition-colors"
        >
          Voir la fiche ↗
        </Link>
      </div>

      {/* ——— une carte par coloris — RÈGLE PERMANENTE : une largeur = une ligne ——— */}
      <div className="grid gap-4">
        {groups.map((g) => (
          <section
            key={g.coloris}
            className="bg-white rounded-[12px] border border-border shadow-sm p-5"
          >
            <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
              <span className="font-bold text-[15px]">{g.displayColoris}</span>
              <span className="text-xs text-text-disabled">
                {g.cells.size} taille{g.cells.size > 1 ? 's' : ''}
              </span>
              {/* Réglage DIFFÉRENCIÉ par coloris (demande Mathias 22/07) : le décor
                  de CE coloris pour CE lancement — défaut de la fiche prérempli. */}
              <label className="flex items-center gap-1.5 ml-3 text-[12.5px] font-semibold text-text-secondary">
                Décor {g.displayColoris.toLowerCase()} :
                <select
                  value={String(decorParColoris[g.coloris] ?? 'defaut')}
                  onChange={(e) =>
                    setDecorParColoris((cur) => ({
                      ...cur,
                      [g.coloris]: e.target.value === 'defaut' ? 'defaut' : Number(e.target.value),
                    }))
                  }
                  className="bg-white border border-border rounded-[8px] px-2 py-1 text-[12.5px] outline-none focus:border-brand-green"
                >
                  <option value="defaut">
                    {reglages[g.coloris]?.decorId != null
                      ? `Paramètres par défaut : ${
                          decors.find((d) => d.id === reglages[g.coloris]!.decorId)?.name ??
                          `décor n°${reglages[g.coloris]!.decorId}`
                        }`
                      : 'Paramètres par défaut — aucun décor !'}
                  </option>
                  {decors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.type === 'coulissant-xl' ? ' (XL)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {reglages[g.coloris]?.decorId == null &&
                (decorParColoris[g.coloris] ?? 'defaut') === 'defaut' && (
                  <span className="text-[11.5px] font-bold text-[#92580a] bg-[#fef3c7] rounded-full px-2.5 py-0.5">
                    ⚠ pas de décor par défaut — choisis-en un
                  </span>
                )}
              <button
                onClick={() => toutColoris(g)}
                className="ml-auto text-[12.5px] font-semibold text-brand-green hover:underline"
              >
                tout sélectionner
              </button>
            </div>
            <div className="grid gap-2">
              {g.widths.map((w) => (
                <div
                  key={w}
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${g.heights.length}, minmax(0, 1fr))` }}
                >
                  {g.heights.map((h) => {
                    const cell = g.cells.get(`${w}x${h}`)
                    if (!cell) {
                      // Taille absente de la gamme : case vide ALIGNÉE (jamais de repli).
                      return (
                        <div
                          key={h}
                          className="rounded-[8px] border-2 border-dashed border-border/70 min-h-[86px] grid place-items-center text-text-disabled text-xs"
                        >
                          —
                        </div>
                      )
                    }
                    const ok = generable(g.coloris, cell)
                    const mes = mesOfCell(g.coloris, cell.sizeLabel)
                    const selected = selection.has(cellKey(g.coloris, cell.sizeLabel))
                    const photo = cell.faceJpg ?? cell.facePng
                    if (!ok) {
                      return (
                        <div
                          key={h}
                          title="Pas de visuel détouré pour cette référence — détoure-la depuis la fiche."
                          className="rounded-[8px] border-2 border-dashed border-border min-h-[86px] flex flex-col items-center justify-center text-text-disabled text-xs gap-0.5"
                        >
                          <span>pas de photo</span>
                          <span className="font-bold">{nomen(w, h)}</span>
                        </div>
                      )
                    }
                    return (
                      <button
                        key={h}
                        onClick={() => basculer(g.coloris, cell.sizeLabel)}
                        className={`group relative rounded-[8px] border-2 text-center transition-all ${
                          selected
                            ? 'border-brand-green ring-2 ring-brand-green-light'
                            : 'border-border hover:border-brand-green'
                        }`}
                      >
                        {selected && (
                          <span className="absolute top-1.5 left-1.5 z-10 w-[18px] h-[18px] rounded-full bg-brand-green text-white text-[11px] font-bold grid place-items-center">
                            ✓
                          </span>
                        )}
                        {mes.count > 0 && (
                          <span
                            title={mes.preview ? `MES existante — ${mes.preview.note}` : undefined}
                            className={`absolute top-1.5 right-1.5 z-10 rounded-full text-[10px] font-bold px-1.5 py-px border ${
                              selected
                                ? 'bg-[#d97706] text-white border-[#d97706]'
                                : 'bg-[#fef3c7] text-[#92580a] border-[#ecd9a8]'
                            }`}
                          >
                            {mes.count} MES
                          </span>
                        )}
                        {/* Vignette (demande Mathias 22/07) : la MES existante quand
                            il y en a une, sinon la photo produit — et au survol,
                            l'inverse (la photo produit qui sera posée). */}
                        <span className="block h-[62px] overflow-hidden rounded-t-[6px] bg-surface">
                          {mes.preview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mes.preview.url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          ) : photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/catalogue/${id}/fichier?p=${encodeURIComponent(photo)}&w=240`}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-contain"
                            />
                          ) : null}
                        </span>
                        <span
                          className={`block text-[11px] font-bold py-1 ${
                            selected ? 'text-brand-green' : 'text-text-secondary'
                          }`}
                        >
                          {nomen(w, h)}
                        </span>
                        {/* Au survol : la photo produit (celle qui sera posée dans le décor). */}
                        {mes.preview && photo && (
                          <span className="pointer-events-none hidden group-hover:block absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-52 bg-white border border-border rounded-[10px] shadow-lg p-2 z-30 text-left">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/catalogue/${id}/fichier?p=${encodeURIComponent(photo)}&w=240`}
                              alt=""
                              className="w-full h-[84px] object-contain rounded-[6px] bg-surface"
                            />
                            <span className="block text-[11px] font-semibold text-text-secondary mt-1.5 leading-snug">
                              <b className="text-text-primary">Photo produit</b> — celle qui sera
                              posée dans le décor
                            </span>
                            {mes.count > 1 && (
                              <span className="block text-[10.5px] text-text-disabled mt-0.5">
                                {mes.count} MES existantes (voir la fiche)
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* ——— formats (le décor se règle en tête de chaque carte coloris) ——— */}
      <section className="bg-white rounded-[12px] border border-border shadow-sm p-5 mt-4">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
          Formats
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13.5px] font-semibold bg-brand-green-light text-brand-green rounded-full px-4 py-1.5">
            Site · 2000×1330
          </span>
          <span
            className="text-[13.5px] font-semibold bg-white border border-border text-text-disabled rounded-full px-4 py-1.5"
            title="La déclinaison Marketplace se fait après le Site, depuis la fiche produit."
          >
            Marketplace — après le Site, depuis la fiche
          </span>
        </div>
        <span className="block text-xs text-text-disabled mt-2">
          Un décor choisi en tête d&apos;une carte coloris vaut pour CE lancement — il ne change pas
          les réglages de la fiche.
        </span>
      </section>

      {launchErrors.length > 0 && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mt-4">
          <p className="font-bold mb-1">
            {launchedBatch
              ? 'Certaines cases n’ont pas pu partir :'
              : 'Aucune génération n’a pu partir :'}
          </p>
          <ul className="list-disc pl-5 space-y-0.5">
            {launchErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {launchedBatch && (
            <p className="mt-2">
              <Link
                href={`/production/gamme/${launchedBatch}`}
                className="font-bold underline hover:no-underline"
              >
                Voir la session des générations lancées →
              </Link>
            </p>
          )}
        </div>
      )}

      {/* ——— récap avant de lancer ——— */}
      <div className="sticky bottom-3 z-20 mt-5 bg-white rounded-[12px] border border-border shadow-lg px-5 py-3.5 flex items-center gap-4 flex-wrap">
        <span className="font-bold text-[15px]">
          {selection.size} taille{selection.size > 1 ? 's' : ''} sélectionnée
          {selection.size > 1 ? 's' : ''}
        </span>
        {avecMes > 0 && (
          <span className="bg-[#fef3c7] text-[#92580a] rounded-full text-[12.5px] font-bold px-3 py-1">
            ⚠ {avecMes} {avecMes > 1 ? 'ont' : 'a'} déjà une MES — la nouvelle la remplacera sur la
            fiche
          </span>
        )}
        <button
          onClick={lancer}
          disabled={selection.size === 0 || launching}
          className="group ml-auto bg-brand-green text-white rounded-full px-6 py-2.5 font-bold text-[15px] hover:bg-brand-green-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <PictoIllu name="generer" size={20} />
          {launching
            ? 'Lancement…'
            : selection.size > 0
              ? `Générer ${selection.size} MES`
              : 'Générer'}
        </button>
      </div>
    </div>
  )
}
