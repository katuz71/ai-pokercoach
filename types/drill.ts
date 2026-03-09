export type DrillOption = { 
  key: 'A' | 'B' | 'C'; 
  text: string;
};

export type DrillScenario = {
  id: string;
  title: string;
  spot: string;
  question: string;
  options: DrillOption[];
  correct: 'A' | 'B' | 'C';
  mistake_tag: string;
  explanation: string;
  focus_leak: string | null;
};

export type DrillGradeResult = {
  is_correct: boolean;
  correct_action: 'A' | 'B' | 'C';
  feedback: string;
  why: string[];
  next_step: string;
  mistake_tag: string | null;
};

// --- Table drill (Poker Table UI) ---

export type TableDrillPos = 'BTN' | 'SB' | 'BB' | 'CO' | 'HJ' | 'UTG' | 'MP';
export type TableDrillStreet = 'flop' | 'turn' | 'river';
export type TableDrillCorrectAction = 'fold' | 'call' | 'raise';
export type RaiseSizingOption = '2.5x' | '3x' | 'overbet';
export type ActionToHeroType = 'bet' | 'check' | 'raise';

export type TableDrillScenario = {
  game: string;
  hero_pos: TableDrillPos;
  villain_pos: TableDrillPos;
  effective_stack_bb: number;
  hero_cards: [string, string];
  board: {
    flop: [string, string, string];
    turn: string | null;
    river: string | null;
  };
  pot_bb: number;
  street: TableDrillStreet;
  /** Текст действия в сторону Hero (например "Villain поставил 6bb"). Из БД — строка. */
  action_to_hero: string;
  /** Размер ставки оппонента в bb. Используется для кнопки Колл и фишек на столе. */
  villain_bet: number;
  correct_action?: TableDrillCorrectAction;
  explanation: string;
  /** action_decision (default) | raise_sizing */
  drill_type?: 'action_decision' | 'raise_sizing';
  /** For raise_sizing: options and correct choice */
  options?: [string, string, string];
  correct_option?: string;
  rule_of_thumb?: string;
  leak_tag?: string;
};
