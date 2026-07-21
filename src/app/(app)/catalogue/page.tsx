'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Silhouette, { familyTypo } from '../Silhouette'
import {
  CatalogueSearch,
  brandLabel,
  familySlug,
  familyTitle,
  fetchCatalogue,
  invalidateCatalogueCache,
  type ProductLight,
} from './catalogueUi'

/**
 * Accueil du Catalogue (navigation v2) : les grandes catégories DE LA MARQUE
 * ACTIVE (choisie via le logo). Les marques sans moteur affichent « bientôt ».
 */

type ScanProgress = { actif: boolean; fait: number; total: number; demarreA: number | null }

function dureeRestante(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `~${s} s`
  return `~${Math.round(s / 60)} min`
}

/** Libellé du bouton pendant le scan : avancement + temps restant estimé. */
function scanLabel(p: ScanProgress | null): string {
  if (!p || p.total === 0 || p.fait === 0 || !p.demarreA) return 'Consultation du serveur…'
  const restant = ((Date.now() - p.demarreA) / p.fait) * (p.total - p.fait)
  return `Scan ${p.fait}/${p.total} — reste ${dureeRestante(restant)}`
}

export default function CataloguePage() {
  const [products, setProducts] = useState<ProductLight[] | null>(null)
  const [brand, setBrand] = useState<string>('casanoov')
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Pendant le scan : interroge la progression chaque seconde pour animer la
  // barre du bouton et rafraîchir l'estimation du temps restant.
  useEffect(() => {
    if (!scanning) {
      setProgress(null)
      return
    }
    const timer = setInterval(() => {
      fetch('/api/catalogue/progression', { cache: 'no-store' })
        .then((r) => r.json())
        .then((p: ScanProgress) => {
          if (p?.actif) setProgress(p)
        })
        .catch(() => undefined)
    }, 1000)
    return () => clearInterval(timer)
  }, [scanning])

  useEffect(() => {
    fetchCatalogue().then(
      (d) => {
        setProducts(d.products)
        setBrand(d.brand)
      },
      () => setProducts([])
    )
  }, [])

  async function rescan() {
    setScanning(true)
    setNotice(null)
    const res = await fetch('/api/catalogue', { method: 'POST' })
    const data = await res.json().catch(() => null)
    setScanning(false)
    if (res.ok) {
      const secs = Math.round((data.report?.durationMs ?? 0) / 1000)
      setNotice(
        `Serveur consulté : ${data.report?.scanned ?? 0} produits mis à jour en ${secs}s.` +
          (data.report?.errors?.length ? ` ${data.report.errors.length} dossier(s) inaccessibles.` : '')
      )
      invalidateCatalogueCache()
      fetchCatalogue(true).then((d) => setProducts(d.products), () => undefined)
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  const brandProducts = useMemo(
    () => (products ?? []).filter((p) => p.brand === brandLabel(brand)),
    [products, brand]
  )

  const categories = useMemo(() => {
    const byFamily = new Map<string, ProductLight[]>()
    for (const p of brandProducts) {
      if (!byFamily.has(p.family)) byFamily.set(p.family, [])
      byFamily.get(p.family)!.push(p)
    }
    return Array.from(byFamily.entries()).map(([family, items]) => ({
      family,
      count: items.length,
      mes: items.reduce((n, p) => n + p.counts.mes, 0),
    }))
  }, [brandProducts])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">
          Catalogue <span className="text-brand-green">{brandLabel(brand)}</span>
        </h1>
        <CatalogueSearch className="flex-1 min-w-64 max-w-md" />
        <button
          onClick={rescan}
          disabled={scanning}
          title="Relit tout le serveur (plusieurs minutes)"
          className="relative overflow-hidden text-sm font-semibold text-brand-green bg-brand-green-light rounded-full px-4 py-2 hover:bg-brand-green hover:text-white transition-colors disabled:pointer-events-none"
        >
          {/* Barre de progression : remplissage DANS le bouton, jamais plus large que lui. */}
          {scanning && progress && progress.total > 0 && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-brand-green/25 transition-[width] duration-700"
              style={{ width: `${Math.min(100, (progress.fait / progress.total) * 100)}%` }}
            />
          )}
          <span className="relative">
            {scanning ? scanLabel(progress) : '↻ Actualiser depuis le serveur'}
          </span>
        </button>
      </div>

      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-4 py-3 mb-5">
          {notice}
        </div>
      )}

      {products === null ? (
        <p className="text-text-secondary text-sm">Chargement…</p>
      ) : brandProducts.length === 0 ? (
        <div className="bg-white rounded-[12px] border border-border shadow-sm p-10 text-center max-w-2xl">
          <p className="font-bold text-lg mb-1">PortaGEN {brandLabel(brand)} arrive bientôt</p>
          <p className="text-sm text-text-secondary">
            {brand === 'casanoov'
              ? 'Le catalogue est vide — lancez une consultation du serveur avec le bouton ci-dessus.'
              : 'Le moteur de cette marque n’existe pas encore — ses produits apparaîtront ici dès qu’il sera prêt. La recherche, elle, couvre déjà toutes les marques.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => {
            // Silhouette produit (maquette choix-mode-typologie-v1) quand la
            // famille correspond à une typologie connue — sinon carte texte seule.
            const typo = familyTypo(cat.family)
            return (
              <Link
                key={cat.family}
                href={`/catalogue/famille/${familySlug(cat.family)}`}
                className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden hover:shadow-md transition-shadow block"
              >
                {typo && (
                  <div className="border-b border-border px-[18px] pt-[18px] bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                    <Silhouette typo={typo} />
                  </div>
                )}
                <div className="p-6">
                  <div className="text-lg font-bold">{familyTitle(cat.family)}</div>
                  <div className="text-sm text-text-secondary mt-1">
                    {cat.count} gamme{cat.count > 1 ? 's' : ''}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {cat.mes > 0 && (
                      <span className="text-[11px] font-bold bg-brand-green-light text-brand-green rounded-full px-2.5 py-1">
                        {cat.mes} MES
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-brand-green mt-4">
                    Voir les produits →
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
