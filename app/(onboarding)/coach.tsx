import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { CoachStyle, useApp } from '../../context/AppContext';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';

const coaches: Record<CoachStyle, { title: string; desc: string }> = {
  toxic: { title: 'TOXIC', desc: 'Жёстко, прямо, без соплей' },
  mental: { title: 'MENTAL', desc: 'Спокойно, контроль, дисциплина' },
  math: { title: 'MATH', desc: 'Только цифры, диапазоны, EV' },
};

function CoachCard({
  style,
  title,
  desc,
  active,
  onPress,
}: {
  style: CoachStyle;
  title: string;
  desc: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Card style={[styles.coachCard, ...(active ? [styles.coachCardActive] : [])]}>
        <AppText variant="h3" style={styles.coachTitle}>{title}</AppText>
        <AppText variant="body" style={styles.coachDesc}>{desc}</AppText>
      </Card>
    </TouchableOpacity>
  );
}

export default function CoachSetup() {
  const router = useRouter();
  const { profile, setCoachStyle } = useApp();

  const [style, setStyle] = useState<CoachStyle>(profile?.coachStyle ?? 'mental');

  const onNext = async () => {
    await setCoachStyle(style);
    router.push('/(onboarding)/finish');
  };

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <AppText variant="h2">Стиль тренера</AppText>
        <AppText variant="body">Выбери подход к обучению</AppText>

        <View style={styles.coachList}>
          {(Object.entries(coaches) as [CoachStyle, typeof coaches[CoachStyle]][]).map(([key, coach]) => (
            <CoachCard
              key={key}
              style={key}
              title={coach.title}
              desc={coach.desc}
              active={style === key}
              onPress={() => setStyle(key)}
            />
          ))}
        </View>

        <View style={{ marginTop: 'auto' }}>
          <TouchableOpacity onPress={onNext} style={styles.button}>
            <AppText variant="h3" color="#FFFFFF">Продолжить</AppText>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
  },
  coachList: {
    gap: 12,
    marginTop: 8,
  },
  coachCard: {
    padding: 20,
  },
  coachCardActive: {
    borderColor: '#E53935',
    borderWidth: 2,
  },
  coachTitle: {
    fontSize: 20,
    letterSpacing: 1,
  },
  coachDesc: {
    marginTop: 8,
  },
  button: {
    backgroundColor: '#E53935',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
});
