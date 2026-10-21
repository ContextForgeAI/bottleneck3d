import type { ChangeEvent } from 'react'
import { useI18n } from './i18n'
import {
  presetTimingChanges,
  type OrcaPresetKind,
  type OrcaPresetLibrary,
  type PresetSelection,
  type ResolvedPreset,
} from './orca-presets'

interface OrcaPresetPanelProps {
  library: OrcaPresetLibrary | null
  selection: PresetSelection
  resolved: Array<ResolvedPreset | null>
  fileConfig: Record<string, string>
  busy: boolean
  onFiles: (files: FileList) => void
  onSelect: (selection: PresetSelection) => void
}

export function OrcaPresetPanel({
  library,
  selection,
  resolved,
  fileConfig,
  busy,
  onFiles,
  onSelect,
}: OrcaPresetPanelProps) {
  const { t } = useI18n()
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) onFiles(event.target.files)
    event.target.value = ''
  }
  const active = resolved.filter((item): item is ResolvedPreset => item !== null)
  const merged = Object.assign({}, ...active.map((item) => item.config)) as Record<string, string>
  const changes = presetTimingChanges(fileConfig, merged)
  const missing = active.filter((item) => item.missingParent)
  const choices = (kind: OrcaPresetKind) =>
    library?.presets.filter((preset) => preset.kind === kind && preset.instantiable) ?? []
  const count = (kind: OrcaPresetKind) =>
    library?.presets.filter((preset) => preset.kind === kind).length ?? 0

  return (
    <div className="orca-presets">
      <div className="orca-presets-head">
        <strong>{t.presets.title}</strong>
        <span className="preset-sources">
          {busy ? (
            <span>{t.presets.reading}</span>
          ) : (
            <>
              <label className="text-button folder-button">
                <input
                  type="file"
                  multiple
                  ref={(input) => input?.setAttribute('webkitdirectory', '')}
                  onChange={pick}
                />
                {t.presets.folder}
              </label>
              <label className="text-button folder-button">
                <input type="file" accept=".json,application/json" onChange={pick} />
                {t.presets.exportFile}
              </label>
            </>
          )}
        </span>
      </div>

      {!library && <p className="mode-note">{t.presets.help}</p>}

      {library && (
        <>
          <div className="preset-selects">
            {(['machine', 'filament'] as const).map((kind) => (
              <label key={kind}>
                <span>{t.presets.kinds[kind]}</span>
                <select
                  value={selection[kind]}
                  onChange={(event) => onSelect({ ...selection, [kind]: event.target.value })}
                >
                  <option value="">{t.presets.asInGcode}</option>
                  {choices(kind).map((preset) => (
                    <option key={preset.name} value={preset.name}>
                      {preset.name}
                      {preset.from.toLowerCase() === 'user' ? '' : ` · ${t.presets.system}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {changes.length > 0 && (
            <ul className="preset-changes">
              {changes.map((change) => (
                <li key={change.key}>
                  <code>{change.key}</code> {change.file ?? '—'} → <b>{change.preset}</b>
                </li>
              ))}
            </ul>
          )}
          {active.length > 0 && changes.length === 0 && <p className="mode-note">{t.presets.sameAsFile}</p>}
          {missing.length > 0 && (
            <p className="mode-note">
              {t.presets.missingParent(missing.map((item) => `«${item.missingParent}»`).join(', '))}
            </p>
          )}
          <p className="mode-note">{t.presets.found(count('machine'), count('filament'), count('process'))}</p>
        </>
      )}
    </div>
  )
}
