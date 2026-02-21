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

// ─── COLOR THEME ─────────────────────────────────────────────────────────────
const FELT_EDGE    = '#14382A';
const FELT_CENTER  = '#1A4A35';
const RAIL_BG      = '#110A03';
const RAIL_TRIM    = '#261208';
const RAIL_LIGHT   = '#3A1C0A';
const ROOM_BG      = '#06070C';
// Actual panel content height: paddingTop 8 + infoRow 20 + gap 6 + buttons 46 + paddingBottom 6 = 86
const CONTROL_PANEL_HEIGHT = 86;

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

type CardViewSize = 'sm' | 'md' | 'lg';
const CARD_DIMENSIONS: Record<CardViewSize, {
  width: number; height: number;
  cornerRankSize: number; cornerSuitSize: number;
  centerSuitSize: number; radius: number;
}> = {
  sm: { width: 32,  height: 46,  cornerRankSize: 10, cornerSuitSize: 8,  centerSuitSize: 18, radius: 3 },
  md: { width: 44,  height: 62,  cornerRankSize: 13, cornerSuitSize: 10, centerSuitSize: 26, radius: 5 },
  lg: { width: 54,  height: 76,  cornerRankSize: 16, cornerSuitSize: 12, centerSuitSize: 33, radius: 6 },
};
const CARD_MD_HEIGHT = CARD_DIMENSIONS.md.height;

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
  const suitColor = isRed ? '#D63031' : '#1A1A2E';

  if (!parsed && !faceDown) {
    return (
      <View style={[cardStyles.slotEmpty, { width: dim.width, height: dim.height, borderRadius: dim.radius }]} />
    );
  }

  if (faceDown) {
    return (
      <View style={[cardStyles.faceDown, { width: dim.width, height: dim.height, borderRadius: dim.radius }]}>
        <View style={[cardStyles.backInnerBorder, { borderRadius: Math.max(1, dim.radius - 1) }]} />
        <View style={cardStyles.backDiamondA} />
        <View style={cardStyles.backDiamondB} />
      </View>
    );
  }

  return (
    <View style={[cardStyles.cardFaceUp, { width: dim.width, height: dim.height, borderRadius: dim.radius }]}>
      {/* Top-left corner: rank only */}
      <View style={cardStyles.cornerTL}>
        <AppText variant="body" style={[cardStyles.cornerRankText, { fontSize: dim.cornerRankSize, color: suitColor }]}>
          {RANK_DISPLAY[parsed!.rank]}
        </AppText>
      </View>

      {/* Bottom-right corner: same rank, no rotation (rotating 9→6 causes confusion) */}
      <View style={cardStyles.cornerBR}>
        <AppText variant="body" style={[cardStyles.cornerRankText, { fontSize: dim.cornerRankSize, color: suitColor }]}>
          {RANK_DISPLAY[parsed!.rank]}
        </AppText>
      </View>

      {/* Center: large suit symbol only */}
      <View style={cardStyles.centerSuit}>
        <AppText variant="body" style={[cardStyles.suitCenterText, { fontSize: dim.centerSuitSize, color: suitColor }]}>
          {SUIT_SYMBOLS[parsed!.suit]}
        </AppText>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  slotEmpty: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  cardFaceUp: {
    backgroundColor: '#FFFFFF',
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 7,
    overflow: 'hidden',
  },
  faceDown: {
    backgroundColor: '#0F1E3D',
    borderWidth: 1,
    borderColor: 'rgba(80,110,200,0.35)',
    overflow: 'hidden',
  },
  backInnerBorder: {
    position: 'absolute',
    top: 3, left: 3, right: 3, bottom: 3,
    borderWidth: 1,
    borderColor: 'rgba(90,130,220,0.4)',
    backgroundColor: '#142452',
  },
  backDiamondA: {
    position: 'absolute',
    top: -40, left: -10, right: -10, bottom: -40,
    borderWidth: 1,
    borderColor: 'rgba(120,160,240,0.07)',
    transform: [{ rotate: '45deg' }, { scaleX: 0.55 }],
  },
  backDiamondB: {
    position: 'absolute',
    top: -20, left: -20, right: -20, bottom: -20,
    borderWidth: 1,
    borderColor: 'rgba(120,160,240,0.05)',
    transform: [{ rotate: '45deg' }, { scaleX: 0.4 }],
  },
  cornerTL: {
    position: 'absolute',
    top: 3, left: 4,
    alignItems: 'center',
  },
  cornerBR: {
    position: 'absolute',
    bottom: 3, right: 4,
    alignItems: 'center',
  },
  cornerRankText: {
    fontWeight: '800',
    lineHeight: undefined,
    includeFontPadding: false,
  },
  cornerSuitText: {
    fontWeight: '700',
    lineHeight: undefined,
    includeFontPadding: false,
    marginTop: -2,
  },
  centerSuit: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suitCenterText: {
    fontWeight: '900',
    lineHeight: undefined,
    includeFontPadding: false,
  },
  rankText: { color: '#111827', fontWeight: '900' },
  suitText: { fontWeight: '800' },
});

