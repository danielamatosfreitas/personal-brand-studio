'use client'

import { useEffect } from 'react'
import type { LinkedInOrganization } from '../services/api'

// ── Ícones ─────────────────────────────────────────────────────────────────────

export function IconLinkedIn({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  )
}

export function IconFacebook({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
    </svg>
  )
}

export function IconInstagram({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  )
}

export function IconSpinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

export function IconCalendar({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/>
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" strokeLinecap="round"/>
      <path d="M8 13.5h2M8 17h2M14 13.5h2M14 17h2" strokeLinecap="round"/>
    </svg>
  )
}

export function IconCheck() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
    </svg>
  )
}

// ── Toast ──────────────────────────────────────────────────────────────────────

interface ToastProps {
  message: string
  type: 'success' | 'error'
  onClose: () => void
}

export function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className={`fixed bottom-6 right-6 left-6 sm:left-auto z-50 flex items-center gap-3 px-5 py-3.5 rounded-brand-lg shadow-brand-lg text-sm font-medium animate-slide-up border-l-4 ${
      type === 'success'
        ? 'bg-brand-primary text-brand-background border-brand-gold'
        : 'bg-brand-text text-brand-background border-brand-accent'
    }`}>
      {type === 'success' ? <IconCheck/> : '×'}
      {message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  )
}

// ── Seletor de destino no LinkedIn (perfil pessoal ou Página de empresa) ───────

interface LinkedInDestinationFieldProps {
  orgs: LinkedInOrganization[]
  value: string
  onChange: (v: string) => void
}

export function LinkedInDestinationField({ orgs, value, onChange }: LinkedInDestinationFieldProps) {
  if (orgs.length === 0) return null // sem Página disponível — só existe o perfil pessoal mesmo

  return (
    <div className="mb-4">
      <label className="field-label">
        Publicar como
      </label>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)} className="select pr-8">
          <option value="">Perfil pessoal</option>
          {orgs.map(org => (
            <option key={org.urn} value={org.urn}>{org.name}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-muted text-xs">▾</span>
      </div>
    </div>
  )
}

// ── Ícones de navegação ────────────────────────────────────────────────────────

const navSvg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function IconHome({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg {...navSvg} className={className}><path d="M4 11l8-6.5 8 6.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/></svg>
}
export function IconCreate({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg {...navSvg} className={className}><path d="M12 20h8"/><path d="M15.5 4.5l4 4L8 20H4v-4L15.5 4.5z"/></svg>
}
export function IconClock({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg {...navSvg} className={className}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
}
export function IconStories({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg {...navSvg} className={className}><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><circle cx="12" cy="10.5" r="2.8"/><path d="M9.5 17h5"/></svg>
}
export function IconUpload({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg {...navSvg} className={className}><path d="M12 16V4.5"/><path d="M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15v4.5h15V15"/></svg>
}
export function IconLink({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg {...navSvg} className={className}><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>
}
export function IconArrow({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg {...navSvg} className={className}><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
}
export function IconMenu({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg {...navSvg} className={className}><path d="M4 7h16M4 12h16M4 17h16"/></svg>
}
export function IconClose({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg {...navSvg} className={className}><path d="M6 6l12 12M18 6L6 18"/></svg>
}

// ── Logo da marca (recorte circular) ───────────────────────────────────────────

export function BrandLogo({ size = 40 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="rounded-full overflow-hidden ring-1 ring-brand-gold/60 flex-shrink-0 bg-white">
      <img src="/images/logo.jpg" alt="Capital Humano Intelligence" className="w-full h-full object-cover scale-[1.7]"/>
    </div>
  )
}
