# Bottleneck3D

[![GitHub release](https://img.shields.io/github/v/release/ContextForgeAI/bottleneck3d?include_prereleases)](https://github.com/ContextForgeAI/bottleneck3d/releases)
[![Downloads](https://img.shields.io/github/downloads/ContextForgeAI/bottleneck3d/total)](https://github.com/ContextForgeAI/bottleneck3d/releases)

**Analyze any G-code in your browser. Get deeper insights and verify upgrade
scenarios inside OrcaSlicer 2.5+.**

Bottleneck3D is a local-first **3D print time analyzer** and **G-code bottleneck
analysis** tool. Open an exported print file and see **where the time goes**
(printing at set speed, acceleration, travel, layer-cooling slowdown), which
constraint looks limiting on *this* file, and how changes to acceleration,
speed, hotend flow, or minimum layer time could shift that estimate.

Nothing is uploaded. The UI is available in **English and Russian**.

### [Try Bottleneck3D](https://contextforgeai.github.io/bottleneck3d/)

Open the hosted web app — no install. Load your exported `.gcode` (or the
built-in demo). Works without OrcaSlicer 2.5; the optional plugin adds
in-slicer extras and **Verify in Orca**.

---

## Choose how to use it

| | Standalone web app | OrcaSlicer plugin (optional) |
| --- | --- | --- |
| **What you get** | Full analysis UI for an exported `.gcode` | Same UI as a tab inside Orca, plus live presets and **Verify in Orca** (reslice to check upgrade scenarios) |
| **Orca version** | **Not tied to 2.5.** Open G-code from Orca 2.4, PrusaSlicer, and similar | Requires **OrcaSlicer 2.5.0-alpha or newer** (Python plugins) |
| **How to start** | **[Try online](https://contextforgeai.github.io/bottleneck3d/)** or run locally with Node | Download one `.whl` — **no Node or Python** for end users |
| **Best when** | Quick try in the browser, or older Orca | Orca 2.5+ with in-slicer workflow + reslice verification |

Opening a file does **not** mean every slicer or every G-code dialect is fully
validated. Depth and trust depend on metadata in the file and on the commands
we support. See [Accuracy](#accuracy-and-known-limitations).

### Run the web app locally (optional)

Needs [Node.js](https://nodejs.org/) if you prefer a local copy:

```bash
npm install
npm start        # opens the local app in your browser
```

Then **Open file** and pick an exported `.gcode` (or use the built-in demo).
Same UI as the hosted site; you still lose in-Orca extras without the plugin.

### Install the OrcaSlicer plugin (optional)

For OrcaSlicer **2.5.0-alpha+** only. Older Orca cannot load this plugin — use
the web app instead.

1. Download  
   **[v0.4.0 → Assets → `bottleneck3d_orca-0.4.0-py3-none-any.whl`](https://github.com/ContextForgeAI/bottleneck3d/releases/tag/v0.4.0)**  
   (expand **Assets**; do not download Source code).
2. Orca → menu ≡ → **Plugins** → **Browse plugins** ▾ → **Install local plugin**
   → pick the `.whl`.
3. Restart Orca → Slice → **Export G-code** → open the **Bottleneck3D** tab.

Step-by-step guide (update, uninstall, troubleshooting):  
**[docs/INSTALL-ORCA.md](docs/INSTALL-ORCA.md)** · tested on Windows.

---

## What you see (examples)

Same UI in the browser and in the Orca tab. These shots are from a real file
inside Orca; captions describe the decision, not only the tab name.

**Where does the time go — and what limits this print?**  
Overview: total time, trust badge vs the slicer’s estimate, time mix, and the
ranked upgrade ideas for *this* G-code:

![Overview — time mix and bottleneck](docs/images/overview.png)

**Which line types and layers eat the clock?**  
Time: breakdown by feature (walls, infill, travel…), hotend load vs your flow
limit, and time per layer:

![Time — roles, flow, layers](docs/images/time.png)

**What if I change acceleration or speed?**  
Upgrades: ready-made scenarios and sliders for a quick forecast. Instant
numbers can diverge from a real reslice; in Orca 2.5+, **Verify in Orca**
re-slices to compare against Orca’s own estimate:

![Upgrades — scenarios and Verify in Orca](docs/images/upgrades.png)

**What limits and planner did the estimate use?**  
Details: estimator model and values taken from the G-code / config block:

![Details — planner and file limits](docs/images/details.png)

---

## Main features

- **Print time analysis** — split into printing at set speed, acceleration and
  braking, travel/retracts, and layer-cooling slowdown when present.
- **Bottleneck reading** — which subsystem looks dominant on the loaded file.
- **Upgrade simulation** — acceleration, profile speeds, hotend volumetric
  flow, minimum layer time; scenarios ranked by estimated impact on *this*
  file (not a generic hardware promise).
- **Trust badge** — “checked against the slicer ±X%” or “approximate” with a
  reason (missing estimate/config, untested slicer, large delta).
- **OrcaSlicer plugin** — integrated tab; optional **Verify in Orca** reslice
  for upgrade checks on 2.5.0-alpha+.

---

## Accuracy and known limitations

On the current test set (PrusaSlicer 2.5, OrcaSlicer 2.4 and 2.5.0-alpha with
Klipper, including G2/G3 arc-fitted files), `npm run compare` against the
estimate written into the G-code shows about **0.1% mean** difference and
**0.6% worst**. Bench notes:
[`demo/accuracy-sweep/`](demo/accuracy-sweep/),
[`docs/ACCURACY-TEST-PLAN.md`](docs/ACCURACY-TEST-PLAN.md).

Honest limits (do not skip these):

- Agreement with the **slicer’s** estimated time is **not** validation against
  real printer wall-clock time.
- **Cura, Bambu Studio, SuperSlicer**, and **untested / newer Orca builds** are
  not fully validated — treat results as approximate unless the trust badge
  says otherwise.
- **Instant upgrade forecasts** do not reslice; they can differ from a real
  reslice (layer slowdowns rebuild). **Verify in Orca** closes that gap when
  the plugin is available; on the test models it matched Orca’s reslice to the
  second.
- **Cooling** uses configured minimum layer time, not a thermal simulation.
- **Verify in Orca** exports the plate as STL: modifiers, painting, and
  per-object settings may be lost (a no-change baseline reslice is subtracted).
- Do **not** base purchase decisions on unvalidated forecasts alone. See
  [ROADMAP.md](ROADMAP.md) and
  [`docs/IMPROVEMENT-PLAN.md`](docs/IMPROVEMENT-PLAN.md).

---

## Local development

For contributors working on the web app or packaging the plugin.

```bash
npm install
npm start        # Vite dev server
npm test
npm run lint
npm run build
```

Plugin from source (Node 24 + [uv](https://docs.astral.sh/uv/)):

```bash
npm run package:orca   # → dist-orca/*.whl for distribution
npm run install:orca   # build + install into %APPDATA% on this PC
cd orca-plugin && uv run --with pytest pytest tests
```

More detail: [`orca-plugin/README.md`](orca-plugin/README.md),
[ARCHITECTURE.md](ARCHITECTURE.md).

## License

[MIT](LICENSE)
