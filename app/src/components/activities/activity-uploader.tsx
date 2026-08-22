'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'

type FileStatus = 'pending' | 'uploading' | 'created' | 'duplicate' | 'error'

interface FileItem {
  file: File
  status: FileStatus
  message?: string
  activityId?: string
}

const ACCEPT = '.fit,.gpx,.tcx'

export function ActivityUploader({ onDone }: { onDone?: () => void }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [items, setItems] = useState<FileItem[]>([])
  const [busy, setBusy] = useState(false)

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) =>
      /\.(fit|gpx|tcx)$/i.test(f.name)
    )
    setItems((prev) => [
      ...prev,
      ...incoming.map((file) => ({ file, status: 'pending' as FileStatus })),
    ])
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
    },
    [addFiles]
  )

  async function upload() {
    const pending = items.filter((i) => i.status === 'pending')
    if (!pending.length) return

    setBusy(true)
    setItems((prev) =>
      prev.map((i) => (i.status === 'pending' ? { ...i, status: 'uploading' } : i))
    )

    const form = new FormData()
    pending.forEach((i) => form.append('files', i.file))

    try {
      const res = await apiFetch('/api/activities/upload', { method: 'POST', body: form })

      // Read the response as text first so we can surface non-JSON errors
      // (500 HTML pages, 413 payload-too-large, ngrok error pages, etc.)
      const raw = await res.text()
      let json: {
        results?: { filename: string; status: FileStatus; message?: string; activityId?: string }[]
        created?: number
        error?: string
      } = {}
      try {
        json = raw ? JSON.parse(raw) : {}
      } catch {
        // Non-JSON response — surface status + a snippet
        const snippet = raw.slice(0, 120).replace(/\s+/g, ' ').trim()
        setItems((prev) =>
          prev.map((i) =>
            i.status === 'uploading'
              ? { ...i, status: 'error', message: `HTTP ${res.status}${snippet ? `: ${snippet}` : ''}` }
              : i
          )
        )
        return
      }

      // Top-level error (401/400/etc.) with no per-file results
      if (!json.results && json.error) {
        setItems((prev) =>
          prev.map((i) =>
            i.status === 'uploading'
              ? { ...i, status: 'error', message: `${json.error} (HTTP ${res.status})` }
              : i
          )
        )
        return
      }

      const byName = new Map<
        string,
        { status: FileStatus; message?: string; activityId?: string }
      >()
      for (const r of json.results ?? []) {
        byName.set(r.filename, {
          status: r.status,
          message: r.message,
          activityId: r.activityId,
        })
      }

      setItems((prev) =>
        prev.map((i) => {
          const r = byName.get(i.file.name)
          return r ? { ...i, ...r } : i
        })
      )

      if ((json.created ?? 0) > 0) {
        router.refresh()
        onDone?.()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      setItems((prev) =>
        prev.map((i) =>
          i.status === 'uploading' ? { ...i, status: 'error', message: `Upload failed: ${message}` } : i
        )
      )
    } finally {
      setBusy(false)
    }
  }

  const pendingCount = items.filter((i) => i.status === 'pending').length

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors',
          dragging
            ? 'border-[var(--primary)] bg-[var(--primary)]/5'
            : 'border-[var(--border)] hover:border-[var(--primary)]/50 hover:bg-[var(--muted)]/40'
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="size-8 text-[var(--muted-foreground)]"
          aria-hidden
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="text-sm font-medium text-[var(--foreground)]">
          Drop .FIT, .GPX, or .TCX files here
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, idx) => (
            <li
              key={`${item.file.name}-${idx}`}
              className="flex items-center gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
            >
              <StatusIcon status={item.status} />
              <span className="flex-1 truncate">{item.file.name}</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                {item.message ?? statusLabel(item.status)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pendingCount > 0 && (
        <Button className="w-full" onClick={upload} disabled={busy}>
          {busy ? 'Uploading…' : `Upload ${pendingCount} file${pendingCount > 1 ? 's' : ''}`}
        </Button>
      )}
    </div>
  )
}

function statusLabel(status: FileStatus): string {
  switch (status) {
    case 'pending':
      return 'Ready'
    case 'uploading':
      return 'Uploading…'
    case 'created':
      return 'Added'
    case 'duplicate':
      return 'Already uploaded'
    case 'error':
      return 'Error'
  }
}

function StatusIcon({ status }: { status: FileStatus }) {
  if (status === 'uploading') {
    return (
      <svg className="size-4 animate-spin text-[var(--muted-foreground)]" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )
  }
  const color =
    status === 'created'
      ? 'text-green-500'
      : status === 'duplicate'
        ? 'text-amber-500'
        : status === 'error'
          ? 'text-red-500'
          : 'text-[var(--muted-foreground)]'
  const path =
    status === 'created'
      ? 'M20 6 9 17l-5-5' // check
      : status === 'error'
        ? 'M18 6 6 18M6 6l12 12' // x
        : 'M12 2v20M2 12h20' // dot-ish placeholder for pending/duplicate
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={cn('size-4', color)} aria-hidden>
      <path d={path} />
    </svg>
  )
}
