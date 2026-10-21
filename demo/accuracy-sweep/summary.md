# Отчёт: погрешность Bottleneck3D vs Orca (Voron 2.4 R2 300)

Автосбор по `demo/accuracy-sweep/sweep.ts`. Пресет процесса: Voron 0.20 Verify Cube, филамент Voron PLA Star Plast, машина Voron 2.4 R2 300 0.4 (Klipper). OrcaSlicer 2.5.0-alpha.

## Команда CLI, которая сработала

Плоские пресеты (без `inherits`, уникальные имена, `compatible_printers: []`), два флага `--load-settings`, без `--datadir` и без `--export-3mf`:

```
"C:\Program Files\OrcaSlicer\orca-slicer.exe" --slice 0 --arrange 1 --allow-newer-file --load-settings <flat/machine.json> --load-settings <flat/process.json> --load-filaments <flat/filament.json> --outputdir <out> <model.stl>
```

Перезапуск всего прогона:

```
node demo/accuracy-sweep/sweep.ts
```

Кэш G-code: `%TEMP%\b3d-sweep\gcode\`. Повторный анализ без нарезки: `node demo/accuracy-sweep/sweep.ts --analyze-only`.

## Сводка по группам

| Группа | n | средн. \|audit\| % | худш. \|audit\| % | средн. \|whatif\| % | худш. \|whatif\| % | средн. \|delta\| % | худш. \|delta\| % |
|---|---:|---:|---:|---:|---:|---:|---:|
| base | 4 | 0.01 | 0.02 | 1.75 | 2.64 | — | — |
| print_accel | 8 | 0.04 | 0.10 | 3.95 | 7.72 | 150.24 | 269.61 |
| print_accel_raised | 4 | 0.05 | 0.09 | 1.50 | 3.48 | 15.08 | 23.77 |
| travel_accel | 8 | 0.03 | 0.12 | — | — | — | — |
| print_speed | 8 | 0.04 | 0.10 | 2.69 | 5.60 | 240.87 | 414.44 |
| travel_speed | 6 | 0.05 | 0.10 | — | — | — | — |
| flow | 8 | 0.01 | 0.02 | 2.41 | 2.64 | 296.98 | 415.63 |
| machine_accel | 8 | 0.02 | 0.10 | — | — | — | — |
| machine_speed | 6 | 0.07 | 0.21 | — | — | — | — |
| jerk | 8 | 0.03 | 0.07 | — | — | — | — |
| cooling | 6 | 0.03 | 0.09 | 1.76 | 4.03 | 12.49 | 37.43 |
| layer_height | 6 | 0.04 | 0.13 | — | — | — | — |

`audit_err = (B3D(gcode_v) − Orca(gcode_v)) / Orca(gcode_v)`.
`whatif_err = (B3D_whatif(gcode_base, v) − Orca(gcode_v)) / Orca(gcode_v)`.
`delta_err = (pred_delta − real_delta) / |real_delta|`.

What-if считается как вкладка «Апгрейды»: `virtual_limits` + `typicalSpeed` (p90 emitted F), `maxPrintSpeed` рычага = typical×k. Для travel / лимитов машины / jerk / layer_height рычага нет — только audit.

## Топ худших случаев

1. **cube / flow / filament_max_volumetric_speed=8** — audit 0.002%, whatif -2.529%, delta -415.631%. orca=820.000s, notes: —
2. **cube / print_speed / print_speed_x=2** — audit 0.029%, whatif -3.068%, delta -414.443%. orca=809.000s, notes: —
3. **cube / print_speed / print_speed_x=1.5** — audit 0.075%, whatif -2.778%, delta -375.282%. orca=809.000s, notes: —
4. **penholder / print_speed / print_speed_x=2** — audit 0.048%, whatif -5.604%, delta -328.034%. orca=1691.000s, notes: —
5. **penholder / print_speed / print_speed_x=1.5** — audit 0.048%, whatif -4.936%, delta -322.977%. orca=1694.000s, notes: —
6. **penholder / print_accel / print_acceleration_x=4** — audit 0.007%, whatif -7.718%, delta -269.609%. orca=1672.000s, notes: —
7. **penholder / print_accel / print_acceleration_x=2** — audit 0.025%, whatif -6.610%, delta -231.007%. orca=1672.000s, notes: —
8. **penholder / flow / filament_max_volumetric_speed=8** — audit 0.016%, whatif -2.433%, delta -178.331%. orca=1744.000s, notes: —
9. **cube / print_accel / print_acceleration_x=4** — audit 0.037%, whatif -2.746%, delta -169.732%. orca=802.000s, notes: —
10. **cube / print_accel / print_acceleration_x=2** — audit 0.089%, whatif -2.005%, delta -124.052%. orca=802.000s, notes: —

## Пропуски

- quartz: оценка Orca 30663s > 3ч, остальные варианты модели пропущены
- dragon: оценка Orca 18099s > 3ч, остальные варианты модели пропущены

## Как трактовать (черновик)

После прогона смотрите числа в таблице: цель audit |err| ≤ 1% (сейчас у Orca 2.5 + Klipper ожидаемо около +3.8% до порта `plan_klipper`); what-if delta ≤ 15% для ускорения и потока, ≤ 25% для скоростей.

Полные гипотезы по худшим ячейкам — ниже по факту CSV; этот файл перезаписывается скриптом, уточнения добавляются вручную в том же REPORT.md после просмотра.
