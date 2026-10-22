# Bottleneck3D

Bottleneck3D показывает, **куда уходит время печати** и что реально изменит
апгрейд (ускорение, скорость, поток хотэнда, мин. время слоя).

Работает как вкладка в **OrcaSlicer 2.5** и как отдельная веб-страница.
Интерфейс: русский и английский. Файлы никуда не загружаются.

---

## Установка плагина в Orca (для всех)

Нужны только OrcaSlicer и один файл. **Node и Python не нужны.**

1. Скачайте плагин из релиза  
   **[v0.4.0 → Assets → `bottleneck3d_orca-0.4.0-py3-none-any.whl`](https://github.com/ContextForgeAI/bottleneck3d/releases/tag/v0.4.0)**  
   (блок Assets внизу страницы; не берите Source code).
2. В Orca: меню ≡ → **Plugins** → **Browse plugins** ▾ →  
   **Install local plugin** → выберите `.whl`.
3. **Перезапустите Orca.**
4. Нарежьте модель → **Export G-code** → откройте вкладку **Bottleneck3D**.

Подробно (RU/EN), обновление, удаление, типичные проблемы:  
**[docs/INSTALL-ORCA.md](docs/INSTALL-ORCA.md)**

Требуется OrcaSlicer **2.5.0-alpha или новее**. Проверено на Windows.

---

## What it does

- **Overview** — total time, the main bottleneck and the file it came from.
- **Time** — time by line role, volumetric flow and per-layer chart.
- **Upgrades** — ready-made upgrade scenarios ranked by savings for this file,
  plus manual levers. Inside Orca, «Check in Orca» reslices the model with the
  chosen change and shows Orca's exact estimate next to the instant forecast.
- **Details** — the motion model, limits and settings read from the file.

## Accuracy

`npm run compare -- <files|folder>` checks the estimate against the one the
slicer wrote into the file. On the current test set (PrusaSlicer 2.5,
OrcaSlicer 2.4 and 2.5.0-alpha with Klipper, including files with G2/G3 arc
fitting) the mean difference is 0.1% and the worst is 0.6%.

The instant upgrade forecast does not reslice the model, so speed and
acceleration changes can differ from a real reslice: the slicer also rebuilds
per-layer slowdowns. «Check in Orca» removes that error; on the test models it
matched Orca's own reslice to the second. The accuracy bench and its results
are in [`demo/accuracy-sweep/`](demo/accuracy-sweep/) and
[`docs/ACCURACY-TEST-PLAN.md`](docs/ACCURACY-TEST-PLAN.md).

All of this is agreement with the slicer's estimator, not with a real printer:
real print times have not been validated yet. Cura, Bambu Studio, SuperSlicer
and newer Orca builds are untested.

## Run the web app (developers)

```bash
npm install
npm start        # dev server, opens the browser
```

Open a `.gcode` file, a `bottleneck3d-report.json`, or the built-in demo.

## Build / install plugin from source (developers)

```bash
npm install
npm run package:orca   # → dist-orca/*.whl  (give this file to users)
npm run install:orca   # build + install into %APPDATA% on this PC
```

Needs Node 24 and [uv](https://docs.astral.sh/uv/). Details:
[`orca-plugin/README.md`](orca-plugin/README.md).

## Checks

```bash
npm test
npm run lint
npm run build
cd orca-plugin && uv run --with pytest pytest tests
```

## Limitations

- The time card shows how far the number can be trusted: «checked against the
  slicer ±X%» or «approximate» with the reason (untested slicer, no estimate or
  config in the file, difference above 1%).
- Cooling impact comes from the configured minimum layer time, not from a
  thermal simulation.
- «Check in Orca» slices the plate as STL: modifiers, painting and per-object
  settings are lost. A baseline reslice without changes is subtracted to cancel
  most of that error.
- Do not base purchase decisions on the forecast alone until it is validated
  against real prints. See [ROADMAP.md](ROADMAP.md) and
  [`docs/IMPROVEMENT-PLAN.md`](docs/IMPROVEMENT-PLAN.md).
