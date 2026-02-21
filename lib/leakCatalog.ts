/**
 * Unified Leak Catalog
 * 
 * Нормализация и отображение leak tags по всему приложению.
 */

export type LeakCatalogItem = {
  tag: string;            // canonical: lower_snake_case
  title: string;          // RU human title
  short?: string;         // optional short label
  description?: string;   // optional hint/explanation
};

/**
 * Каталог leak-тегов
 * 
 * Ключ — canonical tag (lower_snake_case)
 */
export const LEAK_CATALOG: Record<string, LeakCatalogItem> = {
  chasing_draws: {
    tag: 'chasing_draws',
    title: 'Инвестиции в дровяные руки',
    short: 'Chasing draws',
    description: 'Коллы без достаточных пот-оддсов на дро'
  },
  missed_value_bet: {
    tag: 'missed_value_bet',
    title: 'Упущенное велью',
    short: 'Missed value',
    description: 'Пропуск вэлью-бета с сильной рукой'
  },
  overbet_bluff: {
    tag: 'overbet_bluff',
    title: 'Слишком крупные блефы',
    short: 'Overbet bluffs',
    description: 'Чрезмерные ставки на блефе'
  },
  passive_play: {
    tag: 'passive_play',
    title: 'Пассивная игра',
    short: 'Passive play',
    description: 'Чеки и коллы вместо агрессии'
  },
  bad_pot_odds_call: {
    tag: 'bad_pot_odds_call',
    title: 'Коллы без пот-оддсов',
    short: 'Bad pot odds',
    description: 'Коллы без математического обоснования'
  },
  river_betting_strategy: {
    tag: 'river_betting_strategy',
    title: 'Ставки на ривере',
    short: 'River betting',
    description: 'Проблемы со стратегией ставок на ривере'
  },
  turn_raise_undervalue: {
    tag: 'turn_raise_undervalue',
    title: 'Переоценка/недооценка рейзов на тёрне',
    short: 'Turn raises',
    description: 'Неправильная оценка силы рейзов на тёрне'
  },
  preflop_3bet_defense: {
    tag: 'preflop_3bet_defense',
    title: 'Защита против 3-бета префлоп',
    short: '3bet defense',
    description: 'Плохая защита против 3-бета'
  },
  cbet_frequency: {
    tag: 'cbet_frequency',
    title: 'Частота контбета',
    short: 'C-bet frequency',
    description: 'Слишком частый или редкий контбет'
  },
  position_awareness: {
    tag: 'position_awareness',
    title: 'Понимание позиции',
    short: 'Position play',
    description: 'Игнорирование позиционного преимущества'
  },
  bluff_catching: {
    tag: 'bluff_catching',
    title: 'Ловля блефов',
    short: 'Bluff catching',
    description: 'Проблемы с блеф-кетчингом'
  },
  sizing_mistakes: {
    tag: 'sizing_mistakes',
    title: 'Ошибки в sizing',
    short: 'Sizing errors',
    description: 'Неправильные размеры ставок'
  },
};

/**
 * Нормализует leak tag к каноническому виду
 * 
 * @example
 * normalizeLeakTag('River Betting Strategy') // 'river_betting_strategy'
 * normalizeLeakTag('  bad-pot-odds  ') // 'bad_pot_odds'
 */
export function normalizeLeakTag(tag: string): string {
  if (!tag) return '';
  
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')  // spaces and dashes → underscore
    .replace(/_+/g, '_')        // collapse multiple underscores
    .replace(/^_|_$/g, '');     // trim underscores from edges
}

/**
 * Преобразует snake_case в Title Case
 * 
 * @example
 * toHumanTitleFromTag('river_betting_strategy') // 'River Betting Strategy'
 */
export function toHumanTitleFromTag(tag: string): string {
  if (!tag) return '';
  
  return tag
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Получить нормализованное отображение leak tag
 * 
 * Возвращает canonical tag и human-readable title
 * 
 * @example
 * getLeakDisplay('chasing_draws') // { canonical: 'chasing_draws', title: 'Инвестиции в дровяные руки' }
 * getLeakDisplay('unknown_leak') // { canonical: 'unknown_leak', title: 'Unknown Leak' }
 */
export function getLeakDisplay(tag: string): { canonical: string; title: string } {
  const canonical = normalizeLeakTag(tag);
  
  if (!canonical) {
    return { canonical: '', title: 'Leak' };
  }
  
  const catalogItem = LEAK_CATALOG[canonical];
  
  if (catalogItem) {
    return { canonical, title: catalogItem.title };
  }
  
  // Fallback: convert to Title Case
  return { canonical, title: toHumanTitleFromTag(canonical) || 'Leak' };
}
