import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
// @ts-ignore
import { Hand } from 'pokersolver';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/"/g, '').replace(/\/$/, '');
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').replace(/"/g, '');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('ОШИБКА: Переменные EXPO_PUBLIC_SUPABASE_URL или EXPO_PUBLIC_SUPABASE_ANON_KEY не найдены в .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 1. Починенный маппинг карт: '10' -> 'T' для pokersolver
function toPokersolverCard(card: string): string {
  if (!card) return '';
  let rank = card.slice(0, -1);
  const suit = card.slice(-1).toLowerCase();
  if (rank === '10') rank = 'T';
  return rank + suit;
}

// 2. Математическое определение ранга руки
function solveHandRank(cards: string[]): string {
  const normalized = cards.map(toPokersolverCard).filter(c => c !== '');
  try {
    const solved = Hand.solve(normalized, 'standard');
    return solved.name; // Возвращает "Straight", "Three of a Kind", "Pair" и т.д.
  } catch (e) {
    return 'High Card';
  }
}

async function importBatch() {
  const fileName = process.argv[2] || 'batch_1.json';
  const filePath = path.resolve(process.cwd(), fileName);

  if (!fs.existsSync(filePath)) {
    console.error(`Файл не найден: ${filePath}`);
    return;
  }

  const rawData = fs.readFileSync(filePath, 'utf-8');
  const tasks = JSON.parse(rawData);

  console.log(`Начинаем импорт ${tasks.length} задач из ${fileName}...`);

  const results = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    
    // Собираем все карты для проверки
    const allCards = [...task.hero_cards, ...task.board];
    const solverRank = solveHandRank(allCards);
    const claudeRank = task.hero_hand_rank || '';

    // Логика исправления ранга: слушаем солвера, если он нашел комбинацию
    let finalRank = claudeRank;
    const isDraw = /дро|draw|gate|gutshot/i.test(claudeRank);
    
    if (!isDraw && solverRank !== 'High Card') {
      finalRank = solverRank;
      if (claudeRank.toLowerCase() !== solverRank.toLowerCase()) {
         console.log(`[batch_1.json] Задача ${i+1}: коррекция ранга — "${claudeRank}" -> "${solverRank}"`);
      }
    }

    // action_to_hero — всегда строка из JSON (не объект), иначе в UI вечно "Чек"
    const actionToHeroStr =
      typeof task.action_to_hero === 'string'
        ? task.action_to_hero.trim()
        : task.action_to_hero != null
          ? (typeof task.action_to_hero === 'object' ? JSON.stringify(task.action_to_hero) : String(task.action_to_hero))
          : '';

    // villain_cards — всегда массив
    const villainCardsArr = Array.isArray(task.villain_cards)
      ? task.villain_cards
      : task.villain_cards != null
        ? Array.from(Array.isArray(task.villain_cards) ? task.villain_cards : [task.villain_cards])
        : [];

    // 3. ФИНАЛЬНЫЙ МАППИНГ ОБЪЕКТА (Устраняем ошибки NOT NULL и баг "Чека")
    const taskToInsert = {
      game: task.game || 'NLH',
      street: task.street,
      hero_pos: task.hero_pos,
      villain_pos: task.villain_pos,
      drill_type: task.drill_type || 'postflop',

      // Карты — строго массивы
      hero_cards: Array.isArray(task.hero_cards) ? task.hero_cards : [],
      villain_cards: villainCardsArr,
      board: Array.isArray(task.board) ? task.board : [],

      // Числовые значения; pot_size обязательно (task.pot_size || task.pot_bb)
      pot_bb: Number(task.pot_bb ?? 0) || 0,
      pot_size: Number(task.pot_size ?? task.pot_bb ?? 0) || 10,
      villain_bet: Number(task.villain_bet ?? 0),
      hero_stack: Number(task.hero_stack ?? 100),
      effective_stack_bb: Number(task.effective_stack_bb ?? 100),

      // Действия и тексты — action_to_hero строка
      action_to_hero: actionToHeroStr,
      correct_action: task.correct_action === 'check' ? 'call' : task.correct_action,
      explanation: task.explanation ?? '',
      hero_hand_rank: finalRank,

      // Дополнительные поля (nullable в базе)
      options: task.options || {},
      leak_tag: task.leak_tag || null,
      correct_option: task.correct_option || null,
      rule_of_thumb: task.rule_of_thumb || null
    };

    results.push(taskToInsert);
  }

  // Массовая вставка в Supabase
  const { data, error } = await supabase
    .from('hand_library')
    .insert(results)
    .select('id');

  if (error) {
    console.error('Ошибка вставки в hand_library:', error.message);
  } else {
    console.log(`Успех! Загружено ${data.length} задач в базу.`);
    console.log('ID вставленных записей:', data.map(d => d.id).join(', '));
  }
}

importBatch().catch(console.error);