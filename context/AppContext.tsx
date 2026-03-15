import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { CoachStyle, PlayerProfile } from '../types/profile';

type AppState = {
  isHydrated: boolean;
  onboardingDone: boolean;
  profile: PlayerProfile | null;
  setProfile: (p: PlayerProfile) => Promise<void>;
  setCoachStyle: (s: CoachStyle) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
};

const KEY_PROFILE = 'poker_ai.profile.v1';
const KEY_ONBOARDING = 'poker_ai.onboarding_done.v1';

function profileToRow(p: PlayerProfile) {
  return {
    skill_level: p.skillLevel,
    plays_for_money: p.playsForMoney,
    game_types: p.gameTypes,
    goals: p.goals,
    weak_areas: p.weakAreas,
    coach_style: p.coachStyle,
    subscription_tier: p.subscriptionTier ?? 'free',
    pokerok_id: p.pokerokId ?? null,
  };
}

async function syncProfileToSupabase(p: PlayerProfile): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('profiles')
      // @ts-expect-error - Supabase generics infer never for table; payload matches profiles.Insert
      .upsert({ id: user.id, ...profileToRow(p) }, { onConflict: 'id' });
  } catch (e) {
    console.error('[AppContext] Failed to sync profile to Supabase', e);
  }
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setHydrated] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [profile, setProfileState] = useState<PlayerProfile | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [pRaw, doneRaw] = await Promise.all([
          AsyncStorage.getItem(KEY_PROFILE),
          AsyncStorage.getItem(KEY_ONBOARDING),
        ]);
        if (pRaw) setProfileState(JSON.parse(pRaw));
        setOnboardingDone(doneRaw === '1');
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const setProfile = useCallback(async (p: PlayerProfile) => {
    setProfileState(p);
    await AsyncStorage.setItem(KEY_PROFILE, JSON.stringify(p));
    await syncProfileToSupabase(p);
  }, []);

  const setCoachStyle = useCallback(
    async (s: CoachStyle) => {
      const next = (profile ?? {
        skillLevel: 'beginner',
        playsForMoney: 'no',
        gameTypes: ['mtt'],
        goals: [],
        weakAreas: [],
        coachStyle: 'mental',
        subscriptionTier: 'free',
      }) satisfies PlayerProfile;

      const updated: PlayerProfile = { ...next, coachStyle: s };
      setProfileState(updated);
      await AsyncStorage.setItem(KEY_PROFILE, JSON.stringify(updated));
      await syncProfileToSupabase(updated);
    },
    [profile]
  );

  const completeOnboarding = useCallback(async () => {
    setOnboardingDone(true);
    await AsyncStorage.setItem(KEY_ONBOARDING, '1');
  }, []);

  const resetOnboarding = useCallback(async () => {
    setOnboardingDone(false);
    setProfileState(null);
    await Promise.all([
      AsyncStorage.removeItem(KEY_ONBOARDING),
      AsyncStorage.removeItem(KEY_PROFILE),
    ]);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      isHydrated,
      onboardingDone,
      profile,
      setProfile,
      setCoachStyle,
      completeOnboarding,
      resetOnboarding,
    }),
    [isHydrated, onboardingDone, profile, setProfile, setCoachStyle, completeOnboarding, resetOnboarding]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

export type { CoachStyle, PlayerProfile } from '../types/profile';
