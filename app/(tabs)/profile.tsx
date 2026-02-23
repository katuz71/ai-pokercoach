import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { CoachStyle } from '../../context/AppContext';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { ensureSession } from '../../lib/ensureSession';
import { callEdge } from '../../lib/edge';
import { Profile } from '../../types/database';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { LeakSummary } from '../../types/leaks';
import { DailyCheckin } from '../../types/checkin';
import { getLeakDisplay, normalizeLeakTag } from '../../lib/leakCatalog';
import { ActionPlanResponse, ActionPlanItem } from '../../types/actionPlan';
import { getFunctionsErrorDetails } from '../../lib/functionsError';

const MISTAKE_REASON_KEYS = ['range', 'sizing', 'position', 'board', 'stack', 'unknown'] as const;
type MistakeReasonKey = (typeof MISTAKE_REASON_KEYS)[number];

function normalizeMistakeReason(r: string | null | undefined): MistakeReasonKey {
  if (!r || !String(r).trim()) return 'unknown';
  const lower = String(r).trim().toLowerCase();
  return MISTAKE_REASON_KEYS.includes(lower as MistakeReasonKey) ? (lower as MistakeReasonKey) : 'unknown';
}

function mistakeReasonLabel(key: MistakeReasonKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

const labelByStyle: Record<CoachStyle, string> = {
  toxic: 'TOXIC',
  mental: 'MENTAL',
  math: 'MATH',
};

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leakSummary, setLeakSummary] = useState<LeakSummary | null>(null);
  const [loadingLeaks, setLoadingLeaks] = useState(false);
  const [leakError, setLeakError] = useState<string | null>(null);
  
  // Daily Check-in state
  const [dailyCheckin, setDailyCheckin] = useState<DailyCheckin | null>(null);
  const [loadingCheckin, setLoadingCheckin] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  
  // Activity reminder state
  const [hasActivityToday, setHasActivityToday] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(false);
  
  // Action Plan state
  const [actionPlan, setActionPlan] = useState<ActionPlanResponse | null>(null);
  const [loadingActionPlan, setLoadingActionPlan] = useState(false);
  const [actionPlanError, setActionPlanError] = useState<string | null>(null);

  // Most common mistake reasons (7 days) for Coach Review
  const [mistakeReasons7d, setMistakeReasons7d] = useState<Array<{ reason: MistakeReasonKey; count: number }>>([]);
  const [loadingMistakeReasons, setLoadingMistakeReasons] = useState(false);
  const [mistakeReasonsError, setMistakeReasonsError] = useState<string | null>(null);

  // Sync action plan with recent activity
  const syncActionPlan = async () => {
    if (!user) return;

    try {
      await ensureSession();

      const data = await callEdge('ai-sync-action-plan', {}) as ActionPlanResponse;

      // Log sync results
      console.log('[Profile] sync returned items:', data?.items?.map(i => ({id:i.id,type:i.type,done:i.done})));

      // Update local state directly from sync response (no additional DB query)
      if (data?.items) {
        setActionPlan(prev => prev ? {
          ...prev,
          items: data.items,
        } : null);
      }
    } catch (err: any) {
      // Gracefully ignore 404 (no plan) or other errors
      if (err?.message?.includes('plan_not_found') || err?.message?.includes('404')) {
        console.log('[Profile] No action plan to sync');
        return;
      }
      console.error('[Profile] Failed to sync action plan:', err);
    }
  };

  // Load current action plan
  const loadCurrentActionPlan = async () => {
    if (!user) return;

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('action_plans')
        .select('id, period_start, period_end, focus_tag, items')
        .eq('user_id', user.id)
        .lte('period_start', today)
        .gte('period_end', today)
        .maybeSingle() as { 
          data: { 
            id: string; 
            period_start: string; 
            period_end: string; 
            focus_tag: string | null; 
            items: any 
          } | null; 
          error: any 
        };

      if (error) {
        console.error('[Profile] Failed to load action plan:', error);
        return;
      }

      if (data) {
        // Set initial plan data from DB
        setActionPlan({
          plan_id: data.id,
          period_start: data.period_start,
          period_end: data.period_end,
          focus_tag: data.focus_tag || '',
          items: data.items as ActionPlanItem[],
        });

        // Sync will update items in state directly - no additional DB query
        await syncActionPlan();
      }
    } catch (err: any) {
      console.error('[Profile] Failed to load action plan:', err);
    }
  };

  const loadMistakeReasons7d = async () => {
    if (!user) return;
    setLoadingMistakeReasons(true);
    setMistakeReasonsError(null);
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('training_events')
        .select('mistake_reason')
        .eq('user_id', user.id)
        .eq('is_correct', false)
        .gte('created_at', sevenDaysAgo);

      if (error) throw error;

      const counts: Record<MistakeReasonKey, number> = {
        range: 0,
        sizing: 0,
        position: 0,
        board: 0,
        stack: 0,
        unknown: 0,
      };
      (data ?? []).forEach((row: { mistake_reason: string | null }) => {
        const key = normalizeMistakeReason(row.mistake_reason);
        counts[key] += 1;
      });
      const top3 = (MISTAKE_REASON_KEYS as readonly MistakeReasonKey[])
        .filter((k) => counts[k] > 0)
        .map((reason) => ({ reason, count: counts[reason] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      setMistakeReasons7d(top3);
    } catch (err: any) {
      console.error('[Profile] Failed to load mistake reasons:', err);
      setMistakeReasonsError(err?.message ?? 'Ошибка загрузки');
    } finally {
      setLoadingMistakeReasons(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    loadProfile();
    loadTodayCheckin();
    checkTodayActivity();
    loadCurrentActionPlan();
    loadMistakeReasons7d();
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (fetchError) {
        // If profile doesn't exist yet, it's not an error
        if (fetchError.code === 'PGRST116') {
          setProfile(null);
        } else {
          throw fetchError;
        }
      } else {
        setProfile(data);
      }
    } catch (err: any) {
      console.error('[Profile] Failed to load profile:', err);
      setError(err.message ?? 'Ошибка загрузки профиля');
    } finally {
      setLoading(false);
    }
  };

  const loadTodayCheckin = async () => {
    if (!user) return;

    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      const { data, error } = await supabase
        .from('daily_checkins')
        .select('message')
        .eq('user_id', user.id)
        .eq('checkin_date', today)
        .maybeSingle() as { data: { message: any } | null; error: any };

      if (error) {
        console.error('[Profile] Failed to load today checkin:', error);
        return;
      }

      if (data?.message) {
        setDailyCheckin(data.message as DailyCheckin);
      }
    } catch (err: any) {
      console.error('[Profile] Failed to load today checkin:', err);
    }
  };

  const checkTodayActivity = async () => {
    if (!user) return;

    setLoadingActivity(true);

    try {
      const todayUTC = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const startOfTodayUTC = `${todayUTC}T00:00:00.000Z`;

      // Check for hand analyses today
      const { data: handsData, error: handsError } = await supabase
        .from('hand_analyses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_deleted', false)
        .gte('created_at', startOfTodayUTC)
        .limit(1);

      if (handsError) throw handsError;

      // Check for training events today
      const { data: drillsData, error: drillsError } = await supabase
        .from('training_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startOfTodayUTC)
        .limit(1);

      if (drillsError) throw drillsError;

      // Check for daily checkin today
      const { data: checkinData, error: checkinError } = await supabase
        .from('daily_checkins')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('checkin_date', todayUTC)
        .limit(1);

      if (checkinError) throw checkinError;

      const hasActivity = (handsData && handsData.length > 0) || 
                          (drillsData && drillsData.length > 0) || 
                          (checkinData && checkinData.length > 0);

      setHasActivityToday(hasActivity);
    } catch (err: any) {
      console.error('[Profile] Failed to check today activity:', err);
    } finally {
      setLoadingActivity(false);
    }
  };

  const generateCheckin = async () => {
    if (!user) return;

    setLoadingCheckin(true);
    setCheckinError(null);
    setShowAnswer(false);

    try {
      // Ensure valid session before calling Edge Function
      await ensureSession();

      // Get coach_style from profile, fallback to MENTAL
      const coachStyle = (profile?.coach_style || 'mental').toUpperCase();

      const data = await callEdge('ai-daily-checkin', {
        coach_style: coachStyle,
      });

      setDailyCheckin(data as DailyCheckin);
    } catch (err: any) {
      console.error('[Profile] Failed to generate checkin:', err);
      // Handle session creation failure
      if (err?.message === 'Failed to create session') {
        setCheckinError('Не удалось создать сессию. Перезапусти приложение.');
      } else {
        setCheckinError(err.message ?? 'Ошибка генерации чек-ина');
      }
    } finally {
      setLoadingCheckin(false);
    }
  };

  const loadLeakSummary = async () => {
    if (!user) return;

    setLoadingLeaks(true);
    setLeakError(null);

    try {
      // Ensure valid session before calling Edge Function
      await ensureSession();

      const data = await callEdge('ai-summarize-leaks', {});

      setLeakSummary(data.summary);
    } catch (err: any) {
      console.error('[Profile] summarize invoke error raw:', err);

      // Handle session creation failure
      if (err?.message === 'Failed to create session') {
        setLeakError('Не удалось создать сессию. Перезапусти приложение.');
      } else {
        setLeakError(err.message ?? 'Ошибка загрузки анализа');
      }
    } finally {
      setLoadingLeaks(false);
    }
  };

  const generateActionPlan = async () => {
    if (!user) return;

    setLoadingActionPlan(true);
    setActionPlanError(null);

    try {
      await ensureSession();

      const data = await callEdge('ai-generate-action-plan', {});

      setActionPlan(data as ActionPlanResponse);
    } catch (err: any) {
      console.error('[Profile] generate action plan error:', err);

      if (err?.message === 'Failed to create session') {
        setActionPlanError('Не удалось создать сессию. Перезапусти приложение.');
      } else if (err?.message?.includes('no_leaks_found')) {
        setActionPlanError('Недостаточно данных. Сделай 3+ разбора.');
      } else if (err?.message?.includes('plan_not_found') || err?.message?.includes('404')) {
        setActionPlanError('План не найден (404)');
      } else {
        setActionPlanError(err.message ?? 'Ошибка генерации плана');
      }
    } finally {
      setLoadingActionPlan(false);
    }
  };

  const toggleActionPlanItem = async (itemId: string) => {
    if (!user || !actionPlan) return;

    const updatedItems = actionPlan.items.map(item =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );

    // Optimistic update
    setActionPlan({
      ...actionPlan,
      items: updatedItems,
    });

    try {
      const { error } = await (supabase
        .from('action_plans') as any)
        .update({ items: updatedItems })
        .eq('id', actionPlan.plan_id);

      if (error) {
        console.error('[Profile] Failed to update action plan:', error);
        // Revert on error
        await loadCurrentActionPlan();
      }
    } catch (err: any) {
      console.error('[Profile] Failed to update action plan:', err);
      // Revert on error
      await loadCurrentActionPlan();
    }
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator color="#E53935" size="large" />
          <AppText variant="body" style={{ marginTop: 16 }}>Загрузка...</AppText>
        </View>
      </ScreenWrapper>
    );
  }

  if (error) {
    return (
      <ScreenWrapper>
        <View style={styles.container}>
          <AppText variant="h2">Profile</AppText>
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
          <AppText variant="h2">Profile</AppText>

          {/* Daily Check-in Section */}
          <Card style={styles.checkinSection}>
            <AppText variant="h3" style={styles.sectionTitle}>Daily Check-in</AppText>
            
            {dailyCheckin ? (
              <View style={styles.checkinContent}>
                {/* Streak */}
                <View style={styles.streakContainer}>
                  <AppText variant="h1" color="#4C9AFF" style={styles.streakNumber}>
                    {dailyCheckin.streak}
                  </AppText>
                  <AppText variant="body" style={styles.streakLabel}>
                    {dailyCheckin.streak === 1 ? 'день' : dailyCheckin.streak < 5 ? 'дня' : 'дней'}
                  </AppText>
                </View>

                {/* Focus */}
                <View style={styles.focusContainer}>
                  {dailyCheckin.focus.tag && (
                    <View style={styles.focusTagBadge}>
                      <AppText variant="label" color="#FFFFFF" style={styles.focusTagText}>
                        {dailyCheckin.focus.tag}
                      </AppText>
                    </View>
                  )}
                  <AppText variant="h3" style={styles.focusTitle}>
                    {dailyCheckin.focus.title}
                  </AppText>
                  <AppText variant="body" style={styles.focusTip}>
                    {dailyCheckin.focus.tip}
                  </AppText>
                </View>

                {/* Micro Drill */}
                <Card style={styles.drillCard}>
                  <AppText variant="body" style={styles.drillQuestion}>
                    {dailyCheckin.micro_drill.question}
                  </AppText>
                  <TouchableOpacity
                    onPress={() => setShowAnswer(!showAnswer)}
                    style={styles.showAnswerButton}
                  >
                    <AppText variant="label" color="#4C9AFF">
                      {showAnswer ? 'Скрыть ответ' : 'Показать ответ'}
                    </AppText>
                  </TouchableOpacity>
                  {showAnswer && (
                    <Card style={styles.answerCard}>
                      <AppText variant="body" style={styles.answerText}>
                        {dailyCheckin.micro_drill.answer}
                      </AppText>
                    </Card>
                  )}
                </Card>
              </View>
            ) : (
              <View style={styles.noCheckinContainer}>
                <AppText variant="body" style={styles.noCheckinText}>
                  Получи свой ежедневный чек-ин от тренера
                </AppText>
              </View>
            )}

            {checkinError && (
              <Card style={styles.checkinErrorCard}>
                <AppText variant="body" color="#FF9800">
                  {checkinError}
                </AppText>
              </Card>
            )}

            <TouchableOpacity
              onPress={generateCheckin}
              style={[styles.checkinButton, loadingCheckin && styles.checkinButtonDisabled]}
              disabled={loadingCheckin}
            >
              {loadingCheckin ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <AppText variant="label" color="#FFFFFF" style={styles.checkinButtonText}>
                  {dailyCheckin ? 'Обновить чек-ин' : 'Получить чек-ин'}
                </AppText>
              )}
            </TouchableOpacity>
          </Card>

          {/* In-app Reminder */}
          {!loadingActivity && !hasActivityToday && (
            <Card style={styles.reminderCard}>
              <AppText variant="h3" style={styles.reminderTitle}>Сегодня без тренировки</AppText>
              <AppText variant="body" style={styles.reminderText}>
                Сделай 1 разбор или 1 drill — streak будет расти.
              </AppText>
              <View style={styles.reminderButtons}>
                <TouchableOpacity
                  onPress={() => router.push('/analyze/new')}
                  style={styles.reminderButton}
                >
                  <AppText variant="label" color="#FFFFFF" style={styles.reminderButtonText}>
                    Разобрать руку
                  </AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/train')}
                  style={[styles.reminderButton, styles.reminderButtonSecondary]}
                >
                  <AppText variant="label" color="#4C9AFF" style={styles.reminderButtonText}>
                    Drill
                  </AppText>
                </TouchableOpacity>
              </View>
            </Card>
          )}

          {/* Week Progress Button */}
          <TouchableOpacity
            onPress={() => router.push('/progress/week')}
            style={styles.weekProgressCard}
          >
            <View style={styles.weekProgressContent}>
              <AppText variant="h3" style={styles.weekProgressTitle}>Week Progress</AppText>
              <AppText variant="body" style={styles.weekProgressDescription}>
                Твои метрики за последние 7 дней
              </AppText>
            </View>
            <AppText variant="h2" color="#4C9AFF">→</AppText>
          </TouchableOpacity>

          <Card style={styles.section}>
            <AppText variant="h3" style={styles.sectionTitle}>Coach Settings</AppText>
            <AppText variant="body" style={styles.sectionValue}>
              Текущий стиль: {profile?.coach_style ? labelByStyle[profile.coach_style as CoachStyle] : '—'}
            </AppText>
            <TouchableOpacity
              onPress={() => router.push('/(onboarding)/coach')}
              style={styles.changeButton}
            >
              <AppText variant="label" color="#FFFFFF" style={styles.changeButtonText}>
                Сменить тренера
              </AppText>
            </TouchableOpacity>
          </Card>

          {/* Coach Chat */}
          <TouchableOpacity
            onPress={() => router.push('/coach/chat')}
            style={styles.coachChatCard}
          >
            <View style={styles.coachChatContent}>
              <AppText variant="h3" style={styles.coachChatTitle}>Coach Chat</AppText>
              <AppText variant="body" style={styles.coachChatDescription}>
                Задай вопрос тренеру
              </AppText>
            </View>
            <AppText variant="h2" color="#4C9AFF">→</AppText>
          </TouchableOpacity>

          <Card style={styles.section}>
            <AppText variant="h3" style={styles.sectionTitle}>Player Info</AppText>
            <AppText variant="body" style={styles.sectionValue}>
              Уровень: {profile?.skill_level ?? '—'}
            </AppText>
            <AppText variant="body" style={styles.sectionValue}>
              На деньги: {profile?.plays_for_money ?? '—'}
            </AppText>
            <AppText variant="body" style={styles.sectionValue}>
              Форматы: {profile?.game_types?.join(', ') || '—'}
            </AppText>
          </Card>

          {/* Coach Review Section */}
          <Card style={styles.section}>
            <AppText variant="h3" style={styles.sectionTitle}>Coach Review</AppText>
            <AppText variant="body" style={styles.sectionDescription}>
              Анализ твоих ошибок за последние 30 раздач
            </AppText>

            <TouchableOpacity
              onPress={loadLeakSummary}
              style={[styles.reviewButton, loadingLeaks && styles.reviewButtonDisabled]}
              disabled={loadingLeaks}
            >
              {loadingLeaks ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <AppText variant="label" color="#FFFFFF" style={styles.reviewButtonText}>
                  Обновить разбор ошибок
                </AppText>
              )}
            </TouchableOpacity>

            {leakError && (
              <Card style={styles.leakErrorCard}>
                <AppText variant="body" color="#FF9800">
                  {leakError}
                </AppText>
              </Card>
            )}

            {/* Most common mistake reasons (7 days) */}
            <Card style={styles.mistakeReasonsCard}>
              <AppText variant="h3" style={styles.mistakeReasonsTitle}>
                Most common mistake reasons (7 days)
              </AppText>
              {loadingMistakeReasons ? (
                <AppText variant="body" color="#A7B0C0">Loading…</AppText>
              ) : mistakeReasonsError ? (
                <AppText variant="body" color="#FF9800">{mistakeReasonsError}</AppText>
              ) : mistakeReasons7d.length === 0 ? (
                <AppText variant="body" color="#A7B0C0">No mistakes in last 7 days.</AppText>
              ) : (
                mistakeReasons7d.map(({ reason, count }, idx) => (
                  <AppText key={reason} variant="body" style={styles.mistakeReasonLine}>
                    {idx + 1}) {mistakeReasonLabel(reason)} — {count}
                  </AppText>
                ))
              )}
            </Card>

            {leakSummary && (
              <View style={styles.leakSummaryContainer}>
                {/* Top Leaks */}
                <AppText variant="h3" style={styles.leakSubtitle}>
                  Топ ошибок:
                </AppText>
                {leakSummary.top_leaks.map((leak, idx) => {
                  const display = getLeakDisplay(leak.tag);
                  return (
                    <Card key={idx} style={styles.leakCard}>
                      <View style={styles.leakHeader}>
                        <AppText variant="body" color="#FFFFFF" style={styles.leakTag}>
                          {display.title}
                        </AppText>
                        <View style={styles.leakCountBadge}>
                          <AppText variant="label" color="#FFFFFF">
                            {leak.count}x
                          </AppText>
                        </View>
                      </View>
                      <AppText variant="body" style={styles.leakExplanation}>
                        {leak.explanation}
                      </AppText>
                    </Card>
                  );
                })}

                {/* Train this — top leak */}
                {leakSummary.top_leaks.length > 0 && (() => {
                  const rawTag = leakSummary.top_leaks[0].tag;
                  const topLeakTag = normalizeLeakTag(rawTag) || rawTag?.trim();
                  if (!topLeakTag) return null;
                  return (
                    <TouchableOpacity
                      style={styles.trainThisButton}
                      onPress={() =>
                        router.push({
                          pathname: '/(tabs)/train',
                          params: { startSessionLeakTag: topLeakTag },
                        })
                      }
                    >
                      <AppText variant="label" color="#4C9AFF" style={styles.trainThisButtonText}>
                        Train this
                      </AppText>
                    </TouchableOpacity>
                  );
                })()}

                {/* Improvement Plan */}
                <AppText variant="h3" style={styles.leakSubtitle}>
                  План улучшения:
                </AppText>
                <Card style={styles.planCard}>
                  {leakSummary.improvement_plan.map((step, idx) => (
                    <View key={idx} style={styles.planItem}>
                      <AppText variant="body">
                        {idx + 1}. {step}
                      </AppText>
                    </View>
                  ))}
                </Card>
              </View>
            )}
          </Card>

          {/* Action Plan Section */}
          <Card style={styles.section}>
            <AppText variant="h3" style={styles.sectionTitle}>Action Plan (7 дней)</AppText>
            <AppText variant="body" style={styles.sectionDescription}>
              План действий для исправления топ ошибки
            </AppText>

            {/* Debug button */}
            <TouchableOpacity
              onPress={syncActionPlan}
              style={styles.debugButton}
            >
              <AppText variant="label" color="#FF9800">
                Sync plan (debug)
              </AppText>
            </TouchableOpacity>

            {actionPlan && (
              <View style={styles.actionPlanContainer}>
                {/* Focus Tag Badge */}
                {actionPlan.focus_tag && (
                  <View style={styles.actionPlanHeader}>
                    <View style={styles.focusTagBadge}>
                      <AppText variant="label" color="#FFFFFF" style={styles.focusTagText}>
                        {actionPlan.focus_tag}
                      </AppText>
                    </View>
                    <AppText variant="body" style={styles.actionPlanPeriod}>
                      {new Date(actionPlan.period_start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} - {new Date(actionPlan.period_end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </AppText>
                  </View>
                )}

                {/* Checklist */}
                <View style={styles.checklistContainer}>
                  {actionPlan.items.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => toggleActionPlanItem(item.id)}
                      style={styles.checklistItem}
                    >
                      <View style={[styles.checkbox, item.done && styles.checkboxDone]}>
                        {item.done && (
                          <AppText variant="label" color="#FFFFFF" style={styles.checkmark}>
                            ✓
                          </AppText>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText 
                          variant="body" 
                          style={{
                            ...styles.checklistText,
                            ...(item.done ? styles.checklistTextDone : {}),
                          }}
                        >
                          {item.text}
                        </AppText>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {actionPlanError && (
              <Card style={styles.actionPlanErrorCard}>
                <AppText variant="body" color="#FF9800">
                  {actionPlanError}
                </AppText>
              </Card>
            )}

            <TouchableOpacity
              onPress={generateActionPlan}
              style={[styles.actionPlanButton, loadingActionPlan && styles.actionPlanButtonDisabled]}
              disabled={loadingActionPlan}
            >
              {loadingActionPlan ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <AppText variant="label" color="#FFFFFF" style={styles.actionPlanButtonText}>
                  {actionPlan ? 'Обновить план' : 'Сгенерировать план'}
                </AppText>
              )}
            </TouchableOpacity>
          </Card>

          {!profile && (
            <Card style={styles.warningCard}>
              <AppText variant="body" color="#A7B0C0">
                Профиль ещё не создан. Пройдите онбординг.
              </AppText>
            </Card>
          )}
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
  section: {
    padding: 20,
    gap: 12,
  },
  checkinSection: {
    padding: 20,
    gap: 16,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(76, 154, 255, 0.3)',
    borderWidth: 1,
  },
  checkinContent: {
    gap: 16,
  },
  streakContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: 'rgba(76, 154, 255, 0.1)',
    borderRadius: 12,
  },
  streakNumber: {
    fontSize: 48,
    fontWeight: '700',
  },
  streakLabel: {
    fontSize: 16,
    marginTop: 4,
    opacity: 0.8,
  },
  focusContainer: {
    gap: 8,
  },
  focusTagBadge: {
    backgroundColor: '#E53935',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  focusTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  focusTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 4,
  },
  focusTip: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.9,
  },
  drillCard: {
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    gap: 12,
  },
  drillQuestion: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  showAnswerButton: {
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  answerCard: {
    backgroundColor: 'rgba(76, 154, 255, 0.1)',
    borderColor: 'rgba(76, 154, 255, 0.3)',
    borderWidth: 1,
    padding: 12,
    marginTop: 4,
  },
  answerText: {
    fontSize: 14,
    lineHeight: 20,
  },
  noCheckinContainer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  noCheckinText: {
    fontSize: 14,
    opacity: 0.7,
  },
  checkinErrorCard: {
    backgroundColor: '#1F1914',
    borderColor: '#FF9800',
    borderWidth: 1,
    padding: 16,
  },
  checkinButton: {
    backgroundColor: '#4C9AFF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  checkinButtonDisabled: {
    opacity: 0.6,
  },
  checkinButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 18,
    marginBottom: 4,
  },
  sectionValue: {
    fontSize: 15,
  },
  sectionDescription: {
    fontSize: 14,
    marginBottom: 8,
  },
  changeButton: {
    backgroundColor: '#E53935',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  changeButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  reviewButton: {
    backgroundColor: '#4C9AFF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  reviewButtonDisabled: {
    opacity: 0.6,
  },
  reviewButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  leakErrorCard: {
    backgroundColor: '#1F1914',
    borderColor: '#FF9800',
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
  },
  mistakeReasonsCard: {
    padding: 16,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    gap: 8,
    marginTop: 12,
  },
  mistakeReasonsTitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  mistakeReasonLine: {
    fontSize: 14,
  },
  trainThisButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(76, 154, 255, 0.4)',
    marginTop: 8,
  },
  trainThisButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  leakSummaryContainer: {
    marginTop: 16,
    gap: 12,
  },
  leakSubtitle: {
    fontSize: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  leakCard: {
    padding: 16,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    gap: 8,
  },
  leakHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leakTag: {
    fontSize: 16,
    fontWeight: '600',
  },
  leakCountBadge: {
    backgroundColor: '#E53935',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  leakExplanation: {
    fontSize: 14,
    lineHeight: 20,
  },
  planCard: {
    padding: 16,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(76, 154, 255, 0.3)',
    borderWidth: 1,
    gap: 12,
  },
  planItem: {
    marginBottom: 4,
  },
  errorCard: {
    backgroundColor: '#11161F',
    borderColor: '#FF5A6A',
    borderWidth: 1,
    padding: 20,
  },
  warningCard: {
    backgroundColor: '#11161F',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    padding: 20,
  },
  reminderCard: {
    padding: 20,
    backgroundColor: '#1F1416',
    borderColor: '#FF9800',
    borderWidth: 1,
    gap: 12,
  },
  reminderTitle: {
    fontSize: 18,
    color: '#FF9800',
  },
  reminderText: {
    fontSize: 15,
    lineHeight: 22,
  },
  reminderButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  reminderButton: {
    flex: 1,
    backgroundColor: '#4C9AFF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  reminderButtonSecondary: {
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderColor: '#4C9AFF',
    borderWidth: 1,
  },
  reminderButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  weekProgressCard: {
    backgroundColor: '#11161F',
    borderColor: 'rgba(76, 154, 255, 0.3)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekProgressContent: {
    flex: 1,
    gap: 4,
  },
  weekProgressTitle: {
    fontSize: 18,
  },
  weekProgressDescription: {
    fontSize: 14,
    opacity: 0.7,
  },
  actionPlanContainer: {
    marginTop: 12,
    gap: 16,
  },
  actionPlanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionPlanPeriod: {
    fontSize: 13,
    opacity: 0.7,
  },
  checklistContainer: {
    gap: 12,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4C9AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDone: {
    backgroundColor: '#4C9AFF',
    borderColor: '#4C9AFF',
  },
  checkmark: {
    fontSize: 14,
    fontWeight: '700',
  },
  checklistText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  checklistTextDone: {
    opacity: 0.5,
    textDecorationLine: 'line-through',
  },
  actionPlanButton: {
    backgroundColor: '#4C9AFF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  actionPlanButtonDisabled: {
    opacity: 0.6,
  },
  actionPlanButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionPlanErrorCard: {
    backgroundColor: '#1F1914',
    borderColor: '#FF9800',
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
  },
  debugButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  coachChatCard: {
    backgroundColor: '#11161F',
    borderColor: 'rgba(76, 154, 255, 0.3)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coachChatContent: {
    flex: 1,
    gap: 4,
  },
  coachChatTitle: {
    fontSize: 18,
  },
  coachChatDescription: {
    fontSize: 14,
    opacity: 0.7,
  },
});
