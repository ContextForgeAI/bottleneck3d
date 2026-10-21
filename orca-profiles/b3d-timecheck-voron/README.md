# B3D TimeCheck — Voron 2.4 R2 300

Тестовые профили Orca, чтобы сверить **время Orca** с **Bottleneck3D** на одной и той же траектории.

Старый `DragonScalePot …_1h33m.gcode` был:
- принтер `Voron 2.4 R2 300 0.4`
- process `Voron 0.28 PLA Dragon Scales Vase` (vase 0.28 / F≈50 / accel≈1500)
- filament `Voron PLA Star Plast` (max vol **10**, **slow_down_layer_time=12**)

Из‑за layer slowdown Orca часто пишет F ниже 50 → в B3D «типичная скорость пути» ~30 мм/с. Это нормально для того файла, но мешает чистой сверке.

## Что установлено в Orca

| Тип | Имя |
|---|---|
| Printer | `Voron 2.4 R2 300 0.4` (уже был) |
| Filament | **`B3D TimeCheck Voron PLA`** |
| Process (Dragon / vase) | **`B3D TimeCheck Voron Vase 0.28`** |
| Process (куб / детали) | **`B3D TimeCheck Voron Parts 0.20`** |

Filament = Star Plast (190/195, bed 60, flow 0.95, max vol **10**), но **`slow_down_layer_time = 0`**.

## Как прогнать сверку (Dragon)

1. Перезапусти Orca (или File → Reload), чтобы подхватил профили.
2. Printer: `Voron 2.4 R2 300 0.4`
3. Filament: `B3D TimeCheck Voron PLA`
4. Process: `B3D TimeCheck Voron Vase 0.28`
5. Тот же STL DragonScalePot → Slice
6. Запиши **Estimated time** из Orca
7. Export G-code → открой в Bottleneck3D

### В Bottleneck3D (секция 01 / what-if)

| Параметр | Значение |
|---|---|
| Макс. объёмный поток | **10** мм³/с |
| Макс. скорость печати | **150–200** (потолок машины; audit сам берёт F из файла) |
| Ускорение | **1500** мм/с² |
| Мин. время слоя | **0** с |

What-if «скорость пути» после загрузки должен встать около **~50 мм/с** (не ~30).  
Сравни: **Orca estimated** vs **B3D «как в файле»**.

Ожидание: B3D повторяет оценщик Orca и должен совпасть в пределах ~0.1%. Сверка без UI: `npm run compare -- <файл или папка>`. Если уедет больше чем на 1% — пиши оба числа.

## Parts-профиль

Для куба/калибровочной детали: process `B3D TimeCheck Voron Parts 0.20`, в B3D accel **3000**, flow **10**, min layer **0**.

## Важно

- Orca `slow_down_layer_time` **замедляет F**, B3D `min layer time` **добавляет паузы** — разные модели. Для сверки тестовый filament отключает slowdown.
- Vase 0.28 × ширина 0.6 × 50 мм/с ≈ **8.4 мм³/с** &lt; 10 → flow почти не жмёт; главный рычаг — скорость пути / геометрия.
