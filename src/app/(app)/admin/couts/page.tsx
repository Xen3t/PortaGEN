'use client'

import { useEffect, useState } from 'react'

interface ByModel {
  model: string
  kind: string
  calls: number
  ok: number
  inputTokens: number
  outputTokens: number
}
interface ByDay {
  day: string
  calls: number
  outputTokens: number
}

export default function CostsPage() {
  const [byModel, setByModel] = useState<ByModel[]>([])
  const [byDay, setByDay] = useState<ByDay[]>([])

  useEffect(() => {
    fetch('/api/costs')
      .then((r) => r.json())
      .then((d) => {
        setByModel(d.byModel ?? [])
        setByDay(d.byDay ?? [])
      })
  }, [])

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Coûts API</h1>
      <p className="text-sm text-text-secondary mb-6">
        Tokens réels journalisés à chaque appel. Le coût en euros dépend de la grille tarifaire
        Gemini en vigueur (tokens de sortie image = l’essentiel de la facture).
      </p>
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-medium bg-surface border-b border-border">
            Par modèle
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide bg-surface text-text-secondary">
              <tr>
                <th className="px-4 py-2">Modèle</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2 text-right">Appels (ok)</th>
                <th className="px-4 py-2 text-right">Tokens sortie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byModel.map((m, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-mono text-xs">{m.model}</td>
                  <td className="px-4 py-2 text-text-secondary">{m.kind}</td>
                  <td className="px-4 py-2 text-right">
                    {m.calls} ({m.ok})
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {m.outputTokens.toLocaleString('fr-FR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-medium bg-surface border-b border-border">
            Par jour (30 derniers)
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide bg-surface text-text-secondary">
              <tr>
                <th className="px-4 py-2">Jour</th>
                <th className="px-4 py-2 text-right">Appels</th>
                <th className="px-4 py-2 text-right">Tokens sortie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byDay.map((d) => (
                <tr key={d.day}>
                  <td className="px-4 py-2">{d.day}</td>
                  <td className="px-4 py-2 text-right">{d.calls}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {d.outputTokens.toLocaleString('fr-FR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
