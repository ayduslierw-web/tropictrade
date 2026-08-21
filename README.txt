TropicTrade — простой запуск

1) Установи Node.js 18+.
2) Распакуй папку.
3) Открой .env и вставь STEAM_API_KEY.
4) Запусти START_WINDOWS.bat.
5) Открой http://localhost:3000.
6) Нажми «Войти через Steam».

НЕ открывай public/index.html напрямую. Steam вход работает через server.js.

Для публичного сайта нужен HTTPS-домен. API-ключ хранится только на сервере в .env.