// ─── CHIP STACK ───────────────────────────────────────────────────────────────
type ChipTier = 'small' | 'medium' | 'large' | 'huge';
function chipTierByAmount(amountBb: number): ChipTier {
  if (amountBb <= 2)  return 'small';
  if (amountBb <= 10) return 'medium';
  if (amountBb <= 25) return 'large';
  return 'huge';
}

// Casino-style chip colors
const CHIP_PALETTE: Record<ChipTier, { base: string; stripe: string }> = {
  small:  { base: '#E8E4D8', stripe: '#FFFFFF' },   // ivory/white
  medium: { base: '#CC2200', stripe: '#FF9977' },   // red
  large:  { base: '#1A3A7A', stripe: '#6699DD' },   // blue
  huge:   { base: '#5C0DAE', stripe: '#C580FF' },   // purple
};

function ChipStack({ amountBb }: { amountBb: number }) {
  const tier = chipTierByAmount(amountBb);
  const { base, stripe } = CHIP_PALETTE[tier];
  const chipCount = Math.min(6, Math.max(3, 3 + Math.floor(amountBb / 8)));
  const chipDiam  = 16;
  const stackWidth  = 26;
  const stackHeight = chipDiam + (chipCount - 1) * 3;

  return (
    <View style={[chipStackStyles.wrap, { width: stackWidth, height: stackHeight }]}>
      {Array.from({ length: chipCount }).map((_, i) => (
        <View
          key={i}
          style={[
            chipStackStyles.chip,
            {
              width: chipDiam, height: chipDiam,
              borderRadius: chipDiam / 2,
              backgroundColor: base,
              bottom: i * 3,
              left: (stackWidth - chipDiam) / 2,
            },
          ]}
        >
          <View style={[chipStackStyles.chipBorder, { width: chipDiam, height: chipDiam, borderRadius: chipDiam / 2 }]} />
          <View style={[chipStackStyles.inlayH, { width: chipDiam - 6, left: 3, top: 3,    backgroundColor: stripe }]} />
          <View style={[chipStackStyles.inlayH, { width: chipDiam - 6, left: 3, bottom: 3, backgroundColor: stripe }]} />
          <View style={[chipStackStyles.inlayV, { height: chipDiam - 6, top: 3, left: 3,   backgroundColor: stripe }]} />
          <View style={[chipStackStyles.inlayV, { height: chipDiam - 6, top: 3, right: 3,  backgroundColor: stripe }]} />
          <View style={[chipStackStyles.highlight, { width: chipDiam / 2, height: chipDiam / 4, top: 1, left: chipDiam / 4 }]} />
        </View>
      ))}
    </View>
  );
}

const chipStackStyles = StyleSheet.create({
  wrap: { position: 'relative' },
  chip: { position: 'absolute', overflow: 'hidden' },
  chipBorder: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.40)',
    top: 0, left: 0,
  },
  inlayH: {
    position: 'absolute',
    height: 2.5,
    borderRadius: 1,
    opacity: 0.85,
  },
  inlayV: {
    position: 'absolute',
    width: 2.5,
    borderRadius: 1,
    opacity: 0.85,
  },
  highlight: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 4,
  },
});

// ─── TABLE LOGIC ──────────────────────────────────────────────────────────────
type TableGradeResult = { isCorrect: boolean; explanation: string };

