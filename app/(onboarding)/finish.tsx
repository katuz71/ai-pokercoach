import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Database } from '../../types/database';

export default function Finish() {
  const router = useRouter();
  const { profile, completeOnboarding } = useApp();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    if (!user) {
      setError('Пользователь не авторизован');
      return;
    }

    if (!profile) {
      setError('Профиль не найден');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Upsert profile to Supabase
      const profileData = {
        id: user.id,
        skill_level: profile.skillLevel,
        plays_for_money: profile.playsForMoney,
        game_types: profile.gameTypes,
        goals: profile.goals,
        weak_areas: profile.weakAreas,
        coach_style: profile.coachStyle,
        updated_at: new Date().toISOString(),
      } as Database['public']['Tables']['profiles']['Insert'];

      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert(profileData as any);

      if (upsertError) throw upsertError;

      // Complete onboarding in local state
      await completeOnboarding();
      
      // Navigate to tabs
      router.replace('/(tabs)/analyze');
    } catch (err: any) {
      console.error('[Finish] Failed to save profile:', err);
      setError(err.message ?? 'Ошибка сохранения профиля');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <AppText variant="h1">Готово</AppText>
        <AppText variant="body" style={styles.subtitle}>
          Я понял твой уровень. Готов начать работу.
        </AppText>

        {error && (
          <View style={styles.errorCard}>
            <AppText variant="body" color="#FF5A6A">{error}</AppText>
          </View>
        )}

        <TouchableOpacity 
          onPress={onStart} 
          style={[styles.button, loading && styles.buttonDisabled]}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <AppText variant="h3" color="#FFFFFF">Перейти в приложение</AppText>
          )}
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 24,
  },
  subtitle: {
    fontSize: 18,
  },
  button: {
    backgroundColor: '#E53935',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  errorCard: {
    backgroundColor: '#11161F',
    borderColor: '#FF5A6A',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
});
