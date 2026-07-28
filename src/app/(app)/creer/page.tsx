'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import DecorStudio from '@/components/DecorStudio'

/**
 * « Créer » — flux guidé unique (refonte UX 10/07/2026). Une seule page, trois
 * étapes chaînées : 1. je choisis mon décor (ou j'en génère un), 2. je choisis
 * ma gamme de portails (tailles présélectionnées d'après les visuels
 * disponibles), 3. je vérifie et je lance. Tout le reste est automatique ;
 * la validation des images se fait dans Production.
 */

interface DecorEntry {
  id: number
  file_path: string
  name: string
  slug: string
  gamme: string | null
  status: string
  favorite: boolean
  image_size: string | null
}
interface MoodboardEntry {
  path: string
  name: string
}
interface SizeEntry {
  w: number
  h: number
  label: string
}
interface ProductEntry {
  path: string
  name: string
  group: string
  size: { w: number; h: number } | null
}
interface ProductGroup {
  name: string
  products: ProductEntry[]
}

const STEPS = ['Décor', 'Portails', 'Vérifier & lancer']

function imgUrl(p: string): string {
  return `/api/artifacts?p=${encodeURIComponent(p)}`
}

export default function CreerPage() {
  return (
    <Suspense>
      <CreerPageInner />
    </Suspense>
  )
}

function CreerPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep] = useState(0)
  const [decors, setDecors] = useState<DecorEntry[]>([])
  const [moodboards, setMoodboards] = useState<MoodboardEntry[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [sizes, setSizes] = useState<SizeEntry[]>([])
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [decor, setDecor] = useState<DecorEntry | null>(null)
  const [groupName, setGroupName] = useState('')
  const [selectedSizes, setSelectedSizes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // — génération d'un nouveau décor (panneau repliable de l'étape 1) —
  const [newDecorOpen, setNewDecorOpen] = useState(false)
  const [moodboard, setMoodboard] = useState('')
  const [decorSize, setDecorSize] = useState<'2K' | '4K'>('4K')
  const [tirages, setTirages] = useState(1)
  const [decorBusy, setDecorBusy] = useState(false)
  const [mbZoom, setMbZoom] = useState(false)
  const [studio, setStudio] = useState<{ jobIds: number[] } | null>(null)

  async function loadDecors(selectPath?: string) {
    const d = await fetch('/api/decors').then((r) => r.json())
    // Seuls les décors ACTIFS sont utilisables — favoris d'abord
    const actifs: DecorEntry[] = (d.decors ?? [])
      .filter((x: DecorEntry) => x.status === 'actif')
      .sort(
        (a: DecorEntry, b: DecorEntry) =>
          Number(b.favorite) - Number(a.favorite) || b.id - a.id
      )
    setDecors(actifs)
    setMoodboards(d.moodboards ?? [])
    setIsAdmin(d.role === 'admin')
    if (d.moodboards?.length) setMoodboard((cur) => cur || d.moodboards[0].path)
    if (selectPath) {
      const found = actifs.find((x) => x.file_path === selectPath)
      if (found) setDecor(found)
    }
    return actifs
  }

  useEffect(() => {
    const wanted = searchParams.get('decor')
    loadDecors().then((actifs) => {
      const fromUrl = wanted ? actifs.find((x) => x.file_path === wanted) : undefined
      setDecor(fromUrl ?? null)
      // Arrivée depuis la Bibliothèque avec un décor déjà choisi → étape 2 direct
      if (fromUrl) setStep(1)
    })
    fetch('/api/sizes')
      .then((r) => r.json())
      .then((d) => setSizes(d.sizes ?? []))
    loadProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadProducts(selectGroup?: string) {
    fetch('/api/products')
      .then((r) => r.json())
      .then((d) => {
        const gs: ProductGroup[] = d.groups ?? []
        setGroups(gs)
        setGroupName((cur) => selectGroup ?? (cur && gs.some((g) => g.name === cur) ? cur : gs[0]?.name ?? ''))
      })
  }

  const group = groups.find((g) => g.name === groupName) ?? null

  // Grille largeurs × hauteurs du référentiel (lecture « catalogue »)
  const widths = useMemo(() => [...new Set(sizes.map((s) => s.w))].sort((a, b) => a - b), [sizes])
  const heights = useMemo(() => [...new Set(sizes.map((s) => s.h))].sort((a, b) => a - b), [sizes])
  const sizeSet = useMemo(() => new Set(sizes.map((s) => s.label)), [sizes])

  /** label de taille → visuel produit de la gamme choisie (nomenclature du fichier). */
  const productBySize = useMemo(() => {
    const map = new Map<string, ProductEntry>()
    for (const p of group?.products ?? []) {
      if (p.size) map.set(`${p.size.w}x${p.size.h}`, p)
    }
    return map
  }, [group])

  // Présélection automatique : toutes les tailles du référentiel qui ont leur visuel produit.
  useEffect(() => {
    setSelectedSizes(sizes.filter((s) => productBySize.has(s.label)).map((s) => s.label))
  }, [sizes, productBySize])

  function toggleSize(label: string) {
    if (!productBySize.has(label)) return
    setSelectedSizes((cur) =>
      cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
    )
  }

  async function uploadProduct(file: File) {
    setUploadBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    if (groupName) fd.append('dir', groupName)
    const res = await fetch('/api/products', { method: 'POST', body: fd })
    const data = await res.json().catch(() => null)
    setUploadBusy(false)
    if (!res.ok) {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
      return
    }
    loadProducts(groupName || undefined)
  }

  async function launchNewDecor() {
    setDecorBusy(true)
    setNotice(null)
    const res = await fetch('/api/decor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moodboardPath: moodboard, imageSize: decorSize, count: tirages }),
    })
    setDecorBusy(false)
    const data = await res.json().catch(() => null)
    if (res.ok) {
      // L'atelier s'ouvre en grand et suit la génération en direct.
      setStudio({ jobIds: data.jobIds ?? [data.jobId] })
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function launch() {
    if (!decor || selectedSizes.length === 0) return
    setBusy(true)
    setNotice(null)
    const items = selectedSizes.map((label) => {
      const [w, h] = label.split('x').map(Number)
      return { size: { w, h }, productPath: productBySize.get(label)?.path }
    })
    const res = await fetch('/api/gamme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decorPath: decor.file_path, items }),
    })
    setBusy(false)
    const data = await res.json().catch(() => null)
    if (res.ok) {
      router.push(data.batchId ? `/production/gamme/${data.batchId}` : '/')
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  const canNext = step === 0 ? decor !== null : step === 1 ? selectedSizes.length > 0 : true
  const readyCount = selectedSizes.length

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Créer des mises en situation</h1>
      <p className="text-sm text-text-secondary mb-6">
        Trois étapes, tout le reste est automatique. Vous validerez les images finales dans
        Production.
      </p>

      {/* Fil d'étapes */}
      <ol className="flex items-center gap-0 mb-8">
        {STEPS.map((label, i) => {
          const reachable = i <= step || (i === 1 && decor) || (i === 2 && decor && readyCount > 0)
          const done = i < step
          return (
            <li key={label} className="flex items-center grow last:grow-0">
              <button
                onClick={() => reachable && setStep(i)}
                disabled={!reachable}
                className={`flex items-center gap-2.5 ${reachable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                    i === step
                      ? 'bg-brand-green border-brand-green text-white'
                      : done
                        ? 'bg-brand-green-light border-brand-green text-brand-green'
                        : 'bg-white border-border text-text-disabled'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    i === step ? 'text-text-primary' : done ? 'text-brand-green' : 'text-text-disabled'
                  }`}
                >
                  {label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span className={`grow h-0.5 mx-4 rounded ${done ? 'bg-brand-green' : 'bg-border'}`} />
              )}
            </li>
          )
        })}
      </ol>

      {notice && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5 flex justify-between gap-4">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-brand-red/60 hover:text-brand-red">✕</button>
        </div>
      )}

      {/* ÉTAPE 1 — Décor */}
      {step === 0 && (
        <div className="space-y-5 animate-fade-in-up">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Choisissez le décor de la gamme</h2>
            <Link href="/decors" className="text-sm text-brand-teal hover:underline">
              Gérer la bibliothèque →
            </Link>
          </div>
          {decors.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {decors.map((d) => {
                const on = decor?.id === d.id
                return (
                  <button
                    key={d.id}
                    onClick={() => setDecor(d)}
                    className={`bg-white rounded-[12px] overflow-hidden text-left border-2 shadow-sm transition-all duration-200 ${
                      on ? 'border-brand-green' : 'border-transparent hover:shadow-default hover:translate-y-[-1px]'
                    }`}
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgUrl(d.file_path)} alt={d.name} className="w-full aspect-[3/2] object-cover" />
                      {on && (
                        <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand-green text-white text-xs font-bold flex items-center justify-center">
                          ✓
                        </span>
                      )}
                      {d.favorite && !on && (
                        <span className="absolute top-2 right-2 text-brand-teal text-lg drop-shadow">★</span>
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium truncate" title={d.name}>{d.name}</p>
                      <p className="text-xs text-text-disabled truncate">{d.gamme ?? 'Sans gamme'}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-text-secondary bg-white rounded-[12px] border border-border shadow-sm p-5">
              Aucun décor actif pour l&apos;instant — générez-en un ci-dessous.
            </p>
          )}

          {/* Générer un nouveau décor */}
          <section className="bg-white rounded-[12px] border border-border shadow-sm p-5">
            <button
              onClick={() => setNewDecorOpen((o) => !o)}
              className="w-full flex items-center justify-between text-left"
            >
              <span className="font-semibold text-sm">
                ✨ Il me faut un nouveau décor
              </span>
              <span className={`text-text-disabled transition-transform ${newDecorOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {newDecorOpen && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="grow min-w-56">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Moodboard (ambiance)</label>
                  <select
                    title="Moodboard"
                    value={moodboard}
                    onChange={(e) => setMoodboard(e.target.value)}
                    className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                  >
                    {moodboards.map((m) => (
                      <option key={m.path} value={m.path}>{m.name}</option>
                    ))}
                    {moodboards.length === 0 && <option value="">— aucun moodboard —</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Qualité</label>
                  <select
                    title="Qualité"
                    value={decorSize}
                    onChange={(e) => setDecorSize(e.target.value as '2K' | '4K')}
                    className="border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                  >
                    <option value="4K">4K (recommandé)</option>
                    <option value="2K">2K (plus léger)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1" title="Plusieurs propositions du même moodboard, à trier ensuite">
                    Propositions
                  </label>
                  <select
                    title="Nombre de propositions"
                    value={tirages}
                    onChange={(e) => setTirages(Number(e.target.value))}
                    className="border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={launchNewDecor}
                  disabled={decorBusy || !moodboard}
                  className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                >
                  {decorBusy ? 'Lancement…' : 'Générer le décor'}
                </button>
                <p className="w-full text-xs text-text-disabled">
                  Le décor s&apos;ouvre en grand dès qu&apos;il est prêt : vous pourrez le corriger
                  (« enlève l&apos;arbre à droite »), le garder ou le jeter, puis l&apos;utiliser directement.
                </p>
                {moodboard && (
                  <figure className="w-full">
                    <button
                      onClick={() => setMbZoom(true)}
                      title="Cliquez pour voir le moodboard en grand"
                      className="block cursor-zoom-in"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl(moodboard)}
                        alt="Aperçu du moodboard"
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
        </div>
      )}

      {/* ÉTAPE 2 — Portails */}
      {step === 1 && (
        <div className="space-y-5 animate-fade-in-up">
          <div className="bg-white rounded-[12px] border border-border shadow-sm p-5">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="font-semibold">Choisissez la gamme de portails</h2>
              <label className="text-sm text-brand-teal hover:underline cursor-pointer">
                {uploadBusy ? 'Envoi…' : '+ Ajouter un visuel produit'}
                <input
                  ref={fileInput}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadProduct(f)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              Les tailles disposant d&apos;un visuel produit sont cochées d&apos;office — décochez ce
              que vous ne voulez pas produire.
            </p>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <label className="text-sm text-text-secondary">Gamme</label>
              <select
                title="Gamme de portails"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="border border-border bg-surface rounded-[8px] px-2 py-1.5 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                {groups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name} ({g.products.filter((p) => p.size).length} tailles)
                  </option>
                ))}
                {groups.length === 0 && <option value="">— aucun visuel produit —</option>}
              </select>
            </div>

            {/* Grille catalogue : une LIGNE par largeur, les hauteurs en colonnes */}
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-1.5">
                <thead>
                  <tr>
                    <th className="text-xs font-medium text-text-secondary text-right pr-3 align-bottom pb-1">
                      Hauteur →
                    </th>
                    {heights.map((h) => (
                      <th key={h} className="text-xs font-semibold text-text-secondary pb-1 min-w-24">
                        {h} cm
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {widths.map((w) => (
                    <tr key={w}>
                      <td className="text-xs font-semibold text-text-secondary text-right pr-3 whitespace-nowrap">
                        Largeur {w} cm
                      </td>
                      {heights.map((h) => {
                        const label = `${w}x${h}`
                        if (!sizeSet.has(label)) {
                          // Taille absente du référentiel
                          return <td key={h} />
                        }
                        const product = productBySize.get(label)
                        const on = selectedSizes.includes(label)
                        return (
                          <td key={h}>
                            <button
                              onClick={() => toggleSize(label)}
                              disabled={!product}
                              title={
                                product
                                  ? `${w} × ${h} cm — visuel : ${product.name}`
                                  : `${w} × ${h} cm — pas de visuel produit dans la gamme choisie`
                              }
                              className={`w-full h-10 rounded-[8px] border text-sm font-medium transition-colors ${
                                !product
                                  ? 'bg-surface text-text-disabled border-transparent cursor-not-allowed'
                                  : on
                                    ? 'bg-brand-green text-white border-brand-green shadow-sm'
                                    : 'bg-white text-text-secondary border-border hover:border-brand-green hover:text-brand-green'
                              }`}
                            >
                              {!product ? '—' : on ? `✓ ${w}×${h}` : `${w}×${h}`}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bilan + actions rapides */}
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
              <span className="text-text-secondary">
                <b className="text-text-primary">{selectedSizes.length}</b> taille{selectedSizes.length > 1 ? 's' : ''} sélectionnée{selectedSizes.length > 1 ? 's' : ''} sur {productBySize.size} disponible{productBySize.size > 1 ? 's' : ''}
              </span>
              <button
                onClick={() => setSelectedSizes(sizes.filter((s) => productBySize.has(s.label)).map((s) => s.label))}
                disabled={selectedSizes.length === productBySize.size}
                className="text-brand-teal hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Tout cocher
              </button>
              <button
                onClick={() => setSelectedSizes([])}
                disabled={selectedSizes.length === 0}
                className="text-brand-teal hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Tout décocher
              </button>
            </div>
            {group && productBySize.size === 0 && (
              <p className="text-sm text-brand-red bg-brand-red-light rounded-[8px] px-3 py-2 mt-3">
                Aucune taille reconnue dans la gamme « {group.name} » — vérifiez que les noms de
                fichiers contiennent la taille (ex. « 300B140 »).
              </p>
            )}
          </div>
        </div>
      )}

      {/* ÉTAPE 3 — Vérifier & lancer */}
      {step === 2 && decor && (
        <div className="space-y-5 animate-fade-in-up">
          <div className="bg-white rounded-[12px] border border-border shadow-sm p-5 flex flex-wrap gap-5 items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgUrl(decor.file_path)}
              alt={decor.name}
              className="w-52 aspect-[3/2] object-cover rounded-[8px] border border-border"
            />
            <div className="min-w-64 grow">
              <p className="text-sm text-text-secondary">Décor</p>
              <p className="font-semibold">{decor.name}</p>
              <p className="text-sm text-text-secondary mt-3">Gamme de portails</p>
              <p className="font-semibold">{groupName || '—'}</p>
              <p className="text-sm text-text-secondary mt-3">
                {readyCount} taille{readyCount > 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {[...selectedSizes]
                  .sort((a, b) => {
                    const [aw, ah] = a.split('x').map(Number)
                    const [bw, bh] = b.split('x').map(Number)
                    return aw - bw || ah - bh
                  })
                  .map((label) => (
                    <span key={label} className="bg-brand-green-light text-brand-green rounded-[8px] px-2 py-0.5 text-xs font-semibold">
                      {label.replace('x', ' × ')} cm
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <div className="bg-white rounded-[12px] border border-border shadow-sm p-5">
            <button
              onClick={launch}
              disabled={busy || readyCount === 0}
              className="bg-brand-green text-white rounded-[10px] px-6 py-3 font-bold hover:bg-brand-green-hover hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Lancement…' : `🚀 Lancer la génération (${readyCount} image${readyCount > 1 ? 's' : ''})`}
            </button>
            <p className="text-xs text-text-disabled mt-2">
              Chaque taille est produite automatiquement de bout en bout. Vous suivrez
              l&apos;avancement en direct et validerez les images une par une ou toutes d&apos;un coup.
            </p>
          </div>
        </div>
      )}

      {/* Barre Retour / Continuer */}
      <div className="flex items-center justify-between mt-8">
        {step > 0 ? (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="bg-white border border-border text-text-secondary rounded-[10px] px-5 py-2.5 font-medium hover:bg-surface transition-colors"
          >
            ← Retour
          </button>
        ) : (
          <span />
        )}
        {step < 2 && (
          <button
            onClick={() => canNext && setStep((s) => s + 1)}
            disabled={!canNext}
            className="bg-brand-green text-white rounded-[10px] px-6 py-2.5 font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
          >
            Continuer →
          </button>
        )}
      </div>

      {mbZoom && moodboard && (
        <button
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setMbZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgUrl(moodboard)} alt="Moodboard en grand" className="max-w-full max-h-full object-contain" />
        </button>
      )}

      {studio && (
        <DecorStudio
          jobIds={studio.jobIds}
          isAdmin={isAdmin}
          onClose={() => {
            setStudio(null)
            loadDecors()
          }}
          onChanged={() => loadDecors()}
        />
      )}
    </div>
  )
}
