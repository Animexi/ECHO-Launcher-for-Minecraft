# ECHO Launcher

Кастомный лаунчер для Minecraft, написанный на Electron. Красивый UI с анимациями и полной поддержкой модов.

---

## Возможности

- Авторизация Microsoft / Offline
- Управление аккаунтами
- Выбор версий Minecraft (Release, Snapshot)
- Поддержка модлоадеров: Forge, Fabric, OptiFine, NeoForge, Quilt
- Установка и запуск модпаков
- Кастомные настройки (выделенная RAM, Java-путь, JVM-аргументы)
- Автоматическая загрузка и установка нужной версии Java
- Встроенный менеджер модов
- Красивый минималистичный интерфейс с анимациями
- Сборка в установщик Windows (NSIS)

---

## Требования

- Windows 10/11
- Node.js 18+
- Java 17+ (ляунчер скачает автоматически, если не найдена)

---


## Сборка установщика

build_installer.bat

Готовый установщик появится в папке `dist/`.

---

## Структура проекта

```
echo-launcher/
├── src/
│   ├── main.js          # Точка входа Electron
│   ├── auth/            # Авторизация (Microsoft / Offline)
│   ├── launcher/        # Логика запуска Minecraft
│   └── ui/              # HTML/CSS/JS интерфейс
├── assets/
│   └── icon.png         # Иконка приложения
├── icon.ico             # Иконка для Windows-сборки
├── package.json
└── package-lock.json
```

---

## Технологии

- **Electron** — десктопный фреймворк
- **Node.js** — серверная логика
- **HTML/CSS/JS** — интерфейс
- **electron-builder** — сборка установщика

---

## Лицензия

MIT
