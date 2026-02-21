import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { supabase } from '../../lib/supabase';
import { ensureSession } from '../../lib/ensureSession';
import { callEdge } from '../../lib/edge';
import type { TableDrillScenario, TableDrillCorrectAction } from '../../types/drill';
import { DrillQueueRow } from '../../types/database';

const FELT_EDGE = '#0a4f2b';
const FELT_CENTER = '#0f6b3c';
const RAIL_COLOR = '#1a1a1a';
const ROOM_BG = '#0f1216';
const CARD_SLOT_COLOR = 'rgba(0,0,0,0.35)';
const ACTION_BAR_HEIGHT = 72;
const ACTION_LINE_HEIGHT = 28;

const SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = ['h', 'd'];
const RANK_DISPLAY: Record<string, string> = { A: 'A', K: 'K', Q: 'Q', J: 'J', T: 'T', '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2' };

function parseCardCode(code: string | null | undefined): { rank: string; suit: string } | null {
  if (!code || typeof code !== 'string' || code.length < 2) return null;
  const rank = code[0].toUpperCase();
  const suit = code[1].toLowerCase();
  if (!RANK_DISPLAY[rank] || !SUIT_SYMBOLS[suit]) return null;
  return { rank, suit };
}

type CardViewSize = 'sm' | 'md' | 'lg';
const CARD_DIMENSIONS: Record<CardViewSize, { width: number; height: number; rankFontSize: number; suitFontSize: number; cornerFontSize: number }> = {
  sm: { width: 32, height: 44, rankFontSize: 10, suitFontSize: 12, cornerFontSize: 8 },
  md: { width: 40, height: 56, rankFontSize: 14, suitFontSize: 16, cornerFontSize: 10 },
  lg: { width: 44, height: 62, rankFontSize: 15, suitFontSize: 18, cornerFontSize: 11 },
};

function CardView({
  code,
  size = 'md',
  faceDown = false,
}: {
  code?: string | null;
  size?: CardViewSize;
  faceDown?: boolean;
}) {
  const dim = CARD_DIMENSIONS[size];
  const parsed = faceDown ? null : parseCardCode(code ?? null);
  const isRed = parsed && RED_SUITS.includes(parsed.suit);
  const suitColor = isRed ? '#ef4444' : '#111827';

  if (!parsed && !faceDown) {
    return (
      <View
        style={[
          cardStyles.slot,
          {
            width: dim.width,
            height: dim.height,
            borderRadius: 11,
          },
        ]}
      />
    );
  }

  if (faceDown) {
    return (
      <View
        style={[
          cardStyles.card,
          {
            width: dim.width,
            height: dim.height,
            borderRadius: 11,
          },
          cardStyles.faceDown,
        ]}
      >
        <View style={cardStyles.backPattern1} />
        <View style={cardStyles.backPattern2} />
      </View>
    );
  }

  return (
    <View
      style={[
        cardStyles.card,
        {
          width: dim.width,
          height: dim.height,
          borderRadius: 11,
        },
      ]}
    >
      <View style={[cardStyles.cornerTop, { top: 3, left: 4 }]}>
        <AppText variant="body" style={[cardStyles.rankText, { fontSize: dim.rankFontSize }]}>
          {RANK_DISPLAY[parsed!.rank]}
        </AppText>
        <AppText variant="body" style={[cardStyles.suitText, { fontSize: dim.suitFontSize, color: suitColor }]}>
          {SUIT_SYMBOLS[parsed!.suit]}
        </AppText>
      </View>
      <View style={[cardStyles.cornerBottom, { bottom: 3, right: 4 }]}>
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <AppText variant="body" style={[cardStyles.rankText, { fontSize: dim.cornerFontSize }]}>
            {RANK_DISPLAY[parsed!.rank]}
          </AppText>
          <AppText variant="body" style={[cardStyles.suitText, { fontSize: dim.cornerFontSize, color: suitColor }]}>
            {SUIT_SYMBOLS[parsed!.suit]}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  slot: {
    backgroundColor: CARD_SLOT_COLOR,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  card: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    overflow: 'hidden',
  },
  faceDown: {
    backgroundColor: '#1a2744',
  },
  backPattern1: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    margin: 2,
  },
  backPattern2: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.2,
    backgroundColor: 'transparent',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
    transform: [{ skewX: '-20deg' }],
    marginHorizontal: 8,
  },
  cornerTop: {
    position: 'absolute',
    alignItems: 'flex-start',
  },
  cornerBottom: {
    position: 'absolute',
    alignItems: 'flex-end',
  },
  rankText: {
    color: '#111',
    fontWeight: '800',
  },
  suitText: {
    fontWeight: '700',
  },
});

