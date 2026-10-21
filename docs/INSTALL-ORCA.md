# Bottleneck3D для OrcaSlicer — установка

Нужен только файл `bottleneck3d_orca-<версия>-py3-none-any.whl`. Node, Python и
исходники не нужны.

## Требования

- OrcaSlicer **2.5.0-alpha** или новее: в нём появились Python-плагины. В 2.4 и
  старше плагин не загрузится.
- Windows. На macOS и Linux плагин должен работать, но там не проверялся.

## Установка

1. Откройте Orca → главное меню → **Plugins**.
2. Кнопка **Browse plugins** → стрелка → **Install local plugin**, выберите
   файл `.whl`.
3. Перезапустите Orca.
4. В главном окне появится вкладка **Bottleneck3D**. Если её нет —
   Plugins → Bottleneck3D Window → Run откроет то же самое в отдельном окне.

Ручной вариант: создайте папку `%APPDATA%\OrcaSlicer\orca_plugins\bottleneck3d\`
и положите туда `.whl` (один файл на папку), затем перезапустите Orca.

## Как пользоваться

1. Нарежьте модель и сделайте **Export G-code** — вкладка подхватит файл сама
   («Обновить из Orca», если файл новее).
2. «Обзор» и «Время» — куда уходит время печати. Чип под временем показывает,
   насколько можно верить цифре.
3. «Апгрейды» — что даст апгрейд. Кнопка **Проверить в Orca** перенарежет модель
   с выбранным изменением и покажет точное время Orca (10–60 с).

## Обновление и удаление

Обновление — установите новый `.whl` так же. Удаление — закройте Orca и
удалите папку `%APPDATA%\OrcaSlicer\orca_plugins\bottleneck3d\`.

## Если не работает

- Логи Python: `%APPDATA%\OrcaSlicer\log\python_*.log` — пришлите последний.
- Вкладка пустая или «Веб-интерфейс не собран» — файл собран неправильно,
  попросите новый.
- Кнопки «Проверить в Orca» нет — плагин не нашёл `orca-slicer.exe`; задайте
  путь в переменной окружения `ORCA_SLICER` и перезапустите Orca.

Плагин ничего не отправляет в интернет: G-code, модели и пресеты остаются на
компьютере.

---

# Bottleneck3D for OrcaSlicer — install

You only need `bottleneck3d_orca-<version>-py3-none-any.whl`.

1. OrcaSlicer **2.5.0-alpha** or newer (Python plugins). Tested on Windows.
2. Main menu → **Plugins** → **Browse plugins** ▾ → **Install local plugin** →
   pick the `.whl`, restart Orca.
3. Open the **Bottleneck3D** tab, slice and **Export G-code**.
4. Upgrades → **Check in Orca** reslices with the chosen change and shows
   Orca's exact time.

Logs: `%APPDATA%\OrcaSlicer\log\python_*.log`. If «Check in Orca» is missing,
set `ORCA_SLICER` to the Orca executable path. Nothing leaves your computer.
