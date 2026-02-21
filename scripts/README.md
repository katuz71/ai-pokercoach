# Testing Drill Focus Distribution

## Цель
Проверить, что система reinforcement работает правильно: drills тренируют главный leak игрока с вероятностью ~70%.

## Запуск теста

```bash
npm run test:drill-focus
```

## Что тестируется

Скрипт генерирует 10 drills подряд и проверяет:
- Сколько из них имеют `focus_leak = top_leak[0]`
- Распределение focus_leak по всем тегам

## Ожидаемый результат

**Если у игрока есть leak data:**
- 6-8 из 10 drills должны иметь `focus_leak = top_leak[0]` (60-80%)
- 2-4 drills могут иметь другие теги из top 3 leaks

**Если у игрока нет leak data:**
- Все drills должны иметь `focus_leak = null`
- `mistake_tag = "fundamentals"`

## Пример вывода

```
🧪 Testing drill focus_leak distribution...

👤 User: player@example.com
🎯 Top Leak: chasing_draws

Available leaks: chasing_draws, missed_value_bet, passive_play
🎓 Coach Style: MENTAL

Generating 10 drills...

✅ Drill 1: chasing_draws - "Колл на дро без оддсов"
✅ Drill 2: chasing_draws - "Флеш-дро на тёрне"
⚪ Drill 3: missed_value_bet - "Упущенное велью на ривере"
✅ Drill 4: chasing_draws - "Неправильный колл дро"
✅ Drill 5: chasing_draws - "Оценка эквити"
✅ Drill 6: chasing_draws - "Пот-оддсы на дро"
✅ Drill 7: chasing_draws - "Инвестиции в дро"
⚪ Drill 8: passive_play - "Пассивная линия"
✅ Drill 9: chasing_draws - "Дро без оддсов"
⚪ Drill 10: missed_value_bet - "Пропуск вэлью"

============================================================
📊 RESULTS
============================================================
Total drills: 10
Top leak matches: 7/10
Percentage: 70.0%
Expected: 60-80% (6-8 out of 10)
✅ Distribution is within expected range!

📈 Focus Leak Distribution:
  chasing_draws                  ███████ 7 (70%)
  missed_value_bet               ██ 2 (20%)
  passive_play                   █ 1 (10%)

✅ Test completed!
```

## Проблемы

**"Not authenticated":**
- Убедись, что ты залогинен в приложении
- Перезапусти приложение и попробуй снова

**"No leak data found":**
- Это нормально для новых пользователей
- Сначала нужно разобрать руки и сгенерировать leak summary
- Запусти `npm run test:drill-focus` после создания leak summaries

## Edge Function Logic

В `supabase/functions/ai-generate-drill/index.ts`:

```typescript
function selectFocusLeak(topLeaks: TopLeak[]): string | null {
  if (topLeaks.length === 0) {
    return null;
  }

  const rand = Math.random();

  // 70% chance to focus on the #1 leak
  if (rand < 0.7) {
    return topLeaks[0].tag;
  }

  // 30% chance to pick from top 3 (or all available if less than 3)
  const poolSize = Math.min(3, topLeaks.length);
  const randomIndex = Math.floor(Math.random() * poolSize);
  return topLeaks[randomIndex].tag;
}
```

## UI Changes

В `app/(tabs)/train.tsx` добавлен badge с фокусом drill:

```typescript
<View style={styles.focusBadge}>
  <AppText variant="caption" color="#4C9AFF" style={styles.focusText}>
    Фокус: {focusTitle}
  </AppText>
</View>
```

Где `focusTitle`:
- Если `focus_leak` есть → используется `getLeakDisplay(focus_leak).title` из leak catalog
- Иначе → "База"
