# Безопасность и границы

Пароли: scrypt + случайная 16-byte salt, timingSafeEqual. Сессия: случайные 32 bytes, SHA-256 в БД, срок 30 дней; logout отзывает текущую сессию. HTTPS: COOKIE_SECURE=true. Нет reset password, email-verification, MFA, принудительного завершения всех сессий или очистки expired rows.

Все SQL значения параметризованы. Ник валидируется Unicode allowlist. DOM пользовательского ника экранируется. CSP запрещает внешние скрипты, inline scripts и framing, nosniff, same-origin referrer. POST требует JSON и проверяет Origin; SameSite Strict. Без доверия X-Forwarded-For: лимитер видит remoteAddress. За reverse proxy все пользователи могут делить один лимит; до публичной беты нужен trusted-proxy config + общий rate-limit store. Текущий лимит 15 auth/минуту, 120 API/минуту на адрес. Scrypt синхронный — нужен worker pool до нагрузки.

Невозможно обратиться к чужому профилю по ID: API использует только session.user. Идемпотентность и BEGIN IMMEDIATE защищают покупки. Нет произвольных изменений баланса или прав из body. Нет чата/рынка, соответственно их безопасность ещё не реализована. Не считать это security audit.

Перед публичным запуском: PostgreSQL, нормализованные permissions, объёмные лимиты accounts/actions, session cleanup, распределённые ограничения, отдельный мониторинг ошибок с редактированием секретов, moderation/reporting, backup restore drill, аудит dependency/build pipeline. Регистрация пока открытая — не выкладывать как production beta без мер против массового создания аккаунтов.
