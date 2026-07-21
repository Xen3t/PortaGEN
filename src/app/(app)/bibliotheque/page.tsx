'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import DecorStudio from '@/components/DecorStudio'

/**
 * « Décors » (ex-Bibliothèque, renommée le 13/07/2026 — demande Mathias) :
 * recherche, filtres, statuts, favoris et génération de nouveaux décors.
 * Les onglets Moodboards et Produits ont été supprimés (ils ne servaient à
 * rien) ; la page est désormais dans la nav principale, après Catalogue.
 * L'adresse reste /bibliotheque car des liens internes pointent dessus.
 */

interface Decor {
  id: number
  file_path: string
  name: string
  slug: string
  gamme: string | null
  type: 'battant' | 'coulissant' | 'portillon'
  angle: 'face' | 'angle'
  status: 'a_valider' | 'actif' | 'archive'
  image_size: string | null
  width: number | null
  height: number | null
  moodboard_path: string | null
  job_id: number | null
  created_at: string
  tags: string[]
  favorite: boolean
  lastUsedAt: string | null
  lastUsedJobId: number | null
  versionCount: number
}

interface MoodboardEntry {
  path: string
  name: string
}

const TYPE_LABELS: Record<Decor['type'], string> = {
  battant: 'Battant',
  coulissant: 'Coulissant',
  portillon: 'Portillon',
}
const ANGLE_LABELS: Record<Decor['angle'], string> = { face: 'Face', angle: 'Angle' }
const STATUS_LABELS: Record<Decor['status'], string> = {
  a_valider: 'À valider',
  actif: 'Actif',
  archive: 'Archivé',
}
const STATUS_STYLES: Record<Decor['status'], string> = {
  a_valider: 'bg-brand-teal-light text-brand-teal',
  actif: 'bg-brand-green-light text-brand-green',
  archive: 'bg-surface text-text-secondary',
}

const PAGE_SIZE = 12

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function Star({ on, onClick }: { on: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title={on ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`text-lg leading-none ${on ? 'text-brand-teal' : 'text-text-disabled hover:text-brand-teal'}`}
    >
      ★
    </button>
  )
}

