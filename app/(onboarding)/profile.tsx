import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { PlayerProfile, useApp } from '../../context/AppContext';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        active && styles.chipActive,
      ]}
    >
      <AppText color={active ? '#FFFFFF' : '#A7B0C0'} style={styles.chipText}>
        {label}
      </AppText>
    </TouchableOpacity>
  );
}

export default function ProfileSetup() {
  const router = useRouter();
  const { profile, setProfile } = useApp();

  const [skillLevel, setSkillLevel] = useState<PlayerProfile['skillLevel']>(profile?.skillLevel ?? 'beginner');
  const [playsForMoney, setPlaysForMoney] = useState<PlayerProfile['playsForMoney']>(profile?.playsForMoney ?? 'no');
  const [gameTypes, setGameTypes] = useState<PlayerProfile['gameTypes']>(profile?.gameTypes ?? ['mtt']);

  const canContinue = useMemo(() => gameTypes.length > 0, [gameTypes]);

  const toggleGame = (g: PlayerProfile['gameTypes'][number]) => {
    setGameTypes((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  const onNext = async () => {
    const next: PlayerProfile = {
      skillLevel,
      playsForMoney,
      gameTypes,
      goals: profile?.goals ?? [],
      weakAreas: profile?.weakAreas ?? [],
      coachStyle: profile?.coachStyle ?? 'mental',
    };
    await setProfile(next);
    router.push('/(onboarding)/coach');
  };

  return (
    <ScreenWrapper style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <AppText variant="h2">Профиль</AppText>
        <AppText variant="body" style={styles.description}>
          Короткая настройка под твой уровень
        </AppText>

        <View style={styles.section}>
          <AppText variant="h3" style={styles.sectionTitle}>Уровень</AppText>
          <View style={styles.chipRow}>
            <Chip label="Beginner" active={skillLevel === 'beginner'} onPress={() => setSkillLevel('beginner')} />
            <Chip label="Regular" active={skillLevel === 'intermediate'} onPress={() => setSkillLevel('intermediate')} />
            <Chip label="Pro" active={skillLevel === 'advanced'} onPress={() => setSkillLevel('advanced')} />
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="h3" style={styles.sectionTitle}>Играешь на деньги?</AppText>
          <View style={styles.chipRow}>
            <Chip label="Да" active={playsForMoney === 'regular'} onPress={() => setPlaysForMoney('regular')} />
            <Chip label="Нет" active={playsForMoney === 'no'} onPress={() => setPlaysForMoney('no')} />
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="h3" style={styles.sectionTitle}>Форматы</AppText>
          <View style={styles.chipRow}>
            <Chip label="MTT" active={gameTypes.includes('mtt')} onPress={() => toggleGame('mtt')} />
            <Chip label="Cash" active={gameTypes.includes('cash')} onPress={() => toggleGame('cash')} />
            <Chip label="SNG" active={gameTypes.includes('sng')} onPress={() => toggleGame('sng')} />
            <Chip label="Live" active={gameTypes.includes('live')} onPress={() => toggleGame('live')} />
          </View>
        </View>

        <TouchableOpacity
          disabled={!canContinue}
          onPress={onNext}
          style={[
            styles.button,
            !canContinue && styles.buttonDisabled,
          ]}
        >
          <AppText variant="h3" color="#FFFFFF">Далее</AppText>
        </TouchableOpacity>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
    gap: 24,
  },
  description: {
    fontSize: 16,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#11161F',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  chipActive: {
    backgroundColor: '#E53935',
    borderColor: '#E53935',
  },
  chipText: {
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#E53935',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#11161F',
    opacity: 0.5,
  },
});
