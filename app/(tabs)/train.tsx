import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
  DimensionValue,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Удален импорт ScreenWrapper - он ломал верстку!
import { normalizeLeakTag } from '../../lib/leakCatalog';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { ensureSession } from '../../lib/ensureSession';
import { callEdge } from '../../lib/edge';
import type { TableDrillScenario, TableDrillCorrectAction, RaiseSizingOption } from '../../types/drill';
import { DrillQueueRow } from '../../types/database';

// ─── GG POKER STYLE THEME ──────────────────────────────────────────────────
const THEME = {
  BG_MAIN: '#1B1C22',
  FELT_BASE: '#0D4232',
  FELT_CENTER: '#145945',
  RAIL_OUTER: '#111216',
  RAIL_INNER: '#2A2C35',
  PANEL_BG: '#111216',
  BTN_FOLD: '#D92D20',
  BTN_CALL: '#059669',
  BTN_RAISE: '#D97706',
  BTN_GREY: '#374151',
};

const SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = ['h', 'd'];
const RANK_DISPLAY: Record<string, string> = {
  A: 'A', K: 'K', Q: 'Q', J: 'J', T: 'T',
  '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2',
};

function parseCardCode(code: string | null | undefined): { rank: string; suit: string } | null {
  if (!code || typeof code !== 'string' || code.length < 2) return null;
  const rank = code[0].toUpperCase();
  const suit = code[1].toLowerCase();
  if (!RANK_DISPLAY[rank] || !SUIT_SYMBOLS[suit]) return null;
  return { rank, suit };
}

const SESSION_TARGET_COUNT = 5;
type SessionHistoryEntry = { is_correct: boolean; drill_type: string; difficulty?: string };

type CardViewSize = 'sm' | 'md' | 'lg';
const CARD_DIMENSIONS: Record<CardViewSize, {
  width: number; height: number;
  cornerRankSize: number; cornerSuitSize: number;
  centerSuitSize: number; radius: number;
}> = {
  sm: { width: 32, height: 46, cornerRankSize: 10, cornerSuitSize: 8, centerSuitSize: 18, radius: 3 },
  md: { width: 42, height: 60, cornerRankSize: 13, cornerSuitSize: 10, centerSuitSize: 26, radius: 4 },
  lg: { width: 56, height: 80, cornerRankSize: 18, cornerSuitSize: 14, centerSuitSize: 36, radius: 6 },
};

function CardView({ code, size = 'md', faceDown = false }: { code?: string | null; size?: CardViewSize; faceDown?: boolean }) {
  const dim = CARD_DIMENSIONS[size];
  const parsed = faceDown ? null : parseCardCode(code ?? null);
  const isRed = parsed && RED_SUITS.includes(parsed.suit);
  const suitColor = isRed ? '#EF4444' : '#111827';

  if (!parsed && !faceDown) {
    return <View style={[cardStyles.slotEmpty, { width: dim.width, height: dim.height, borderRadius: dim.radius }]} />;
  }

  if (faceDown) {
    return (
      <View style={[cardStyles.faceDown, { width: dim.width, height: dim.height, borderRadius: dim.radius }]}>
        <View style={[cardStyles.backInnerBorder, { borderRadius: Math.max(1, dim.radius - 1) }]} />
      </View>
    );
  }

  return (
    <View style={[cardStyles.cardFaceUp, { width: dim.width, height: dim.height, borderRadius: dim.radius }]}>
      <View style={cardStyles.cornerTL}>
        <AppText variant="body" style={[cardStyles.cornerRankText, { fontSize: dim.cornerRankSize, color: suitColor }]}>{RANK_DISPLAY[parsed!.rank]}</AppText>
      </View>
      <View style={cardStyles.cornerBR}>
        <AppText variant="body" style={[cardStyles.cornerRankText, { fontSize: dim.cornerRankSize, color: suitColor }]}>{RANK_DISPLAY[parsed!.rank]}</AppText>
      </View>
      <View style={cardStyles.centerSuit}>
        <AppText variant="body" style={[cardStyles.suitCenterText, { fontSize: dim.centerSuitSize, color: suitColor }]}>{SUIT_SYMBOLS[parsed!.suit]}</AppText>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  slotEmpty: { backgroundColor: 'rgba(0,0,0,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  cardFaceUp: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4, overflow: 'hidden' },
  faceDown: { backgroundColor: '#1E3A8A', borderWidth: 1, borderColor: '#3B82F6', overflow: 'hidden' },
  backInnerBorder: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: '#172554' },
  cornerTL: { position: 'absolute', top: 2, left: 4, alignItems: 'center' },
  cornerBR: { position: 'absolute', bottom: 2, right: 4, alignItems: 'center' },
  cornerRankText: { fontWeight: '800', lineHeight: undefined, includeFontPadding: false },
  centerSuit: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  suitCenterText: { fontWeight: '900', lineHeight: undefined, includeFontPadding: false },
});

