import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) redirect('/')
  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-surface">
      <div className="w-full max-w-[380px] bg-white border border-border rounded-[16px] p-6 shadow-sm animate-fade-in-up">
        <h1 className="text-2xl font-bold text-text-primary">PortaGEN V2</h1>
        <p className="text-sm text-text-secondary mb-6">Portail de génération de MES</p>
        <LoginForm />
      </div>
    </main>
  )
}
