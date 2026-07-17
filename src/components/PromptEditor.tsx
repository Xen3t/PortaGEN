'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Éditeur de prompt EN LIGNE dans la fiche moteur (demande Mathias 13/07/2026 :
 * plus de page Prompt System séparée — « Modifier » déroule l'éditeur sous la
 * ligne du prompt, avec le contenu et l'historique des versions).
 *
 * Mêmes règles que l'ancienne page : chaque enregistrement crée une NOUVELLE
 * version (l'historique est conservé, la dernière version est l'active) ;
 * rouvrir une version historique et l'enregistrer en fait la nouvelle active.
 */

interface PromptVersion {
  version: number
  content: string
  comment: string | null
  created_by: string | null
  created_at: string
}

export default function PromptEditor({
  name,
  onSaved,
}: {
  name: string
  /** Prévient le parent qu'une nouvelle version est active (met à jour le badge vN). */
  onSaved?: (name: string, version: number) => void
}) {
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [comment, setComment] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadVersions = useCallback(() => {
    fetch(`/api/prompts/${name}`)
      .then((r) => r.json())
      .then((d) => {
        const list: PromptVersion[] = d.versions ?? []
        setVersions(list)
        if (list.length) {
          setViewing(list[0].version)
          setDraft(list[0].content)
        }
      })
  }, [name])

  useEffect(loadVersions, [loadVersions])

  function showVersion(v: number) {
    const found = versions.find((x) => x.version === v)
    if (found) {
      setViewing(v)
      setDraft(found.content)
    }
  }

  async function saveNewVersion() {
    setBusy(true)
    setNotice(null)
    const res = await fetch(`/api/prompts/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: draft, comment }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      setNotice(
        `Version ${data.prompt.version} enregistrée — utilisée dès la prochaine génération.`
      )
      setComment('')
      onSaved?.(name, data.prompt.version)
      loadVersions()
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  const latest = versions[0]?.version
  const isDirty = draft !== versions.find((v) => v.version === viewing)?.content

  return (
    <div className="border-t border-border bg-surface/50 px-3 py-3 rounded-b-[8px]">
      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-xs rounded-[8px] px-3 py-2 mb-3">
          {notice}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          <span className="text-text-secondary">Historique :</span>
          {versions.map((v) => (
            <button
              key={v.version}
              type="button"
              onClick={() => showVersion(v.version)}
              title={`${v.created_at} · ${v.created_by ?? ''} ${v.comment ? `· ${v.comment}` : ''}`}
              className={`px-2 py-1 rounded-[8px] transition-colors ${
                viewing === v.version
                  ? 'bg-brand-green text-white'
                  : 'bg-white border border-border text-text-secondary hover:bg-background'
              }`}
            >
              v{v.version}
              {v.version === latest ? ' (active)' : ''}
            </button>
          ))}
        </div>
        {viewing !== latest && (
          <span className="text-xs text-brand-teal bg-brand-teal-light px-2 py-1 rounded-[8px]">
            Version historique — enregistrer en fera la nouvelle version active
          </span>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="w-full h-72 border border-border bg-white rounded-[8px] p-3 font-mono text-xs leading-relaxed focus:outline-none focus:border-brand-green transition-colors"
      />
      <div className="flex items-center gap-3 mt-2.5">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Commentaire de version (ex. : durcit l'interdiction de clôtures)"
          className="grow border border-border bg-white rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors"
        />
        <button
          type="button"
          onClick={saveNewVersion}
          disabled={busy || !isDirty}
          className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
        >
          Enregistrer comme v{(latest ?? 0) + 1}
        </button>
      </div>
    </div>
  )
}
