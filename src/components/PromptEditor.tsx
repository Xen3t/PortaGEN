'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Atelier de prompt EN LIGNE dans la fiche moteur (refonte du 28/07/2026,
 * maquette prompt-system-v6 validée par Mathias) : « Modifier » déplie sous la
 * ligne un atelier à deux colonnes — à gauche la FRISE des versions (date,
 * auteur, commentaire), à droite deux modes : Éditer (grand champ de texte) et
 * Comparer (différences entre une version choisie et la version active).
 *
 * Mêmes règles qu'avant : chaque enregistrement crée une NOUVELLE version
 * (l'historique est immuable, la dernière version est l'active) ; rouvrir une
 * version historique et l'enregistrer en fait la nouvelle active.
 */

interface PromptVersion {
  version: number
  content: string
  comment: string | null
  created_by: string | null
  created_at: string
}

/** Métadonnées de la version enregistrée, remontées au parent pour la ligne fermée. */
export interface PromptSaved {
  version: number
  created_at: string
  created_by: string | null
}

/** Les datetimes SQLite sont en UTC sans suffixe — on le rétablit pour parser. */
function parseDbDate(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
}

function fmtDate(s: string): string {
  const d = parseDbDate(s)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

type DiffOp = { kind: 'ctx' | 'add' | 'del'; text: string }
type DiffRow = DiffOp | { kind: 'skip'; count: number }

/** Diff ligne à ligne (LCS) — les prompts font quelques dizaines de lignes. */
function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'ctx', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'del', text: a[i] })
      i++
    } else {
      ops.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ kind: 'del', text: a[i++] })
  while (j < m) ops.push({ kind: 'add', text: b[j++] })
  return ops
}

/** Replie les longues suites de lignes inchangées (2 lignes de contexte gardées). */
function collapseCtx(ops: DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = []
  let run: string[] = []
  const flush = (isFirst: boolean, isLast: boolean) => {
    const head = isFirst ? 0 : 2
    const tail = isLast ? 0 : 2
    if (run.length > head + tail + 1) {
      for (let k = 0; k < head; k++) rows.push({ kind: 'ctx', text: run[k] })
      rows.push({ kind: 'skip', count: run.length - head - tail })
      for (let k = run.length - tail; k < run.length; k++) rows.push({ kind: 'ctx', text: run[k] })
    } else {
      for (const text of run) rows.push({ kind: 'ctx', text })
    }
    run = []
  }
  let seenChange = false
  for (const op of ops) {
    if (op.kind === 'ctx') {
      run.push(op.text)
    } else {
      flush(!seenChange, false)
      seenChange = true
      rows.push(op)
    }
  }
  flush(!seenChange, true)
  return rows
}

