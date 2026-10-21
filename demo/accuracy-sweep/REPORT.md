# Погрешность Bottleneck3D vs OrcaSlicer 2.5 (Voron 2.4 R2 300, Klipper)

Пресеты: машина `Voron 2.4 R2 300 0.4`, процесс `Voron 0.20 Verify Cube` (слой 0.2, стенки 2, гироид 15%, accel 5000, wall 100/150, infill 180), филамент `Voron PLA Star Plast` (flow 23 мм³/с, `slow_down_layer_time=6`). OrcaSlicer **2.5.0-alpha**. Движок `src/` не менялся.

Модели в сетке: **cube** (XYZ 20 mm, 13 мин 35 с, 29 176 сегментов) и **penholder** (Voron Cube Penholder.3mf, 28 мин 40 с, 86 474 сегмента). Quartz Pot (8 ч 31 мин) и DragonScalePot (5 ч 02 мин) нарезаны только в базе и отброшены: оценка печати > 3 ч.

## 1. Как запустить CLI

Сработало **без** `--datadir` и **без** `--export-3mf`. Нужны плоские JSON (цепочка `inherits` развёрнута из `bottleneck3d-presets.json`, имена уникальные, `compatible_printers: []`):

```
"C:\Program Files\OrcaSlicer\orca-slicer.exe" --slice 0 --arrange 1 --allow-newer-file --load-settings <TEMP>\b3d-sweep\flat\machine.json --load-settings <TEMP>\b3d-sweep\flat\process.json --load-filaments <TEMP>\b3d-sweep\flat\filament.json --outputdir <OUT> <model.stl>
```

Два отдельных `--load-settings` (machine, затем process). G-code появляется как `plate_1.gcode` в `--outputdir`. Успех = комментарий `; estimated printing time (normal mode)`.

