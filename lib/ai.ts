import { supabase } from './supabase';

export type CoachStyle = 'toxic' | 'mental' | 'math';

export type PlayerProfile = {
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  playsForMoney: 'no' | 'sometimes' | 'regular' | 'income';
  gameTypes: Array<'mtt' | 'cash' | 'sng' | 'live'>;
  goals: string[];
  weakAreas: string[];
  coachStyle: CoachStyle;
};

export type HandInput = {
  holeCards: string; // e.g. "As Kd" or "AKo"
  position: string; // e.g. "BTN"
  stackBb: number; // e.g. 30
  gameType: 'mtt' | 'cash' | 'sng' | 'live';
  preAction: string; // e.g. "UTG raises 2.5x, folds to you"
  board?: string; // e.g. "Ah 7d 2c" (optional)
  notes?: string; // free text
};

export type CoachResponse = {
  action: 'FOLD' | 'CALL' | 'RAISE' | 'CHECK' | 'BET';
  sizing?: string; // e.g. "3x" or "2/3 pot"
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  why: string[];
  strategyNext: string[];
  mistakesToAvoid: string[];
  drill: string;
  evidence?: Array<{ type: string; id: string }>; // optional for future RAG
};

export async function analyzeHand(args: {
  profile: PlayerProfile;
  hand: HandInput;
}): Promise<CoachResponse> {
  const { data, error } = await supabase.functions.invoke('ai-request', {
    body: {
      kind: 'analyze_hand',
      profile: args.profile,
      hand: args.hand,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as CoachResponse;
}
