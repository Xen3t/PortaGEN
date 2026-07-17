'use client'

import { useCallback, useEffect, useState } from 'react'

interface User {
  id: number
  username: string
  role: 'admin' | 'user'
  created_at: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
  }, [])

  useEffect(load, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok) {
      setNotice(`Compte « ${data.user.username} » créé (${data.user.role}).`)
      setUsername('')
      setPassword('')
      load()
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function reset(user: User) {
    const pwd = window.prompt(`Nouveau mot de passe pour « ${user.username} » (8 caractères min.) :`)
    if (!pwd) return
    const res = await fetch(`/api/users/${user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    })
    const data = await res.json().catch(() => null)
    setNotice(res.ok ? `Mot de passe de « ${user.username} » réinitialisé.` : `Erreur : ${data?.error}`)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Utilisateurs</h1>
      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-4 py-3 mb-5">
          {notice}
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-medium bg-surface border-b border-border">
            Comptes existants
          </h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        u.role === 'admin' ? 'bg-brand-teal-light text-brand-teal' : 'bg-surface text-text-secondary'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => reset(u)} className="text-xs text-brand-teal hover:underline">
                      Réinitialiser le mot de passe
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="bg-white rounded-[12px] border border-border shadow-sm p-5">
          <h2 className="text-sm font-medium mb-4">Créer un compte</h2>
          <form onSubmit={create} className="space-y-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nom d’utilisateur"
              className="w-full border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe (8 caractères min.)"
              type="text"
              className="w-full border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
              className="w-full border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            >
              <option value="user">Utilisateur (générer, valider)</option>
              <option value="admin">Admin (tout, y compris prompts et comptes)</option>
            </select>
            <button
              type="submit"
              disabled={!username || password.length < 8}
              className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
            >
              Créer le compte
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
