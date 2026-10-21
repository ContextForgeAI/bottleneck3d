export type SimulationMode =
  | 'emitted_gcode_audit'
  | 'virtual_path_retiming'
  | 'orca_profile_analysis'
  | 'reslice_simulation'
  | 'hardware_capability'

export const simulationModeLabels: Record<SimulationMode, string> = {
  emitted_gcode_audit: 'Как в G-code сейчас',
  virtual_path_retiming: 'Та же траектория, новые лимиты',
  orca_profile_analysis: 'Анализ профиля Orca',
  reslice_simulation: 'Симуляция переслайса',
  hardware_capability: 'Возможности принтера',
}
