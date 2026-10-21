import { analyzeGcodeText } from '../src/analyzer.ts'
import { DEFAULT_PRINTER_SETTINGS } from '../src/domain/profile.ts'

const lines = ['G21', 'G90', 'M83', 'G92 E0']
for (let layer = 1; layer <= 30; layer += 1) {
  const z = (layer * 0.2).toFixed(2)
  lines.push(
    `G1 Z${z} F1200`,
    'G1 X20 Y20 F12000',
    'G1 X100 Y20 E5 F12000',
    'G1 X100 Y100 E5',
    'G1 X20 Y100 E5',
    'G1 X20 Y20 E5',
  )
}
const gcode = lines.join('\n')
const a = analyzeGcodeText(gcode, DEFAULT_PRINTER_SETTINGS)
const b = analyzeGcodeText(gcode, {
  ...DEFAULT_PRINTER_SETTINGS,
  maxVolumetricFlow: 40,
})
const c = analyzeGcodeText(gcode, {
  ...DEFAULT_PRINTER_SETTINGS,
  acceleration: 35000,
})
console.log('base', a.estimatedSeconds, a.constraintSeconds, a.dominant)
console.log(
  'flow40',
  b.estimatedSeconds,
  b.constraintSeconds,
  'saved',
  a.estimatedSeconds - b.estimatedSeconds,
)
console.log(
  'accel35k',
  c.estimatedSeconds,
  c.constraintSeconds,
  'saved',
  a.estimatedSeconds - c.estimatedSeconds,
)
