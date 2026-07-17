import type { Metadata } from 'next'
import { Titillium_Web } from 'next/font/google'
import { getSessionUser } from '@/lib/auth/session'
import { DEFAULT_BRAND, getUserBrand } from '@/lib/brands'
import './globals.css'

const titilliumWeb = Titillium_Web({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700'],
  variable: '--font-titillium',
})

export const metadata: Metadata = {
  title: 'PortaGEN V2',
  description: 'Portail de génération de MES — HoorTrade Média',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La marque active de l'utilisateur teinte toute l'app (html[data-brand]).
  const user = await getSessionUser()
  const brand = user ? getUserBrand(user.id) : DEFAULT_BRAND
  return (
    <html lang="fr" data-brand={brand} className={titilliumWeb.variable}>
      <body className="bg-surface text-text-primary min-h-screen antialiased">{children}</body>
    </html>
  )
}
