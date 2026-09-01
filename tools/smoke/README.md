# tools/smoke — смоук-тесты фронта (без Windows-сборки)

- `jsdom-test.js` — прогоняет init-поток UI на jsdom с мок-API: миграция
  легаси-лэйаута, профили per-IP, редактор (слои/хэндлы/модалки), monitor v2,
  виджеты (вкл. viewport). Выход 0 = все проверки OK.
- `mock.js` — статика wwwroot + заглушки API (порт 8099), чтобы покликать UI
  в браузере без реального сервера.

```
npm i jsdom          # один раз, рядом (package.json не обязателен)
node jsdom-test.js
node mock.js         # http://localhost:8099
```
