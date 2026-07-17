'use client'

import { useEffect, useState } from 'react'
import MoteurLab from '@/components/MoteurLab'
import type { MoteurKey } from '@/lib/moteurs'

/**
 * Admin → LAB (réorganisation Mathias 13/07/2026) : l'ex-page « Réglages
 * généraux » devient le LAB. Les réglages généraux qui y vivaient sont partis
 * dans Admin → Réglages ; ici il ne reste que les essais du moteur, avec un
 * SÉLECTEUR DE MOTEUR (demande Mathias 13/07/2026) — on choisit le moteur à
 * tester (JANUS seul pour l'instant), les essais utilisent SES tailles, SES
 * gabarits, SES prompts et SES réglages.
 */

interface MoteurEntry {
  key: MoteurKey
  label: string
  codeName?: string
  status: 'actif' | 'preparation'
}

export default function LabPage() {
  const [moteurs, setMoteurs] = useState<MoteurEntry[]>([])
  const [selected, setSelected] = useState<MoteurKey>('battant')

  useEffect(() => {
    fetch('/api/moteurs')
      .then((r) => r.json())
      .then((d) => setMoteurs(d.moteurs ?? []))
  }, [])

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">LAB</h1>
      <p className="text-sm text-text-secondary mb-5">
        Choisissez le moteur à tester : chaque essai utilise ses tailles, ses gabarits, ses
        prompts et ses réglages (Admin → Réglages).
      </p>

      {/* Sélecteur de moteur — les moteurs en préparation ne sont pas testables. */}
      <div className="flex flex-wrap gap-2 mb-6" role="tablist">
        {moteurs.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={m.key === selected}
            disabled={m.status !== 'actif'}
            onClick={() => setSelected(m.key)}
            className={`flex items-baseline gap-2 px-4 py-2 rounded-[10px] border-[1.5px] text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              m.key === selected
                ? 'border-brand-green text-brand-green bg-brand-green-light'
                : 'border-border bg-white text-text-secondary hover:border-[#d5d9de]'
            }`}
          >
            {m.label}
            {m.codeName && (
              <span
                className={`text-xs font-bold ${
                  m.key === selected ? 'text-brand-green' : 'text-text-secondary'
                }`}
              >
                « {m.codeName} »
              </span>
            )}
            {m.status !== 'actif' && (
              <span className="text-xs font-semibold text-text-disabled">en préparation</span>
            )}
          </button>
        ))}
      </div>

      {/* key={selected} : changer de moteur repart d'un Lab neuf (référentiels rechargés). */}
      <MoteurLab key={selected} moteur={selected} />
    </div>
  )
}
