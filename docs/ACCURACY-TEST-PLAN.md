# План теста точности: как ошибается Bottleneck3D при изменении параметров Orca

Задача: для принтера **Voron 2.4 R2 300 (Klipper)** узнать погрешность
Bottleneck3D (B3D) при изменении скорости, ускорения, потока, лимитов машины и
jerk/SCV в OrcaSlicer. Инструкция рассчитана на автономного агента.

## Правила

- **Не менять** код в `src/` (движок расчёта). Новые файлы — только в
  `demo/accuracy-sweep/`. Если найден баг — описать в отчёте, не чинить.
- Не коммитить. Не трогать пресеты пользователя в `%APPDATA%\OrcaSlicer\user` —
  копировать во временную папку.
- Большие G-code/3MF — только в `%TEMP%\b3d-sweep\`, не в репозиторий.
- Отвечать/писать отчёт на русском.

## Что измеряем (две разные погрешности)

1. **Audit** — B3D считает время по G-code, нарезанному Orca с параметром `v`:
   `audit_err = (B3D(gcode_v) − Orca(gcode_v)) / Orca(gcode_v)`.
   Показывает, насколько B3D повторяет оценщик Orca.
2. **What-if** — B3D берёт **базовый** G-code и подставляет `v` рычагом
   (режим `virtual_limits`, как вкладка «Апгрейды»), без переслайса:
   `whatif_err = (B3D_whatif(gcode_base, v) − Orca(gcode_v)) / Orca(gcode_v)`,
   плюс ошибка предсказанной экономии:
   `delta_err = (pred_delta − real_delta) / |real_delta|`, где
   `real_delta = Orca(gcode_v) − Orca(gcode_base)`, `pred_delta = B3D_whatif − B3D(gcode_base)`.
   Это ответ на вопрос пользователя «насколько верить what-if».

## Окружение

- Repo: `C:\PROJECTS\bottleneck3d\bottleneck3d`, Node 24 (TS запускается
  напрямую: `node file.ts`, импорты вида `../../src/analyzer.ts`).
- Orca: `C:\Program Files\OrcaSlicer\orca-slicer.exe` (2.5.0-alpha), данные
  `%APPDATA%\OrcaSlicer` (есть `system\`, `user\default\{machine,process,filament}`).
- Пресеты: machine `Voron 2.4 R2 300 0.4.json`, process `Voron 0.20 Verify Cube.json`
  (и `Voron 0.20 PLA Organizer.json` как второй), filament `Voron PLA Star Plast.json`.
- Полные (resolved) пресеты уже выгружены плагином в
  `%APPDATA%\OrcaSlicer\orca_plugins\plugin_data\bottleneck3d_orca-0.2.0-py3-none-any\bottleneck3d-presets.json`
  (структура — см. `orca-plugin/src/bottleneck3d_orca/preset_export.py`).
- Модели (`C:\Users\Developer\Downloads\`):
  - `XYZ 20mm Calibration Cube - 1278865\files\xyzCalibration_cube.stl` — короткая, много разгонов;
  - `Quartz_Pot.stl` — средняя;
  - `DragonScalePot.stl` — кривые, мелкие сегменты;
  - `Voron_Cube_Penholder.3mf` — проект Orca.
  Если печать > 3 ч на одном варианте — масштабировать модель (`--scale 0.5`) или пропустить.

## Шаг 1. Научиться резать из командной строки

Известно: `orca-slicer.exe` — GUI-приложение, stdout в консоль не пишет; ошибки
пишутся в файл через `Start-Process ... -RedirectStandardOutput/-RedirectStandardError`.
Пользовательские пресеты наследуются (`"inherits"`) от системных; запуск

```
orca-slicer.exe --datadir "%APPDATA%\OrcaSlicer" --slice 0 --arrange 1 `
  --load-settings "machine.json;process.json" --load-filaments "filament.json" `
  --outputdir OUT --export-3mf out.3mf model.stl