function ChipStack({ amountBb }: { amountBb: number }) {
  const isSmall = amountBb <= 5;
  const chipCount = isSmall ? 3 : Math.min(6, 3 + Math.floor(amountBb / 10));
  const chipDiam = 18;
  const stackWidth = 26;
  const stackHeight = chipDiam + (chipCount - 1) * 4;

  return (
    <View style={[{ width: stackWidth, height: stackHeight, position: 'relative' }]}>
      {Array.from({ length: chipCount }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute', width: chipDiam, height: chipDiam, borderRadius: chipDiam / 2,
            backgroundColor: isSmall ? '#D1D5DB' : '#F59E0B', borderWidth: 1.5, borderColor: '#000',
            bottom: i * 4, left: (stackWidth - chipDiam) / 2, justifyContent: 'center', alignItems: 'center'
          }}
        >
          <View style={{ width: chipDiam - 6, height: chipDiam - 6, borderRadius: (chipDiam - 6)/2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderStyle: 'dashed' }} />
        </View>
      ))}
    </View>
  );
}

function firstPhrase(text: string, maxLen = 140): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx !== -1) return trimmed.slice(0, dotIdx + 1).trim();
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen).trim() + '…';
}
function leakTagDisplay(tag: string | null | undefined): string {
  if (!tag) return '';
  return tag.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

type TableGradeResult = { isCorrect: boolean; explanation: string };
const HERO_SEAT_INDEX = 0;
const VILLAIN_SEAT_INDEX = 3;
const POSITION_LABELS = ['BTN', 'CO', 'HJ', 'UTG', 'BB', 'SB'];

type SeatPos = { top?: DimensionValue; bottom?: DimensionValue; left?: DimensionValue; right?: DimensionValue; marginLeft?: number };

const SEAT_POSITIONS: SeatPos[] = [
  { bottom: 0, left: '50%', marginLeft: -30 },   // 0: Hero
  { bottom: '20%', right: -25 },                   // 1: CO
  { top: '20%', right: -25 },                      // 2: HJ
  { top: -10, left: '50%', marginLeft: -30 },      // 3: Villain
  { top: '20%', left: -25 },                       // 4: BB
  { bottom: '20%', left: -25 },                    // 5: SB
];

export default function TrainScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ startSessionLeakTag?: string }>();
  const startSessionFromParamHandledRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<TableDrillScenario | null>(null);
  const [tableGradeResult, setTableGradeResult] = useState<TableGradeResult | null>(null);
  const [currentDrillRow, setCurrentDrillRow] = useState<DrillQueueRow | null>(null);
  const [dueDrills, setDueDrills] = useState<DrillQueueRow[]>([]);
  const [raiseSizeBb, setRaiseSizeBb] = useState(12);
  const [currentDifficulty, setCurrentDifficulty] = useState<string | null>(null);
  const [currentDrillType, setCurrentDrillType] = useState<'action_decision' | 'raise_sizing' | null>(null);
  const [lastTrainingEventId, setLastTrainingEventId] = useState<string | null>(null);
  const [selectedMistakeReason, setSelectedMistakeReason] = useState<string | null>(null);
  const [showReasonSaved, setShowReasonSaved] = useState(false);
  const reasonSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInProgressRef = useRef(false);

  const [weeklyFocusTag, setWeeklyFocusTag] = useState<string>('fundamentals');
  const [weeklyFocusWhy, setWeeklyFocusWhy] = useState<string>('');
  const [tomorrowPlanText, setTomorrowPlanText] = useState<string>('');
  const [tomorrowPlanSubtext, setTomorrowPlanSubtext] = useState<string>('Target: ≥4/5');
  const [focusModalVisible, setFocusModalVisible] = useState(false);

  const [sessionActive, setSessionActive] = useState(false);
  const [sessionLeakTag, setSessionLeakTag] = useState<string | null>(null);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
  const [sessionDrillRow, setSessionDrillRow] = useState<DrillQueueRow | null>(null);
  const sessionIndexRef = useRef(0);

  const isYourTurn = scenario != null && !tableGradeResult;
  const showActionBar = !!scenario && !tableGradeResult;

  const heroCard1Opacity = useRef(new Animated.Value(0)).current;
  const heroCard1TranslateY = useRef(new Animated.Value(10)).current;
  const heroCard2Opacity = useRef(new Animated.Value(0)).current;
  const heroCard2TranslateY = useRef(new Animated.Value(10)).current;
  const boardOpacities = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  const boardTranslateYs = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(8))).current;
  const betBadgeOpacity = useRef(new Animated.Value(0)).current;
  const heroPulseScale = useRef(new Animated.Value(1)).current;
  const heroPulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const foldScale = useRef(new Animated.Value(1)).current;
  const callScale = useRef(new Animated.Value(1)).current;
  const raiseScale = useRef(new Animated.Value(1)).current;

  // ── ЖЕСТКИЕ РАЗМЕРЫ СТОЛА (ОГРОМНЫЙ ОВАЛ)
  const tableWidth = screenWidth * 0.88; 
  // Делаем стол вытянутым, но чтобы он не разорвал экран
  const tableHeight = Math.min(screenHeight * 0.68, tableWidth * 1.85);
  const tableBorderRadius = tableWidth / 2; 

  async function loadDueDrills() {
    try {
      const { data, error: err } = await supabase.rpc('rpc_get_due_drills', { limit_n: 5 } as any);
      if (err) throw err;
      setDueDrills(data ?? []);
    } catch (e) {
      setDueDrills([]);
    }
  }

  const refreshFocus = useCallback(async () => {
    try {
      const { data: rows } = await supabase.from('skill_ratings').select('leak_tag, rating, attempts_7d, correct_7d, last_practice_at');
      if (!rows || rows.length === 0) return;
      setWeeklyFocusTag('fundamentals');
    } catch (e) { }
  }, []);

  const refreshTrain = useCallback(async () => {
    if (refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
      await ensureSession();
      await callEdge('ai-bootstrap-drill-queue', {});
      await loadDueDrills();
    } catch (e) { } finally {
      refreshInProgressRef.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => { refreshTrain(); refreshFocus(); }, [refreshTrain, refreshFocus]));

  useEffect(() => {
    if (scenario?.action_to_hero) setRaiseSizeBb(Math.max(12, scenario.action_to_hero.size_bb * 2));
  }, [scenario]);

  useEffect(() => {
    if (!scenario) {
      heroCard1Opacity.setValue(0); heroCard1TranslateY.setValue(10);
      heroCard2Opacity.setValue(0); heroCard2TranslateY.setValue(10);
      boardOpacities.forEach((a) => a.setValue(0)); boardTranslateYs.forEach((a) => a.setValue(8));
      betBadgeOpacity.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(heroCard1Opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(heroCard1TranslateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(heroCard2Opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(heroCard2TranslateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();

    const cardCount = 3 + (scenario.board.turn ? 1 : 0) + (scenario.board.river ? 1 : 0);
    boardOpacities.slice(0, cardCount).forEach((op, i) => {
      Animated.sequence([
        Animated.delay(i * 80),
        Animated.parallel([
          Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }),
          Animated.timing(boardTranslateYs[i], { toValue: 0, duration: 150, useNativeDriver: true }),
        ]),
      ]).start();
    });

    if (scenario.action_to_hero.type === 'bet' || scenario.action_to_hero.type === 'raise') {
      Animated.sequence([Animated.delay(300), Animated.timing(betBadgeOpacity, { toValue: 1, duration: 200, useNativeDriver: true })]).start();
    }
  }, [scenario]);

  async function startDrill() {
    if (sessionActive) return;
    setLoading(true); setError(null); setScenario(null); setTableGradeResult(null); setCurrentDrillRow(null); setCurrentDrillType(null);
    try {
      await ensureSession();
      const due = dueDrills[0] ?? null;
      const leak_tag = due?.leak_tag ?? 'fundamentals';
      const drillType = due?.drill_type === 'raise_sizing' ? 'raise_sizing' : 'action_decision';
      const data = await callEdge('ai-generate-table-drill', { leak_tag, drill_type: drillType });
      if (!data || !data.ok || !data.scenario) { setError('Ошибка генерации'); return; }
      setScenario(data.scenario as TableDrillScenario);
      setCurrentDrillType(drillType);
      setCurrentDifficulty((data as any)?.difficulty ?? null);
      if (due) setCurrentDrillRow(due);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function selectTableAction(userAnswer: TableDrillCorrectAction | RaiseSizingOption) {
    if (!scenario || !currentDrillRow) return;
    setLoading(true); setError(null);
    const drillType = (currentDrillType ?? scenario.drill_type) === 'raise_sizing' ? 'raise_sizing' : 'action_decision';
    try {
      await ensureSession();
      const payload: any = { drill_queue_id: currentDrillRow.id, scenario, drill_type: drillType };
      if (drillType === 'raise_sizing') payload.user_answer = userAnswer;
      else { payload.user_action = userAnswer; if (userAnswer === 'raise') payload.raise_size_bb = raiseSizeBb; }
      
      const data = await callEdge('ai-submit-table-drill-result', payload);
      if (data?.error) { setError(data.error); return; }
      
      setLastTrainingEventId(data?.training_event_id ?? null);
      setTableGradeResult({ isCorrect: data?.correct === true, explanation: data?.explanation ?? '' });
      if (sessionActive) {
        const nextIndex = Math.min(SESSION_TARGET_COUNT, sessionIndex + 1);
        sessionIndexRef.current = nextIndex; setSessionIndex(nextIndex);
        setSessionCorrect((p) => p + (data?.correct ? 1 : 0));
        setSessionHistory((p) => [...p, { is_correct: data?.correct, drill_type: drillType, difficulty: currentDifficulty ?? undefined }]);
        if (nextIndex >= SESSION_TARGET_COUNT) setTableGradeResult(null);
      }
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function closeResultModal() {
    setTableGradeResult(null); setLastTrainingEventId(null); setSelectedMistakeReason(null);
    if (sessionActive && sessionIndexRef.current >= SESSION_TARGET_COUNT) { setScenario(null); return; }
    startDrill();
  }

  function actionLineText(): string {
    if (!scenario) return 'Checked to you';
    const type = currentDrillType ?? scenario.drill_type;
    if (type === 'raise_sizing') return 'Choose raise size';
    const a = scenario.action_to_hero;
    if (a?.type === 'check') return 'Checked to you';
    return a ? `To call: ${a.size_bb} bb` : '—';
  }

  function communityCards(sc: TableDrillScenario): string[] {
    const out = [...sc.board.flop];
    if (sc.board.turn) out.push(sc.board.turn);
    if (sc.board.river) out.push(sc.board.river);
    return out;
  }

  useEffect(() => {
    if (showActionBar && scenario?.action_to_hero) {
      heroPulseScale.setValue(1);
      heroPulseLoopRef.current = Animated.loop(Animated.sequence([
        Animated.timing(heroPulseScale, { toValue: 1.05, duration: 800, useNativeDriver: true }),
        Animated.timing(heroPulseScale, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]));
      heroPulseLoopRef.current.start();
      return () => { heroPulseLoopRef.current?.stop(); heroPulseScale.setValue(1); };
    }
  }, [showActionBar, scenario]);

  const bottomPadding = 0; // Таббар уже учитывает safe area

  return (
    // МЫ НЕ ИСПОЛЬЗУЕМ <ScreenWrapper>, ЧТОБЫ СБРОСИТЬ ОТСТУПЫ!
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      
      {error && <View style={[styles.errorBar, { top: insets.top + 10 }]}><AppText style={{color: '#FFF'}}>{error}</AppText></View>}

      {/* ─── ВЕРХНИЙ БЛОК: СТОЛ (FLEX: 1, ЗАНИМАЕТ ВСЁ СВОБОДНОЕ МЕСТО) ───────────────────────── */}
      <View style={styles.tableContainer}>
        <View style={[styles.tablePill, { width: tableWidth, height: tableHeight, borderRadius: tableBorderRadius }]}>
          <View style={[styles.railOuter, { borderRadius: tableBorderRadius }, styles.absoluteFill]} />
          <View style={[styles.railInner, { borderRadius: tableBorderRadius - 12 }, styles.absoluteFill]}>
            <View style={[styles.felt, { borderRadius: tableBorderRadius - 14 }, styles.absoluteFill]}>
               <View style={styles.feltCenterGlow} pointerEvents="none" />
            </View>
          </View>

          <View style={styles.boardCenter}>
            <View style={styles.potDisplay}>
              <AppText style={styles.potText}>Pot: {scenario ? scenario.pot_bb : 0}</AppText>
            </View>
            <View style={styles.boardRow}>
              {scenario && communityCards(scenario).map((code, i) => (
                <Animated.View key={i} style={{ opacity: boardOpacities[i], transform: [{ translateY: boardTranslateYs[i] }] }}>
                  <CardView code={code} size="md" />
                </Animated.View>
              ))}
            </View>
          </View>

          <View style={styles.dealerBtn}><AppText style={styles.dealerText}>D</AppText></View>

          {SEAT_POSITIONS.map((pos, index) => {
            const isHero = index === HERO_SEAT_INDEX;
            const isVillain = index === VILLAIN_SEAT_INDEX;
            const isEmpty = !isHero && !isVillain;
            const posLabel = POSITION_LABELS[index];
            const stack = scenario && (isHero || isVillain) ? `${scenario.effective_stack_bb} bb` : '';

            return (
              <View key={index} style={[styles.seatContainer, { top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, marginLeft: pos.marginLeft }]}>
                {isEmpty ? (
                  <View style={styles.emptySeat}><AppText style={styles.seatLabelEmpty}>{posLabel}</AppText></View>
                ) : (
                  <Animated.View style={[styles.activeSeat, isHero && { transform: [{ scale: heroPulseScale }] }]}>
                    {isVillain && scenario && (scenario.action_to_hero.type === 'bet' || scenario.action_to_hero.type === 'raise') && (
                       <Animated.View style={[styles.villainBet, { opacity: betBadgeOpacity }]}>
                         <ChipStack amountBb={scenario.action_to_hero.size_bb} />
                         <AppText style={styles.villainBetText}>{scenario.action_to_hero.size_bb}</AppText>
                       </Animated.View>
                    )}

                    <View style={[styles.avatar, isHero ? styles.avatarHero : styles.avatarVillain]}>
                       <AppText style={styles.avatarText}>{isHero ? 'You' : 'Opp'}</AppText>
                    </View>
                    <View style={styles.seatInfo}>
                      <AppText style={styles.seatStackText}>{stack}</AppText>
                    </View>
                    
                    {isHero && scenario && (
                       <View style={styles.heroCards}>
                         <Animated.View style={{ opacity: heroCard1Opacity, transform: [{ translateY: heroCard1TranslateY }, { rotate: '-6deg' }] }}>
                           <CardView code={scenario?.hero_cards[0]} size="lg" />
                         </Animated.View>
                         <Animated.View style={{ opacity: heroCard2Opacity, transform: [{ translateY: heroCard2TranslateY }, { rotate: '6deg' }], marginLeft: -20, marginTop: 5 }}>
                           <CardView code={scenario?.hero_cards[1]} size="lg" />
                         </Animated.View>
                       </View>
                    )}
                  </Animated.View>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* ─── НИЖНИЙ БЛОК: КНОПКИ (ЖЕСТКО ПРИБИТ К НИЗУ, НИКАКОГО АБСОЛЮТА) ──────── */}
      <View style={[styles.controlPanel, { paddingBottom: 8 }]}>
        
        {!scenario && !loading && (
           <TouchableOpacity style={styles.btnStart} onPress={startDrill} activeOpacity={0.8}>
              <AppText style={styles.btnStartText}>Новый Drill</AppText>
           </TouchableOpacity>
        )}

        {loading && !scenario && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={THEME.BTN_CALL} size="large" />
            <AppText style={{color: '#9CA3AF', fontWeight: 'bold'}}>Раздача...</AppText>
          </View>
        )}

        {tableGradeResult && scenario && (
           <View style={styles.feedbackContainer}>
              <View style={[styles.feedbackHeader, { backgroundColor: tableGradeResult.isCorrect ? THEME.BTN_CALL : THEME.BTN_FOLD }]}>
                 <AppText style={styles.feedbackTitle}>{tableGradeResult.isCorrect ? 'Correct Decision' : 'Incorrect Decision'}</AppText>
              </View>
              <AppText style={styles.feedbackBody}>{firstPhrase(tableGradeResult.explanation)}</AppText>
              <TouchableOpacity style={styles.btnNext} onPress={closeResultModal} activeOpacity={0.8}>
                 <AppText style={styles.btnNextText}>Next Hand</AppText>
              </TouchableOpacity>
           </View>
        )}

        {showActionBar && (
          <View style={styles.actionsContainer}>
            <View style={styles.actionHeader}>
              <AppText style={styles.actionHeaderText}>{actionLineText()}</AppText>
            </View>

            {(currentDrillType ?? scenario!.drill_type) === 'raise_sizing' ? (
               <View style={styles.gridRowSizing}>
                 <TouchableOpacity style={styles.btnSizing} onPress={() => selectTableAction('2.5x')}><AppText style={styles.btnActionText}>2.5x</AppText></TouchableOpacity>
                 <TouchableOpacity style={styles.btnSizing} onPress={() => selectTableAction('3x')}><AppText style={styles.btnActionText}>3x</AppText></TouchableOpacity>
                 <TouchableOpacity style={styles.btnSizing} onPress={() => selectTableAction('overbet')}><AppText style={styles.btnActionText}>Overbet</AppText></TouchableOpacity>
               </View>
            ) : (
              <View style={styles.actionGrid}>
                <View style={styles.actionRowHalf}>
                  <Pressable
                    style={[styles.btnAction, { backgroundColor: THEME.BTN_FOLD }]}
                    onPressIn={() => Animated.timing(foldScale, { toValue: 0.95, duration: 100, useNativeDriver: true }).start()}
                    onPressOut={() => Animated.timing(foldScale, { toValue: 1, duration: 100, useNativeDriver: true }).start()}
                    onPress={() => selectTableAction('fold')} disabled={loading}
                  >
                    <Animated.View style={{ transform: [{ scale: foldScale }], alignItems: 'center' }}>
                      <AppText style={styles.btnActionLabel}>FOLD</AppText>
                    </Animated.View>
                  </Pressable>
                  
                  <Pressable
                    style={[styles.btnAction, { backgroundColor: THEME.BTN_CALL }]}
                    onPressIn={() => Animated.timing(callScale, { toValue: 0.95, duration: 100, useNativeDriver: true }).start()}
                    onPressOut={() => Animated.timing(callScale, { toValue: 1, duration: 100, useNativeDriver: true }).start()}
                    onPress={() => selectTableAction('call')} disabled={loading}
                  >
                    <Animated.View style={{ transform: [{ scale: callScale }], alignItems: 'center' }}>
                      <AppText style={styles.btnActionLabel}>CALL</AppText>
                      <AppText style={styles.btnActionSub}>{scenario?.action_to_hero?.size_bb || 0}</AppText>
                    </Animated.View>
                  </Pressable>
                </View>

                {/* Raise Full-width Section */}
                <View style={styles.raiseFullContainer}>
                  <TouchableOpacity style={styles.raiseInlineAdjust} onPress={() => setRaiseSizeBb(p => Math.max(2, p - 1))} disabled={loading}>
                    <AppText style={styles.raiseInlineAdjustText}>−</AppText>
                  </TouchableOpacity>

                  <Pressable
                    style={styles.raiseInlineCenter}
                    onPressIn={() => Animated.timing(raiseScale, { toValue: 0.95, duration: 100, useNativeDriver: true }).start()}
                    onPressOut={() => Animated.timing(raiseScale, { toValue: 1, duration: 100, useNativeDriver: true }).start()}
                    onPress={() => selectTableAction('raise')} disabled={loading}
                  >
                    <Animated.View style={{ alignItems: 'center', transform: [{ scale: raiseScale }] }}>
                      <AppText style={styles.btnActionLabel}>RAISE TO</AppText>
                      <AppText style={styles.btnActionSub}>{raiseSizeBb} bb</AppText>
                    </Animated.View>
                  </Pressable>
                  <TouchableOpacity style={styles.raiseInlineAdjust} onPress={() => setRaiseSizeBb(p => p + 1)} disabled={loading}>
                    <AppText style={styles.raiseInlineAdjustText}>+</AppText>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // 1. ЖЕСТКАЯ СЕТКА ЭКРАНА
  screen: { flex: 1, flexDirection: 'column', justifyContent: 'space-between', backgroundColor: THEME.BG_MAIN },
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  errorBar: { position: 'absolute', left: 16, right: 16, backgroundColor: '#991B1B', padding: 12, borderRadius: 8, zIndex: 100, alignItems: 'center' },

  // 2. БЛОК СО СТОЛОМ ЗАНИМАЕТ ВСЁ ВЕРХНЕЕ ПРОСТРАНСТВО
  tableContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%', paddingTop: 24 }, 
  tablePill: { position: 'relative', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.8, shadowRadius: 30, elevation: 20 },
  
  railOuter: { backgroundColor: THEME.RAIL_OUTER, borderWidth: 4, borderColor: '#000' },
  railInner: { margin: 12, backgroundColor: THEME.RAIL_INNER, borderWidth: 2, borderColor: '#3A3F58', overflow: 'hidden' },
  felt: { margin: 14, backgroundColor: THEME.FELT_BASE, borderWidth: 2, borderColor: 'rgba(0,0,0,0.6)' },
  feltCenterGlow: { position: 'absolute', top: '20%', left: '20%', right: '20%', bottom: '20%', backgroundColor: THEME.FELT_CENTER, borderRadius: 999, opacity: 0.5, shadowColor: THEME.FELT_CENTER, shadowOpacity: 1, shadowRadius: 40 },
  
  boardCenter: { alignItems: 'center', zIndex: 10 },
  potDisplay: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 4, borderRadius: 12, marginBottom: 12 },
  potText: { color: '#E5E7EB', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },
  boardRow: { flexDirection: 'row', gap: 4 },
  
  dealerBtn: {
    position: 'absolute',
    bottom: '25%',
    left: '70%',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F8FAFC',
    borderWidth: 2,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  dealerText: { color: '#000', fontWeight: '900', fontSize: 13 },

  seatContainer: { position: 'absolute', width: 60, height: 60, alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  emptySeat: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  seatLabelEmpty: { color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: '800' },
  
  activeSeat: { alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 2, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity:0.6, shadowRadius:6, elevation: 5 },
  avatarHero: { backgroundColor: '#1E3A8A', borderColor: '#3B82F6' },
  avatarVillain: { backgroundColor: '#7F1D1D', borderColor: '#EF4444' },
  avatarText: { color: '#FFF', fontWeight: '900', fontSize: 14 },
  seatInfo: { backgroundColor: '#000', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginTop: -8, borderWidth: 1, borderColor: '#374151', alignItems: 'center', zIndex: 40 },
  seatStackText: { color: '#FCD34D', fontSize: 12, fontWeight: '900' },

  heroCards: { position: 'absolute', bottom: 35, flexDirection: 'row', zIndex: 30, shadowColor: '#000', shadowOffset: {width:0, height:4}, shadowOpacity: 0.5, shadowRadius: 8 },
  villainBet: {
    position: 'absolute',
    top: 75,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 4,
    paddingRight: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EF4444',
    gap: 6,
    zIndex: 30,
  },
  villainBetText: { color: '#FFF', fontWeight: '900', fontSize: 13 },

  // 3. БЛОК КНОПОК ПРИБИТ К НИЗУ (ОБЫЧНЫЙ FLEX БЛОК)
  controlPanel: { width: '100%', backgroundColor: THEME.PANEL_BG, paddingTop: 12, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#1F2233' },
  loadingRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingVertical: 30 },
  
  btnStart: { backgroundColor: THEME.BTN_CALL, height: 54, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  btnStartText: { color: '#FFF', fontWeight: '900', fontSize: 18, textTransform: 'uppercase', letterSpacing: 1 },

  actionsContainer: { paddingBottom: 4 },
  actionHeader: { alignItems: 'center', marginBottom: 12 },
  actionHeaderText: { color: '#9CA3AF', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  
  actionGrid: { flexDirection: 'column', gap: 8 },
  actionRowHalf: { flexDirection: 'row', gap: 8, height: 54 },
  raiseFullContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.BTN_RAISE,
    borderRadius: 12,
    height: 60,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
    overflow: 'hidden',
  },
  raiseInlineAdjust: {
    width: 65,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  raiseInlineAdjustText: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: '500',
    lineHeight: 30,
  },
  raiseInlineCenter: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },

  btnAction: { flex: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: {width:0, height:2}, shadowOpacity: 0.5, shadowRadius: 4, elevation: 4 },
  btnActionLabel: { color: '#FFF', fontWeight: '900', fontSize: 18, textTransform: 'uppercase', letterSpacing: 1 },
  btnActionSub: { color: 'rgba(255,255,255,0.8)', fontWeight: '800', fontSize: 14, marginTop: 2 },

  gridRowSizing: { flexDirection: 'row', gap: 8, height: 54 },
  btnSizing: { flex: 1, backgroundColor: THEME.BTN_RAISE, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  btnActionText: { color: '#FFF', fontWeight: '900', fontSize: 18 },

  feedbackContainer: { backgroundColor: '#1F2937', borderRadius: 8, overflow: 'hidden', marginBottom: 8 },
  feedbackHeader: { paddingVertical: 12, alignItems: 'center' },
  feedbackTitle: { color: '#FFF', fontWeight: '900', fontSize: 16, textTransform: 'uppercase', letterSpacing: 1 },
  feedbackBody: { color: '#E5E7EB', padding: 16, fontSize: 15, textAlign: 'center', lineHeight: 22, fontWeight: '500' },
  btnNext: { backgroundColor: THEME.BTN_CALL, margin: 16, marginTop: 0, height: 56, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  btnNextText: { color: '#FFF', fontWeight: '900', fontSize: 16, textTransform: 'uppercase' },
});