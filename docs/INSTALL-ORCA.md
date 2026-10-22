# Install Bottleneck3D in OrcaSlicer

You only need OrcaSlicer and one plugin file.  
**Node, Python, Git, and source builds are not required.**

The file looks like this:  
`bottleneck3d_orca-0.4.0-py3-none-any.whl`  
That is the plugin package (a `.whl` archive). You do not open it by hand and
you do not install Python — Orca loads it for you.

---

## 1. Requirements

| Required | Not required |
| --- | --- |
| OrcaSlicer **2.5.0-alpha** or newer | Node, Python, Visual Studio |
| Windows (tested) | Building from source |

Orca **2.4 and older** have no Python plugins — the tab will not appear.
Use the **web app** instead and open your `.gcode` there; the website is **not**
tied to 2.5.0-alpha (see [README](../README.md)).

Check your version: **Help → About**.

---

## 2. Download the plugin

1. Open the release page:  
   **[Bottleneck3D v0.4.0](https://github.com/ContextForgeAI/bottleneck3d/releases/tag/v0.4.0)**
2. Scroll to **Assets** (expand the section if it is collapsed).
3. Download  
   **`bottleneck3d_orca-0.4.0-py3-none-any.whl`**  
   (not Source code.zip / .tar.gz).

Save it somewhere easy to find, e.g. Downloads.

---

## 3. Install in Orca

1. Start **OrcaSlicer**.
2. Open the main menu (top-left ≡ / hamburger / logo).
3. Choose **Plugins**.
4. Click **Browse plugins**.  
   If the button has a ▾ menu, open it and choose **Install local plugin**.
5. Select the `.whl` file you downloaded.
6. **Quit Orca completely and start it again.**

After restart you should see a **Bottleneck3D** tab in the main window.

If there is no tab: **Plugins** → **Bottleneck3D Window** → **Run** opens the
same app in a separate window.

### If “Install local plugin” is missing

Quit Orca. Create this folder:

`C:\Users\<your_user>\AppData\Roaming\OrcaSlicer\orca_plugins\bottleneck3d\`

(Quick path: Win+R → `%APPDATA%\OrcaSlicer\orca_plugins` → Enter)

Copy the `.whl` into that folder (**one** `.whl` only). Start Orca again.

---

## 4. First use (important)

The plugin does not see your model until you export G-code.

1. Place a model on the plate and **Slice**.
2. Use **Export G-code** and save the file.  
   Slice alone is often not enough.
3. Open the **Bottleneck3D** tab.  
   The file should load automatically. If not, click **Refresh from Orca**.

Then:

- **Overview** and **Time** — where print time goes.
- **Upgrades** — what an upgrade would change.  
  **Verify in Orca** reslices with your chosen change and shows Orca’s exact
  estimate (usually 10–60 seconds).

Nothing is uploaded: G-code, models, and presets stay on your PC.

You should see something like this (Overview). More screenshots:
[README → Screenshots](../README.md#screenshots).

![Overview after Export G-code](images/overview.png)

---

## 5. Update and uninstall

**Update:** download a newer `.whl` from
[Releases](https://github.com/ContextForgeAI/bottleneck3d/releases) and install
it the same way (step 3). Restart Orca.

**Uninstall:** quit Orca and delete  
`%APPDATA%\OrcaSlicer\orca_plugins\bottleneck3d\`

---

## 6. Troubleshooting

| Symptom | What to do |
| --- | --- |
| No Plugins menu | You need Orca **2.5.0-alpha** or newer |
| No Bottleneck3D tab | Restart Orca; or Plugins → Bottleneck3D Window → Run |
| Empty tab / “web UI not built” | Re-download the `.whl` from release Assets (not Source code) |
| No file / empty analysis | **Export G-code**, then Refresh from Orca |
| No “Verify in Orca” button | Rare: set env var `ORCA_SLICER` to the full path of `orca-slicer.exe`, restart Orca |

Error logs (attach the latest file to an Issue):  
`%APPDATA%\OrcaSlicer\log\python_*.log`

Developer notes: [README](../README.md), [`orca-plugin/`](../orca-plugin/).
