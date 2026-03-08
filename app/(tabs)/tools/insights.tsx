import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';
import { supabase } from '../../../lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

interface SkillRating {
  leak_tag: string;
  rating: number;
  total_attempts: number;
  [key: string]: unknown;
}

interface TopLeak {
  tag: string;
  severity?: string;
  description?: string;
  explanation?: string;
  [key: string]: unknown;
}

interface LeakSummaryRow {
  id: string;
  summary: {
    top_leaks?: TopLeak[];
    improvement_plan?: string[];
  };
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatLeakTag(tag: string): string {
  return tag
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getSeverityColor(severity: string | undefined): string {
  if (!severity) return '#4C9AFF';
  const s = severity.toUpperCase();
  if (s === 'HIGH') return '#EF4444';
  if (s === 'MEDIUM') return '#F59E0B';
  return '#4C9AFF';
}

// ─── Screen ───────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skillRatings, setSkillRatings] = useState<SkillRating[]>([]);
  const [latestSummary, setLatestSummary] = useState<LeakSummaryRow | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ratingsRes, summaryRes] = await Promise.all([
        supabase
          .from('skill_ratings')
          .select('*')
          .order('rating', { ascending: false }),
        supabase
          .from('leak_summaries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (ratingsRes.error) throw new Error(ratingsRes.error.message);
      if (summaryRes.error) throw new Error(summaryRes.error.message);

      setSkillRatings(ratingsRes.data ?? []);
      setLatestSummary(summaryRes.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4C9AFF" />
          <AppText variant="body" color="#A7B0C0" style={styles.loadingText}>
            Загрузка аналитики…
          </AppText>
        </View>
      </ScreenWrapper>
    );
  }

  const topLeaks = latestSummary?.summary?.top_leaks ?? [];

  return (
    <ScreenWrapper>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
            <AppText variant="body" color="#4C9AFF">← Назад</AppText>
          </TouchableOpacity>
          <AppText variant="h1" style={styles.title}>AI Insights</AppText>
        </View>

        {error ? (
          <Card style={styles.errorCard}>
            <AppText variant="body" color="#EF4444">{error}</AppText>
          </Card>
        ) : null}

        {/* Section 1: Skill Ratings */}
        <View style={styles.section}>
          <AppText variant="h2" style={styles.sectionTitle}>Твои навыки</AppText>
          {skillRatings.length === 0 ? (
            <Card style={styles.emptyCard}>
              <AppText variant="body" color="#A7B0C0" style={styles.emptyText}>
                Пройди больше тренировок (Drills), чтобы ИИ оценил твои навыки.
              </AppText>
            </Card>
          ) : (
            <View style={styles.skillList}>
              {skillRatings.map((item) => (
                <Card key={item.leak_tag} style={styles.skillCard}>
                  <AppText variant="h3" style={styles.skillTag}>
                    {formatLeakTag(item.leak_tag)}
                  </AppText>
                  <AppText variant="body" color="#A7B0C0" style={styles.skillMeta}>
                    Rating: {item.rating}/100 (Тренировок: {item.total_attempts ?? 0})
                  </AppText>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.min(100, Math.max(0, item.rating))}%` },
                      ]}
                    />
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>

        {/* Section 2: Top Leaks */}
        <View style={styles.section}>
          <AppText variant="h2" style={styles.sectionTitle}>Топ ошибки</AppText>
          {topLeaks.length === 0 ? (
            <Card style={styles.emptyCard}>
              <AppText variant="body" color="#A7B0C0" style={styles.emptyText}>
                Проанализируй больше раздач, чтобы ИИ нашёл твои лики.
              </AppText>
            </Card>
          ) : (
            <View style={styles.leakList}>
              {topLeaks.map((leak, index) => {
                const severity = leak.severity ?? '';
                const description = leak.description ?? leak.explanation ?? '';
                const badgeColor = getSeverityColor(severity);
                return (
                  <Card key={`${leak.tag}-${index}`} style={styles.leakCard}>
                    <View style={styles.leakHeader}>
                      <AppText variant="h3" style={styles.leakTag}>
                        {formatLeakTag(leak.tag)}
                      </AppText>
                      {severity ? (
                        <View style={[styles.severityBadge, { backgroundColor: badgeColor }]}>
                          <AppText variant="label" style={styles.severityText}>
                            {severity.toUpperCase()}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                    {description ? (
                      <AppText variant="body" color="#A7B0C0" style={styles.leakDescription}>
                        {description}
                      </AppText>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    marginTop: 8,
  },
  header: {
    marginBottom: 24,
    gap: 4,
  },
  backRow: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    marginBottom: 24,
    padding: 16,
    borderRadius: 12,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 24,
    marginBottom: 12,
    color: '#FFFFFF',
  },
  emptyCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 20,
    borderRadius: 12,
  },
  emptyText: {
    textAlign: 'center',
    lineHeight: 22,
  },
  skillList: {
    gap: 12,
  },
  skillCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  skillTag: {
    color: '#FFFFFF',
    fontSize: 18,
  },
  skillMeta: {
    fontSize: 14,
  },
  progressTrack: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4C9AFF',
    borderRadius: 4,
  },
  leakList: {
    gap: 12,
  },
  leakCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  leakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  leakTag: {
    color: '#FFFFFF',
    fontSize: 18,
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  severityText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  leakDescription: {
    fontSize: 15,
    lineHeight: 22,
  },
});
