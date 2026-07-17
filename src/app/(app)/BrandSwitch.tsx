'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Le logo-sélecteur de marque (navigation v2 validée) : « PortaGEN CASANOOV ▾ »
 * ouvre le menu des marques ; en choisir une change les couleurs de toute
 * l'app et est mémorisé PAR UTILISATEUR en base (reprise à la reconnexion).
 */

const BRANDS = [
  { key: 'casanoov', label: 'CASANOOV', what: 'portails…', color: '#5d9228' },
  { key: 'cazeboo', label: 'CAZEBOO', what: 'pergolas…', color: '#38a0ad' },
  { key: 'sicaan', label: 'SICAAN', what: 'meubles…', color: '#dc9083' },
] as const

export default function BrandSwitch({ initialBrand }: { initialBrand: string }) {
  const [brand, setBrand] = useState(initialBrand)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  async function choose(key: string) {
    if (key === brand) {
      setOpen(false)
      return
    }
    setBrand(key)
    setOpen(false)
    document.documentElement.dataset.brand = key // couleurs immédiates
    await fetch('/api/brand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: key }),
    }).catch(() => undefined)
    // Recharge complète : Accueil, Catalogue et Production suivent la marque.
    window.location.reload()
  }

  const active = BRANDS.find((b) => b.key === brand) ?? BRANDS[0]

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-baseline gap-1.5 font-bold tracking-tight"
        title="Changer de marque"
      >
        <span className="text-brand-green">PortaGEN</span>
        <span className="text-sm text-text-primary">{active.label}</span>
        <span className="text-[9px] text-text-disabled">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 bg-white border border-border rounded-[8px] shadow-lg min-w-60 overflow-hidden">
          {BRANDS.map((b) => (
            <button
              key={b.key}
              onClick={() => choose(b.key)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold hover:bg-surface transition-colors ${
                b.key === brand ? 'bg-brand-green-light' : ''
              }`}
            >
              <span className="w-3 h-3 rounded-full flex-none" style={{ background: b.color }} />
              <span>
                PortaGEN <span style={{ color: b.color }}>{b.label}</span>
              </span>
              <small className="ml-auto text-text-disabled font-normal text-[11px]">{b.what}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
