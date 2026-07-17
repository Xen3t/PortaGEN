'use client'

import Link from 'next/link'
import { use, useEffect, useMemo, useState } from 'react'
import {
  CatalogueSearch,
  ProductCard,
  brandLabel,
  familySlug,
  familyTitle,
  fetchCatalogue,
  type ProductLight,
} from '../../catalogueUi'

/** Page catégorie : les produits d'une famille, pour la MARQUE ACTIVE. */
export default function FamillePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params)
  const [products, setProducts] = useState<ProductLight[] | null>(null)
  const [brand, setBrand] = useState<string>('casanoov')

  useEffect(() => {
    fetchCatalogue().then(
      (d) => {
        setProducts(d.products)
        setBrand(d.brand)
      },
      () => setProducts([])
    )
  }, [])

  const items = useMemo(
    () =>
      (products ?? []).filter(
        (p) => familySlug(p.family) === slug && p.brand === brandLabel(brand)
      ),
    [products, slug, brand]
  )
  const familyName = items[0]?.family ?? slug.replace(/-/g, ' ')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <Link
          href="/catalogue"
          className="text-sm font-semibold text-text-secondary bg-white border border-border rounded-full px-4 py-2 hover:text-brand-green hover:border-brand-green transition-colors"
        >
          ← Catalogue
        </Link>
        <h1 className="text-xl font-semibold">{familyTitle(familyName)}</h1>
        <CatalogueSearch className="flex-1 min-w-64 max-w-md" />
      </div>

      {products === null ? (
        <p className="text-text-secondary text-sm">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Aucun produit dans cette catégorie. Essayez « ↻ Actualiser depuis le serveur » sur la
          page Catalogue si les dossiers viennent d&apos;arriver.
        </p>
      ) : (
        <>
          <p className="text-sm text-text-secondary mb-4">
            {items.length} gamme{items.length > 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
