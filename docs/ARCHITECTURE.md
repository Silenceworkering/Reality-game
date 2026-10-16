# Текущая архитектура

Один Node.js 24 процесс отдаёт клиент и `/api/v1`. ES modules в `packages/shared` содержат цены, реплики и правила. Сервер не принимает внешний user ID: владелец выводится только из сессии. Нет внешних запросов из браузера.

`node:sqlite` — один локальный файл, foreign keys, WAL, явные BEGIN IMMEDIATE / COMMIT / ROLLBACK. Схема создаётся идемпотентно на старте: users, sessions, ledger, dialogues, actions. Это bootstrap, не система версионных миграций. Уникальные `(house, apartment)`, `(user,key)`, `(user,choice)`, CHECK wallet>=0. Квартира и стартовый ledger создаются одной транзакцией. Первая покупка — списание, мебель, ledger и сохранение ответа одной транзакцией. Повтор ключа возвращает первоначальный ответ; актуальное состояние после других операций запрашивается через GET me.

Фиксированная мебель хранится в JSON layout; в полном продукте нужна нормализованная модель instances/definitions. Работающий срез не содержит все сущности из ТЗ. Нельзя запускать несколько реплик с независимыми файлами SQLite.

Клиент: native ES modules, DOM-интерфейс, SVG-сцены. Состояние перезагружается из API, localStorage хранит только настройку движения. Никакая логика не зависит от FPS. Игровые часы и погода декоративны. Масштабирование 1 / 1.45 / 1.9; панорамирование нативной прокруткой, без drag-camera и pinch zoom. При отключённом JavaScript игра недоступна.

Следующий архитектурный шаг — TypeScript strict, workspace packages, PostgreSQL migrations, repository layer с теми же интеграционными контрактами, затем авторизованный Socket.IO. Выбор Socket.IO для будущего этапа: комнаты, reconnect/ack, но право на действие и дедупликация всё равно на сервере. Сейчас никакого socket endpoint нет.

## Обновление 0.2: PostgreSQL

DATABASE_URL выбирает pg Pool. Adapter использует AsyncLocalStorage для transaction-scoped client, BEGIN/COMMIT/ROLLBACK и pg_advisory_xact_lock для сериализации всех записей (включая присвоение квартир и идемпотентные покупки) между процессами. Число соединений ограничено 5. SQL placeholders параметризованы. SQLite остаётся локальным fallback, его async-транзакции также сериализованы mutex. createGame теперь async. Health проверяет SELECT 1. Runtime-ошибки логируются только кодом, без URL/паролей/SQL параметров.
