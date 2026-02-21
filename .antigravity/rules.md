# AI Constitution & Rules

1.  **Никогда не хардкодить API-ключи.** 
    *   Все ключи должны быть в `supabase secrets` или `.env` (но не в коде клиента).
    *   Клиент никогда не должен иметь доступ к `OPENAI_API_KEY`.

2.  **Всегда использовать SDK 35 для Android 15.**
    *   `compileSdkVersion` = 35
    *   `targetSdkVersion` = 35
    *   `ndkVersion` = 27 (для поддержки 16kb page size alignment).

3.  **Проверять отступы клавиатуры.**
    *   Использовать `KeyboardAvoidingView` или `useSafeAreaInsets`.
    *   Тестировать поля ввода в нижней части экрана.
