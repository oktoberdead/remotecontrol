# remotecontrol

Сервер удалённого управления Windows-машиной (ASP.NET Core, net8.0-windows, порт 8086 по умолчанию).

## Вкладка Monitor (DDC/CI, ControlMyMonitor)
- Положи `ControlMyMonitor.exe` (NirSoft) в папку рядом с `RemoteControl.Server.exe`,
  либо укажи полный путь в `appsettings.json` → `Monitor:CmmPath`
- Какой монитор крутить: `Monitor:Name` (по умолчанию `Primary`; можно `\\.\DISPLAY1\Monitor0` или серийник)
- Что работает: слайдер/ввод яркости (VCP 10), кнопки On / Off / Switch (VCP D6, через `/TurnOn`, `/TurnOff`, `/SwitchOffOn`)

## Собираем
```
dotnet build -c Release
```
Release собирается как WinExe (без консоли), Debug — с консолью. Флаг `--console` включает лог в консоль.