export default function PromptEditor({
  name,
  onSaved,
}: {
  name: string
  /** Prévient le parent qu'une nouvelle version est active (ligne fermée : badge vN, date, auteur). */
  onSaved?: (name: string, saved: PromptSaved) => void
}) {
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [comment, setComment] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'edit' | 'compare'>('edit')
  const [compareWith, setCompareWith] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const loadVersions = useCallback(() => {
    fetch(`/api/prompts/${name}`)
      .then((r) => r.json())
      .then((d) => {
        const list: PromptVersion[] = d.versions ?? []
        setVersions(list)
        if (list.length) {
          setViewing(list[0].version)
          setDraft(list[0].content)
          setCompareWith(list.length > 1 ? list[1].version : null)
        }
      })
      .catch(() => setNotice('Erreur : historique impossible à charger'))
      .finally(() => setLoading(false))
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
      setMode('edit')
      onSaved?.(name, {
        version: data.prompt.version,
        created_at: data.prompt.created_at,
        created_by: data.prompt.created_by,
      })
      loadVersions()
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  const latest = versions[0]
  const isDirty = draft !== versions.find((v) => v.version === viewing)?.content
  const compared = versions.find((v) => v.version === compareWith)

  const diffRows = useMemo(() => {
    if (mode !== 'compare' || !latest || !compared) return []
    return collapseCtx(diffLines(compared.content, latest.content))
  }, [mode, latest, compared])
  const diffHasChanges = diffRows.some((r) => r.kind === 'add' || r.kind === 'del')

  return (
    <div className="border-t border-border bg-surface/50 rounded-b-[8px] overflow-hidden">
      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-xs px-4 py-2">{notice}</div>
      )}
      {/* Petite animation le temps du chargement initial (demande Mathias 28/07/2026) —
          pas de flash au rechargement après enregistrement : les versions sont déjà là. */}
      {loading && versions.length === 0 ? (
        <div className="flex items-center justify-center gap-2.5 py-10 text-sm text-text-secondary">
          <span className="w-5 h-5 rounded-full border-2 border-border border-t-brand-green animate-spin" />
          Chargement de l&apos;historique…
        </div>
      ) : (
      <div className="grid md:grid-cols-[250px_1fr]">
        {/* ===== Frise des versions ===== */}
        <div className="bg-white/60 border-b md:border-b-0 md:border-r border-border py-3">
          <div className="px-4 pb-2 text-[11px] uppercase tracking-[.07em] font-bold text-text-secondary">
            Historique
          </div>
          <div className="relative">
            <div className="absolute left-[23px] top-1.5 bottom-1.5 w-[2px] bg-border" />
            {versions.map((v) => {
              const isActive = v.version === latest?.version
              const isCompared = mode === 'compare' && v.version === compareWith
              const highlight =
                mode === 'compare'
                  ? isCompared
                    ? 'bg-brand-teal-light'
                    : isActive
                      ? 'bg-brand-green-light'
                      : 'hover:bg-surface'
                  : v.version === viewing
                    ? 'bg-brand-green-light'
                    : 'hover:bg-surface'
              const dot =
                isActive
                  ? 'border-brand-green bg-brand-green'
                  : isCompared
                    ? 'border-brand-teal bg-white'
                    : 'border-text-disabled bg-white'
              return (
                <button
                  key={v.version}
                  type="button"
                  onClick={() =>
                    mode === 'compare'
                      ? !isActive && setCompareWith(v.version)
                      : showVersion(v.version)
                  }
                  title={
                    mode === 'compare'
                      ? isActive
                        ? 'Version active — référence de la comparaison'
                        : `Comparer v${v.version} à la version active`
                      : `Afficher v${v.version}`
                  }
                  className={`relative block w-full text-left py-2 pl-10 pr-3.5 transition-colors ${highlight}`}
                >
                  <span
                    className={`absolute left-[17px] top-[13px] w-[13px] h-[13px] rounded-full border-2 ${dot}`}
                  />
                  <span
                    className={`font-mono text-xs font-bold ${isActive ? 'text-brand-green' : isCompared ? 'text-brand-teal' : ''}`}
                  >
                    v{v.version}
                  </span>
                  {isActive && (
                    <span className="text-[9px] font-bold uppercase tracking-[.06em] px-1.5 py-px rounded-full bg-brand-green text-white ml-1.5 align-[1px]">
                      Active
                    </span>
                  )}
                  {isCompared && (
                    <span className="text-[9px] font-bold uppercase tracking-[.06em] px-1.5 py-px rounded-full bg-brand-teal text-white ml-1.5 align-[1px]">
                      Comparée
                    </span>
                  )}
                  <span className="text-[11px] text-text-disabled ml-1.5">
                    {fmtDate(v.created_at)}
                    {v.created_by ? ` · ${v.created_by}` : ''}
                  </span>
                  {v.comment && (
                    <span className="block text-xs text-text-secondary leading-snug">
                      {v.comment}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="mt-2 pt-2.5 px-4 border-t border-border text-[11px] text-text-disabled leading-snug">
            Cliquer une version l&apos;affiche. L&apos;enregistrer en fait la nouvelle active — rien
            n&apos;est jamais écrasé.
          </div>
        </div>

        {/* ===== Zone de travail ===== */}
        <div className="p-4">
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <span className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={`px-4 py-1.5 text-xs transition-colors ${
                  mode === 'edit' ? 'bg-brand-green text-white font-bold' : 'text-text-secondary hover:bg-surface'
                }`}
              >
                Éditer
              </button>
              <button
                type="button"
                onClick={() => setMode('compare')}
                disabled={versions.length < 2}
                title={versions.length < 2 ? 'Une seule version — rien à comparer' : undefined}
                className={`px-4 py-1.5 text-xs border-l border-border transition-colors disabled:opacity-50 ${
                  mode === 'compare' ? 'bg-brand-green text-white font-bold' : 'text-text-secondary hover:bg-surface'
                }`}
              >
                Comparer
              </button>
            </span>
            {mode === 'compare' && compared && latest ? (
              <span className="text-xs text-text-disabled">
                Différences entre <b className="text-brand-teal">v{compared.version}</b> et{' '}
                <b className="text-brand-green">v{latest.version} (active)</b> — choisir la version
                comparée dans la frise.
              </span>
            ) : viewing !== latest?.version ? (
              <span className="text-xs text-brand-teal bg-brand-teal-light px-2 py-1 rounded-[8px]">
                Version historique — enregistrer en fera la nouvelle version active
              </span>
            ) : null}
          </div>

          {mode === 'edit' ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="w-full h-72 border border-border bg-white rounded-[8px] p-3 font-mono text-xs leading-relaxed focus:outline-none focus:border-brand-green transition-colors"
            />
          ) : (
            <>
              <div className="border border-border bg-white rounded-[8px] overflow-hidden font-mono text-xs leading-[1.7]">
                {!diffHasChanges ? (
                  <div className="px-3.5 py-3 text-text-disabled font-sans">
                    Aucune différence entre v{compared?.version} et v{latest?.version}.
                  </div>
                ) : (
                  diffRows.map((r, i) =>
                    r.kind === 'skip' ? (
                      <div
                        key={i}
                        className="bg-surface/60 text-text-disabled text-[10.5px] px-3.5 py-0.5 border-y border-border first:border-t-0 last:border-b-0"
                      >
                        ⋯ {r.count} ligne{r.count > 1 ? 's' : ''} inchangée{r.count > 1 ? 's' : ''} ⋯
                      </div>
                    ) : r.kind === 'add' ? (
                      <div key={i} className="px-3.5 whitespace-pre-wrap bg-brand-green-light">
                        <span className="font-bold text-brand-green">+ </span>
                        {r.text}
                      </div>
                    ) : r.kind === 'del' ? (
                      <div key={i} className="px-3.5 whitespace-pre-wrap bg-[#fbe9eb] text-[#8a2530]">
                        <span className="font-bold text-brand-red no-underline">− </span>
                        <span className="line-through">{r.text}</span>
                      </div>
                    ) : (
                      <div key={i} className="px-3.5 whitespace-pre-wrap text-text-secondary">
                        {r.text}
                      </div>
                    )
                  )
                )}
              </div>
              {diffHasChanges && (
                <div className="flex gap-4 flex-wrap text-[11.5px] text-text-secondary mt-2">
                  <span>
                    <span className="inline-block w-[11px] h-[11px] rounded-[3px] bg-brand-green-light align-[-1px] mr-1" />
                    Ajouté dans v{latest?.version}
                  </span>
                  <span>
                    <span className="inline-block w-[11px] h-[11px] rounded-[3px] bg-[#fbe9eb] align-[-1px] mr-1" />
                    Retiré de v{compared?.version}
                  </span>
                </div>
              )}
            </>
          )}

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commentaire de version (ex. : durcit l'interdiction de clôtures)"
              className="grow min-w-[220px] border border-border bg-white rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors"
            />
            <button
              type="button"
              onClick={saveNewVersion}
              disabled={busy || !isDirty}
              title={!isDirty ? 'Aucune modification par rapport à la version affichée' : undefined}
              className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
            >
              Enregistrer comme v{(latest?.version ?? 0) + 1}
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
