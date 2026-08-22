import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Root "/" — handled by middleware but this is a safety fallback
export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  redirect(user ? '/dashboard' : '/login')
}
