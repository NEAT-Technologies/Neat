'use client'

import { useEffect, useState } from 'react'
import { toastBus, type ToastEvent } from '../../lib/proxy-client'

// ADR-058 #3 — surfaces non-2xx fetch responses as transient toasts.
// Subscribes to `toastBus` populated by trackedFetch. Auto-dismisses after
// six seconds; stacks up to four at a time.
export function Toaster() {
  const [toasts, setToasts] = useState<ToastEvent[]>([])

  useEffect(() => {
    const unsub = toastBus.subscribe((t) => {
      setToasts((prev) => [...prev, t].slice(-4))
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((p) => p.id !== t.id))
      }, 6_000)
    })
    return unsub
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 56,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 999,
      }}
    >
      {toasts.map((t) => {
        const color = t.level === 'error' ? '#e87a7a' : t.level === 'warn' ? '#d3a847' : 'var(--prov-observed)'
        return (
          <div
            key={t.id}
            className="toast"
            onClick={() => setToasts((prev) => prev.filter((p) => p.id !== t.id))}
            style={{
              background: 'var(--ink-2, #14141a)',
              border: `1px solid ${color}`,
              borderLeft: `3px solid ${color}`,
              padding: '8px 12px',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: 'var(--paper-1, #d8d3c9)',
              maxWidth: 360,
              cursor: 'pointer',
              boxShadow: '0 8px 16px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ color, fontWeight: 600 }}>{t.status ?? t.level}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
