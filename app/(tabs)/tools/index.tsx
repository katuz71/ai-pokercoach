import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';
import { supabase } from '../../../lib/supabase';
import { LeakSummaryShort } from '../../../types/tools';
import { normalizeLeakTag, getLeakDisplay } from '../../../lib/leakCatalog';

type StreetOption = 'two_cards' | 'one_card';

export default function ToolsScreen() {
  const router = useRouter();
  // Pot Odds state
  const [potSize, setPotSize] = useState('');
  const [betToCall, setBetToCall] = useState('');

  // Outs → Equity state
  const [outs, setOuts] = useState('');
  const [street, setStreet] = useState<StreetOption>('two_cards');

  // Leak awareness state
  const [leakSummary, setLeakSummary] = useState<LeakSummaryShort | null>(null);
  const [loadingLeaks, setLoadingLeaks] = useState(false);

  // Refs for scrolling
  const potOddsRef = useRef<View>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadLeakSummary();
  }, []);

  async function loadLeakSummary() {
    setLoadingLeaks(true);
    try {
      const { data, error } = await supabase
        .from('leak_summaries')
        .select('summary')
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle<{ summary: LeakSummaryShort }>();

      if (error || !data) {
        setLeakSummary(null);
        return;
      }

      setLeakSummary(data.summary);
    } catch (e) {
      console.error('Failed to load leak summary:', e);
      setLeakSummary(null);
    } finally {
      setLoadingLeaks(false);
    }
  }

  // Pot Odds calculations
  function calculatePotOdds() {
    const pot = parseFloat(potSize) || 0;
    const call = parseFloat(betToCall) || 0;

    if (pot <= 0 || call <= 0) {
      return null;
    }

    const totalPot = pot + call;
    const ratio = pot / call;
    const requiredEquity = (call / totalPot) * 100;

    return {
      ratio: ratio.toFixed(2),
      requiredEquity: requiredEquity.toFixed(1),
    };
  }

  // Outs → Equity calculations (Rule of 2 and 4)
  function calculateEquity() {
    const outsNum = parseInt(outs) || 0;

    if (outsNum < 0 || outsNum > 20) {
      return null;
    }

    const equity = street === 'two_cards' ? outsNum * 4 : outsNum * 2;

    return {
      equity: Math.min(equity, 100), // Cap at 100%
      outs: outsNum,
    };
  }

  function clearPotOdds() {
    setPotSize('');
    setBetToCall('');
  }

  function clearOuts() {
    setOuts('');
  }

  function scrollToPotOdds() {
    if (potOddsRef.current && scrollViewRef.current) {
      potOddsRef.current.measureLayout(
        scrollViewRef.current as any,
        (x, y) => {
          scrollViewRef.current?.scrollTo({ y: y - 20, animated: true });
        },
        () => {}
      );
    }
  }

  const potOddsResult = calculatePotOdds();
  const equityResult = calculateEquity();

  // Check if chasing_draws leak exists
  const hasChasingDrawsLeak = leakSummary?.top_leaks?.some(
    (leak) => normalizeLeakTag(leak.tag) === 'chasing_draws'
  );

  return (
    <ScreenWrapper>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <AppText variant="caption" color="#A7B0C0">AI Poker Coach</AppText>
            <AppText variant="h1" style={styles.title}>Калькуляторы</AppText>
          </View>

          {/* Insights card */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => router.push('/tools/insights')}
          >
            <Card style={styles.insightsCard}>
              <AppText variant="h3" style={styles.cardTitle}>Insights</AppText>
              <AppText variant="caption" style={styles.cardDescription}>
                Графики и сводки по тренировкам за 7 и 30 дней
              </AppText>
              <AppText variant="label" color="#4C9AFF">Открыть →</AppText>
            </Card>
          </TouchableOpacity>

          {/* Coach Tip (only if chasing_draws leak exists) */}
          {!loadingLeaks && hasChasingDrawsLeak && (
            <Card style={styles.coachTipCard}>
              <View style={styles.coachTipHeader}>
                <AppText variant="h3" color="#FF9800">💡 Coach Tip</AppText>
              </View>
              <AppText variant="body" style={styles.coachTipText}>
                Твой топ-лик: <AppText variant="body" color="#F44336">{getLeakDisplay('chasing_draws').title}</AppText>.
                Перед коллом — проверь пот-оддсы.
              </AppText>
              <TouchableOpacity
                style={styles.coachTipButton}
                onPress={scrollToPotOdds}
              >
                <AppText variant="label" color="#4C9AFF">
                  Открыть Pot Odds ↓
                </AppText>
              </TouchableOpacity>
            </Card>
          )}

          {/* Card 1: Pot Odds Calculator */}
          <View ref={potOddsRef}>
            <Card style={styles.calculatorCard}>
              <AppText variant="h3" style={styles.cardTitle}>Pot Odds</AppText>
              <AppText variant="caption" style={styles.cardDescription}>
                Рассчитай необходимый эквити для колла
              </AppText>

              <View style={styles.inputGroup}>
                <AppText variant="label" style={styles.inputLabel}>
                  Pot size (BB)
                </AppText>
                <TextInput
                  style={styles.input}
                  placeholder="Например: 10"
                  placeholderTextColor="#65708A"
                  keyboardType="decimal-pad"
                  value={potSize}
                  onChangeText={setPotSize}
                />
              </View>

              <View style={styles.inputGroup}>
                <AppText variant="label" style={styles.inputLabel}>
                  Bet to call (BB)
                </AppText>
                <TextInput
                  style={styles.input}
                  placeholder="Например: 5"
                  placeholderTextColor="#65708A"
                  keyboardType="decimal-pad"
                  value={betToCall}
                  onChangeText={setBetToCall}
                />
              </View>

              {potOddsResult && (
                <View style={styles.resultContainer}>
                  <View style={styles.resultRow}>
                    <AppText variant="body" color="#A7B0C0">
                      Pot odds ratio:
                    </AppText>
                    <AppText variant="h2" color="#FFFFFF">
                      {potOddsResult.ratio} : 1
                    </AppText>
                  </View>
                  <View style={styles.resultRow}>
                    <AppText variant="body" color="#A7B0C0">
                      Required equity:
                    </AppText>
                    <AppText variant="h2" color="#4CAF50">
                      {potOddsResult.requiredEquity}%
                    </AppText>
                  </View>
                  <View style={styles.resultExplanation}>
                    <AppText variant="caption" color="#65708A">
                      Тебе нужно {potOddsResult.requiredEquity}% эквити, чтобы колл был прибыльным
                    </AppText>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={styles.clearButton}
                onPress={clearPotOdds}
              >
                <AppText variant="body" color="#A7B0C0">
                  Очистить
                </AppText>
              </TouchableOpacity>
            </Card>
          </View>

          {/* Card 2: Outs → Equity Calculator */}
          <Card style={styles.calculatorCard}>
            <AppText variant="h3" style={styles.cardTitle}>Outs → Equity</AppText>
            <AppText variant="caption" style={styles.cardDescription}>
              Оцени свой эквити по количеству аутов
            </AppText>

            <View style={styles.inputGroup}>
              <AppText variant="label" style={styles.inputLabel}>
                Количество аутов (0-20)
              </AppText>
              <TextInput
                style={styles.input}
                placeholder="Например: 9"
                placeholderTextColor="#65708A"
                keyboardType="number-pad"
                value={outs}
                onChangeText={setOuts}
              />
            </View>

            <View style={styles.inputGroup}>
              <AppText variant="label" style={styles.inputLabel}>
                Улица
              </AppText>
              <View style={styles.toggleContainer}>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    street === 'two_cards' && styles.toggleButtonActive,
                  ]}
                  onPress={() => setStreet('two_cards')}
                >
                  <AppText
                    variant="body"
                    color={street === 'two_cards' ? '#FFFFFF' : '#A7B0C0'}
                    style={styles.toggleButtonText}
                  >
                    Flop → River
                  </AppText>
                  <AppText
                    variant="caption"
                    color={street === 'two_cards' ? '#A7B0C0' : '#65708A'}
                  >
                    (2 карты)
                  </AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    street === 'one_card' && styles.toggleButtonActive,
                  ]}
                  onPress={() => setStreet('one_card')}
                >
                  <AppText
                    variant="body"
                    color={street === 'one_card' ? '#FFFFFF' : '#A7B0C0'}
                    style={styles.toggleButtonText}
                  >
                    Turn → River
                  </AppText>
                  <AppText
                    variant="caption"
                    color={street === 'one_card' ? '#A7B0C0' : '#65708A'}
                  >
                    (1 карта)
                  </AppText>
                </TouchableOpacity>
              </View>
            </View>

            {equityResult && equityResult.outs > 0 && (
              <View style={styles.resultContainer}>
                <View style={styles.resultRow}>
                  <AppText variant="body" color="#A7B0C0">
                    Примерный equity:
                  </AppText>
                  <AppText variant="h1" color="#4C9AFF">
                    ~{equityResult.equity}%
                  </AppText>
                </View>
                <View style={styles.resultExplanation}>
                  <AppText variant="caption" color="#FF9800">
                    ⚠️ Это оценка (правило {street === 'two_cards' ? '4' : '2'}).
                  </AppText>
                  <AppText variant="caption" color="#65708A" style={styles.disclaimerSpacing}>
                    Для точности нужен калькулятор эквити.
                  </AppText>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.clearButton}
              onPress={clearOuts}
            >
              <AppText variant="body" color="#A7B0C0">
                Очистить
              </AppText>
            </TouchableOpacity>
          </Card>

          {/* Info card */}
          <Card style={styles.infoCard}>
            <AppText variant="h3" style={styles.infoTitle}>📚 Как использовать</AppText>
            <View style={styles.infoBullet}>
              <AppText variant="body">
                • <AppText variant="body" color="#FFFFFF">Pot Odds</AppText>: Рассчитывает необходимый эквити для прибыльного колла
              </AppText>
            </View>
            <View style={styles.infoBullet}>
              <AppText variant="body">
                • <AppText variant="body" color="#FFFFFF">Outs → Equity</AppText>: Оценивает твой эквити по количеству аутов (правило 2 и 4)
              </AppText>
            </View>
            <View style={styles.infoBullet}>
              <AppText variant="body">
                • Используй перед важными решениями на флопе и тёрне
              </AppText>
            </View>
          </Card>

          {loadingLeaks && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#FFFFFF" size="small" />
            </View>
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
    gap: 16,
  },
  header: {
    gap: 4,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
  },
  insightsCard: {
    padding: 20,
    backgroundColor: 'rgba(76, 154, 255, 0.06)',
    borderColor: 'rgba(76, 154, 255, 0.2)',
  },
  coachTipCard: {
    padding: 16,
    backgroundColor: 'rgba(255, 152, 0, 0.05)',
    borderColor: 'rgba(255, 152, 0, 0.3)',
    borderWidth: 1,
  },
  coachTipHeader: {
    marginBottom: 8,
  },
  coachTipText: {
    marginBottom: 12,
    lineHeight: 22,
  },
  coachTipButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(76, 154, 255, 0.1)',
    borderRadius: 8,
  },
  calculatorCard: {
    padding: 20,
  },
  cardTitle: {
    fontSize: 20,
    marginBottom: 4,
  },
  cardDescription: {
    marginBottom: 20,
    color: '#65708A',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    marginBottom: 8,
    color: '#A7B0C0',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 16,
  },
  toggleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleButton: {
    flex: 1,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderColor: '#4C9AFF',
  },
  toggleButtonText: {
    fontWeight: '600',
    marginBottom: 4,
  },
  resultContainer: {
    backgroundColor: 'rgba(76, 154, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultExplanation: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  disclaimerSpacing: {
    marginTop: 4,
  },
  clearButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
  },
  infoCard: {
    padding: 20,
    backgroundColor: 'rgba(76, 154, 255, 0.03)',
  },
  infoTitle: {
    fontSize: 18,
    marginBottom: 12,
  },
  infoBullet: {
    marginBottom: 8,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
});