const SEAT_ANGLES_RAD = [Math.PI / 2, Math.PI / 6, -Math.PI / 6, -Math.PI / 2, -5 * Math.PI / 6, 5 * Math.PI / 6];
const HERO_SEAT_INDEX    = 0;
const VILLAIN_SEAT_INDEX = 3;
// Clockwise from BTN: right side → CO, HJ, UTG(top/villain), BB, SB(left of hero)
// Hero(0)=BTN  → right: 1=CO, 2=HJ  → top: 3=UTG  → left: 4=BB, 5=SB
const POSITION_LABELS = ['BTN', 'CO', 'HJ', 'UTG', 'BB', 'SB'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

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
  if (index === HERO_SEAT_INDEX)    y += 10;
  if (index === VILLAIN_SEAT_INDEX) y -= 6;
  return { x, y };
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────
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
  const refreshInProgressRef = useRef(false);

  const isYourTurn = scenario != null && !tableGradeResult;
  // Panel is ALWAYS visible — content changes based on state
  const showActionBar = !!scenario && !tableGradeResult;

  // Card animations
  const heroCard1Opacity    = useRef(new Animated.Value(0)).current;
  const heroCard1TranslateY = useRef(new Animated.Value(10)).current;
  const heroCard2Opacity    = useRef(new Animated.Value(0)).current;
  const heroCard2TranslateY = useRef(new Animated.Value(10)).current;
  const boardOpacities      = useRef([0,1,2,3,4].map(() => new Animated.Value(0))).current;
  const boardTranslateYs    = useRef([0,1,2,3,4].map(() => new Animated.Value(8))).current;

  // Bet badge fade-in animation
  const betBadgeOpacity = useRef(new Animated.Value(0)).current;

  const heroPulseScale   = useRef(new Animated.Value(1)).current;
  const heroPulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const foldScale  = useRef(new Animated.Value(1)).current;
  const callScale  = useRef(new Animated.Value(1)).current;
  const raiseScale = useRef(new Animated.Value(1)).current;

  // Tab navigator already places screen ABOVE the tab bar.
  // insets.bottom = Android nav-buttons height (below tab bar) — irrelevant here, do NOT add it.
  const PANEL_BOTTOM_PAD = 6;   // tiny gap between buttons and tab bar
  const tableAreaPaddingBottom = CONTROL_PANEL_HEIGHT + PANEL_BOTTOM_PAD + 8;
  const tableAreaInnerHeight = screenHeight - insets.top - tableAreaPaddingBottom;
  // 0.86 multiplier leaves enough room for hero cards below the oval without overlap
  const tableHeight = tableAreaInnerHeight * 0.86;
  const tableWidth  = Math.min(screenWidth * 0.92, tableHeight * 1.32);
  const wrapW = tableLayout?.width  ?? tableWidth + 24;
  const wrapH = tableLayout?.height ?? tableHeight + 24;
  const boardY = wrapH * 0.40;
  const potY   = boardY + CARD_MD_HEIGHT + 12;
  const scale  = clamp(screenWidth / 390, 0.92, 1.05);

  async function loadDueDrills() {
    setLoadingDue(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  useEffect(() => {
    if (!scenario) {
      heroCard1Opacity.setValue(0);
      heroCard1TranslateY.setValue(10);
      heroCard2Opacity.setValue(0);
      heroCard2TranslateY.setValue(10);
      boardOpacities.forEach((a) => a.setValue(0));
      boardTranslateYs.forEach((a) => a.setValue(8));
      betBadgeOpacity.setValue(0);
      return;
    }

    const heroDuration  = 200;
    const boardDuration = 170;
    const boardDelays   = [0, 90, 170, 270, 360];
    const cardCount     = 3 + (scenario.board.turn ? 1 : 0) + (scenario.board.river ? 1 : 0);

    Animated.parallel([
      Animated.timing(heroCard1Opacity,    { toValue: 1, duration: heroDuration, useNativeDriver: true }),
      Animated.timing(heroCard1TranslateY, { toValue: 0, duration: heroDuration, useNativeDriver: true }),
      Animated.timing(heroCard2Opacity,    { toValue: 1, duration: heroDuration, useNativeDriver: true }),
      Animated.timing(heroCard2TranslateY, { toValue: 0, duration: heroDuration, useNativeDriver: true }),
    ]).start();

    boardOpacities.slice(0, cardCount).forEach((op, i) => {
      Animated.sequence([
        Animated.delay(boardDelays[i]),
        Animated.parallel([
          Animated.timing(op,                  { toValue: 1, duration: boardDuration, useNativeDriver: true }),
          Animated.timing(boardTranslateYs[i], { toValue: 0, duration: boardDuration, useNativeDriver: true }),
        ]),
      ]).start();
    });

    const isBetOrRaise = scenario.action_to_hero.type === 'bet' || scenario.action_to_hero.type === 'raise';
    if (isBetOrRaise) {
      betBadgeOpacity.setValue(0);
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(betBadgeOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [scenario]);

  async function startDrill() {
    setLoading(true);
    setError(null);
    setScenario(null);
    setTableGradeResult(null);
    setCurrentDrillRow(null);

    try {
      await ensureSession();

      const leak_tag = dueDrills.length > 0 ? dueDrills[0].leak_tag : 'fundamentals';
      const row      = dueDrills.length > 0 ? dueDrills[0] : null;

      const data = await callEdge('ai-generate-table-drill', { leak_tag, difficulty: 'medium' });

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

      const isCorrect   = data?.correct === true;
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

  function actionLineText(): string {
    if (!scenario) return 'Checked to you';
    const a = scenario.action_to_hero;
    if (a.type === 'check') return 'Checked to you';
    return `To call: ${a.size_bb} bb`;
  }

  function communityCards(sc: TableDrillScenario): string[] {
    const out = [...sc.board.flop];
    if (sc.board.turn)  out.push(sc.board.turn);
    if (sc.board.river) out.push(sc.board.river);
    return out;
  }

  const isModalOpen = !!tableGradeResult;

  useEffect(() => {
    if (showActionBar && scenario?.action_to_hero) {
      heroPulseScale.setValue(1);
      heroPulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(heroPulseScale, { toValue: 1.03, duration: 650, useNativeDriver: true }),
          Animated.timing(heroPulseScale, { toValue: 1,    duration: 650, useNativeDriver: true }),
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

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <ScreenWrapper style={styles.screenWrapper}>
      <View style={styles.screen}>

        {/* ── TABLE AREA ─────────────────────────────────────────────────── */}
        <View style={[styles.tableArea, { paddingTop: insets.top, paddingBottom: tableAreaPaddingBottom }]}>
          <TouchableWithoutFeedback>
            <View
              style={[styles.tableWrap, { width: tableWidth + 24, height: tableHeight + 24 }]}
              onLayout={(e) => {
                const { x, y, width, height } = e.nativeEvent.layout;
                setTableLayout({ x, y, width, height });
              }}
            >
              {/* Rail outer glow ring */}
              <View style={[styles.railOuter, styles.tableAbsoluteFill]} />
              {/* Rail + felt */}
              <View style={[styles.tableOuter, styles.tableAbsoluteFill, { zIndex: 1 }]}>
                <View style={[styles.tableFelt, { width: tableWidth, height: tableHeight }]}>
                  <View
                    style={[styles.feltRadialOverlay, {
                      width:        tableWidth  * 0.78,
                      height:       tableHeight * 0.78,
                      borderRadius: (tableWidth * 0.78) / 2,
                    }]}
                    pointerEvents="none"
                  />
                  <View
                    style={[styles.feltInnerShadow, {
                      width:        tableWidth  - 10,
                      height:       tableHeight - 10,
                      left: 5, top: 5,
                      borderRadius: (tableWidth - 10) / 2,
                    }]}
                    pointerEvents="none"
                  />
                </View>
              </View>

              {/* ── Community cards — only actual cards, centered ── */}
              <View style={[styles.boardContainer, { top: boardY, zIndex: 5 }]} pointerEvents="none">
                <View style={styles.boardRow}>
                  {scenario
                    ? communityCards(scenario).map((code, i) => (
                        <Animated.View
                          key={i}
                          style={{ opacity: boardOpacities[i], transform: [{ translateY: boardTranslateYs[i] }, { scale }] }}
                        >
                          <CardView code={code} size="md" />
                        </Animated.View>
                      ))
                    : null}
                </View>
              </View>

              {/* Pot capsule: below board */}
              <View style={[styles.potCapsuleContainer, { top: potY, zIndex: 5 }]} pointerEvents="none">
                <View style={styles.potCapsule}>
                  <AppText variant="caption" style={styles.potText}>
                    POT  {scenario ? `${scenario.pot_bb} bb` : '—'}
                  </AppText>
                </View>
              </View>

              {/* ── Your-turn dim overlay ── */}
              {isYourTurn && (
                <View style={[StyleSheet.absoluteFillObject, styles.yourTurnDimOverlay, { zIndex: 15 }]} pointerEvents="none" />
              )}

              {/* ── Dealer button (D) — on the felt, beside BTN/Hero cards ── */}
              {(() => {
                // Hero = BTN = Dealer; button sits to the right of hero's cards
                const hp = seatPosition(HERO_SEAT_INDEX, wrapW, wrapH);
                const cardHalfSpan = CARD_DIMENSIONS.lg.width + 10; // approx half of 2 cards + gap
                return (
                  <View
                    style={[styles.dealerButton, {
                      left: hp.x + cardHalfSpan,
                      top:  hp.y - 44,   // at the bottom edge of the table oval
                      zIndex: 25,
                    }]}
                    pointerEvents="none"
                  >
                    <AppText style={styles.dealerText}>D</AppText>
                  </View>
                );
              })()}

              {/* ── 6 seats ─────────────────────────────────────────────── */}
              {/*
                Layout strategy:
                  - Uniform SEAT_OFFSET_Y = 46 for all seats.
                  - Each seat View top = pos.y - 46; content flows DOWN.
                  - Hero (bottom, y ≈ wrapH): offsetY = -6 so content flows
                    BELOW the table oval (not over the hole cards).
                  - Villain (top, y ≈ 6): offsetY = 56 so the entire
                    seat content sits ABOVE the table oval.
                  - All others: 46 — content sits on the rail edge.
              */}
              {[0, 1, 2, 3, 4, 5].map((index) => {
                const pos       = seatPosition(index, wrapW, wrapH);
                const isHero    = index === HERO_SEAT_INDEX;
                const isVillain = index === VILLAIN_SEAT_INDEX;
                const isEmpty   = !isHero && !isVillain;
                const posLabel  = POSITION_LABELS[index];
                const stack     = scenario && (isHero || isVillain)
                  ? `${scenario.effective_stack_bb} bb`
                  : '';

                // Per-seat vertical offset (see comment above)
                const offsetY = isHero ? -6 : isVillain ? 56 : 46;
                const seatW   = isHero ? 64 : isVillain ? 62 : 52;

                const posStyle = {
                  left:  pos.x - seatW / 2,
                  top:   pos.y - offsetY,
                  width: seatW,
                  zIndex: isHero || isVillain ? 10 : 8,
                };

                // ── EMPTY SEAT ───────────────────────────────────────────
                if (isEmpty) {
                  return (
                    <View key={index} style={[styles.seat, posStyle, styles.seatEmpty]}>
                      {/* faint ghost circle */}
                      <View style={styles.ghostCircle} />
                      <View style={styles.emptySlot}>
                        <AppText style={styles.emptySlotText}>{posLabel}</AppText>
                      </View>
                    </View>
                  );
                }

                // ── VILLAIN SEAT ─────────────────────────────────────────
                if (isVillain) {
                  return (
                    <View key={index} style={[styles.seat, posStyle, { alignItems: 'center' }]}>
                      <View style={[styles.playerAvatar, styles.villainAvatar,
                        isYourTurn && { opacity: 0.55 }]}>
                        <AppText style={styles.playerAvatarText}>V</AppText>
                      </View>
                      <View style={styles.villainPosChip}>
                        <AppText style={styles.villainPosText}>{posLabel}</AppText>
                      </View>
                      {!!stack && <AppText style={styles.playerStack}>{stack}</AppText>}
                    </View>
                  );
                }

                // ── HERO SEAT ────────────────────────────────────────────
                // Shows BELOW the table oval (below hole cards)
                return (
                  <Animated.View
                    key={index}
                    style={[styles.seat, posStyle, { alignItems: 'center' },
                      isYourTurn && styles.heroYourTurnGlow,
                      { transform: [{ scale: heroPulseScale }] },
                    ]}
                  >
                    <View style={styles.heroPosChip}>
                      <AppText style={styles.heroPosText}>{posLabel}</AppText>
                    </View>
                    {!!stack && <AppText style={styles.heroStack}>{stack}</AppText>}
                  </Animated.View>
                );
              })}

              {/* ── Villain bet badge (replaces flying chip) ── */}
              {scenario && (scenario.action_to_hero.type === 'bet' || scenario.action_to_hero.type === 'raise') && (() => {
                const villainPos = seatPosition(VILLAIN_SEAT_INDEX, wrapW, wrapH);
                const sizeBb     = scenario.action_to_hero.size_bb;
                const tier       = sizeBb <= 2 ? 'small' : sizeBb <= 10 ? 'medium' : sizeBb <= 25 ? 'large' : 'huge';
                const tintColor  = { small: '#AAAAAA', medium: '#FF6644', large: '#4477CC', huge: '#9944EE' }[tier];
                // Place badge well below villain seat content (content ends ~pos.y+20)
                // Push toward center of table so it floats between villain and board
                return (
                  <Animated.View
                    style={[styles.betBadgeWrap, {
                      left: villainPos.x - 36,
                      top:  villainPos.y + 46,
                      opacity: betBadgeOpacity,
                      zIndex: 8,
                    }]}
                    pointerEvents="none"
                  >
                    <View style={styles.betBadgeChipRow}>
                      <ChipStack amountBb={sizeBb} />
                      <View style={[styles.betBadgePill, { borderColor: tintColor }]}>
                        <AppText variant="caption" style={[styles.betBadgeText, { color: tintColor }]}>
                          {sizeBb} bb
                        </AppText>
                      </View>
                    </View>
                  </Animated.View>
                );
              })()}

              {/* ── Hero hole cards ── */}
              {scenario && (
                <View style={[styles.heroCardsContainer, { zIndex: 20 }]} pointerEvents="none">
                  <Animated.View style={{ opacity: heroCard1Opacity, transform: [{ translateY: heroCard1TranslateY }, { scale }] }}>
                    <CardView code={scenario?.hero_cards[0]} size="lg" />
                  </Animated.View>
                  <Animated.View style={{ opacity: heroCard2Opacity, transform: [{ translateY: heroCard2TranslateY }, { scale }] }}>
                    <CardView code={scenario?.hero_cards[1]} size="lg" />
                  </Animated.View>
                </View>
              )}

              {/* Loading spinner inside table (while waiting for scenario) */}
              {loading && !scenario && (
                <View style={styles.centerOverlay} pointerEvents="none">
                  <ActivityIndicator color="rgba(255,255,255,0.5)" size="large" />
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>

        {/* Error bar */}
        {error ? (
          <View style={[styles.errorBar, { top: insets.top + 8 }]}>
            <AppText variant="caption" color="#FF6B6B">{error}</AppText>
          </View>
        ) : null}

        {/* ── CONTROL PANEL — always visible, flush to tab bar ─────────── */}
        <View style={styles.controlPanel}>

          {/* ── STATE 1: Loading ── */}
          {loading && !scenario && (
            <View style={styles.panelLoadingRow}>
              <ActivityIndicator color="#4C9AFF" size="small" />
              <AppText variant="caption" style={styles.panelLoadingText}>
                Генерирую задачу…
              </AppText>
            </View>
          )}

          {/* ── STATE 2: No scenario — show "New Drill" CTA ── */}
          {!scenario && !loading && (
            <TouchableOpacity
              style={styles.startDrillBtn}
              onPress={startDrill}
              activeOpacity={0.82}
            >
              <AppText variant="body" style={styles.startDrillBtnText}>
                ▶  Новый Drill
              </AppText>
            </TouchableOpacity>
          )}

          {/* ── STATE 3: Scenario active — Fold / Call / Raise ── */}
          {showActionBar && (
            <>
              {/* Info row */}
              <View style={styles.controlInfoRow}>
                <AppText variant="caption" style={styles.controlInfoText}>
                  {actionLineText()}
                </AppText>
                <View style={styles.controlPotPill}>
                  <AppText variant="caption" style={styles.controlPotText}>
                    POT  {scenario ? `${scenario.pot_bb} bb` : '—'}
                  </AppText>
                </View>
              </View>

              {/* Buttons row */}
              <View style={styles.controlBtnRow}>
                {/* FOLD */}
                <Pressable
                  style={styles.controlBtnPressable}
                  onPressIn ={() => Animated.timing(foldScale, { toValue: 0.96, duration: 80,  useNativeDriver: true }).start()}
                  onPressOut={() => Animated.timing(foldScale, { toValue: 1,    duration: 150, useNativeDriver: true }).start()}
                  onPress={() => selectTableAction('fold')}
                  disabled={isModalOpen || loading}
                >
                  <Animated.View style={[styles.controlBtn, styles.btnFold, { transform: [{ scale: foldScale }] }]}>
                    <AppText variant="body" style={styles.btnFoldText}>Fold</AppText>
                  </Animated.View>
                </Pressable>

                {/* CALL */}
                <Pressable
                  style={styles.controlBtnPressable}
                  onPressIn ={() => Animated.timing(callScale, { toValue: 0.96, duration: 80,  useNativeDriver: true }).start()}
                  onPressOut={() => Animated.timing(callScale, { toValue: 1,    duration: 150, useNativeDriver: true }).start()}
                  onPress={() => selectTableAction('call')}
                  disabled={isModalOpen || loading}
                >
                  <Animated.View style={[styles.controlBtn, styles.btnCall, { transform: [{ scale: callScale }] }]}>
                    <AppText variant="body" style={styles.btnCallText}>Call</AppText>
                  </Animated.View>
                </Pressable>

                {/* RAISE group: [−] [Raise Xbb] [+] */}
                <View style={styles.raiseGroup}>
                  <TouchableOpacity
                    style={styles.raiseAdjBtn}
                    onPress={() => setRaiseSizeBb((p) => Math.max(2, p - 2))}
                    disabled={isModalOpen || loading}
                  >
                    <AppText variant="body" style={styles.raiseAdjText}>−</AppText>
                  </TouchableOpacity>

                  <Pressable
                    style={{ flex: 1 }}
                    onPressIn ={() => Animated.timing(raiseScale, { toValue: 0.96, duration: 80,  useNativeDriver: true }).start()}
                    onPressOut={() => Animated.timing(raiseScale, { toValue: 1,    duration: 150, useNativeDriver: true }).start()}
                    onPress={() => selectTableAction('raise')}
                    disabled={isModalOpen || loading}
                  >
                    <Animated.View style={[styles.controlBtn, styles.btnRaise, { transform: [{ scale: raiseScale }] }]}>
                      <AppText variant="caption" style={styles.btnRaiseLabel}>RAISE</AppText>
                      <AppText variant="body" style={styles.btnRaiseSize}>{raiseSizeBb} bb</AppText>
                    </Animated.View>
                  </Pressable>

                  <TouchableOpacity
                    style={styles.raiseAdjBtn}
                    onPress={() => setRaiseSizeBb((p) => p + 2)}
                    disabled={isModalOpen || loading}
                  >
                    <AppText variant="body" style={styles.raiseAdjText}>+</AppText>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      </View>

      {/* ── RESULT MODAL ─────────────────────────────────────────────────── */}
      <Modal visible={isModalOpen} transparent animationType="fade">
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, {
            borderColor: tableGradeResult?.isCorrect ? '#22C55E' : '#EF4444',
            borderWidth: 2,
          }]}>
            <View style={[styles.overlayBadge, {
              backgroundColor: tableGradeResult?.isCorrect ? '#16A34A' : '#DC2626',
            }]}>
              <AppText variant="h3" color="#FFFFFF">
                {tableGradeResult?.isCorrect ? '✓  Correct' : '✗  Incorrect'}
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

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: ROOM_BG,
    padding: 0,
  },
  screen: {
    flex: 1,
    backgroundColor: ROOM_BG,
  },
  tableArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableWrap: { position: 'relative' },
  tableAbsoluteFill: {
    position: 'absolute',
    width: '100%', height: '100%',
    left: 0, top: 0,
  },
  railOuter: {
    borderRadius: 9999,
    backgroundColor: RAIL_LIGHT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.85,
    shadowRadius: 30,
    elevation: 24,
    zIndex: 0,
  },
  tableOuter: {
    padding: 13,
    borderRadius: 9999,
    backgroundColor: RAIL_BG,
    borderWidth: 2.5,
    borderColor: RAIL_TRIM,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableFelt: {
    backgroundColor: FELT_EDGE,
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.40)',
    overflow: 'hidden',
  },
  feltRadialOverlay: {
    position: 'absolute',
    backgroundColor: FELT_CENTER,
    opacity: 0.68,
    alignSelf: 'center',
    top: '11%', left: '11%',
  },
  feltInnerShadow: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.28)',
    alignSelf: 'center',
  },

  // Board
  boardContainer: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
  },
  boardRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },

  // Pot
  potCapsuleContainer: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
  },
  potCapsule: {
    backgroundColor: 'rgba(8,10,18,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.40,
    shadowRadius: 6,
    elevation: 5,
  },
  potText: {
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '700',
    letterSpacing: 1.0,
    fontSize: 12,
  },

  // Dim overlay
  yourTurnDimOverlay: {
    backgroundColor: 'rgba(0,0,0,0.10)',
    borderRadius: 9999,
  },

  // ── SEATS ─────────────────────────────────────────────────────────────────
  seat: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  seatEmpty: { opacity: 0.40 },

  // Empty seat: ghost circle + small dim label
  ghostCircle: {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  emptySlot: {
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  emptySlotText: {
    fontSize: 10, fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.5, lineHeight: 14,
  },

  // Shared avatar style
  playerAvatar: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 2,
    justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 6, elevation: 4,
  },
  playerAvatarText: {
    fontWeight: '800', fontSize: 16, color: '#FFFFFF', lineHeight: 18,
  },
  playerStack: {
    marginTop: 2, fontSize: 11, fontWeight: '500',
    color: 'rgba(220,215,215,0.70)',
  },

  // Villain avatar styling
  villainAvatar: {
    backgroundColor: '#2A1018',
    borderColor: 'rgba(220,70,70,0.60)',
    shadowColor: '#CC2200',
  },
  villainPosChip: {
    marginTop: 4,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 7,
    backgroundColor: 'rgba(200,50,50,0.20)',
    borderWidth: 1, borderColor: 'rgba(220,80,80,0.45)',
  },
  villainPosText: {
    fontSize: 11, fontWeight: '700',
    color: 'rgba(255,190,190,0.95)',
    letterSpacing: 0.7, lineHeight: 15,
  },

  // Hero seat: shows BELOW the table, no avatar (cards represent hero)
  heroPosChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(37,99,235,0.30)',
    borderWidth: 1.5, borderColor: 'rgba(80,140,255,0.60)',
  },
  heroPosText: {
    fontSize: 12, fontWeight: '800', color: '#FFFFFF',
    letterSpacing: 0.8, lineHeight: 15,
  },
  heroStack: {
    marginTop: 3, fontSize: 11, fontWeight: '500',
    color: 'rgba(180,210,255,0.75)',
  },
  heroYourTurnGlow: {
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.80, shadowRadius: 16, elevation: 8,
  },

  // Dealer button — on the felt beside BTN/Hero's cards
  dealerButton: {
    position: 'absolute',
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#F0EBD4',
    borderWidth: 2, borderColor: '#C8A000',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.65, shadowRadius: 5, elevation: 7,
  },
  dealerText: {
    fontWeight: '900', fontSize: 13, color: '#1A1400', lineHeight: 15,
  },

  // Villain bet badge
  betBadgeWrap: {
    position: 'absolute',
  },
  betBadgeChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  betBadgePill: {
    backgroundColor: 'rgba(8,10,18,0.85)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  betBadgeText: {
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.4,
  },

  // Hero cards — positioned above table oval bottom edge, clear of control panel
  heroCardsContainer: {
    position: 'absolute',
    bottom: 30, left: 0, right: 0,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Overlays
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBar: {
    position: 'absolute',
    left: 16, right: 16,
    padding: 10,
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },

  // ── CONTROL PANEL ────────────────────────────────────────────────────────
  controlPanel: {
    position: 'absolute',
    left: 0, right: 0,
    bottom: 0,
    zIndex: 50,
    backgroundColor: '#0C0E16',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.65,
    shadowRadius: 18,
    elevation: 22,
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  // Panel: loading state
  panelLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 18,
  },
  panelLoadingText: {
    color: 'rgba(200,215,240,0.75)',
    fontSize: 14,
  },

  // Panel: "New Drill" start button
  startDrillBtn: {
    marginVertical: 4,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#1751A0',
    borderWidth: 1,
    borderColor: 'rgba(100,160,255,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 8,
  },
  startDrillBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 17,
    letterSpacing: 0.4,
  },

  controlInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  controlInfoText: {
    color: 'rgba(200,215,240,0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
  controlPotPill: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  controlPotText: {
    color: 'rgba(255,255,255,0.90)',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  controlBtnRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  controlBtnPressable: { flex: 1 },
  controlBtn: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },

  btnFold: {
    backgroundColor: '#1E1E28',
    borderWidth: 1.5,
    borderColor: 'rgba(239,68,68,0.30)',
  },
  btnFoldText: { color: '#FF8080', fontWeight: '700', fontSize: 16 },

  btnCall: {
    backgroundColor: '#0F3478',
    borderWidth: 1,
    borderColor: 'rgba(100,150,255,0.35)',
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.50,
    shadowRadius: 8,
    elevation: 6,
  },
  btnCallText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },

  raiseGroup: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  raiseAdjBtn: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  raiseAdjText: {
    fontSize: 20,
    fontWeight: '600',
    color: 'rgba(255,210,80,0.9)',
    lineHeight: 22,
  },
  btnRaise: {
    backgroundColor: '#7A4E00',
    borderWidth: 1,
    borderColor: 'rgba(255,185,0,0.40)',
    shadowColor: '#C88000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 6,
    gap: 1,
  },
  btnRaiseLabel: {
    color: 'rgba(255,200,60,0.80)',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1.2,
    lineHeight: 12,
  },
  btnRaiseSize: {
    color: '#FFD60A',
    fontWeight: '800',
    fontSize: 15,
    lineHeight: 18,
  },

  // ── RESULT MODAL ──────────────────────────────────────────────────────────
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayCard: {
    width: '100%',
    maxWidth: 360,
    padding: 22,
    backgroundColor: '#13161E',
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
  },
  overlayBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 16,
  },
  overlayExplanation: {
    color: '#C8D0E0',
    marginBottom: 22,
    lineHeight: 23,
    fontSize: 15,
  },
  nextButton: {
    backgroundColor: '#1751A0',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(100,150,255,0.3)',
  },
  nextButtonText: { fontWeight: '700', fontSize: 15 },
});
