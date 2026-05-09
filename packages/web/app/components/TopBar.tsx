'use client'

import { useEffect, useRef, useState } from 'react'

interface Project {
  name: string
  path: string
  status: 'active' | 'paused' | 'broken'
}

interface SearchResult {
  node: { id: string; type: string; name?: string }
  score: number
}

interface TopBarProps {
  project: string
  onProjectChange: (name: string) => void
  onNodeSelect: (id: string) => void
  onRelayout: () => void
  onToggleLock: () => void
}

export function TopBar({ project, onProjectChange, onNodeSelect, onRelayout, onToggleLock }: TopBarProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLive, setIsLive] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: Project[]) => {
        if (Array.isArray(data)) setProjects(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const check = () =>
      fetch('/api/health')
        .then((r) => r.json())
        .then((d: { ok: boolean }) => setIsLive(d.ok === true))
        .catch(() => setIsLive(false))
    check()
    const id = setInterval(check, 15_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setShowResults(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d: { results: SearchResult[] }) => {
          if (Array.isArray(d.results)) {
            setResults(d.results.slice(0, 8))
            setShowResults(true)
          }
        })
        .catch(() => {})
    }, 280)
  }, [query])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ⌘K / Ctrl+K focuses the search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      // F key focuses search when not in an input
      if (e.key === 'f' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const displayProject = project === 'default' ? (projects[0]?.name ?? 'default') : project

  return (
    <header className="topbar">
      <div className="brand" title="NEAT">N</div>

      <div className="crumbs">
        {projects.length > 1 ? (
          <select
            className="project-select"
            value={project}
            onChange={(e) => onProjectChange(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        ) : (
          <span className="repo">{displayProject}</span>
        )}
        <span className="sep">/</span>
        <span className="here">graph view</span>
      </div>

      <div className="topbar-spacer" />

      <div className="top-search" ref={searchRef}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" />
        </svg>
        <input
          ref={inputRef}
          aria-label="Search nodes"
          aria-expanded={showResults}
          placeholder="find · query · @author · #service"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
        />
        {!query && <span className="kbd">⌘K</span>}
        {showResults && results.length > 0 && (
          <div className="search-results" role="listbox">
            {results.map((r) => (
              <div
                key={r.node.id}
                className="search-result-item"
                role="option"
                aria-selected={false}
                onMouseDown={() => {
                  setQuery('')
                  setShowResults(false)
                  onNodeSelect(r.node.id)
                }}
              >
                <span className="sr-name">{r.node.name ?? r.node.id}</span>
                <span className="sr-type">{r.node.type.replace('Node', '').toLowerCase()}</span>
                <span className="sr-score">{r.score.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="top-actions">
        <button className="top-btn" aria-label={isLive ? 'Core connected' : 'Core offline'}>
          <span className={`dot${isLive ? ' live' : ''}`} />
          {isLive ? 'Live' : 'Offline'}
        </button>
        <button className="top-btn" title="Re-run cose layout" onClick={onRelayout}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 8v4l3 2" /><circle cx="12" cy="12" r="9" />
          </svg>
          Layout
        </button>
        <button className="top-btn" title="Toggle node dragging" onClick={onToggleLock}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Lock
        </button>
      </div>
    </header>
  )
}
