import type { RoleTime } from './domain/result'

export type Lang = 'ru' | 'en'

let lang: Lang = 'ru'

/** Called by the language provider; formatting below follows it. */
export function setFormatLang(next: Lang) {
  lang = next
}

const UNITS = {
  ru: { h: 'ч', min: 'мин', s: 'с', m: 'м', mm: 'мм' },
  en: { h: 'h', min: 'min', s: 's', m: 'm', mm: 'mm' },
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  const unit = UNITS[lang]
  const rounded = Math.round(Math.abs(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const rest = rounded % 60
  if (hours) return `${hours} ${unit.h} ${minutes.toString().padStart(2, '0')} ${unit.min}`
  if (minutes) return `${minutes} ${unit.min} ${rest.toString().padStart(2, '0')} ${unit.s}`
  return `${rest} ${unit.s}`
}

/** Compact axis label: "1.5 ч", "12 мин", "40 с". */
export function shortTime(seconds: number): string {
  const unit = UNITS[lang]
  if (seconds >= 3600) return `${formatNumber(seconds / 3600, 1)} ${unit.h}`
  if (seconds >= 60) return `${Math.round(seconds / 60)} ${unit.min}`
  return `${Math.round(seconds)} ${unit.s}`
}

/** "−12 мин" when faster, "+3 мин" when slower. */
export function formatDelta(seconds: number): string {
  if (Math.abs(seconds) < 1) return '±0'
  return `${seconds < 0 ? '−' : '+'}${formatTime(seconds)}`
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function share(part: number, total: number): number {
  return total > 0 && part > 0 ? (part / total) * 100 : 0
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatLength(mm: number): string {
  const unit = UNITS[lang]
  return mm >= 1000 ? `${formatNumber(mm / 1000, 1)} ${unit.m}` : `${formatNumber(mm)} ${unit.mm}`
}

type RoleKey =
  | 'outer'
  | 'inner'
  | 'overhang'
  | 'infill'
  | 'solid'
  | 'top'
  | 'bottom'
  | 'skin'
  | 'bridge'
  | 'internalBridge'
  | 'gap'
  | 'support'
  | 'supportInterface'
  | 'skirt'
  | 'brim'
  | 'skirtBrim'
  | 'ironing'
  | 'tower'
  | 'custom'

const ROLE_KEYS: Record<string, RoleKey> = {
  'outer wall': 'outer',
  'external perimeter': 'outer',
  'wall-outer': 'outer',
  'inner wall': 'inner',
  perimeter: 'inner',
  'wall-inner': 'inner',
  'overhang wall': 'overhang',
  'overhang perimeter': 'overhang',
  'sparse infill': 'infill',
  'internal infill': 'infill',
  fill: 'infill',
  'internal solid infill': 'solid',
  'solid infill': 'solid',
  'top surface': 'top',
  'top solid infill': 'top',
  'bottom surface': 'bottom',
  skin: 'skin',
  bridge: 'bridge',
  'bridge infill': 'bridge',
  'internal bridge': 'internalBridge',
  'gap infill': 'gap',
  'gap fill': 'gap',
  support: 'support',
  'support material': 'support',
  'support interface': 'supportInterface',
  'support material interface': 'supportInterface',
  'support transition': 'support',
  skirt: 'skirt',
  brim: 'brim',
  'skirt/brim': 'skirtBrim',
  ironing: 'ironing',
  'prime tower': 'tower',
  'wipe tower': 'tower',
  custom: 'custom',
}

const ROLE_LABELS: Record<Lang, Record<RoleKey | 'travel' | 'retract' | 'unmarked', string>> = {
  ru: {
    outer: 'Внешний периметр',
    inner: 'Внутренние периметры',
    overhang: 'Нависающие стенки',
    infill: 'Заполнение',
    solid: 'Сплошное заполнение',
    top: 'Верхняя поверхность',
    bottom: 'Нижняя поверхность',
    skin: 'Верх/низ',
    bridge: 'Мосты',
    internalBridge: 'Внутренние мосты',
    gap: 'Заполнение щелей',
    support: 'Поддержки',
    supportInterface: 'Интерфейс поддержек',
    skirt: 'Юбка',
    brim: 'Кайма',
    skirtBrim: 'Юбка / кайма',
    ironing: 'Разглаживание',
    tower: 'Башня очистки',
    custom: 'Служебный G-code',
    travel: 'Перемещения',
    retract: 'Ретракты',
    unmarked: 'Печать без метки',
  },
  en: {
    outer: 'Outer wall',
    inner: 'Inner walls',
    overhang: 'Overhang walls',
    infill: 'Sparse infill',
    solid: 'Solid infill',
    top: 'Top surface',
    bottom: 'Bottom surface',
    skin: 'Top/bottom',
    bridge: 'Bridges',
    internalBridge: 'Internal bridges',
    gap: 'Gap fill',
    support: 'Supports',
    supportInterface: 'Support interface',
    skirt: 'Skirt',
    brim: 'Brim',
    skirtBrim: 'Skirt / brim',
    ironing: 'Ironing',
    tower: 'Prime tower',
    custom: 'Custom G-code',
    travel: 'Travel',
    retract: 'Retracts',
    unmarked: 'Unmarked print',
  },
}

export function roleLabel(role: RoleTime): string {
  const labels = ROLE_LABELS[lang]
  if (role.kind === 'travel') return labels.travel
  if (role.kind === 'retract') return labels.retract
  if (!role.role) return labels.unmarked
  const key = ROLE_KEYS[role.role.toLowerCase()]
  return key ? labels[key] : role.role
}

/** Stable colour family per role kind; print roles cycle through a palette. */
const ROLE_PALETTE = [
  '#68ff9c',
  '#4fd1a5',
  '#9be15d',
  '#38bdf8',
  '#a78bfa',
  '#f472b6',
  '#facc15',
  '#fb923c',
  '#2dd4bf',
  '#c084fc',
]

export function roleColor(role: RoleTime, index: number): string {
  if (role.kind === 'travel') return '#64748b'
  if (role.kind === 'retract') return '#475569'
  return ROLE_PALETTE[index % ROLE_PALETTE.length]
}
