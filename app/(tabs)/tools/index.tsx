import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';

type ToolCardProps = {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
  status?: string;
};

function ToolCard({ icon, title, description, onPress, disabled, status }: ToolCardProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={false}
      style={styles.cardTouch}
    >
      <Card style={[styles.card, disabled && styles.cardDisabled]}>
        <View style={styles.cardHeader}>
          <AppText variant="h2" style={styles.cardIcon}>{icon}</AppText>
          {status ? (
            <AppText variant="label" color="#65708A">{status}</AppText>
          ) : null}
        </View>
        <AppText variant="h3" style={styles.cardTitle}>{title}</AppText>
        <AppText variant="caption" style={styles.cardDescription}>{description}</AppText>
      </Card>
    </TouchableOpacity>
  );
}

export default function ToolsScreen() {
  const router = useRouter();

  return (
    <ScreenWrapper>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <AppText variant="h1" style={styles.title}>Инструменты</AppText>
            <AppText variant="caption" color="#65708A">
              Полезные утилиты для покериста
            </AppText>
          </View>

          <View style={styles.grid}>
            <ToolCard
              icon="🧮"
              title="Pot Odds Calculator"
              description="Быстрый расчет шансов банка и эквити"
              onPress={() => router.push('/(tabs)/tools/calculator')}
            />
            <ToolCard
              icon="🧠"
              title="AI Insights"
              description="Глубокая аналитика твоих ликов"
              onPress={() => router.push('/(tabs)/tools/insights')}
            />
            <ToolCard
              icon="💰"
              title="Bankroll Tracker"
              description="Статистика сессий"
              onPress={() => router.push('/(tabs)/tools/bankroll')}
            />
          </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  container: {
    flex: 1,
    gap: 20,
  },
  header: {
    gap: 4,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
  },
  grid: {
    gap: 16,
  },
  cardTouch: {
    width: '100%',
  },
  card: {
    backgroundColor: '#1B1C22',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  cardDisabled: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardIcon: {
    fontSize: 28,
  },
  cardTitle: {
    fontSize: 18,
    marginBottom: 6,
  },
  cardDescription: {
    color: '#65708A',
    lineHeight: 20,
  },
});
