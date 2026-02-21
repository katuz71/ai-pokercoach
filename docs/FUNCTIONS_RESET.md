# Edge Functions Hard Reset

## Проблема

При использовании Supabase Edge Functions иногда в Dashboard автоматически включается опция **"Verify JWT with legacy secret"**, что приводит к ошибке `401 Invalid JWT` при вызове функций.

## Решение

Полное удаление и переразвертывание всех функций с принудительным `verify_jwt = false` в конфигурации.

## Использование

### Шаг 1: Убедиться что проект подключен

Если проект еще не подключен к Supabase:

```bash
supabase link --project-ref wveutrtikaxcxutnnucq
```

### Шаг 2: Запустить hard reset

```bash
npm run functions:reset
```

Скрипт автоматически:
- Проверит все функции в `supabase/functions/`
- Создаст/обновит `config.toml` в каждой функции с `verify_jwt = false`
- Удалит каждую функцию из Supabase
- Задеплоит функции заново с правильной конфигурацией
- Покажет итоговый список функций

### Шаг 3: Проверить в Dashboard

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard/project/wveutrtikaxcxutnnucq/functions)
2. Перейдите в **Edge Functions → Invocations**
3. Проверьте что ошибки `401 Invalid JWT` исчезли
4. Убедитесь что для каждой функции отключена опция **"Verify JWT"**

## Что делает скрипт

1. **Сканирует** директорию `supabase/functions/` (исключая `_shared`)
2. **Обновляет** `config.toml` в каждой функции:
   ```toml
   verify_jwt = false
   ```
3. **Удаляет** функции последовательно:
   ```bash
   supabase functions delete <slug> --yes
   ```
4. **Деплоит** функции заново:
   ```bash
   supabase functions deploy <slug>
   ```
5. **Показывает** финальный список:
   ```bash
   supabase functions list
   ```

## Важные заметки

- ⚠️ Скрипт выполняется **последовательно** (не параллельно) чтобы избежать rate limits
- ⚠️ Если `deploy` падает - скрипт останавливается с ненулевым exit code
- ✅ Если функция не найдена при `delete` - это не ошибка, скрипт продолжает работу
- ✅ Docker локально **не требуется**
- ✅ Код самих функций **не изменяется**

## Troubleshooting

### Ошибка: "Function not found" при deploy

Проверьте что:
- Директория функции существует в `supabase/functions/`
- В директории есть файл `index.ts` или `index.js`

### Ошибка: "Project not linked"

Выполните:
```bash
supabase link --project-ref wveutrtikaxcxutnnucq
```

### Ошибка: "supabase: command not found"

Установите Supabase CLI:
```bash
npm install -g supabase
```

## Альтернатива: ручное исправление

Если нужно исправить только одну функцию:

```bash
# 1. Убедиться что config.toml содержит verify_jwt = false
echo "verify_jwt = false" > supabase/functions/<function-name>/config.toml

# 2. Удалить функцию
supabase functions delete <function-name> --yes

# 3. Задеплоить заново
supabase functions deploy <function-name>
```
