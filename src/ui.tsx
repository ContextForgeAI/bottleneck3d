import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { formatNumber, formatTime } from './format'

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function Kpi({
  label,
  value,
  note,
  tone,
  children,
}: {
  label: string
  value: ReactNode
  note: ReactNode
  tone?: string
  children?: ReactNode
}) {
  return (
    <article className={`kpi ${tone ? `tone-border-${tone}` : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {children}
      <span>{note}</span>
    </article>
  )
}

export function Meter({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="meter">
      <i className={`tone-${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string; disabled?: boolean }>
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          disabled={option.disabled}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ small = false }: { small?: boolean }) {
  return <span className={`spinner ${small ? 'is-small' : ''}`} aria-hidden />
}

/** Seconds that glide to the new value instead of jumping. */
export function AnimatedTime({
  seconds,
  format = formatTime,
}: {
  seconds: number
  format?: (seconds: number) => string
}) {
  const [shown, setShown] = useState(seconds)
  const current = useRef(seconds)

  useEffect(() => {
    const from = current.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 650)
      const eased = 1 - (1 - progress) ** 3
      current.current = from + (seconds - from) * eased
      setShown(current.current)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [seconds])

  return <>{format(shown)}</>
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Range lever that recalculates only when released: dragging updates the shown
 * value, the commit happens on pointer/key release, Enter in the field or ±.
 */
export function Lever({
  label,
  note,
  unit,
  value,
  min,
  max,
  step,
  digits,
  footer,
  changed,
  onCommit,
}: {
  label: string
  note: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  digits: number
  footer: ReactNode
  changed: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const shown = draft ?? value
  const snap = (next: number) => clamp(Math.round(next / step) * step, min, max)

  const commit = (next: number) => {
    setDraft(null)
    setText(null)
    const snapped = Number(snap(next).toFixed(4))
    if (Number.isFinite(snapped) && snapped !== value) onCommit(snapped)
  }
  const release = () => {
    if (draft !== null) commit(draft)
  }
  const fill = ((clamp(shown, min, max) - min) / (max - min)) * 100

  return (
    <div className={`lever ${changed ? 'is-changed' : ''} ${draft !== null ? 'is-dragging' : ''}`}>
      <div className="lever-head">
        <div>
          <span>{label}</span>
          <small>{note}</small>
        </div>
        <div className="lever-value">
          <button type="button" aria-label="−" onClick={() => commit(value - step)}>
            −
          </button>
          <input
            inputMode="decimal"
            value={text ?? formatNumber(shown, digits)}
            onChange={(event) => setText(event.target.value)}
            onFocus={(event) => event.target.select()}
            onBlur={() => {
              if (text !== null) commit(Number(text.replace(/\s/g, '').replace(',', '.')))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') setText(null)
            }}
          />
          <small>{unit}</small>
          <button type="button" aria-label="+" onClick={() => commit(value + step)}>
            +
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
        onTouchEnd={release}
      />
      <div className="lever-foot">{footer}</div>
    </div>
  )
}
