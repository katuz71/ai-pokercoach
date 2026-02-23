import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../providers/AuthProvider';
import { getLeakDisplay } from '../../../lib/leakCatalog';

const MISTAKE_REASON_KEYS = ['range', 'sizing', 'position', 'board', 'stack', 'unknown'] as const;
type MistakeReasonKey = (typeof MISTAKE_REASON_KEYS)[number];

function normalizeReason(r: string | null | undefined): MistakeReasonKey {
  if (!r || !r.trim()) return 'unknown';
  const lower = r.trim().toLowerCase();
  return MISTAKE_REASON_KEYS.includes(lower as MistakeReasonKey) ? (lower as MistakeReasonKey) : 'unknown';
}

function reasonLabel(key: MistakeReasonKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

type MistakeReasonRow = { reason: MistakeReasonKey; count: number; percent: number };
type LeakRow = { leak_tag: string; count: number; pctOfTop: number };

/** Per-leak counts by reason; used to show top-2 reasons under each leak row. */
type LeakReasonsBreakdown = Record<string, Record<MistakeReasonKey, number>>;

function getTopTwoReasons(
  counts: Record<MistakeReasonKey, number>
): Array<{ reason: MistakeReasonKey; count: number }> {
  return (MISTAKE_REASON_KEYS as readonly MistakeReasonKey[])
    .filter((k) => counts[k] > 0)
    .map((reason) => ({ reason, count: counts[reason] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
}

export default function InsightsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mistakeReasons, setMistakeReasons] = useState<MistakeReasonRow[]>([]);
  const [topLeaks, setTopLeaks] = useState<LeakRow[]>([]);
  const [leakReasonsBreakdown, setLeakReasonsBreakdown] = useState<LeakReasonsBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    try {
      // Block A: mistakes last 7 days — select only mistake_reason
      const { data: mistakesData, error: mistakesErr } = await supabase
        .from('training_events')
        .select('mistake_reason')
        .eq('user_id', user.id)
        .eq('is_correct', false)
        .gte('created_at', sevenDaysAgo);

      if (mistakesErr) throw mistakesErr;

      const reasonCounts: Record<MistakeReasonKey, number> = {
        range: 0,
        sizing: 0,
        position: 0,
        board: 0,
        stack: 0,
        unknown: 0,
      };
      (mistakesData ?? []).forEach((row: { mistake_reason: string | null }) => {
        const key = normalizeReason(row.mistake_reason);
        reasonCounts[key] += 1;
      });
      const totalMistakes = Object.values(reasonCounts).reduce((a, b) => a + b, 0);
      const reasonRows: MistakeReasonRow[] = MISTAKE_REASON_KEYS.filter((k) => reasonCounts[k] > 0).map(
        (reason) => ({
          reason,
          count: reasonCounts[reason],
          percent: totalMistakes > 0 ? (reasonCounts[reason] / totalMistakes) * 100 : 0,
        })
      );
      setMistakeReasons(reasonRows);

      // Block B: top leaks last 30 days — select only leak_tag
      const { data: leaksData, error: leaksErr } = await supabase
        .from('training_events')
        .select('leak_tag')
        .eq('user_id', user.id)
        .eq('is_correct', false)
        .gte('created_at', thirtyDaysAgo);

      if (leaksErr) throw leaksErr;

      const leakCounts: Record<string, number> = {};
      (leaksData ?? []).forEach((row: { leak_tag: string | null }) => {
        const tag = row.leak_tag?.trim();
        if (!tag) return;
        leakCounts[tag] = (leakCounts[tag] ?? 0) + 1;
      });
      const sorted = Object.entries(leakCounts)
        .map(([leak_tag, count]) => ({ leak_tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      const top1 = sorted[0]?.count ?? 1;
      const leakRows: LeakRow[] = sorted.map(({ leak_tag, count }) => ({
        leak_tag,
        count,
        pctOfTop: (count / top1) * 100,
      }));
      setTopLeaks(leakRows);

      // One extra request: breakdown of mistake_reason per top-5 leak (30 days)
      if (leakRows.length > 0) {
        setBreakdownLoading(true);
        setLeakReasonsBreakdown(null);
        try {
          const topTags = leakRows.map((r) => r.leak_tag);
          const { data: breakdownData, error: breakdownErr } = await supabase
            .from('training_events')
            .select('leak_tag, mistake_reason')
            .eq('user_id', user.id)
            .eq('is_correct', false)
            .gte('created_at', thirtyDaysAgo)
            .in('leak_tag', topTags);

          if (!breakdownErr && breakdownData) {
            const breakdown: LeakReasonsBreakdown = {};
            (breakdownData as { leak_tag: string | null; mistake_reason: string | null }[]).forEach((row) => {
              const tag = row.leak_tag?.trim();
              if (!tag) return;
              if (!breakdown[tag]) {
                breakdown[tag] = { range: 0, sizing: 0, position: 0, board: 0, stack: 0, unknown: 0 };
              }
              const key = normalizeReason(row.mistake_reason);
              breakdown[tag][key] += 1;
            });
            setLeakReasonsBreakdown(breakdown);
          } else {
            setLeakReasonsBreakdown({});
          }
        } catch (_e) {
          setLeakReasonsBreakdown({});
        } finally {
          setBreakdownLoading(false);
        }
      } else {
        setLeakReasonsBreakdown({});
      }
    } catch (e) {
      console.error('Insights load failed:', e);
      setError(e instanceof Error ? e.message : 'Failed to load insights');
      setMistakeReasons([]);
      setTopLeaks([]);
      setLeakReasonsBreakdown(null);
      setBreakdownLoading(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) {
    return (
      <ScreenWrapper>
        <View style={styles.centered}>
          <AppText variant="body" color="#65708A">Sign in to see insights.</AppText>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
            <AppText variant="body" color="#4C9AFF">← Back</AppText>
          </TouchableOpacity>
          <AppText variant="caption" color="#A7B0C0">Tools</AppText>
          <AppText variant="h1" style={styles.title}>Insights</AppText>
        </View>

        {loading && (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color="#FFFFFF" size="small" />
            <AppText variant="caption" color="#65708A" style={styles.loadingText}>Loading…</AppText>
          </View>
        )}

        {error && (
          <Card style={styles.errorCard}>
            <AppText variant="body" color="#E53935">{error}</AppText>
            <TouchableOpacity style={styles.retryButton} onPress={load}>
              <AppText variant="label" color="#4C9AFF">Retry</AppText>
            </TouchableOpacity>
          </Card>
        )}

        {!loading && !error && (
          <>
            {/* Block A: Mistake reasons (7 days) */}
            <Card style={styles.blockCard}>
              <AppText variant="h3" style={styles.blockTitle}>Mistake reasons (7 days)</AppText>
              {mistakeReasons.length === 0 ? (
                <AppText variant="body" color="#65708A">No mistakes in last 7 days.</AppText>
              ) : (
                <>
                  {mistakeReasons.map(({ reason, count, percent }) => (
                    <View key={reason} style={styles.reasonRow}>
                      <View style={styles.reasonBarBg}>
                        <View
                          style={[styles.reasonBarFill, { width: `${percent}%` }]}
                        />
                      </View>
                      <View style={styles.reasonMeta}>
                        <AppText variant="body" color="#FFFFFF">
                          {reasonLabel(reason)}
                        </AppText>
                        <AppText variant="caption" color="#A7B0C0">
                          {count} ({percent.toFixed(0)}%)
                        </AppText>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </Card>

            {/* Block B: Top leaks by mistakes (30 days) */}
            <Card style={styles.blockCard}>
              <AppText variant="h3" style={styles.blockTitle}>Top leaks by mistakes (30 days)</AppText>
              {breakdownLoading && (
                <AppText variant="caption" color="#65708A" style={styles.loadingReasonsText}>
                  Loading reasons…
                </AppText>
              )}
              {topLeaks.length === 0 ? (
                <AppText variant="body" color="#65708A">No mistakes with leak tag in last 30 days.</AppText>
              ) : (
                topLeaks.map(({ leak_tag, count, pctOfTop }) => {
                  const breakdown = leakReasonsBreakdown?.[leak_tag];
                  const topTwo = breakdown ? getTopTwoReasons(breakdown) : [];
                  const showReasons = topTwo.length > 0;
                  return (
                    <Pressable
                      key={leak_tag}
                      style={styles.leakRow}
                      onPress={() =>
                        router.push({
                          pathname: '/(tabs)/train',
                          params: { startSessionLeakTag: leak_tag },
                        })
                      }
                    >
                      <View style={styles.leakBarBg}>
                        <View style={[styles.leakBarFill, { width: `${pctOfTop}%` }]} />
                      </View>
                      <View style={styles.leakMeta}>
                        <AppText variant="body" color="#FFFFFF" numberOfLines={1}>
                          {getLeakDisplay(leak_tag).title}
                        </AppText>
                        <AppText variant="caption" color="#A7B0C0">{count}</AppText>
                      </View>
                      {!breakdownLoading && showReasons && (
                        <AppText variant="caption" color="#65708A" style={styles.topReasonsLine}>
                          Top reasons: {topTwo.map(({ reason, count: c }) => `${reasonLabel(reason)} ${c}`).join(' · ')}
                        </AppText>
                      )}
                    </Pressable>
                  );
                })
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 20,
    gap: 4,
  },
  backRow: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
  },
  loadingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  loadingText: {
    marginLeft: 4,
  },
  errorCard: {
    padding: 16,
    backgroundColor: 'rgba(229, 57, 53, 0.08)',
    borderColor: 'rgba(229, 57, 53, 0.3)',
    marginBottom: 16,
  },
  retryButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  blockCard: {
    padding: 20,
    marginBottom: 16,
  },
  blockTitle: {
    fontSize: 18,
    marginBottom: 16,
  },
  loadingReasonsText: {
    fontSize: 12,
    marginBottom: 8,
  },
  reasonRow: {
    marginBottom: 12,
  },
  reasonBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    marginBottom: 4,
  },
  reasonBarFill: {
    height: '100%',
    backgroundColor: '#4C9AFF',
    borderRadius: 3,
  },
  reasonMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leakRow: {
    marginBottom: 12,
  },
  leakBarBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    marginBottom: 4,
  },
  leakBarFill: {
    height: '100%',
    backgroundColor: 'rgba(76, 154, 255, 0.6)',
    borderRadius: 2,
  },
  leakMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topReasonsLine: {
    marginTop: 4,
    fontSize: 12,
  },
});