function chipColorByAmount(amountBb: number): string {
  if (amountBb <= 2) return '#6b7280';
  if (amountBb <= 10) return '#dc2626';
  if (amountBb <= 25) return '#16a34a';
  return '#2563eb';
}

function ChipStack({
  amountBb,
  variant,
}: {
  amountBb: number;
  variant: 'villain' | 'pot';
}) {
  const color = chipColorByAmount(amountBb);
  const chipCount = Math.min(6, Math.max(3, 3 + Math.floor(amountBb / 8)));
  const chipDiam = 14;
  const stackWidth = 24;
  const stackHeight = chipDiam + (chipCount - 1) * 2.5;

  return (
    <View style={[chipStackStyles.wrap, { width: stackWidth, height: stackHeight }]}>
      {Array.from({ length: chipCount }).map((_, i) => (
        <View
          key={i}
          style={[
            chipStackStyles.chip,
            {
              width: chipDiam,
              height: chipDiam,
              borderRadius: chipDiam / 2,
              borderColor: color,
              backgroundColor: color,
              bottom: i * 2.5,
              left: (stackWidth - chipDiam) / 2,
            },
          ]}
        >
          <View style={[chipStackStyles.chipHighlight, { width: chipDiam / 2, height: chipDiam / 4, borderRadius: chipDiam / 4, top: 1, left: (chipDiam - chipDiam / 2) / 2 }]} />
        </View>
      ))}
    </View>
  );
}

const chipStackStyles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  chip: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  chipHighlight: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});

type TableGradeResult = { isCorrect: boolean; explanation: string };

// 6-max seat angles in radians: 0=bottom (Hero), 1=bottomRight, 2=topRight, 3=top (Villain), 4=topLeft, 5=bottomLeft
const SEAT_ANGLES_RAD = [Math.PI / 2, Math.PI / 6, -Math.PI / 6, -Math.PI / 2, -5 * Math.PI / 6, 5 * Math.PI / 6];
const HERO_SEAT_INDEX = 0;
const VILLAIN_SEAT_INDEX = 3;

