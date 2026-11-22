'use client'

interface RecallToggleProps {
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}

export function RecallToggle({ checked, disabled, onChange }: RecallToggleProps) {
  return (
    <label
      htmlFor="chat-recall-toggle"
      className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
    >
      <input
        id="chat-recall-toggle"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby="chat-recall-help"
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">Use other chats as memory</span>
        <span id="chat-recall-help" className="block text-xs text-[var(--muted-foreground)]">
          {checked
            ? 'On: this chat can also draw on your other chats. Kept notes and activity notes still apply.'
            : 'Off: this chat starts clean. Kept notes and activity notes still apply.'}
        </span>
      </span>
    </label>
  )
}
