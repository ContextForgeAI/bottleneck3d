# Как поставить Bottleneck3D в OrcaSlicer

Нужны только OrcaSlicer и один файл плагина.  
**Node, Python, Git и исходники не нужны.**

Файл называется примерно так:  
`bottleneck3d_orca-0.4.0-py3-none-any.whl`  
Это обычный архив плагина (расширение `.whl`). Его не нужно открывать и не нужно
«устанавливать Python» — Orca сама его подхватит.

---

## 1. Что должно быть установлено

| Нужно | Не нужно |
| --- | --- |
| OrcaSlicer **2.5.0-alpha** или новее | Node, Python, Visual Studio |
| Windows (проверено) | Собирать что-то из исходников |

В Orca **2.4 и старше** плагины не поддерживаются — вкладка не появится.

Версию Orca можно посмотреть в меню **Help → About** (или **О программе**).

---

## 2. Скачать плагин

1. Откройте страницу релиза:  
   **[Bottleneck3D v0.4.0](https://github.com/ContextForgeAI/bottleneck3d/releases/tag/v0.4.0)**
2. Пролистайте вниз до блока **Assets** (иногда он свёрнут — нажмите, чтобы раскрыть).
3. Скачайте файл  
   **`bottleneck3d_orca-0.4.0-py3-none-any.whl`**  
   (не исходный код Source code.zip / .tar.gz).

Сохраните файл куда удобно, например в «Загрузки».

---

## 3. Установить в Orca

1. Запустите **OrcaSlicer**.
2. Откройте главное меню (иконка слева сверху, «гамбургер» ≡ или логотип).
3. Выберите **Plugins** (Плагины).
4. Нажмите **Browse plugins** (Обзор плагинов).  
   Если у кнопки есть стрелка ▾ — откройте меню и выберите  
   **Install local plugin** (Установить локальный плагин).
5. Укажите скачанный файл `.whl`.
6. **Полностью закройте Orca и откройте снова.**

После перезапуска в главном окне должна появиться вкладка **Bottleneck3D**.

Если вкладки нет: меню **Plugins** → найдите **Bottleneck3D Window** → **Run** —
откроется то же приложение в отдельном окне.

### Если «Install local plugin» нет

Закройте Orca. Создайте папку:

`C:\Users\<ваш_логин>\AppData\Roaming\OrcaSlicer\orca_plugins\bottleneck3d\`

(быстрый путь: Win+R → введите `%APPDATA%\OrcaSlicer\orca_plugins` → Enter)

Скопируйте туда файл `.whl` (в папке должен быть **один** `.whl`).  
Снова откройте Orca.

---

## 4. Первый запуск (важно)

Плагин не видит модель, пока вы не сохраните G-code.

1. Положите модель на стол в Orca и **нарежьте** её (Slice).
2. Сделайте **Export G-code** / **Экспорт G-code** (сохраните файл на диск).  
   Одной нарезки без экспорта часто недостаточно.
3. Откройте вкладку **Bottleneck3D**.  
   Файл подтянется сам. Если нет — нажмите **«Обновить из Orca»**.

Дальше:

- **Обзор** и **Время** — куда уходит время печати.
- **Апгрейды** — что изменится, если поднять ускорение, скорость и т.п.  
  Кнопка **«Проверить в Orca»** перенарежет модель с выбранным изменением
  и покажет точное время по оценке Orca (обычно 10–60 секунд).

Ничего не отправляется в интернет: G-code, модели и пресеты остаются на вашем ПК.

---

## 5. Обновление и удаление

**Обновить:** скачайте новый `.whl` из [Releases](https://github.com/ContextForgeAI/bottleneck3d/releases)
и установите так же (шаг 3). Старый заменится. Перезапустите Orca.

**Удалить:** закройте Orca и удалите папку  
`%APPDATA%\OrcaSlicer\orca_plugins\bottleneck3d\`

---

## 6. Если что-то не так

| Симптом | Что сделать |
| --- | --- |
| Нет пункта Plugins | Нужна Orca **2.5.0-alpha** или новее |
| Вкладки Bottleneck3D нет | Перезапустите Orca; или Plugins → Bottleneck3D Window → Run |
| Вкладка пустая / «Веб-интерфейс не собран» | Скачайте `.whl` заново из Assets релиза (не Source code) |
| Нет файла / пустой анализ | Сделайте **Export G-code**, затем «Обновить из Orca» |
| Нет кнопки «Проверить в Orca» | Редко: Orca не нашла свой exe. Задайте переменную среды `ORCA_SLICER` = полный путь к `orca-slicer.exe`, перезапустите Orca |

Логи при ошибке (пришлите последний файл в Issue):  
`%APPDATA%\OrcaSlicer\log\python_*.log`

Подробности для разработчиков: [README](../README.md), папка [`orca-plugin/`](../orca-plugin/).

---

# Install Bottleneck3D in OrcaSlicer (English)

You only need OrcaSlicer and one plugin file.  
**No Node, Python, or Git.**

1. **Need:** OrcaSlicer **2.5.0-alpha+** (2.4 has no plugins). Tested on Windows.  
   Check version: Help → About.
2. **Download** from  
   [Release v0.4.0 → Assets](https://github.com/ContextForgeAI/bottleneck3d/releases/tag/v0.4.0):  
   `bottleneck3d_orca-0.4.0-py3-none-any.whl`  
   (not Source code). A `.whl` is just the plugin package — Orca installs it.
3. **Install:** Orca → main menu (≡) → **Plugins** → **Browse plugins** ▾ →  
   **Install local plugin** → pick the `.whl` → **restart Orca**.
4. **First use:** Slice → **Export G-code** → open the **Bottleneck3D** tab  
   (or «Refresh from Orca»). Slice alone is often not enough.
5. **Update:** install a newer `.whl` the same way.  
   **Remove:** delete `%APPDATA%\OrcaSlicer\orca_plugins\bottleneck3d\`.

Manual install: put the `.whl` alone into  
`%APPDATA%\OrcaSlicer\orca_plugins\bottleneck3d\`, then restart.

Logs: `%APPDATA%\OrcaSlicer\log\python_*.log`. Nothing leaves your computer.
