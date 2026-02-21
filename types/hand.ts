// Hand analysis types

export type CoachStyle = 'TOXIC' | 'MENTAL' | 'MATH';

export type HandInput = {
  hero_cards?: string;       // "AhKd"
  position?: string;         // "BTN"
  stack_bb?: number;         // 100
  action_preflop?: string;   // "UTG open 2.5bb, Hero BTN call..."
  board?: string;            // "As7d2c | turn 9h | river Qs"
  notes?: string;            // optional
  raw_text?: string;         // fallback: пользователь вставил текст раздачи
};

export type HandAnalysisRequest = {
  input: HandInput;
  coach_style: CoachStyle;
};

export type HandAnalysisResult = {
  action: 'RAISE' | 'CALL' | 'FOLD' | 'CHECK' | 'BET';
  sizing: string | null;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  why: string[];
  strategy_next: string[];
  common_mistakes: string[];
  leak_link: {
    tag: string;
    evidence_ids: string[];
  };
  drill: {
    title: string;
    steps: string[];
  };
};

export type HandAnalysisResponse = {
  analysis_id: string;
  result: HandAnalysisResult;
};

export type HandAnalysis = {
  id: string;
  user_id: string;
  input: HandInput;
  result: HandAnalysisResult;
  mistake_tags: string[];
  created_at: string;
};
