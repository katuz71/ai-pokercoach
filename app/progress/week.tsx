import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider';
import { WeekProgress } from '../../types/progress';
import { LeakSummaryRow } from '../../types/database';

export default function WeekProgressScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<WeekProgress | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    loadWeekProgress();
  }, [user]);

  const loadWeekProgress = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Calculate date range: last 7 days including today (UTC)
      const todayUTC = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - 6); // 7 days including today
      const startDateUTC = startDate.toISOString().slice(0, 10); // YYYY-MM-DD
      const startDateTimeUTC = `${startDateUTC}T00:00:00.000Z`;

      // Fetch hands analyzed
      const { data: handsData, error: handsError } = await supabase
        .from('hand_analyses')
        .select('id', { count: 'exact', head: false })
        .eq('user_id', user.id)
        .eq('is_deleted', false)
        .gte('created_at', startDateTimeUTC);

      if (handsError) throw handsError;

      // Fetch drills completed
      const { data: drillsData, error: drillsError } = await supabase
        .from('training_events')
        .select('id', { count: 'exact', head: false })
        .eq('user_id', user.id)
        .gte('created_at', startDateTimeUTC);

      if (drillsError) throw drillsError;

      // Fetch check-ins
      const { data: checkinsData, error: checkinsError } = await supabase
        .from('daily_checkins')
        .select('id', { count: 'exact', head: false })
        .eq('user_id', user.id)
        .gte('checkin_date', startDateUTC);

      if (checkinsError) throw checkinsError;

      // Fetch current streak from latest check-in
      const { data: latestCheckin, error: checkinError } = await supabase
        .from('daily_checkins')
        .select('message')
        .eq('user_id', user.id)
        .order('checkin_date', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { message: any } | null; error: any };

      if (checkinError) throw checkinError;

      const streak = latestCheckin?.message?.streak || 0;

      // Fetch latest leak summary for focus
      const { data: leakSummaryData, error: leakError } = await supabase
        .from('leak_summaries')
        .select('summary')
        .eq('user_id', user.id)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { summary: any } | null; error: any };

      if (leakError) throw leakError;

      let focusTag: string | null = null;
      let focusCount: number | null = null;

      if (leakSummaryData?.summary?.top_leaks?.[0]) {
        focusTag = leakSummaryData.summary.top_leaks[0].tag;
        focusCount = leakSummaryData.summary.top_leaks[0].count;
      }

      setProgress({
        hands: handsData?.length || 0,
        drills: drillsData?.length || 0,
        checkins: checkinsData?.length || 0,
        streak,
        focus_tag: focusTag,
        focus_count: focusCount,
      });
    } catch (err: any) {
      console.error('[WeekProgress] Failed to load week progress:', err);
      setError(err.message ?? 'Ошибка загрузки прогресса');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator color="#4C9AFF" size="large" />
          <AppText variant="body" style={{ marginTop: 16 }}>Загрузка...</AppText>
        </View>
      </ScreenWrapper>
    );
  }

  if (error) {
    return (
      <ScreenWrapper>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <AppText variant="body" color="#4C9AFF">← Назад</AppText>
            </TouchableOpacity>
            <AppText variant="h2">Week Progress</AppText>
          </View>
          <Card style={styles.errorCard}>
            <AppText variant="body" color="#FF5A6A">{error}</AppText>
          </Card>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <AppText variant="body" color="#4C9AFF">← Назад</AppText>
            </TouchableOpacity>
            <AppText variant="h2" style={styles.title}>Week Progress</AppText>
          </View>

          {/* Period label */}
          <AppText variant="body" style={styles.periodLabel}>
            Последние 7 дней (включая сегодня)
          </AppText>

          {/* Metrics Grid */}
          <View style={styles.metricsGrid}>
            {/* Hands analyzed */}
            <Card style={styles.metricCard}>
              <AppText variant="h1" color="#4C9AFF" style={styles.metricValue}>
                {progress?.hands || 0}
              </AppText>
              <AppText variant="body" style={styles.metricLabel}>
                Hands analyzed
              </AppText>
            </Card>

            {/* Drills completed */}
            <Card style={styles.metricCard}>
              <AppText variant="h1" color="#FF9800" style={styles.metricValue}>
                {progress?.drills || 0}
              </AppText>
              <AppText variant="body" style={styles.metricLabel}>
                Drills completed
              </AppText>
            </Card>

            {/* Check-ins */}
            <Card style={styles.metricCard}>
              <AppText variant="h1" color="#4CAF50" style={styles.metricValue}>
                {progress?.checkins || 0}
              </AppText>
              <AppText variant="body" style={styles.metricLabel}>
                Check-ins
              </AppText>
            </Card>

            {/* Streak */}
            <Card style={styles.metricCard}>
              <AppText variant="h1" color="#E53935" style={styles.metricValue}>
                {progress?.streak || 0}
              </AppText>
              <AppText variant="body" style={styles.metricLabel}>
                Streak
              </AppText>
            </Card>
          </View>

          {/* This week focus */}
          <Card style={styles.focusCard}>
            <AppText variant="h3" style={styles.focusTitle}>This week focus</AppText>
            {progress?.focus_tag && progress?.focus_count ? (
              <View style={styles.focusContent}>
                <View style={styles.focusTagBadge}>
                  <AppText variant="label" color="#FFFFFF" style={styles.focusTagText}>
                    {progress.focus_tag}
                  </AppText>
                </View>
                <AppText variant="h2" color="#FFFFFF" style={styles.focusCount}>
                  {progress.focus_count}x
                </AppText>
                <AppText variant="body" style={styles.focusDescription}>
                  Твоя самая частая ошибка на этой неделе
                </AppText>
              </View>
            ) : (
              <View style={styles.noFocusContainer}>
                <AppText variant="body" style={styles.noFocusText}>
                  Добавь разборы, чтобы я нашёл твои leaks.
                </AppText>
              </View>
            )}
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
  container: {
    flex: 1,
    gap: 20,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
  },
  periodLabel: {
    fontSize: 14,
    opacity: 0.7,
    marginTop: -12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    padding: 20,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  metricValue: {
    fontSize: 48,
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
  },
  focusCard: {
    padding: 24,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(229, 57, 53, 0.3)',
    borderWidth: 1,
    gap: 16,
  },
  focusTitle: {
    fontSize: 18,
    marginBottom: 4,
  },
  focusContent: {
    gap: 12,
    alignItems: 'center',
  },
  focusTagBadge: {
    backgroundColor: '#E53935',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  focusTagText: {
    fontSize: 14,
    fontWeight: '700',
  },
  focusCount: {
    fontSize: 40,
    fontWeight: '700',
    marginTop: 8,
  },
  focusDescription: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
    marginTop: 4,
  },
  noFocusContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  noFocusText: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  errorCard: {
    backgroundColor: '#11161F',
    borderColor: '#FF5A6A',
    borderWidth: 1,
    padding: 20,
  },
});
