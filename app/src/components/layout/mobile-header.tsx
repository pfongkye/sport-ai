'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

const itemClass =
  'flex w-full min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none cursor-pointer text-[var(--foreground)] data-[highlighted]:bg-[var(--muted)]'

/** Top bar shown below md only: logo + menu with Settings and Sign out (sidebar is hidden there). */
export function MobileHeader() {
  const pathname = usePathname()
  const signOutForm = useRef<HTMLFormElement>(null)
  const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/')

  return (
    <header className="md:hidden sticky top-0 z-40 flex items-center justify-between bg-[var(--card)] border-b border-[var(--border)] px-4 pt-[env(safe-area-inset-top)] h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0">
      <Link href="/dashboard" className="flex items-center gap-2.5">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--primary)] text-white text-sm font-bold shrink-0">
          S
        </div>
        <span className="font-semibold text-[var(--foreground)]">SportAI</span>
      </Link>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Open menu"
            className="-mr-2 flex size-11 items-center justify-center rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-6" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-[60] min-w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg"
          >
            <DropdownMenu.Item asChild>
              <Link
                href="/settings"
                aria-current={settingsActive ? 'page' : undefined}
                className={cn(itemClass, settingsActive && 'text-[var(--primary)]')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </Link>
            </DropdownMenu.Item>
            <form ref={signOutForm} action="/api/auth/signout" method="POST">
              <DropdownMenu.Item
                asChild
                onSelect={(e) => {
                  // Submit before the menu unmounts, otherwise the POST can be cancelled.
                  e.preventDefault()
                  signOutForm.current?.requestSubmit()
                }}
              >
                <button type="submit" className={itemClass}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </DropdownMenu.Item>
            </form>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  )
}