export default function BibliothequePage() {
  const router = useRouter()
  const [decors, setDecors] = useState<Decor[]>([])
  const [moodboards, setMoodboards] = useState<MoodboardEntry[]>([])
  const [gammes, setGammes] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // — onglet Décors —
  const [search, setSearch] = useState('')
  const [fGamme, setFGamme] = useState('')
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('actif')
  const [sort, setSort] = useState<'recent' | 'ancien' | 'nom' | 'utilise'>('recent')
  const [selected, setSelected] = useState<number[]>([])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [bulkForm, setBulkForm] = useState<'tag' | 'gamme' | null>(null)
  const [bulkValue, setBulkValue] = useState('')

  // — génération d'un nouveau décor —
  const [genOpen, setGenOpen] = useState(false)
  const [moodboard, setMoodboard] = useState('')
  const [newGamme, setNewGamme] = useState('')
  const [newName, setNewName] = useState('')
  const [decorSize, setDecorSize] = useState<'2K' | '4K'>('2K')
  const [tirages, setTirages] = useState(1)
  const [busy, setBusy] = useState(false)
  const [mbZoom, setMbZoom] = useState<string | null>(null)

  // — atelier décor (fenêtre plein écran : création et modification) —
  const [studio, setStudio] = useState<{ jobIds?: number[]; decorId?: number } | null>(null)

  // — générations de décors en cours (sessions-v2, 13/07/2026 : la page
  //   Production a disparu, les décors hors gamme se suivent ICI) —
  const [runningJobs, setRunningJobs] = useState<{ id: number; label: string }[]>([])
  useEffect(() => {
    let alive = true
    const poll = () =>
      fetch('/api/jobs?limit=50')
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return
          const jobs = (d.jobs ?? []) as {
            id: number
            type: string
            status: string
            batchId: string | null
            payload: Record<string, unknown> | null
          }[]
          setRunningJobs(
            jobs
              .filter(
                (j) =>
                  (j.type === 'decor' || j.type === 'decor-fix') &&
                  (j.status === 'queued' || j.status === 'running') &&
                  !j.batchId &&
                  j.payload?.lab !== true
              )
              .map((j) => ({
                id: j.id,
                label:
                  j.type === 'decor-fix'
                    ? 'Correction de décor'
                    : String(j.payload?.name ?? j.payload?.slug ?? 'Décor'),
              }))
          )
        })
        .catch(() => {})
    poll()
    const t = setInterval(poll, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const load = useCallback(() => {
    fetch('/api/decors')
      .then((r) => r.json())
      .then((d) => {
        setDecors(d.decors ?? [])
        setMoodboards(d.moodboards ?? [])
        setGammes(d.gammes ?? [])
        setAllTags(d.tags ?? [])
        setIsAdmin(d.role === 'admin')
        if (d.moodboards?.length) setMoodboard((cur) => cur || d.moodboards[0].path)
      })
  }, [])
  useEffect(load, [load])

  const detail = decors.find((d) => d.id === detailId) ?? null

  // Filtres + tri de l'onglet Décors
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = decors.filter((d) => {
      if (q) {
        const hay = `${d.name} ${d.slug} ${d.gamme ?? ''} ${d.tags.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (fGamme && (d.gamme ?? '') !== fGamme) return false
      if (fType && d.type !== fType) return false
      if (fStatus && d.status !== fStatus) return false
      return true
    })
    list = [...list].sort((a, b) => {
      if (sort === 'nom') return a.name.localeCompare(b.name, 'fr')
      if (sort === 'ancien') return a.created_at.localeCompare(b.created_at)
      if (sort === 'utilise') return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')
      return b.created_at.localeCompare(a.created_at)
    })
    return list
  }, [decors, search, fGamme, fType, fStatus, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(() => {
    if (page > pageCount) setPage(1)
  }, [page, pageCount])

  // « Utiliser ce décor » : la Génération s'ouvre avec ce décor présélectionné
  // (rebranché 20/07/2026 — l'ancien flux /creer?decor= n'existe plus).
  function applyDecor(d: Decor) {
    router.push(`/generation?decor=${d.id}`)
  }

  async function patchDecor(id: number, fields: Record<string, unknown>) {
    const res = await fetch(`/api/decors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
      return false
    }
    load()
    return true
  }

  async function toggleFav(d: Decor, e: React.MouseEvent) {
    e.stopPropagation()
    setDecors((cur) => cur.map((x) => (x.id === d.id ? { ...x, favorite: !x.favorite } : x)))
    await fetch(`/api/decors/${d.id}/favorite`, { method: 'POST' })
  }

  async function removeDecor(d: Decor) {
    if (!window.confirm(`Supprimer définitivement « ${d.name} » ?\nLe fichier sera effacé du disque.`)) return
    const res = await fetch(`/api/decors/${d.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setNotice(data?.error ?? `Erreur ${res.status}`)
      return
    }
    setNotice(`« ${d.name} » supprimé.`)
    if (detailId === d.id) setDetailId(null)
    load()
  }

  async function runBulk(action: 'archive' | 'tag' | 'gamme' | 'delete', value?: string) {
    if (action === 'delete') {
      if (!window.confirm(`Supprimer définitivement ${selected.length} décor(s) ?\nLes fichiers seront effacés du disque.`)) return
    }
    const body: Record<string, unknown> = { ids: selected, action }
    if (action === 'tag') body.tags = (value ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    if (action === 'gamme') body.gamme = value
    const res = await fetch('/api/decors/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
      return
    }
    let msg = `${data.done} décor(s) traité(s).`
    if (data.skipped?.length) {
      msg += ` Non supprimés (déjà utilisés par une génération validée — archivez-les) : ${data.skipped.join(', ')}.`
    }
    setNotice(msg)
    setSelected([])
    setBulkForm(null)
    setBulkValue('')
    load()
  }

  async function launchDecor() {
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/decor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moodboardPath: moodboard,
        imageSize: decorSize,
        gamme: newGamme || null,
        name: newName || null,
        count: tirages,
      }),
    })
    setBusy(false)
    const data = await res.json().catch(() => null)
    if (res.ok) {
      setNewName('')
      // Le moment le plus important : l'atelier s'ouvre et suit la génération en direct.
      setStudio({ jobIds: data.jobIds ?? [data.jobId] })
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  function toggleSelected(id: number) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div>
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">Décors</h1>
        <p className="text-sm text-text-secondary mt-1">
          Recherchez, triez et générez les décors utilisés pour les mises en situation.
        </p>
      </div>

      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[12px] px-4 py-3 flex justify-between gap-4">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-brand-teal hover:text-brand-teal-hover">✕</button>
        </div>
      )}

      {/* Générations de décors en cours — masqué quand rien ne tourne */}
      {runningJobs.length > 0 && !studio && (
        <div className="bg-white rounded-[12px] border border-border shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="inline-block animate-spin h-4 w-4 border-[3px] border-brand-teal-light border-t-brand-teal rounded-full" />
          <span className="text-sm font-semibold">
            {runningJobs.length} génération{runningJobs.length > 1 ? 's' : ''} de décor en cours
          </span>
          <span className="text-xs text-text-secondary truncate">
            {runningJobs.map((j) => j.label).join(' · ')}
          </span>
          <button
            onClick={() => setStudio({ jobIds: runningJobs.map((j) => j.id) })}
            className="ml-auto text-sm font-bold text-brand-teal hover:underline"
          >
            Suivre dans l&apos;atelier →
          </button>
        </div>
      )}

      <div className="space-y-4">
          {/* Générer un nouveau décor */}
          <section className="bg-white rounded-[12px] border border-border shadow-sm p-5">
            <button onClick={() => setGenOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
              <span className="font-semibold text-sm">✨ Générer un nouveau décor</span>
              <span className={`text-text-disabled transition-transform ${genOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {genOpen && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="grow min-w-56">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Moodboard</label>
                  <select title="Moodboard" value={moodboard} onChange={(e) => setMoodboard(e.target.value)} className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors">
                    {moodboards.map((m) => (
                      <option key={m.path} value={m.path}>{m.name}</option>
                    ))}
                    {moodboards.length === 0 && <option value="">— aucun moodboard —</option>}
                  </select>
                </div>
                <div className="min-w-44">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Gamme (facultatif)</label>
                  <input list="gammes-list" value={newGamme} onChange={(e) => setNewGamme(e.target.value)} placeholder="ex. Background 1 – MES VOGEL" className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors" />
                  <datalist id="gammes-list">
                    {gammes.map((r) => <option key={r} value={r} />)}
                  </datalist>
                </div>
                <div className="min-w-44">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Nom (facultatif)</label>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="auto si vide" className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Qualité</label>
                  <select title="Qualité" value={decorSize} onChange={(e) => setDecorSize(e.target.value as '2K' | '4K')} className="border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors">
                    <option value="2K">2K (standard)</option>
                    <option value="4K">4K (maximum)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1" title="Plusieurs propositions du même moodboard, à trier ensuite">Propositions</label>
                  <select title="Nombre de propositions" value={tirages} onChange={(e) => setTirages(Number(e.target.value))} className="border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors">
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <button onClick={launchDecor} disabled={busy || !moodboard} className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy ? 'Lancement…' : tirages > 1 ? `Générer ${tirages} propositions` : 'Générer le décor'}
                </button>
                {moodboard && (
                  <figure className="w-full">
                    <button
                      onClick={() => setMbZoom(moodboard)}
                      title="Cliquez pour voir le moodboard en grand"
                      className="block cursor-zoom-in"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl(moodboard, 1024)}
                        alt="Aperçu du moodboard"
                        loading="lazy"
                        decoding="async"
                        className="w-full max-w-2xl rounded-[8px] border border-border"
                      />
                    </button>
                    <figcaption className="text-xs text-text-disabled mt-1">
                      Aperçu du moodboard — cliquez pour l&apos;agrandir.
                    </figcaption>
                  </figure>
                )}
              </div>
            )}
          </section>

          {/* Recherche + filtres */}
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="🔍 Rechercher un décor (nom, gamme, tag)…"
              className="grow min-w-64 border border-border bg-white rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors"
            />
            <select title="Filtrer par gamme" value={fGamme} onChange={(e) => { setFGamme(e.target.value); setPage(1) }} className="border border-border bg-white rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors">
              <option value="">Gamme : toutes</option>
              {gammes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select title="Filtrer par type" value={fType} onChange={(e) => { setFType(e.target.value); setPage(1) }} className="border border-border bg-white rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors">
              <option value="">Type : tous</option>
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select title="Filtrer par statut" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1) }} className="border border-border bg-white rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors">
              <option value="">Statut : tous</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select title="Trier" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="border border-border bg-white rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors">
              <option value="recent">Tri : plus récents</option>
              <option value="ancien">Tri : plus anciens</option>
              <option value="nom">Tri : nom A→Z</option>
              <option value="utilise">Tri : derniers utilisés</option>
            </select>
            <button
              onClick={() =>
                setSelected((cur) =>
                  cur.length === filtered.length ? [] : filtered.map((d) => d.id)
                )
              }
              disabled={filtered.length === 0}
              title="Sélectionne tous les décors correspondant aux filtres, toutes pages confondues"
              className="border border-border bg-white text-text-secondary rounded-[8px] px-3 py-2 text-sm hover:bg-surface transition-colors disabled:opacity-50"
            >
              {selected.length === filtered.length && filtered.length > 0
                ? '☑ Tout désélectionner'
                : `☐ Tout sélectionner (${filtered.length})`}
            </button>
          </div>

          {/* Barre d'actions groupées */}
          {selected.length > 0 && (
            <div className="bg-white rounded-[12px] border border-border shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{selected.length} décor{selected.length > 1 ? 's' : ''} sélectionné{selected.length > 1 ? 's' : ''}</span>
              <button onClick={() => runBulk('archive')} className="bg-white border border-border text-text-secondary rounded-[10px] px-3 py-1.5 text-sm hover:bg-surface transition-colors">Archiver</button>
              <button onClick={() => { setBulkForm(bulkForm === 'tag' ? null : 'tag'); setBulkValue('') }} className="bg-white border border-border text-text-secondary rounded-[10px] px-3 py-1.5 text-sm hover:bg-surface transition-colors">Taguer</button>
              <button onClick={() => { setBulkForm(bulkForm === 'gamme' ? null : 'gamme'); setBulkValue('') }} className="bg-white border border-border text-text-secondary rounded-[10px] px-3 py-1.5 text-sm hover:bg-surface transition-colors">Changer la gamme</button>
              {isAdmin && (
                <button onClick={() => runBulk('delete')} className="border border-border text-brand-red rounded-[10px] px-3 py-1.5 text-sm hover:bg-brand-red-light transition-colors">🗑 Supprimer</button>
              )}
              {bulkForm && (
                <span className="inline-flex items-center gap-2">
                  <input
                    autoFocus
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    list={bulkForm === 'gamme' ? 'gammes-list-bulk' : 'tags-list-bulk'}
                    placeholder={bulkForm === 'tag' ? 'tags séparés par des virgules' : 'nom de la gamme'}
                    className="border border-border bg-surface rounded-[8px] px-2 py-1.5 text-sm w-64 focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                    onKeyDown={(e) => { if (e.key === 'Enter' && bulkValue.trim()) runBulk(bulkForm, bulkValue) }}
                  />
                  <datalist id="gammes-list-bulk">{gammes.map((r) => <option key={r} value={r} />)}</datalist>
                  <datalist id="tags-list-bulk">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
                  <button onClick={() => bulkValue.trim() && runBulk(bulkForm, bulkValue)} className="bg-brand-green text-white font-bold rounded-[10px] px-3 py-1.5 text-sm hover:bg-brand-green-hover transition-colors">OK</button>
                </span>
              )}
              <button onClick={() => setSelected([])} className="ml-auto text-sm text-text-disabled hover:text-text-secondary">Tout désélectionner</button>
            </div>
          )}

          <div className="flex gap-5 items-start">
            {/* Grille */}
            <div className="flex-1">
              <div className={`grid gap-4 ${detail ? 'grid-cols-2 xl:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'}`}>
                {pageItems.map((d) => {
                  const isSel = selected.includes(d.id)
                  return (
                    <div
                      key={d.id}
                      onClick={() => setDetailId(d.id)}
                      className={`bg-white rounded-[12px] overflow-hidden cursor-pointer border-2 shadow-sm transition-all duration-200 ${
                        isSel || detailId === d.id ? 'border-brand-green' : 'border-transparent hover:shadow-default hover:translate-y-[-1px]'
                      }`}
                    >
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgUrl(d.file_path, 480)} alt={d.name} loading="lazy" decoding="async" className="w-full aspect-[3/2] object-cover" />
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSelected(d.id) }}
                          title="Sélectionner"
                          className={`absolute top-2 left-2 w-6 h-6 rounded-[8px] border-2 flex items-center justify-center text-xs font-bold ${
                            isSel ? 'bg-brand-green border-brand-green text-white' : 'bg-white/90 border-border text-transparent hover:border-brand-green'
                          }`}
                        >
                          ✓
                        </button>
                        {d.image_size && (
                          <span className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">{d.image_size}</span>
                        )}
                      </div>
                      <div className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" title={d.name}>{d.name}</p>
                          <p className="text-xs text-text-disabled truncate">{d.gamme ?? 'Sans gamme'}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[d.status]}`}>{STATUS_LABELS[d.status]}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setStudio({ decorId: d.id }) }}
                            title="Modifier (atelier : correction par prompt, versions)"
                            className="text-text-disabled hover:text-brand-teal"
                          >
                            ✎
                          </button>
                          <Star on={d.favorite} onClick={(e) => toggleFav(d, e)} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                {pageItems.length === 0 && (
                  <p className="col-span-full text-sm text-text-secondary py-8 text-center">Aucun décor ne correspond à ces filtres.</p>
                )}
              </div>

              {/* Pagination + compte */}
              <div className="flex items-center justify-between mt-4 text-sm text-text-secondary">
                <span>
                  {filtered.length} décor{filtered.length > 1 ? 's' : ''}
                  {selected.length > 0 ? ` · ${selected.length} sélectionné${selected.length > 1 ? 's' : ''}` : ''}
                </span>
                {pageCount > 1 && (
                  <span className="inline-flex items-center gap-2">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="border border-border rounded-full w-7 h-7 disabled:opacity-40 hover:bg-surface transition-colors">‹</button>
                    {page} / {pageCount}
                    <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} className="border border-border rounded-full w-7 h-7 disabled:opacity-40 hover:bg-surface transition-colors">›</button>
                  </span>
                )}
              </div>
            </div>

            {/* Panneau de détails */}
            {detail && (
              <DetailPanel
                key={detail.id}
                decor={detail}
                gammes={gammes}
                allTags={allTags}
                isAdmin={isAdmin}
                onClose={() => setDetailId(null)}
                onPatch={(fields) => patchDecor(detail.id, fields)}
                onFav={(e) => toggleFav(detail, e)}
                onUse={() => applyDecor(detail)}
                onDelete={() => removeDecor(detail)}
                onOpenStudio={() => setStudio({ decorId: detail.id })}
              />
            )}
          </div>
      </div>

      {mbZoom && (
        <button
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setMbZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgUrl(mbZoom)} alt="Moodboard en grand" className="max-w-full max-h-full object-contain" />
        </button>
      )}

      {studio && (
        <DecorStudio
          jobIds={studio.jobIds}
          decorId={studio.decorId}
          isAdmin={isAdmin}
          onClose={() => {
            setStudio(null)
            load()
          }}
          onChanged={load}
          onUse={(id) => router.push(`/generation?decor=${id}`)}
        />
      )}
    </div>
  )
}

function DetailPanel({
  decor,
  gammes,
  allTags,
  isAdmin,
  onClose,
  onPatch,
  onFav,
  onUse,
  onDelete,
  onOpenStudio,
}: {
  decor: Decor
  gammes: string[]
  allTags: string[]
  isAdmin: boolean
  onClose: () => void
  onPatch: (fields: Record<string, unknown>) => Promise<boolean>
  onFav: (e: React.MouseEvent) => void
  onUse: () => void
  onDelete: () => void
  onOpenStudio: () => void
}) {
  const [name, setName] = useState(decor.name)
  const [gamme, setGamme] = useState(decor.gamme ?? '')
  const [tagInput, setTagInput] = useState('')

  async function addTag() {
    const t = tagInput.trim()
    if (!t) return
    setTagInput('')
    await onPatch({ tags: [...decor.tags, t] })
  }

  return (
    <aside className="w-[340px] shrink-0 bg-white rounded-[16px] border border-border shadow-sm overflow-hidden sticky top-20">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-medium">Détails du décor</h2>
        <button onClick={onClose} className="text-text-disabled hover:text-text-secondary">✕</button>
      </div>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imgUrl(decor.file_path, 768)} alt={decor.name} loading="lazy" decoding="async" className="w-full aspect-[3/2] object-cover" />
        {decor.image_size && (
          <span className="absolute top-2 left-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">{decor.image_size}</span>
        )}
      </div>
      <div className="p-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium truncate" title={decor.name}>{decor.name}</p>
            <p className="text-xs text-text-disabled">
              {decor.width && decor.height ? `${decor.width}×${decor.height} px · ` : ''}créé le {fmtDate(decor.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[decor.status]}`}>{STATUS_LABELS[decor.status]}</span>
            <Star on={decor.favorite} onClick={onFav} />
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">✏ Nom</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== decor.name && onPatch({ name })}
            className="mt-1 w-full border border-border bg-surface rounded-[8px] px-2 py-1.5 focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">▦ Gamme</span>
          <input
            list="gammes-detail"
            value={gamme}
            onChange={(e) => setGamme(e.target.value)}
            onBlur={() => (gamme || null) !== (decor.gamme ?? null) && onPatch({ gamme: gamme || null })}
            placeholder="Sans gamme"
            className="mt-1 w-full border border-border bg-surface rounded-[8px] px-2 py-1.5 focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
          />
          <datalist id="gammes-detail">{gammes.map((r) => <option key={r} value={r} />)}</datalist>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Type</span>
            <select value={decor.type} onChange={(e) => onPatch({ type: e.target.value })} className="mt-1 w-full border border-border bg-surface rounded-[8px] px-2 py-1.5 focus:outline-none focus:border-brand-green focus:bg-white transition-colors">
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Angle</span>
            <select value={decor.angle} onChange={(e) => onPatch({ angle: e.target.value })} className="mt-1 w-full border border-border bg-surface rounded-[8px] px-2 py-1.5 focus:outline-none focus:border-brand-green focus:bg-white transition-colors">
              {Object.entries(ANGLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div>
          <span className="text-xs font-medium text-text-secondary">🏷 Tags</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {decor.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 bg-surface text-text-secondary rounded-[8px] px-2 py-0.5 text-xs">
                {t}
                <button onClick={() => onPatch({ tags: decor.tags.filter((x) => x !== t) })} className="text-text-disabled hover:text-brand-red">×</button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
              onBlur={addTag}
              list="tags-detail"
              placeholder="+ tag"
              className="border border-dashed border-border bg-surface rounded-[8px] px-2 py-0.5 text-xs w-24 focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
            <datalist id="tags-detail">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Statut</span>
          <select
            value={decor.status}
            onChange={(e) => onPatch({ status: e.target.value })}
            className="mt-1 w-full border border-border bg-surface rounded-[8px] px-2 py-1.5 focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
          >
            <option value="a_valider">À valider</option>
            <option value="actif" disabled={!isAdmin && decor.status !== 'actif'}>
              Actif{isAdmin || decor.status === 'actif' ? '' : ' (validation admin)'}
            </option>
            <option value="archive">Archivé</option>
          </select>
        </label>

        <div>
          <span className="text-xs font-medium text-text-secondary">📅 Dernière utilisation</span>
          <p className="mt-0.5 text-text-secondary">
            {decor.lastUsedAt ? (
              <>
                {fmtDate(decor.lastUsedAt)}
                {decor.lastUsedJobId && (
                  <> — <a href={`/production/image/${decor.lastUsedJobId}`} className="text-brand-teal hover:underline">génération #{decor.lastUsedJobId}</a></>
                )}
              </>
            ) : (
              'Jamais utilisé'
            )}
          </p>
        </div>

        <div className="border-t border-border pt-3">
          <button
            onClick={onOpenStudio}
            className="w-full bg-white border border-border text-text-secondary rounded-[10px] py-2 text-sm font-medium hover:bg-surface transition-colors"
          >
            🪄 Modifier ce décor{decor.versionCount > 1 ? ` (${decor.versionCount} versions)` : ''}
          </button>
          <p className="text-[11px] text-text-disabled mt-1 text-center">
            Correction par prompt, historique des versions, retour arrière — en grand.
          </p>
        </div>
      </div>
      <div className="p-4 pt-0 space-y-2">
        <button
          onClick={onUse}
          disabled={decor.status !== 'actif'}
          title={decor.status !== 'actif' ? 'Seul un décor actif peut être utilisé' : undefined}
          className="w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
        >
          Utiliser ce décor →
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onPatch({ status: decor.status === 'archive' ? 'a_valider' : 'archive' })}
            className="bg-white border border-border text-text-secondary rounded-[10px] py-2 text-sm hover:bg-surface transition-colors"
          >
            {decor.status === 'archive' ? 'Désarchiver' : '⬛ Archiver'}
          </button>
          {isAdmin ? (
            <button onClick={onDelete} className="border border-border text-brand-red rounded-[10px] py-2 text-sm hover:bg-brand-red-light transition-colors">
              🗑 Supprimer
            </button>
          ) : (
            <span className="text-[11px] text-text-disabled self-center text-center">Suppression : admin</span>
          )}
        </div>
      </div>
    </aside>
  )
}
