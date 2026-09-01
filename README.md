# remotecontrol

Сервер удалённого управления Windows-машиной (ASP.NET Core, net8.0-windows, порт 8086 по умолчанию).

## Что умеет
- **Конструктор всей страницы**: вкладки создаются/удаляются/переименовываются/переставляются;
  внутри вкладки — разделы-миниканвасы (добавить/удалить/переименовать/высота/порядок),
  внутри разделов — элементы со свободным позиционированием (%), редактор один на всё:
  тап/свайп — выбор (⤡), двойной тап — ✎/✕ (хэндлы всегда 100% opacity)
- Вход в редактор: Settings → Tabs → ✏️, либо дропдаун ⋯ → «Edit this tab»
- **Main** (дефолтная страница): громкость, медиа, системные кнопки, WireGuard, **Shutdown PC** — всё атомами/блоками, полностью редактируется
- **Monitor**: яркость/вкл/выкл напрямую через WinAPI `dxva2.dll` (DDC/CI, `/api/monitor2/*`);
  ControlMyMonitor-путь снесён по итогам теста (dxva2 победил)
- **Mouse / Stream**: тачпады (сенси и edge-зоны настраиваются), стрим с зумом (плавный, на клиенте), FPS, качество, fullscreen;
  блоки Stream переставляются/ресайзятся отдельно для портретной и альбомной ориентаций (конфиг per-orientation)
- **Game**: полноценный конструктор:
  - типовые элементы: button (click/hold/toggle/repeat-спам с задержками), touchpad (X/Y), scrollbar (1 ось), joystick, **viewport** (живой стрим фоном — «облачный гейминг», ахаха), системные (fullscreen/settings/gp-бэйдж) — всё двигается/ресайзится/удаляется
  - слои: background / viewport / controls / overlay / system; в редакторе неактуальные слои приглушаются; opacity на элемент (5–100%) + тоггл реальной/полной непрозрачности
  - редактор: тап/свайп — выбор (появляется ⤡), двойной тап — ✎ изменить / ✕ удалить (хэндлы одного семейства), модалки вместо `prompt()`
  - **профили per-host (по IP)**: несколько профилей на устройство, запоминается последний; новый — по шаблону (джойстик слева, тачпад камеры справа)
  - глобальные настройки (один sens, LMB-tap, edge-зоны **в пикселях**) + override на конкретном элементе
- **Settings** (в дропдауне ⋯):
  - General: редактор `appsettings.json` + рестарт сервера
  - Tabs: скрывать вкладки / прятать в дропдаун ⋯; **общее редактирование вкладки Game** (system-слой)
  - Mouse/Stream: чувствительность, edge-зоны (вкл/размер/скорость)
  - Custom Elements: свои элементы на вкладках (button/touchpad/sequence/slider/toggle/input/**viewport**) с позиционированием drag
- Конфиг UI хранится в `LocalApplicationData\RemoteControl\ui.json` (сырой JSON, схему держит клиент)
- **Стрим**: один общий capture-loop на всех клиентов (сколько бы вьюпортов ни смотрело),
  живёт только пока есть подписчики; зомби-клиенты без heartbeat отстреливаются за 20с

## Структура фронта
`wwwroot/index.html` — разметка (статичны только Stream/Game/Settings, страницы рендерятся из конфига);
`css/app.css`; `js/` — модули (порядок загрузки):
`core` (утилиты/вкладки/конфиг) → `editkit` (общий тулкит редактора: формы/хэндлы/драг) →
`stream` (вкладка + StreamHub) → `viewport` (вьюпорт-элемент) →
`elements` (единый рантайм элементов: wrap+body, поведения) → `blocks` (builtin-блоки:
монитор×2, mousepad, live-input, send-text, audio, shutdown) → `game` → `editor` (game-редактор) →
`pages` (модель/дефолты/миграция/рендер страниц) → `pageeditor` → `streamlayout` (ориентации) →
`settingsui` (менеджер вкладок) → `init`.

Типы элементов: button (key/mouse/combo/api; click/hold/toggle/repeat — интервалы по режиму),
touchpad, scrollbar, joystick, viewport (+gear), slider, toggle, input, label, sequence,
sys-* (fullscreen/settings/gp) и blk-* (builtin-блоки).

## Вкладка Monitor (DDC/CI)
Работает напрямую через `dxva2.dll` — в конфиге не нуждается, мониторы перечисляет сам.
Настройки `Monitor:CmmPath` / `Monitor:Name` в appsettings больше не читаются.

## Собираем
```
dotnet build -c Release
# или чистый self-contained:
dotnet publish RemoteControl.server -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o out
```
Release — WinExe (без консоли), Debug — с консолью. Флаг `--console` включает лог.

## Смоук-тесты фронта (без Windows)
См. [tools/smoke](tools/smoke/README.md) — jsdom-прогон init-потока + мок-сервер для клика по UI.

## Известные проблемы
См. [BUGS.md](BUGS.md)