```

сейчас падает: `can not resolve preset ... "system"` (без `--datadir`) или
`Slic3r::CLI::run found error, exit` (с ним). Варианты, которые нужно перебрать:

1. Сделать **плоские** пресеты: развернуть цепочку `inherits` вручную (system
   JSON вендора Voron в `%APPDATA%\OrcaSlicer\system\Voron\{machine,process,filament}`
   + user JSON поверх), убрать `inherits`, проставить `"from": "User"`, `"name"`,
   `"type"`, для machine `"printer_settings_id"`, для process
   `"compatible_printers": []`. Либо взять готовые resolved-конфиги из
   `bottleneck3d-presets.json`.
2. Флаги: `--debug 4` (лог), `--allow-newer-file`, `--load-defaultfila`,
   `--uptodate`, `--min-save`; G-code — внутри 3MF `Metadata/plate_1.gcode`
   (распаковать как zip) или `--export-slicedata`.
3. Посмотреть справку: `orca-slicer.exe --help > help.txt 2>&1` через
   `Start-Process -RedirectStandardOutput`.
4. Если CLI не заводится за разумное время (≈1 ч попыток) — **запасной путь**:
   записать в отчёт точные шаги для ручной нарезки в GUI (пользователь сам
   сохранит G-code в папку `%TEMP%\b3d-sweep\manual\<model>\<param>=<value>.gcode`),
   и всё равно сделать шаги 3–4 так, чтобы скрипт работал по этой папке.

Готово, когда кубик режется скриптом, а в G-code есть
`; estimated printing time (normal mode)`.

## Шаг 2. Сетка параметров (по одному за раз от базы)

Изменять в **копии** process/machine JSON. База — значения из пресета.

| Группа | Ключи | Значения |
|--------|-------|----------|
| Ускорение печати | `default_acceleration`, `outer_wall_acceleration`, `inner_wall_acceleration`, `top_surface_acceleration` — все ×k | k = 0.5, 1 (база), 2, 4 |
| Ускорение travel | `travel_acceleration` | 1500, 3000, 6000, 10000 |
| Скорости | `outer_wall_speed`, `inner_wall_speed`, `sparse_infill_speed`, `internal_solid_infill_speed`, `top_surface_speed` — ×k | k = 0.5, 1, 1.5, 2 |
| Travel speed | `travel_speed` | 150, 250, 400 |
| Поток | `filament_max_volumetric_speed` (filament) | 8, 15, 23, 40 |
| Лимиты машины | `machine_max_acceleration_x/_y/_extruding/_travel` | 3000, 6000, 12000, 20000 |
| Лимиты машины | `machine_max_speed_x/_y` | 200, 300, 500 |
| Jerk / SCV | `default_jerk`, `outer_wall_jerk`, `inner_wall_jerk`, `infill_jerk`, `top_surface_jerk`, `travel_jerk` — все = v | 5, 9, 15, 25 |
| Охлаждение | `slow_down_layer_time` (filament) | 0, 6, 15 |
| Высота слоя (только audit) | `layer_height` | 0.12, 0.2, 0.28 |

Если `machine_max_*` ниже значения в процессе — Orca клампит; это тоже полезный
случай (B3D должен клампить так же).

## Шаг 3. Скрипт `demo/accuracy-sweep/sweep.ts`

1. Для каждого `model × variant` нарезать (или взять готовый G-code из кэша
   `%TEMP%\b3d-sweep\gcode\`), распаковать G-code.
2. Распарсить как в `demo/compare-slicer.ts` (`GcodeParser`, `settingsFromSlicerMetadata`).
3. Audit: `evaluateWorkload(workload, settings, 'as_emitted')` → сравнить с
   `workload.slicer.estimatedSeconds`.
4. What-if: взять **базовый** workload и профиль `settings` с изменённым полем
   рычага, вызвать `evaluateWorkload(baseWorkload, profile, 'virtual_limits',
   inferTypicalExtrusionSpeed(baseWorkload))` — ровно как `src/engine-core.ts`.
   Соответствие параметров рычагам B3D (`src/insights.ts` → `LEVERS`):
   - ускорение печати ×k → `acceleration = base.acceleration × k`;
   - скорости ×k → `maxPrintSpeed = base.maxPrintSpeed × k`;
   - поток → `maxVolumetricFlow = v`;
   - `slow_down_layer_time` → `minimumLayerTime = v` (проверить, как B3D это трактует);
   - для групп без рычага (travel, лимиты машины, jerk, layer_height) what-if = «нет» —
     только audit, и отметить в отчёте как «рычага нет».
5. Записать `demo/accuracy-sweep/results.csv`:
   `model,group,param,value,orca_s,b3d_audit_s,audit_err_pct,b3d_whatif_s,whatif_err_pct,real_delta_s,pred_delta_s,delta_err_pct,segments,notes`.

## Шаг 4. Отчёт `demo/accuracy-sweep/REPORT.md`

- Сводная таблица по группам: средняя и худшая |audit_err|, |whatif_err|, |delta_err|.
- Топ-10 худших случаев с гипотезой причины (что меняется в G-code: SCV, M204,
  клампы, cooling slowdown, разные траектории при другой ширине и т.д.).
- Вывод для пользователя простым языком: «what-if по ускорению ошибается на ±X%,
  по скорости ±Y%, по потоку ±Z%; доверять можно / нельзя в таких-то случаях».
- Что нужно поменять в движке (список, без правок кода).
- Как перезапустить: одна команда.

## Критерии

- Audit: цель |err| ≤ 1% (Orca 2.5 + Klipper сейчас ≈ +3.8% — ожидаемо до порта `plan_klipper`).
- What-if delta: цель |delta_err| ≤ 15% для ускорения и потока, ≤ 25% для скоростей
  (при переслайсе Orca меняет и замедления слоёв/нависаний).
