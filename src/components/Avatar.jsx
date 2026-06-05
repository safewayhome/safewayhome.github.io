import { T } from '../theme'

export function initials(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
}

export function Avatar({ name, color, style, title, size = 30 }) {
  return (
    <div title={title || name} style={{
      width: size, height: size, borderRadius: 999, background: color, color: '#fff',
      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: size * 0.4,
      border: `2px solid ${T.panel}`, ...style,
    }}>{initials(name)}</div>
  )
}