Перезапуск всего прогона (нарезка кэшируется в `%TEMP%\b3d-sweep\gcode\`):

```
node demo/accuracy-sweep/sweep.ts
```

Только пересчёт CSV по кэшу: `node demo/accuracy-sweep/sweep.ts --analyze-only`. Подмножество моделей: `--models cube,penholder`. Плоские пресеты: `node demo/accuracy-sweep/flatten-presets.ts`.

Что **не** сработало (не повторять):

| Попытка | Результат |
|---|---|
| `--load-settings` с user JSON и `inherits` | `can not resolve preset ... system` (без datadir) |
| `--datadir %APPDATA%\OrcaSlicer` + user JSON | процесс находится, но `process not compatible with printer` |
| `--export-3mf` с абсолютным путём | путь склеивается с outputdir, `Project export ... failed` |
| PowerShell `Start-Process -ArgumentList` без кавычек на STL с пробелами/` - ` | `Invalid option --` |
| `--load-settings "machine;process"` одной строкой | в PS легко ломается на `;`; надёжнее два флага |
| `--scale 0.4` / `0.5` / `0.7` для горшков | флаг принимается, но объект отрывается от стола: `empty first layer` |

На Windows GUI-exe удобнее гонять из Node (`spawn` + `windowsHide`) или `Start-Process -WindowStyle Hidden -RedirectStandardOutput/Error` с **процитированной** командной строкой и таймаутом.

## 2. Сводка погрешностей по группам

Пустые what-if/delta — групп без рычага B3D (travel, лимиты машины, jerk, высота слоя). `delta_err` считается только если `|real_delta| ≥ 0.5 с`.

| Группа | n | средн. \|audit\| % | худш. \|audit\| % | средн. \|whatif\| % | худш. \|whatif\| % | средн. \|delta\| % | худш. \|delta\| % |
|---|---:|---:|---:|---:|---:|---:|---:|
| base | 4 | 3.34 | 6.30 | 3.39 | 6.30 | — | — |
| print_accel | 8 | 4.23 | 7.08 | 5.16 | 10.21 | **258** | **572** |
| travel_accel | 8 | 4.61 | 8.45 | — | — | — | — |
| print_speed | 8 | 3.93 | 6.54 | **18.9** | **69.0** | **1546** | **3829** |
| travel_speed | 6 | 4.07 | 6.31 | — | — | — | — |
| flow | 8 | 4.04 | 6.30 | 4.04 | 6.30 | 43 | 48 |
| machine_accel | 8 | 4.34 | 7.56 | — | — | — | — |
| machine_speed | 6 | 4.11 | 6.35 | — | — | — | — |
| jerk / SCV | 8 | 3.49 | 6.43 | — | — | — | — |
| cooling | 6 | 3.76 | 6.65 | 11.3 | 35.3 | 63 | 101 |
| layer_height | 6 | 4.10 | 6.37 | — | — | — | — |

Audit по моделям: cube **+1.96%** средняя / **+3.97%** худшая; penholder **+6.19%** / **+8.45%**; quartz база +2.94%; dragon база +2.24%. Цель плана ≤1% не достигнута (ожидаемый зазор Orca 2.5 + Klipper, в плане ~+3.8%).

What-if: как вкладка «Апгрейды» — `evaluateWorkload(base, profile, 'virtual_limits', typicalSpeed)`, `maxPrintSpeed` базы = round(p90 emitted F).

## 3. Топ-5 худших случаев (гипотезы)

1. **cube, скорость ×2** (и ×1.5) — audit ~+2%, whatif −26%, **delta −3829%**.  
   Orca: 815 с → 809 с (−6 с). Слои кубика упираются в `slow_down_layer_time=6`: слайсер не отдаёт удвоенный F. B3D масштабирует все extrusion F от typical и предсказывает −236 с. Знаменатель `real_delta` крошечный → огромный `delta_err`. То же на ×0.5: Orca +43 с, B3D +620 с.

2. **penholder, скорость ×2** — audit +6.5%, whatif −5%, **delta −670%**.  
   Та же картина, чуть мягче: пенал длиннее, часть ходов не охлаждается, Orca всё же снимает 29 с (1720→1691), B3D — 223 с.

3. **penholder / cube, ускорение ×4 и ×2** — delta от −200% до −572%.  
   В G-code `default_acceleration = 20000`, но `machine_max_acceleration_* = 6000` и emitted `SET_VELOCITY_LIMIT ACCEL=6000`. Orca клампит. What-if B3D при рычаге выше базы **поднимает** machine envelope (`accelerationScale` → lift), поэтому предсказывает экономию, которой слайсер не даёт (куб: −13 с реально, −62 с в what-if).

4. **cube, `slow_down_layer_time=0`** — audit +4.0%, whatif +35%, **delta +101%**.  
   Orca переслайсит и снимает замедление с F (815→615 с, −200 с). What-if крутит `minimumLayerTime=0` по **уже замедленному** базовому G-code; паузы и так нулевые, F не «разгоняется». Модели разные: Orca режет F, B3D добавляет паузы. На `=15` куб даже неплох (delta −8.7%), потому что оба просто накидывают много времени.

5. **penholder, travel_accel=1500** — худший **audit +8.45%** (рычага нет).  
   Travel в пенале заметнее, чем в кубе. B3D в audit всё ещё быстрее «отстаёт» от Orca на коротких travel+junction. Гипотеза: остаточный зазор планировщика (SCV/ACCEL_TO_DECEL vs оценщик Orca) на travel, плюс общий bias penholder ~+6%.

Дополнительно, не в топе по delta, но важно: **поток 8 мм³/с** почти не меняет время (куб +5 с, пенал +24 с) — эти модели не упираются в хотенд при 23 мм³/с. What-if недооценивает даже этот малый эффект (delta ≈ −38…−48%). Поток 15/23/40 неотличим от базы.

## 4. Вывод простым языком

- **Audit (наш расчёт по уже нарезанному G-code)** на Voron/Klipper сейчас **стабильно завышает** время: кубик примерно **+2%**, пенал **+6%** (худшая ячейка +8.5% на медленном travel). Цели ±1% нет. Цифрам «сколько займёт этот файл» можно верить как оценке «чуть дольше Orca», не как совпадению до минуты.
- **What-if по ускорению** на этих пресетах **нельзя** принимать за чистую монету, если новый accel ≥ лимита машины (6000). Orca клампит, вкладка «Апгрейды» лимит поднимает. Реальная экономия на кубе/пенале при ×2/×4 — единицы процентов, B3D рисует заметно больше. Понижение accel ×0.5 честнее (delta ~+40%, направление верное).
- **What-if по скорости** на деталях с `slow_down_layer_time=6` **почти бесполезен**: Orca почти не ускоряет (слои и так растянуты охлаждением), B3D масштабирует F и обещает минуты, которых не будет. Доверять нельзя, пока what-if не знает про cooling slowdown в F.
- **What-if по потоку** на этих моделях почти ничего не меняет (узкое место не хотенд). На «горячих» профилях сетка не проверялась.
- **What-if по охлаждению** совпадает с Orca только когда оба **добавляют** время (`slow_down=15`). Выключить замедление (`=0`) what-if не умеет: он не переписывает F.
- Travel, jerk/SCV, лимиты машины, высота слоя — **рычагов в UI нет**. Audit по ним следит за Orca с тем же +2…+8%. Jerk в G-code реально меняет `SQUARE_CORNER_VELOCITY` (5 vs 12) и время (куб 864 с при 5 vs 807 с при 15).

## 5. Что поменять в движке (без правок в этом прогоне)

1. **Не поднимать machine envelope** в `virtual_limits`, если пользователь двинул только process-accel. Либо клампить рычаг `acceleration` по `machine_max_acceleration_*` из config, либо завести отдельный рычаг «лимит машины». Сейчас ×2/×4 врут из-за lift в `engine-core`/`evaluateWorkload`.
2. **What-if скорости vs layer cooling.** Пока min layer time в audit принудительно 0 (F уже замедлен), рычаг `maxPrintSpeed` не воспроизводит переслайс. Нужна либо модель «снять slowdown с F», либо честно писать в UI, что на охлаждаемых слоях экономия завышена.
3. **Развести Orca-slowdown и B3D-паузы** в подсказке к `minimumLayerTime`. `=0` на what-if ≠ переслайс с `slow_down_layer_time=0`.
4. **Рычаги travel / SCV (jerk) / machine_max_*** — их нет, а время они меняют (особенно travel accel на пенале и jerk на кубе).
5. **Разбор +6% audit на penholder vs +2% на кубе.** Похоже на travel/junction; куб почти без travel. Имеет смысл смотреть `plan_klipper` на travel + `ACCEL_TO_DECEL`.
6. What-if **потока** на не-hotend-bound моделях шумит на малых delta — для UI лучше не показывать «−X%», если `|pred_delta|` меньше порога.

Найденные баги **не чинились** (правило: только `demo/accuracy-sweep/`).

## 6. Что не удалось

- Полная сетка на Quartz Pot и DragonScalePot: база 8 ч 31 мин и 5 ч 02 мин, G-code 84 и 49 МБ. `--scale` в CLI отрывает модель от стола. Остались cube + penholder (минимум плана выполнен).
- What-if для travel / machine limits / jerk / layer height — нет соответствующих LEVERS.
- Совместимость user-пресетов через `--datadir` так и не завелась (`compatible 0` даже при `compatible_printers` с именем user-машины). Обход — плоские копии с пустым `compatible_printers`.
- Справка `orca-slicer.exe --help` в файлы не пишется (GUI-подсистема).

## 7. Созданные файлы

В репозитории:

- `demo/accuracy-sweep/flatten-presets.ts` — плоские пресеты из экспорта плагина
- `demo/accuracy-sweep/orca-cli.ts` — запуск Orca, таймаут, kill
- `demo/accuracy-sweep/sweep.ts` — сетка, audit/what-if, CSV
- `demo/accuracy-sweep/results.csv` — 76 строк (37 cube + 37 penholder + базы quartz/dragon)
- `demo/accuracy-sweep/REPORT.md` — этот отчёт
- `demo/accuracy-sweep/summary.md` — таблица, которую перезаписывает `sweep.ts`

В `%TEMP%\b3d-sweep\` (не в git): `flat\`, `models\`, `gcode\<model>\*.gcode`, `work\`.

## 8. После улучшений

Движок what-if (`virtual_limits`) научился повторять слойное охлаждение Orca и больше не масштабирует travel. Audit (`as_emitted`) не менялся. Новые срезы: `print_accel_k{2,4}_raised` — те же печатные ускорения ×k, плюс `machine_max_acceleration_*` ×k, чтобы сравнивать апгрейд железа с поднятым конвертом.

`pred_delta` по-прежнему `B3D_whatif − B3D_audit(база)`. Identity what-if куба ~811 с при audit 830 с (Orca 815 с), поэтому у рычагов есть постоянный сдвиг ≈ −19 с относительно audit; ниже ошибка ещё и как доля от `orca_base`.

### Скорость и охлаждение (главное)

| Модель | Вариант | real_Δ с | pred до | pred после | (pred−real)/orca_base |
|---|---|---:|---:|---:|---:|
| cube | скорость ×0.5 | +43 | +620 | **+42** | 70.7% → **−0.1%** |
| cube | скорость ×1.5 | −6 | −174 | −29 | −20.6% → **−2.8%** |
| cube | скорость ×2 | −6 | −236 | −30 | −28.2% → **−3.0%** |
| cube | `slow_down_layer_time=0` | −200 | +2 | **−191** | 24.8% → **+1.1%** |
| cube | `slow_down_layer_time=15` | +820 | +748 | **+829** | −8.8% → **+1.1%** |
| penholder | скорость ×0.5 | +418 | +757 | **+400** | 19.7% → **−1.0%** |
| penholder | скорость ×1.5 | −26 | −170 | −109 | −8.4% → −4.8% |
| penholder | скорость ×2 | −29 | −223 | −121 | −11.3% → −5.3% |
| penholder | `slow_down=0` | −42 | 0 | **−53** | 2.4% → **−0.6%** |
| penholder | `slow_down=15` | +1013 | +580 | **+1088** | −25.2% → **+4.3%** |

Куб больше не обещает минуты на ×2: слои упираются в 6 с, как у Orca. Выключить охлаждение (`=0`) what-if умеет: снимает вшитое в F замедление.

### Ускорение и конверт машины

| Модель | Вариант | real_Δ с | pred до | pred после | (pred−real)/orca_base |
|---|---|---:|---:|---:|---:|
| cube | accel ×0.5 | +54 | +78 | +9 | 2.9% → −5.6% |
| cube | accel ×2 (Orca клампит 6000) | −13 | −39 | −32 | −3.2% → −2.4% |
| cube | accel ×4 (кламп) | −13 | −62 | −39 | −6.0% → −3.2% |
| cube | accel ×2 **+ machine 12000** | −30 | — | **−32** | **−0.3%** |
| cube | accel ×4 **+ machine 24000** | −46 | — | **−39** | **+0.9%** |
| penholder | accel ×0.5 | +236 | +327 | **+223** | 5.3% → **−0.8%** |
| penholder | accel ×2 (кламп) | −48 | −202 | −184 | −9.0% → −7.9% |
| penholder | accel ×4 (кламп) | −48 | −323 | −213 | −16.0% → −9.6% |
| penholder | accel ×2 **+ machine** | −143 | — | −184 | **−2.4%** |
| penholder | accel ×4 **+ machine** | −229 | — | **−213** | **+0.9%** |

Без поднятого конверта Orca не отдаёт ×2/×4 (кламп 6000) — what-if по-прежнему считает апгрейд железа и пишет предупреждение в карточке «Итог». С поднятым конвертом ошибка куба единицы секунд.

Пенал ×0.5: переоценка ~40% ушла (327→223 при real 236). Куб ×0.5 недооценён относительно audit из‑за сдвига identity; travel больше не масштабируется (как у Orca).

Поток 8 мм³/с по-прежнему почти ничего не меняет (куб real +5 с).

### Audit (не менялся)

| Файл | до | после |
|---|---:|---:|
| cube | +1.87% | +1.87% |
| penholder | +6.30% | +6.30% |
| quartz | +2.94% | +2.94% |
| dragon | +2.24% | +2.24% |
| ps5-stand | +3.8% | +3.8% |

Порт `plan_klipper` Orca 2.5 не вливался: текущий `klipper` — полный lookahead toolhead.py, у Orca окно `klipper_junction_flush` ~0.25 с и другая сборка trapezoid. Наивный порт за разумное время не выбил |audit| ≤ 1%. Регрессия не-Orca-2.5 не тронута: auto +0.0 / +0.0 / −0.0 / −0.6 / +3.8.

CSV: `demo/accuracy-sweep/results.csv` (80 строк, включая `print_accel_raised`). База до правок: `results-before.csv`.

## 9. Порт оценщика Orca 2.5.0-alpha (Klipper JD)

Файлы сетки и `ps5-stand.gcode` нарезаны **OrcaSlicer 2.5.0-alpha**. В этом теге **нет** `TimeMachine::plan_klipper` (он появился позже на `main`). Оценщик alpha для `gcode_flavor=klipper` — это тот же Marlin-планировщик, что у `orca_jerk` (окно 256/64, reverse→forward, centripetal cap), но стык считается через `calc_vmax_junction_deviation`: `jd = scv²(√2−1)/accel`, косинус по XYZE, на 90° получается `v ≈ scv`, `safe_feedrate = 0`. `ACCEL_TO_DECEL` / `MINIMUM_CRUISE_RATIO` в alpha в время не входят. Порт `plan_klipper` с `main` дал те же ~+2%/+6%, что полный lookahead toolhead.py: это другая модель, не та, что записала `; estimated printing time`.

Поэтому `junctionModelFor(Orca ≥ 2.5, klipper)` теперь возвращает **`orca_klipper`**: Marlin-трапеции + JD из SCV. Модель `klipper` оставлена как «как реальный принтер».

Прогон: `node demo/accuracy-sweep/sweep.ts --analyze-only` по кэшу `%TEMP%\b3d-sweep\gcode`. Цель |audit| ≤ 1% на всех файлах Orca 2.5 + Klipper **достигнута** (худшая ячейка сетки 0.21%).

### Audit до / после

| Файл | до | после |
|---|---:|---:|
| cube | +1.87% | **+0.01%** |
| penholder | +6.30% | **+0.02%** |
| quartz | +2.94% | **−0.00%** |
| dragon | +2.24% | **+0.00%** |
| ps5-stand | +3.8% | **−0.0%** |

### What-if (реальный Δ Orca vs прогноз B3D, секунды)

`pred_delta = B3D_whatif(база) − B3D_audit(база)`. Identity what-if куба 798 с при audit 815 с (сдвиг ≈ −17 с).

| Модель | Вариант | real_Δ с | pred до | pred после |
|---|---|---:|---:|---:|
| cube | accel ×0.5 | +54 | +9 | +7 |
| cube | speed ×2 | −6 | −30 | −31 |
| penholder | speed ×1.5 | −26 | −109 | −110 |
| penholder | speed ×2 | −29 | −121 | −124 |
| penholder | accel ×0.5 | +236 | +223 | +190 |

What-if по ускорению ×0.5 и по скорости **не** вышел на уровень audit: вкладка «Апгрейды» масштабирует уже нарезанный G-code (`virtual_limits`), а Orca переслайсивает (другой `SET_VELOCITY_LIMIT`, охлаждение слоёв в F). Audit того же переслайса точен (куб accel ×0.5: Orca 869 с, audit 869.9 с).

### Регрессия `npm run compare` (колонка auto)

Не-Orca-2.5 не изменились: Doniczki **+0.0**, DragonScalePot 2.4 **+0.0**, Scale pot **−0.0**, DefaultPrinter 2.4 **−0.6**. ps5-stand (Orca 2.5.0-alpha) **+3.8 → −0.0**.

### Проверки

`npx tsc -b`, `npx eslint src`, `npx vitest run` — зелёные (44 теста).
