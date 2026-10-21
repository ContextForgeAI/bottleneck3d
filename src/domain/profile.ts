import { profileField, type ProfileField } from './sources'

export interface PrinterSettings {
  maxVolumetricFlow: number
  maxPrintSpeed: number
  acceleration: number
  minimumLayerTime: number
  filamentDiameter: number
}

export type PrinterProfile = {
  [Key in keyof PrinterSettings]: ProfileField<PrinterSettings[Key]>
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  maxVolumetricFlow: 12,
  maxPrintSpeed: 250,
  acceleration: 5000,
  minimumLayerTime: 5,
  filamentDiameter: 1.75,
}

export function manualPrinterProfile(
  settings: PrinterSettings,
): PrinterProfile {
  return {
    maxVolumetricFlow: profileField(
      settings.maxVolumetricFlow,
      'manual_override',
      'low',
      undefined,
      ['Веб-MVP пока трактует ввод как override для симуляции.'],
    ),
    maxPrintSpeed: profileField(settings.maxPrintSpeed, 'manual_override', 'low'),
    acceleration: profileField(settings.acceleration, 'manual_override', 'low'),
    minimumLayerTime: profileField(
      settings.minimumLayerTime,
      'manual_override',
      'low',
    ),
    filamentDiameter: profileField(
      settings.filamentDiameter,
      'manual_override',
      'low',
    ),
  }
}

export function settingsFromProfile(profile: PrinterProfile): PrinterSettings {
  return {
    maxVolumetricFlow: profile.maxVolumetricFlow.value,
    maxPrintSpeed: profile.maxPrintSpeed.value,
    acceleration: profile.acceleration.value,
    minimumLayerTime: profile.minimumLayerTime.value,
    filamentDiameter: profile.filamentDiameter.value,
  }
}
