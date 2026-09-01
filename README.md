# remotecontrol

Сервер удалённого управления Windows-машиной (ASP.NET Core, net8.0-windows, порт 8086 по умолчанию).

## Что умеет
- **Main**: громкость, медиа (± перемотка стрелками), системные кнопки, WireGuard, **Shutdown PC** (30 сек + отмена / мгновенно)
- **Monitor**: яркость (DDC/CI через ControlMyMonitor), вкл/выкл монитора
- **Mouse / Stream**: тачпады (квадратный, сенси и edge-зоны настраиваются), стрим с зумом (плавный, на клиенте), FPS, качество, fullscreen
- **Game**: кастомная раскладка, тачпады (скролл/мышь), edge-зоны (8 направлений)
- **Settings** (в дропдауне ⋯):
  - General: редактор `appsettings.json` + рестарт сервера
  - Tabs: скрывать вкладки / прятать в дропдаун ⋯
  - Mouse/Stream: чувствительность, edge-зоны (вкл/размер/скорость)
  - Custom Elements: свои элементы на вкладках (button/touchpad/sequence/slider/toggle/input) с позиционированием drag
- Конфиг UI хранится в `LocalApplicationData\RemoteControl\ui.json`

## Вкладка Monitor (DDC/CI, ControlMyMonitor)
- Положи `ControlMyMonitor.exe` (NirSoft) в папку рядом с `RemoteControl.Server.exe`,
  либо укажи полный путь в `appsettings.json` → `Monitor:CmmPath`
- Какой монитор крутить: `Monitor:Name` (по умолчанию `Primary`; можно `\\.\DISPLAY1\Monitor0` или серийник)

## Собираем
```
dotnet build -c Release
# или чистый self-contained:
dotnet publish RemoteControl.server -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o out
```
Release — WinExe (без консоли), Debug — с консолью. Флаг `--console` включает лог.

## Известные проблемы
См. [BUGS.md](BUGS.md)
