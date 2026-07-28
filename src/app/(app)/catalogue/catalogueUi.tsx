'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Silhouette, { familyTypo } from '../Silhouette'
import Chargement from '@/components/Chargement'

/**
 * Briques partagées du Catalogue : liste allégée mise en CACHE côté navigateur
 * (une seule requête pour l'accueil, les catégories ET la recherche — la
 * navigation ne re-télécharge rien), carte produit, et barre de recherche
 * toujours disponible (demande Mathias 12/07/2026).
 */

export interface ProductLight {
  id: number
  brand: string
  family: string
  name: string
  status: 'detecte' | 'a_completer'
  lastScanAt: string
  /** Photo produit de face (chemin relatif à la gamme, servie par …/fichier) — jamais une MES. */
  cover: string | null
  /** MES générées PAR PORTAGEN pour cette gamme (badge carte) — 0 = pas de badge. */
  mesPortagen: number
  counts: { sizes: number; coloris: number; mes: number; aDetourer: number }
}

/** « PORTAIL BATTANT » → « Portail battant » (affichage). */
export function familyTitle(family: string): string {
  const lower = family.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** « PORTAIL BATTANT » → « portail-battant » (URL). */
export function familySlug(family: string): string {
  return family.toLowerCase().trim().replace(/\s+/g, '-')
}

export interface CatalogueData {
  products: ProductLight[]
  /** Marque active de l'utilisateur (profil de l'app). */
  brand: string
}

/** Étiquette d'une marque telle qu'elle apparaît sur le serveur (products.brand). */
export function brandLabel(key: string): string {
  return key.toUpperCase()
}

/** Cache module : partagé par toutes les pages du Catalogue, TTL 60 s. */
let cache: { at: number; data: CatalogueData } | null = null
let pending: Promise<CatalogueData> | null = null
const CACHE_TTL_MS = 60_000

export function invalidateCatalogueCache(): void {
  cache = null
}

export function fetchCatalogue(force = false): Promise<CatalogueData> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Promise.resolve(cache.data)
  }
  if (!pending) {
    pending = fetch('/api/catalogue')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Erreur ${r.status}`))))
      .then((d) => {
        const data: CatalogueData = { products: d.products, brand: d.brand ?? 'casanoov' }
        cache = { at: Date.now(), data }
        return data
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export function ProductCard({ product }: { product: ProductLight }) {
  const { sizes, coloris } = product.counts
  // Vignette : photo produit de face (jamais une MES) ; sans visuel, la
  // silhouette de la typologie sert de tenant-lieu discret.
  const typo = familyTypo(product.family)
  return (
    <Link
      href={`/catalogue/${product.id}`}
      className="bg-white rounded-[12px] border border-border shadow-sm p-4 hover:shadow-md transition-shadow flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="font-bold">{product.name}</div>
        <div className="text-xs text-text-secondary mt-0.5">
          {sizes} taille{sizes > 1 ? 's' : ''}
          {coloris > 0 && <> · {coloris} coloris</>}
        </div>
        {/* Seul badge (13/07/2026) : le travail DE PORTAGEN sur la gamme — rien
            si l'outil n'y a jamais généré (les stats serveur restent sur la fiche). */}
        {product.mesPortagen > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="text-[11px] font-bold bg-brand-green-light text-brand-green rounded-full px-2 py-0.5">
              {product.mesPortagen} MES PortaGEN
            </span>
          </div>
        )}
      </div>
      <div className="shrink-0 w-28 h-20 grid place-items-center overflow-hidden">
        {product.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/catalogue/${product.id}/fichier?p=${encodeURIComponent(product.cover)}&w=240`}
            alt={product.name}
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
}

/**
 * Recherche produit avec résultats en liste déroulante — présente sur
 * l'accueil, les pages catégorie ET les pages produit.
 */
export function CatalogueSearch({
  autoFocus = false,
  className = '',
}: {
  autoFocus?: boolean
  className?: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<ProductLight[] | null>(null)
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // La recherche couvre TOUTES les marques (décision maquette navigation).
    fetchCatalogue().then(
      (d) => setProducts(d.products),
      () => setProducts([])
    )
  }, [])

  const q = query.trim().toLowerCase()
  const results =
    q && products ? products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : []

  function go(id: number) {
    setQuery('')
    setOpen(false)
    router.push(`/catalogue/${id}`)
  }

  return (
    <div className={`relative ${className}`}>
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results.length > 0) go(results[0].id)
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Rechercher un produit (ex. VOGEL)…"
        className="w-full border border-border bg-white rounded-full px-4 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors"
      />
      {open && q && (
        <div className="absolute z-20 mt-1.5 w-full bg-white border border-border rounded-[10px] shadow-lg overflow-hidden">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-secondary">
              {products === null ? (
                <Chargement inline />
              ) : (
                `Aucun produit ne correspond à « ${query} ».`
              )}
            </div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  go(p.id)
                }}
                className="w-full flex items-baseline gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface transition-colors border-b border-border/50 last:border-0"
              >
                <span className="font-bold">{p.name}</span>
                <span className="text-xs text-text-secondary">{familyTitle(p.family)}</span>
                {p.counts.mes > 0 && (
                  <span className="ml-auto text-[11px] font-bold text-brand-green">
                    {p.counts.mes} MES
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