// 6-max position labels (MVP fixed): 0=BTN, 1=SB, 2=BB, 3=CO, 4=HJ, 5=UTG
const POSITION_LABELS = ['BTN', 'SB', 'BB', 'CO', 'HJ', 'UTG'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Seat position on ellipse (wrap-relative). wrapW/wrapH = table wrap size. Hero: y+10, Villain: y-6. */
function seatPosition(index: number, wrapW: number, wrapH: number): { x: number; y: number } {
  const tableW = wrapW - 24;
  const tableH = wrapH - 24;
  const cx = wrapW / 2;
  const cy = wrapH / 2;
  const rx = tableW * 0.48;
  const ry = tableH * 0.50;
  const theta = SEAT_ANGLES_RAD[index];
  let x = cx + rx * Math.cos(theta);
  let y = cy + ry * Math.sin(theta);
  if (index === HERO_SEAT_INDEX) y += 10;
  if (index === VILLAIN_SEAT_INDEX) y -= 6;
  return { x, y };
}

export default function TrainScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<TableDrillScenario | null>(null);
  const [tableGradeResult, setTableGradeResult] = useState<TableGradeResult | null>(null);
  const [currentDrillRow, setCurrentDrillRow] = useState<DrillQueueRow | null>(null);
  const [dueDrills, setDueDrills] = useState<DrillQueueRow[]>([]);
  const [loadingDue, setLoadingDue] = useState(false);
  const [raiseSizeBb, setRaiseSizeBb] = useState(12);
  const [tableLayout, setTableLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [showPositionLabels, setShowPositionLabels] = useState(false);
  const refreshInProgressRef = useRef(false);

  const isYourTurn = scenario != null && !tableGradeResult;

  // Card animations (hero + board)
  const heroCard1Opacity = useRef(new Animated.Value(0)).current;
  const heroCard1TranslateY = useRef(new Animated.Value(6)).current;
  const heroCard2Opacity = useRef(new Animated.Value(0)).current;
  const heroCard2TranslateY = useRef(new Animated.Value(6)).current;
  const boardOpacities = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  const boardTranslateYs = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(6))).current;

  // Chip animation (villain -> pot): translate from (0,0) at villain to (dx, dy) at pot
  const chipFlyTranslateX = useRef(new Animated.Value(0)).current;
  const chipFlyTranslateY = useRef(new Animated.Value(0)).current;
  const chipFlyOpacity = useRef(new Animated.Value(0)).current;
  const chipAtPotOpacity = useRef(new Animated.Value(0)).current;

  const heroPulseScale = useRef(new Animated.Value(1)).current;
  const heroPulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const foldScale = useRef(new Animated.Value(1)).current;
  const callScale = useRef(new Animated.Value(1)).current;
  const raiseScale = useRef(new Animated.Value(1)).current;

  const contentHeight = screenHeight - insets.top - insets.bottom - ACTION_BAR_HEIGHT - ACTION_LINE_HEIGHT;
  const tableHeight = contentHeight * 0.80;
  const tableWidth = Math.min(screenWidth * 0.88, tableHeight * 1.35);
  const tableCenterX = screenWidth / 2;
  const tableCenterY = insets.top + contentHeight / 2;
  const wrapW = tableLayout?.width ?? tableWidth + 24;
  const wrapH = tableLayout?.height ?? tableHeight + 24;
  const scale = clamp(screenWidth / 390, 0.92, 1.05);

  async function loadDueDrills() {
    setLoadingDue(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB RPC args type mismatch
      const { data, error: err } = await supabase.rpc('rpc_get_due_drills', { limit_n: 5 } as any);
      if (err) throw err;
      setDueDrills(data ?? []);
    } catch (e) {
      console.error('Failed to load due drills:', e);
      setDueDrills([]);
    } finally {
      setLoadingDue(false);
    }
  }

  const refreshTrain = useCallback(async () => {
    if (refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
      await ensureSession();
      await callEdge('ai-bootstrap-drill-queue', {});
      await loadDueDrills();
    } catch (e) {
      console.error('Refresh train failed:', e);
    } finally {
      refreshInProgressRef.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshTrain();
    }, [refreshTrain])
  );

  useEffect(() => {
    if (scenario?.action_to_hero) {
      const defaultRaise = Math.max(12, scenario.action_to_hero.size_bb * 2);
      setRaiseSizeBb(defaultRaise);
    }
  }, [scenario]);

  // Run card + chip animations when scenario appears
  useEffect(() => {
    if (!scenario) {
      heroCard1Opacity.setValue(0);
      heroCard1TranslateY.setValue(6);
      heroCard2Opacity.setValue(0);
      heroCard2TranslateY.setValue(6);
      boardOpacities.forEach((a) => a.setValue(0));
      boardTranslateYs.forEach((a) => a.setValue(6));
      chipFlyTranslateX.setValue(0);
      chipFlyTranslateY.setValue(0);
      chipFlyOpacity.setValue(0);
      chipAtPotOpacity.setValue(0);
      return;
    }

    const heroDuration = 180;
    const boardDuration = 160;
    const boardDelays = [0, 80, 160, 260, 340];
    const cardCount = 3 + (scenario.board.turn ? 1 : 0) + (scenario.board.river ? 1 : 0);

    // Hero cards: fade + slide up
    Animated.parallel([
      Animated.timing(heroCard1Opacity, { toValue: 1, duration: heroDuration, useNativeDriver: true }),
      Animated.timing(heroCard1TranslateY, { toValue: 0, duration: heroDuration, useNativeDriver: true }),
      Animated.timing(heroCard2Opacity, { toValue: 1, duration: heroDuration, useNativeDriver: true }),
      Animated.timing(heroCard2TranslateY, { toValue: 0, duration: heroDuration, useNativeDriver: true }),
    ]).start();

    // Board cards: staggered
    boardOpacities.slice(0, cardCount).forEach((op, i) => {
      Animated.sequence([
        Animated.delay(boardDelays[i]),
        Animated.parallel([
          Animated.timing(op, { toValue: 1, duration: boardDuration, useNativeDriver: true }),
          Animated.timing(boardTranslateYs[i], { toValue: 0, duration: boardDuration, useNativeDriver: true }),
        ]),
      ]).start();
    });

    const isBetOrRaise = scenario.action_to_hero.type === 'bet' || scenario.action_to_hero.type === 'raise';
    if (isBetOrRaise) {
      const villainPos = seatPosition(VILLAIN_SEAT_INDEX, wrapW, wrapH);
      const chipSize = 24;
      const villainChipX = villainPos.x - chipSize / 2;
      const villainChipY = villainPos.y - 50;
      const potChipX = wrapW / 2 - chipSize / 2;
      const potChipY = wrapH / 2 - 28;
      const dx = potChipX - villainChipX;
      const dy = potChipY - villainChipY;

      chipFlyTranslateX.setValue(0);
      chipFlyTranslateY.setValue(0);
      chipFlyOpacity.setValue(1);
      chipAtPotOpacity.setValue(0);

      Animated.sequence([
        Animated.parallel([
          Animated.timing(chipFlyTranslateX, { toValue: dx, duration: 350, useNativeDriver: true }),
          Animated.timing(chipFlyTranslateY, { toValue: dy, duration: 350, useNativeDriver: true }),
          Animated.timing(chipFlyOpacity, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
        Animated.timing(chipAtPotOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [scenario, wrapW, wrapH]);

  async function startDrill() {
    setLoading(true);
    setError(null);
    setScenario(null);
    setTableGradeResult(null);
    setCurrentDrillRow(null);

    try {
      await ensureSession();

      const leak_tag = dueDrills.length > 0 ? dueDrills[0].leak_tag : 'fundamentals';
      const row = dueDrills.length > 0 ? dueDrills[0] : null;

      const data = await callEdge('ai-generate-table-drill', {
        leak_tag,
        difficulty: 'medium',
      });

      if (!data || data.ok !== true || !data.scenario) {
        setError('Не удалось сгенерировать сценарий. Попробуй ещё раз.');
        return;
      }

      setScenario(data.scenario as TableDrillScenario);
      if (row) setCurrentDrillRow(row);
    } catch (e: any) {
      if (e?.message === 'Failed to create session') {
        setError('Не удалось создать сессию. Перезапусти приложение.');
      } else {
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      }
    } finally {
      setLoading(false);
    }
  }

  async function selectTableAction(userAction: TableDrillCorrectAction) {
    if (!scenario) return;
    if (!currentDrillRow) {
      setError('Нет записи в очереди дриллов. Обновите экран.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await ensureSession();
      const data = await callEdge('ai-submit-table-drill-result', {
        drill_queue_id: currentDrillRow.id,
        scenario,
        user_action: userAction,
        raise_size_bb: userAction === 'raise' ? raiseSizeBb : undefined,
      });

      if (data?.error) {
        setError(data.detail ?? data.error ?? 'Ошибка отправки результата');
        return;
      }

      const isCorrect = data?.correct === true;
      const explanation = data?.explanation ?? scenario.explanation ?? '';
      setTableGradeResult({ isCorrect, explanation });
    } catch (e: any) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить результат');
      console.error('ai-submit-table-drill-result failed:', e);
    } finally {
      setLoading(false);
    }
  }

  function closeResultModal() {
    setTableGradeResult(null);
    refreshTrain();
    startDrill();
  }

  function formatActionToHero(sc: TableDrillScenario): string {
    const a = sc.action_to_hero;
    if (a.type === 'check') return 'Villain checks';
    if (a.type === 'bet') return `Villain bets ${a.size_bb}bb`;
    return `Villain raises to ${a.size_bb}bb`;
  }

  function actionLineText(): string {
    if (!scenario) return 'Checked to you';
    const a = scenario.action_to_hero;
    if (a.type === 'check') return 'Checked to you';
    return `To call: ${a.size_bb} bb`;
  }

  function communityCards(sc: TableDrillScenario): string[] {
    const out = [...sc.board.flop];
    if (sc.board.turn) out.push(sc.board.turn);
    if (sc.board.river) out.push(sc.board.river);
    return out;
  }

  const showActionBar = !!scenario && !tableGradeResult;
  const isModalOpen = !!tableGradeResult;

  // Hero seat pulse when waiting for action; stop when result modal opens
  useEffect(() => {
    if (showActionBar && scenario?.action_to_hero) {
      heroPulseScale.setValue(1);
      heroPulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(heroPulseScale, {
            toValue: 1.03,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(heroPulseScale, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
        { resetBeforeIteration: false }
      );
      heroPulseLoopRef.current.start();
      return () => {
        heroPulseLoopRef.current?.stop();
        heroPulseLoopRef.current = null;
        heroPulseScale.setValue(1);
      };
    }
    heroPulseLoopRef.current?.stop();
    heroPulseLoopRef.current = null;
    heroPulseScale.setValue(1);
  }, [showActionBar, scenario?.action_to_hero]);

  return (
    <ScreenWrapper style={styles.screenWrapper}>
      <View style={[styles.room, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Fullscreen room background */}
        <View style={styles.roomContent}>
          {/* Table wrap: tap toggles position labels, onLayout + seats absolute inside */}
          <TouchableWithoutFeedback onPress={() => setShowPositionLabels((v) => !v)}>
            <View
              style={[
                styles.tableWrap,
                {
                  width: tableWidth + 24,
                  height: tableHeight + 24,
                  left: tableCenterX - (tableWidth + 24) / 2,
                  top: tableCenterY - (tableHeight + 24) / 2,
                },
              ]}
              onLayout={(e) => {
                const { x, y, width, height } = e.nativeEvent.layout;
                setTableLayout({ x, y, width, height });
              }}
            >
            <View style={[styles.tableOuter, styles.tableOuterFill]}>
            <View style={[styles.tableFelt, { width: tableWidth, height: tableHeight }]}>
              {/* Radial gradient simulation: center lighter */}
              <View
                style={[
                  styles.feltRadialOverlay,
                  {
                    width: tableWidth * 0.82,
                    height: tableHeight * 0.82,
                    borderRadius: (tableWidth * 0.82) / 2,
                  },
                ]}
                pointerEvents="none"
              />
              {/* Inner shadow: dark inset ring */}
              <View
                style={[
                  styles.feltInnerShadow,
                  {
                    width: tableWidth - 8,
                    height: tableHeight - 8,
                    left: 4,
                    top: 4,
                    borderRadius: (tableWidth - 8) / 2,
                  },
                ]}
                pointerEvents="none"
              />
              {/* Board: 5 slots center (staggered animation) */}
              <View style={[styles.boardRow, { transform: [{ scale }] }]}>
                {(scenario ? communityCards(scenario) : ['', '', '', '', '']).slice(0, 5).map((code, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      {
                        opacity: boardOpacities[i],
                        transform: [{ translateY: boardTranslateYs[i] }],
                      },
                    ]}
                  >
                    <CardView code={code || undefined} size="md" />
                  </Animated.View>
                ))}
              </View>
              {/* Pot capsule */}
              <View style={styles.potCapsule}>
                <AppText variant="caption" style={styles.potText}>
                  POT: {scenario ? `${scenario.pot_bb} bb` : '—'}
                </AppText>
              </View>
            </View>
            </View>

            {/* Your-turn dim overlay (table only; action bar stays bright) */}
            {isYourTurn && (
              <View style={[StyleSheet.absoluteFillObject, styles.yourTurnDimOverlay]} pointerEvents="none" />
            )}

            {/* 6 seats: absolute inside table wrap, positioned on ellipse */}
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const pos = seatPosition(index, wrapW, wrapH);
              const isHero = index === HERO_SEAT_INDEX;
              const isVillain = index === VILLAIN_SEAT_INDEX;
              const isEmpty = !isHero && !isVillain;
              const name = isHero ? 'Hero' : isVillain ? 'Villain' : 'Empty';
              const stack = scenario
                ? isHero || isVillain
                  ? `${scenario.effective_stack_bb}bb`
                  : '—'
                : '—';
              const seatWidth = isHero ? 63 : 56;
              const SEAT_OFFSET_Y = 45;
              const seatStyle = [
                styles.seat,
                {
                  left: pos.x - seatWidth / 2,
                  top: pos.y - SEAT_OFFSET_Y,
                  width: seatWidth,
                },
                isHero && styles.seatHeroGlow,
                isHero && isYourTurn && styles.seatHeroYourTurn,
                isYourTurn && !isHero && { opacity: 0.6 },
                isEmpty && styles.seatEmpty,
              ];
            const seatContent = (
              <>
                {index === VILLAIN_SEAT_INDEX && (
                  <View style={styles.dealerButton}>
                    <AppText variant="caption" color="#1a1a1a" style={styles.dealerText}>D</AppText>
                  </View>
                )}
                <View style={[styles.avatarCircle, isHero && styles.avatarCircleHero, isEmpty && styles.avatarEmpty]}>
                  {!isEmpty && (
                    <AppText variant="caption" color="#fff" numberOfLines={1}>
                      {name.charAt(0)}
                    </AppText>
                  )}
                </View>
                <AppText
                  variant="caption"
                  style={[
                    styles.seatName,
                    isHero && styles.seatNameHero,
                    isEmpty && styles.seatNameEmpty,
                  ]}
                  numberOfLines={1}
                >
                  {name}
                </AppText>
                <AppText variant="caption" style={[styles.seatStack, isEmpty && styles.seatNameEmpty]} numberOfLines={1}>
                  {stack}
                </AppText>
              </>
            );
            return (
              <React.Fragment key={index}>
                {isHero ? (
                  <Animated.View
                    style={[
                      seatStyle,
                      { transform: [{ scale: heroPulseScale }], zIndex: isYourTurn ? 10 : undefined },
                    ]}
                  >
                    {seatContent}
                  </Animated.View>
                ) : (
                  <View style={seatStyle}>{seatContent}</View>
                )}
              </React.Fragment>
            );
            })}

            {/* Position labels overlay (toggle by tap on table) */}
            {showPositionLabels && (
              <>
                {[0, 1, 2, 3, 4, 5].map((index) => {
                  const pos = seatPosition(index, wrapW, wrapH);
                  const SEAT_OFFSET_Y = 45;
                  const labelW = 36;
                  const labelAbove = index === 0 ? false : true;
                  return (
                    <View
                      key={`pos-${index}`}
                      style={[
                        styles.positionLabelCapsule,
                        {
                          left: pos.x - labelW / 2,
                          top: labelAbove ? pos.y - SEAT_OFFSET_Y - 24 : pos.y - SEAT_OFFSET_Y + 90,
                        },
                      ]}
                      pointerEvents="none"
                    >
                      <AppText variant="caption" style={styles.positionLabelText}>
                        {POSITION_LABELS[index]}
                      </AppText>
                    </View>
                  );
                })}
              </>
            )}

            {/* Hero cards: absolute at bottom of table so they stay above action bar */}
            {scenario && (
              <View style={[styles.heroCardsContainer, { transform: [{ scale }] }]} pointerEvents="none">
                <Animated.View
                  style={[
                    {
                      opacity: heroCard1Opacity,
                      transform: [{ translateY: heroCard1TranslateY }],
                    },
                  ]}
                >
                  <CardView code={scenario?.hero_cards[0]} size="lg" />
                </Animated.View>
                <Animated.View
                  style={[
                    {
                      opacity: heroCard2Opacity,
                      transform: [{ translateY: heroCard2TranslateY }],
                    },
                  ]}
                >
                  <CardView code={scenario?.hero_cards[1]} size="lg" />
                </Animated.View>
              </View>
            )}

            {/* Chip stack: flying from villain to pot (bet/raise only), wrap-relative */}
            {scenario && (scenario.action_to_hero.type === 'bet' || scenario.action_to_hero.type === 'raise') && (() => {
              const chipSize = 24;
              const villainPos = seatPosition(VILLAIN_SEAT_INDEX, wrapW, wrapH);
              const villainChipX = villainPos.x - chipSize / 2;
              const villainChipY = villainPos.y - 50;
              const potChipX = wrapW / 2 - chipSize / 2;
              const potChipY = wrapH / 2 - 28;
              const sizeBb = scenario.action_to_hero.size_bb;
              return (
                <>
                  <View style={[styles.chipStackWrap, { left: villainChipX, top: villainChipY, width: chipSize, height: chipSize }]} pointerEvents="none">
                    <Animated.View
                      style={[
                        styles.chipStackInner,
                        {
                          width: chipSize,
                          height: chipSize,
                          opacity: chipFlyOpacity,
                          transform: [
                            { translateX: chipFlyTranslateX },
                            { translateY: chipFlyTranslateY },
                          ],
                        },
                      ]}
                    >
                      <View style={styles.chipStackCenter}>
                        <ChipStack amountBb={sizeBb} variant="villain" />
                      </View>
                    </Animated.View>
                  </View>
                  <Animated.View
                    style={[
                      styles.chipAtPotWrap,
                      {
                        left: potChipX,
                        top: potChipY,
                        width: chipSize,
                        height: chipSize,
                        opacity: chipAtPotOpacity,
                      },
                    ]}
                    pointerEvents="none"
                  >
                    <View style={styles.chipStackCenter}>
                      <ChipStack amountBb={sizeBb} variant="pot" />
                    </View>
                  </Animated.View>
                  <View style={[styles.chipLabelVillain, { left: villainChipX + chipSize + 6, top: villainChipY + 4 }]} pointerEvents="none">
                    <View style={styles.chipLabelCapsule}>
                      <AppText variant="caption" style={styles.chipLabelText}>{sizeBb}bb</AppText>
                    </View>
                  </View>
                </>
              );
            })()}
            </View>
          </TouchableWithoutFeedback>

          {/* Start Drill overlay (center of table when no scenario) */}
          {!scenario && !loading && (
            <TouchableOpacity
              style={[styles.startDrillOverlay, { left: tableCenterX - 100, top: tableCenterY - 28 }]}
              onPress={startDrill}
              activeOpacity={0.8}
            >
              <AppText variant="h3" color="#fff">Start Drill</AppText>
            </TouchableOpacity>
          )}

          {loading && !scenario && (
            <View style={[styles.loadingOverlay, { left: tableCenterX - 80, top: tableCenterY - 40 }]}>
              <ActivityIndicator color="#fff" size="large" />
              <AppText variant="caption" style={styles.loadingText}>Генерирую сценарий...</AppText>
            </View>
          )}

          {error ? (
            <View style={[styles.errorBar, { top: insets.top + 8 }]}>
              <AppText variant="caption" color="#F44336">{error}</AppText>
            </View>
          ) : null}
        </View>

        {/* Action line HUD (above action bar) */}
        {scenario && (
          <View style={[styles.actionLine, { paddingBottom: 4, paddingHorizontal: 16 }]}>
            <AppText variant="caption" style={styles.actionLineText}>
              {formatActionToHero(scenario)}
            </AppText>
          </View>
        )}

        {/* Action Bar (fixed bottom) — floating GG panel; safe area so it doesn't cover hero cards */}
        <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 8), height: ACTION_BAR_HEIGHT + Math.max(insets.bottom, 8) }]}>
          <View style={[styles.actionBarFloating, { marginHorizontal: 16 }]}>
            <View style={styles.actionBarInner}>
              {showActionBar && (
                <>
                  <TouchableOpacity
                    style={[styles.raiseSizeBtn, styles.raiseMinus]}
                    onPress={() => setRaiseSizeBb((prev) => Math.max(2, prev - 2))}
                    disabled={!scenario || isModalOpen || loading}
                  >
                    <AppText variant="body" color="#fff">−</AppText>
                  </TouchableOpacity>
                  <View style={styles.actionToCallWrap}>
                    <AppText variant="caption" style={styles.toCallText}>{actionLineText()}</AppText>
                  </View>
                  <TouchableOpacity
                    activeOpacity={1}
                    onPressIn={() => Animated.timing(foldScale, { toValue: 0.97, duration: 80, useNativeDriver: true }).start()}
                    onPressOut={() => Animated.timing(foldScale, { toValue: 1, duration: 150, useNativeDriver: true }).start()}
                    onPress={() => selectTableAction('fold')}
                    disabled={!scenario || isModalOpen || loading}
                  >
                    <Animated.View style={[styles.actionBtn, styles.foldBtn, { transform: [{ scale: foldScale }] }]}>
                      <AppText variant="body" color="#FFF">Fold</AppText>
                    </Animated.View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={1}
                    onPressIn={() => Animated.timing(callScale, { toValue: 0.97, duration: 80, useNativeDriver: true }).start()}
                    onPressOut={() => Animated.timing(callScale, { toValue: 1, duration: 150, useNativeDriver: true }).start()}
                    onPress={() => selectTableAction('call')}
                    disabled={!scenario || isModalOpen || loading}
                  >
                    <Animated.View style={[styles.actionBtn, styles.callBtn, { transform: [{ scale: callScale }] }]}>
                      <AppText variant="body" color="#FFF">Call</AppText>
                    </Animated.View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={1}
                    onPressIn={() => Animated.timing(raiseScale, { toValue: 0.97, duration: 80, useNativeDriver: true }).start()}
                    onPressOut={() => Animated.timing(raiseScale, { toValue: 1, duration: 150, useNativeDriver: true }).start()}
                    onPress={() => selectTableAction('raise')}
                    disabled={!scenario || isModalOpen || loading}
                  >
                    <Animated.View style={[styles.actionBtn, styles.raiseBtn, { transform: [{ scale: raiseScale }] }]}>
                      <AppText variant="body" color="#FFF">Raise {raiseSizeBb}</AppText>
                    </Animated.View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.raiseSizeBtn, styles.raisePlus]}
                    onPress={() => setRaiseSizeBb((prev) => prev + 2)}
                    disabled={!scenario || isModalOpen || loading}
                  >
                    <AppText variant="body" color="#fff">+</AppText>
                  </TouchableOpacity>
                </>
              )}
              {!showActionBar && (
                <AppText variant="caption" style={styles.toCallText}>Start a drill to play</AppText>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Result Modal */}
      <Modal visible={isModalOpen} transparent animationType="fade">
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { borderColor: tableGradeResult?.isCorrect ? '#4CAF50' : '#F44336', borderWidth: 2 }]}>
            <View style={[styles.overlayBadge, { backgroundColor: tableGradeResult?.isCorrect ? '#4CAF50' : '#F44336' }]}>
              <AppText variant="h3" color="#FFFFFF">
                {tableGradeResult?.isCorrect ? 'Correct' : 'Incorrect'}
              </AppText>
            </View>
            <AppText variant="body" style={styles.overlayExplanation}>
              {tableGradeResult?.explanation}
            </AppText>
            <TouchableOpacity style={styles.nextButton} onPress={closeResultModal}>
              <AppText variant="body" color="#FFFFFF" style={styles.nextButtonText}>
                Следующий Drill
              </AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: ROOM_BG,
    padding: 0,
  },
  room: {
    flex: 1,
    backgroundColor: ROOM_BG,
  },
  roomContent: {
    flex: 1,
  },
  tableWrap: {
    position: 'absolute',
  },
  tableOuter: {
    position: 'absolute',
    padding: 12,
    borderRadius: 9999,
    backgroundColor: RAIL_COLOR,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
    borderWidth: 2,
    borderColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableOuterFill: {
    width: '100%',
    height: '100%',
    left: 0,
    top: 0,
  },
  tableFelt: {
    backgroundColor: FELT_EDGE,
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  feltRadialOverlay: {
    position: 'absolute',
    backgroundColor: FELT_CENTER,
    opacity: 0.75,
    alignSelf: 'center',
    top: '9%',
    left: '9%',
  },
  feltInnerShadow: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
    alignSelf: 'center',
    top: 4,
    left: 4,
  },
  boardRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  potCapsule: {
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  potText: {
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  seat: {
    position: 'absolute',
    width: 56,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  seatHeroGlow: {
    shadowColor: 'rgba(59,130,246,0.25)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 8,
  },
  seatHeroYourTurn: {
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.5)',
    borderRadius: 20,
  },
  yourTurnDimOverlay: {
    backgroundColor: 'rgba(0,0,0,0.10)',
    borderRadius: 9999,
  },
  seatEmpty: {
    opacity: 0.4,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2a2a',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircleHero: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarEmpty: {
    backgroundColor: 'rgba(42,42,42,0.6)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  seatName: {
    color: '#E8EAED',
    marginTop: 4,
    fontSize: 12,
  },
  seatNameHero: {
    color: 'rgba(255,255,255,0.95)',
  },
  seatNameEmpty: {
    color: 'rgba(165,165,165,0.5)',
  },
  seatStack: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    marginTop: 2,
  },
  dealerButton: {
    position: 'absolute',
    top: -8,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dealerText: {
    fontWeight: '800',
    fontSize: 12,
  },
  positionLabelCapsule: {
    position: 'absolute',
    width: 36,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(17,24,39,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionLabelText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.9)',
  },
  heroCardsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  heroCardsContainer: {
    position: 'absolute',
    bottom: 26,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipStackWrap: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipStackInner: {
    overflow: 'visible',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipStackCenter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipAtPotWrap: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipLabelVillain: {
    position: 'absolute',
  },
  chipLabelCapsule: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chipLabelText: {
    color: 'rgba(255,255,255,0.95)',
    fontWeight: '600',
    fontSize: 11,
  },
  startDrillOverlay: {
    position: 'absolute',
    width: 200,
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(76, 154, 255, 0.9)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    width: 160,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.9)',
  },
  errorBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 10,
    backgroundColor: 'rgba(244,67,54,0.15)',
    borderRadius: 8,
    alignItems: 'center',
  },
  actionLine: {
    minHeight: ACTION_LINE_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  actionLineText: {
    color: 'rgba(255,255,255,0.85)',
  },
  actionBar: {
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  actionBarFloating: {
    backgroundColor: '#1a1f25',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    overflow: 'hidden',
  },
  actionBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionToCallWrap: {
    minWidth: 90,
    alignItems: 'center',
  },
  toCallText: {
    color: 'rgba(255,255,255,0.7)',
  },
  raiseSizeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  raiseMinus: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  raisePlus: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  actionBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    minHeight: 48,
    borderRadius: 16,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldBtn: {
    backgroundColor: '#2a2f36',
  },
  callBtn: {
    backgroundColor: '#2563eb',
  },
  raiseBtn: {
    backgroundColor: '#06b6d4',
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayCard: {
    width: '100%',
    maxWidth: 360,
    padding: 20,
    backgroundColor: '#1a1e24',
    borderRadius: 16,
  },
  overlayBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 16,
  },
  overlayExplanation: {
    color: '#E8EAED',
    marginBottom: 20,
    lineHeight: 22,
  },
  nextButton: {
    backgroundColor: '#4C9AFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonText: {
    fontWeight: '600',
  },
});
