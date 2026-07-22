'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Silhouette, { familyTypo } from '../../Silhouette'
import {
  brandLabel,
  familyTitle,
  fetchCatalogue,
  type ProductLight,
} from '../../catalogue/catalogueUi'

/**
 * « Depuis le catalogue » — étape 1 : choisir la gamme (rework 22/07/2026,
 * maquette generer-depuis-catalogue-v3 validée par Mathias).
 *
 * C'est LE catalogue (mêmes familles, mêmes cartes que l'onglet Catalogue),
 * simplement en mode sélection : le bandeau bleu rappelle pourquoi on est là,
 * et cliquer une gamme ouvre l'écran des tailles (/generation/catalogue/[id])
 * au lieu de la fiche produit.
 */

export default function GenerationCataloguePage() {
  const [products, setProducts] = useState<ProductLight[] | null>(null)
  const [brand, setBrand] = useState('casanoov')
  const [famille, setFamille] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')

  useEffect(() => {
    fetchCatalogue().then(
      (d) => {
        setProducts(d.products)
        setBrand(d.brand)
      },
      () => setProducts([])
    )
  }, [])

  const brandProducts = useMemo(
    () => (products ?? []).filter((p) => p.brand === brandLabel(brand)),
    [products, brand]
  )

  const familles = useMemo(() => {
    const byFamily = new Map<string, ProductLight[]>()
    for (const p of brandProducts) {
      if (!byFamily.has(p.family)) byFamily.set(p.family, [])
      byFamily.get(p.family)!.push(p)
    }
    return Array.from(byFamily.entries()).map(([family, items]) => ({ family, items }))
  }, [brandProducts])

  const gammes = useMemo(() => {
    if (!famille) return []
    const q = filtre.trim().toLowerCase()
    return brandProducts.filter(
      (p) => p.family === famille && (!q || p.name.toLowerCase().includes(q))
    )
  }, [brandProducts, famille, filtre])

  const selbar = (
    <div className="bg-brand-teal-light border-[1.5px] border-brand-teal text-brand-teal rounded-[12px] px-4 py-2.5 text-[13.5px] font-semibold mb-5">
      {famille
        ? 'Clique la gamme à mettre en situation — tailles, coloris et MES existantes sur l’écran suivant. '
        : 'Choisis la famille, puis la gamme à mettre en situation. '}
      <Link href="/generation?mode=contrainte" className="underline">
        Annuler
      </Link>
    </div>
  )

  const chemin = (
    <div className="flex items-center gap-1 flex-wrap mb-5">
      <Link
        href={famille ? '#' : '/generation?mode=contrainte'}
        onClick={(e) => {
          if (famille) {
            e.preventDefault()
            setFamille(null)
          }
        }}
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
        href="/generation?mode=contrainte"
        className="text-sm font-semibold text-text-secondary px-2 py-1 rounded-[8px] hover:text-brand-green hover:bg-brand-green-light transition-colors"
      >
        Contrainte
      </Link>
      <span className="text-[#c9cfd6] text-[13px]">›</span>
      {famille ? (
        <>
          <button
            onClick={() => setFamille(null)}
            className="text-sm font-semibold text-text-secondary px-2 py-1 rounded-[8px] hover:text-brand-green hover:bg-brand-green-light transition-colors"
          >
            Depuis le catalogue
          </button>
          <span className="text-[#c9cfd6] text-[13px]">›</span>
          <span className="text-sm font-bold px-2 py-1">{familyTitle(famille)}</span>
        </>
      ) : (
        <span className="text-sm font-bold px-2 py-1">Depuis le catalogue</span>
      )}
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto">
      {chemin}
      {selbar}

      {products === null ? (
        <p className="text-sm text-text-secondary">Chargement…</p>
      ) : brandProducts.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Le catalogue est vide — passe par l&apos;onglet{' '}
          <Link href="/catalogue" className="text-brand-green font-semibold hover:underline">
            Catalogue
          </Link>{' '}
          pour lancer une consultation du serveur.
        </p>
      ) : !famille ? (
        /* ——— étape famille : mêmes cartes que l'accueil du Catalogue ——— */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {familles.map(({ family, items }) => {
            const typo = familyTypo(family)
            return (
              <button
                key={family}
                onClick={() => {
                  setFamille(family)
                  setFiltre('')
                }}
                className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden hover:shadow-md transition-shadow block text-left"
              >
                {typo && (
                  <div className="border-b border-border px-[18px] pt-[18px] bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                    <Silhouette typo={typo} />
                  </div>
                )}
                <div className="p-6">
                  <div className="text-lg font-bold">{familyTitle(family)}</div>
                  <div className="text-sm text-text-secondary mt-1">
                    {items.length} gamme{items.length > 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        /* ——— étape gamme : mêmes cartes que la page famille du Catalogue ——— */
        <>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <p className="text-sm text-text-secondary m-0">
              {gammes.length} gamme{gammes.length > 1 ? 's' : ''}
            </p>
            <input
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
              placeholder="Filtrer cette famille…"
              autoComplete="off"
              className="flex-1 min-w-56 max-w-md bg-white border border-border rounded-full px-4 py-2 text-sm outline-none focus:border-brand-green"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {gammes.map((p) => {
              const typo = familyTypo(p.family)
              return (
                <Link
                  key={p.id}
                  href={`/generation/catalogue/${p.id}`}
                  className="bg-white rounded-[12px] border border-border shadow-sm p-4 hover:shadow-md transition-shadow flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold">{p.name}</div>
                    <div className="text-xs text-text-secondary mt-0.5">
                      {p.counts.sizes} taille{p.counts.sizes > 1 ? 's' : ''}
                      {p.counts.coloris > 0 && <> · {p.counts.coloris} coloris</>}
                    </div>
                    {p.mesPortagen > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className="text-[11px] font-bold bg-brand-green-light text-brand-green rounded-full px-2 py-0.5">
                          {p.mesPortagen} MES PortaGEN
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 w-28 h-20 grid place-items-center overflow-hidden">
                    {p.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/catalogue/${p.id}/fichier?p=${encodeURIComponent(p.cover)}&w=240`}
                        alt={p.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      typo && (
                        <div className="w-full opacity-30 grayscale">
                          <Silhouette typo={typo} />
                        </div>
                      )
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
