# REST v1

JSON, same-origin. Ошибка: `{ "error": { "message": "...", "code": 400 } }`. Session cookie HttpOnly, SameSite=Strict; Secure задаётся на HTTPS. POST требует application/json. Максимальный body 8 KiB. Origin проверяется, если передан; JSON-запрос с чужого сайта блокируется также preflight/SameSite, CORS не включён.

| Метод | Путь | Вход / результат |
|---|---|---|
| GET | /health | status/version, без auth |
| POST | /api/v1/auth/register | name, password → профиль, cookie |
| POST | /api/v1/auth/login | name, password → профиль, cookie |
| POST | /api/v1/auth/logout | {} → удаление сессии |
| GET | /api/v1/me | профиль владельца, layout, history, ledger |
| POST | /api/v1/action | key + type + параметры → профиль |

Типы action: `buy-sofa`; `move-sofa` + `position: left|right`; `dialogue` + `choice: hello|zero|plumber`. Ключ 8–80 символов `[A-Za-z0-9_-]`. Клиент использует UUID. Цена/остаток/пользователь из body игнорируются. Идемпотентные ключи имеют область одного аккаунта, не истекают в текущем прототипе.

Профиль: id, name, wallet, house, apartment, layout: {sofa: null|left|right}, history: [{choice,created}], ledger: [{delta,balance,operation}]. Все timestamps серверные Unix milliseconds.

Нет OpenAPI/Zod, socket contracts, inventory/market/jobs/business endpoints: не реализованы. Эти интерфейсы нельзя рекламировать клиентам как доступные.

## Обновление 0.3

GET /api/v1/content — публичный каталог choices/chapters/jobs, без данных игроков.

`dialogue` теперь принимает узлы из packages/shared/story.mjs; требует prerequisites/any и блокирует mutually exclusive choices и повтор. Денежные награды записываются с прогрессом в одной транзакции.

`job-start`: {type, key, job: delivery|repair|service}. Ответ содержит профиль с activeJob: {id,job,sequence,started}. sequence — JSON-строка из четырёх номеров 1–6. Сервер генерирует её randomInt. Текущий прототип не скрывает ответ: это интерактивный заказ, не антибот-защита.

`job-finish`: {type,key,attempt,answer: number[4]}. Чужой, закрытый, ранний (<10s), просроченный (>10min) или неверный заказ отклоняется. Сервер определяет награду и атомарно закрывает заказ/пополняет кошелёк/добавляет ledger/action. UUID idempotency key повторно возвращает исходный ответ. По истечении 90 секунд можно начать новый заказ того же типа; активный клиент предлагает продолжить незавершённый заказ.

Поле profile.activeJob — последняя незавершённая попытка за 10 минут, иначе null. Старые поля профиля сохранены.
