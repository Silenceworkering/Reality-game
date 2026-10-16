# Результаты проверки

Локально, Node 24.19.0 / Chromium, 16.10.2026:

- `npm run check` — PASS: синтаксис серверного и клиентского JS.
- `npm test` — PASS, 5 сценариев: имена/ownership helper; регистрация→диалоги→диван→перестановка→relogin; два аккаунта и 8 повторов конкурентного запроса; reopening SQLite; rate limits/headers/health.
- Проверены forged price/user, неверное место, сюжет вне порядка, неизвестный ключ реплики, чужой Origin, unauthenticated mutation, неправильный пароль.
- `npm run build` — PASS: runnable dist.
- `node scripts/browser-test.mjs` — PASS: Chromium через CDP, реальные клики регистрации, двух диалогов, подъезда, покупки и расстановки. Reload сохраняет диван и баланс; журнал доступен. Ширины 1440/390/360 без горизонтального overflow; JS exceptions отсутствуют.
- Screenshot: preview-desktop.png. Внешняя визуальная регрессия и эталонные snapshots ещё не настроены.

В sandbox открытие TCP запрещено (EPERM); HTTP/Chromium-тесты выполнены с разрешённым внешним запуском локальных процессов. Первоначальный сбой тестов был инфраструктурным, повтор после разрешения сокетов прошёл. CI подготовлен, статус GitHub Actions отдельно не подтверждён.

**Не проверено/не реализовано:** реальные Android/iOS/Safari/Firefox, screen reader audit, touch pinch/drag camera, offline play, Docker/Render execution, нагрузка, восстановление backup, WebSocket, marketplace, аренда, модерация. Нет утверждения о прохождении полного Definition of Done.

## Обновление 0.3 — 16.10.2026

- 7 тестовых сценариев PASS, включая полный сюжет (18 узлов за прохождение), альтернативы, one-off rewards, ранний/неверный ответ работы, cooldown, forged reward, двойную оплату.
- Chromium PASS: signup → дом → диван → reload → все три главы с альтернативой planArt → подработка delivery с ожиданием 10 секунд и выплатой.
- Desktop 1440×900, mobile 390×844, narrow 360×800: страница и диалоги без горизонтального overflow, JS exceptions отсутствуют. Скриншоты preview-desktop, preview-dialogue, preview-mobile, preview-apartment.
- Добавление job_attempts проверено на отдельной Neon-ветке br-billowing-cake-baei6c74; количество игроков до/после равно 3. Production-данные на этом шаге не менялись.
- Все изображения WebP, полный набор около 2.1 MB. Замеры FPS/RAM/реальные устройства не проводились. Это не realtime 3D и не multiplayer.
