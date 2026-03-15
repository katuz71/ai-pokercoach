export type CoachStyle = 'toxic' | 'mental' | 'math';

export type SubscriptionTier = 'free' | 'pro' | 'affiliate_pro';

export type PlayerProfile = {
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  playsForMoney: 'no' | 'sometimes' | 'regular' | 'income';
  gameTypes: Array<'mtt' | 'cash' | 'sng' | 'live'>;
  goals: string[];
  weakAreas: string[];
  coachStyle: CoachStyle;
  subscriptionTier?: SubscriptionTier;
  pokerokId?: string;
};
