'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    setBusy(false)
    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Connexion impossible')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5" htmlFor="username">
          Utilisateur
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="w-full px-3 py-2.5 rounded-[8px] text-sm border border-border bg-surface focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full px-3 py-2.5 rounded-[8px] text-sm border border-border bg-surface focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
        />
      </div>
      {error && <p className="text-xs text-brand-red font-medium">{error}</p>}
      <button
        type="submit"
        disabled={busy || !username || !password}
        className="w-full py-2.5 rounded-[10px] bg-brand-green text-white font-bold text-sm hover:bg-brand-green-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  )
}
