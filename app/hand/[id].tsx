import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { HandAnalysis } from '../../types/hand';

export default function HandDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [analysis, setAnalysis] = useState<HandAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAnalysis();
  }, [id]);

  async function loadAnalysis() {
    if (!id) {
      setError('Не указан ID анализа');
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('hand_analyses')
        .select('*')
        .eq('id', id)
        .eq('is_deleted', false)
        .single();

      if (fetchError) throw fetchError;

      setAnalysis(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      </ScreenWrapper>
    );
  }

  if (error || !analysis) {
    return (
      <ScreenWrapper>
        <View style={styles.container}>
          <Card style={styles.errorCard}>
            <AppText variant="body" color="#F44336">
              {error || 'Анализ не найден'}
            </AppText>
          </Card>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <AppText variant="body" color="#4C9AFF">
              ← Назад
            </AppText>
          </TouchableOpacity>
        </View>
      </ScreenWrapper>
    );
  }

  const { result } = analysis;
  const confidenceColor =
    result.confidence === 'HIGH' ? '#4CAF50' :
    result.confidence === 'MEDIUM' ? '#FF9800' : '#F44336';

  return (
    <ScreenWrapper>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <AppText variant="body" color="#4C9AFF">← Назад</AppText>
            </TouchableOpacity>
            <AppText variant="h1" style={styles.title}>Разбор руки</AppText>
            <AppText variant="caption" color="#65708A">
              {formatDate(analysis.created_at)}
            </AppText>
          </View>

          {/* Input data */}
          {analysis.input.raw_text && (
            <Card style={styles.card}>
              <AppText variant="h3" style={styles.sectionTitle}>Исходные данные</AppText>
              <View style={styles.inputBox}>
                <AppText variant="body" style={styles.inputText}>
                  {analysis.input.raw_text}
                </AppText>
              </View>
            </Card>
          )}

          {/* Recommendation */}
          <Card style={styles.card}>
            <AppText variant="h3" style={styles.sectionTitle}>Рекомендация</AppText>
            <View style={styles.actionRow}>
              <AppText variant="h2" color="#FFFFFF">{result.action}</AppText>
              {result.sizing && (
                <AppText variant="body" style={styles.sizing}>{result.sizing}</AppText>
              )}
            </View>
            <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor }]}>
              <AppText variant="label" color="#FFFFFF">
                Уверенность: {result.confidence}
              </AppText>
            </View>
          </Card>

          {/* Why */}
          <Card style={styles.card}>
            <AppText variant="h3" style={styles.sectionTitle}>Почему?</AppText>
            {result.why.map((item, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <AppText variant="body">• {item}</AppText>
              </View>
            ))}
          </Card>

          {/* Strategy next */}
          <Card style={styles.card}>
            <AppText variant="h3" style={styles.sectionTitle}>Стратегия на следующие улицы</AppText>
            {result.strategy_next.map((item, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <AppText variant="body">• {item}</AppText>
              </View>
            ))}
          </Card>

          {/* Common mistakes */}
          <Card style={styles.card}>
            <AppText variant="h3" style={styles.sectionTitle}>Частые ошибки</AppText>
            {result.common_mistakes.map((item, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <AppText variant="body">• {item}</AppText>
              </View>
            ))}
          </Card>

          {/* Leak link */}
          {result.leak_link && result.leak_link.tag && (
            <Card style={styles.card}>
              <AppText variant="h3" style={styles.sectionTitle}>Возможная протечка</AppText>
              <AppText variant="body" style={styles.leakTag}>
                {result.leak_link.tag}
              </AppText>
            </Card>
          )}

          {/* Drill */}
          <Card style={styles.card}>
            <AppText variant="h3" style={styles.sectionTitle}>Упражнение</AppText>
            <AppText variant="body" style={styles.drillTitle}>
              {result.drill.title}
            </AppText>
            {result.drill.steps.map((step, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <AppText variant="body">{idx + 1}. {step}</AppText>
              </View>
            ))}
          </Card>
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    gap: 16,
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
  },
  card: {
    padding: 20,
  },
  errorCard: {
    padding: 16,
    backgroundColor: '#1F1416',
    borderColor: '#F44336',
  },
  backButton: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    marginBottom: 12,
  },
  inputBox: {
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  inputText: {
    fontSize: 14,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  sizing: {
    fontSize: 16,
  },
  confidenceBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  bulletItem: {
    marginBottom: 8,
  },
  drillTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  leakTag: {
    fontStyle: 'italic',
  },
});
