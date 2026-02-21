import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';

export default function Welcome() {
  const router = useRouter();

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <AppText variant="h1">AI Poker Coach</AppText>
        <AppText variant="body" style={styles.subtitle}>
          Персональный тренер, который находит твои ошибки
        </AppText>

        <TouchableOpacity
          onPress={() => router.push('/(onboarding)/profile')}
          style={styles.button}
        >
          <AppText variant="h3" color="#FFFFFF">Начать</AppText>
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
});
