import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listUserNotifications } from '@/lib/notifications'

/**
 * Notifications de la cloche (bloc 3.4) : lancements catalogue terminés de
 * l'utilisateur courant. Léger, relu en boucle par la cloche du bandeau.
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ notifications: listUserNotifications(auth.username) })
}
