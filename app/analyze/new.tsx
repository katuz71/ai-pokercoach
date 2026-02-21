import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { ensureSession } from '../../lib/ensureSession';
import { callEdge, callEdgeOcr, callEdgeParseHandText } from '../../lib/edge';
import { CoachStyle } from '../../types/hand';
import { Profile } from '../../types/database';

const OCR_AUTO_ANALYZE_KEY = 'ocr_auto_analyze';
const QUICK_FORM_DEFAULTS_KEY = 'quick_form_defaults_v1';

type QuickFormDefaults = {
  game: GameOption;
  stakesInputText: string;
  stackInputText: string;
  hero_pos?: Position;
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6MB

const FLOP_REGEX = /^([AKQJT98765432][shdc]){3}$/;
const SINGLE_CARD_REGEX = /^[AKQJT98765432][shdc]$/;

type BoardStructured = { flop: string; turn: string | null; river: string | null };
type ValidateBoardResult =
  | { ok: true; board_structured: BoardStructured | null }
  | { ok: false; message: string; errorFields: { flop?: boolean; turn?: boolean; river?: boolean } };

type ParseStackResult =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

function parseEffectiveStackBb(stackInputText: string): ParseStackResult {
  const s = stackInputText.trim();
  if (!s) return { ok: true, value: null };
  const cleaned = s.replace(/\s*(bb|BB)\s*$/i, '').trim();
  const num = parseFloat(cleaned);
  if (Number.isNaN(num)) return { ok: false, message: 'Stack must be a number (bb)' };
  if (num < 5 || num > 500) return { ok: false, message: 'Stack should be between 5 and 500 bb' };
  return { ok: true, value: num };
}

function validateBoardFields(flop: string, turn: string, river: string): ValidateBoardResult {
  const f = flop.trim();
  const t = turn.trim();
  const r = river.trim();

  if (!f && (t || r)) {
    return {
      ok: false,
      message: 'Flop is required if turn/river is set',
      errorFields: { flop: true, turn: !!t, river: !!r },
    };
  }
  if (r && !t) {
    return {
      ok: false,
      message: 'Turn is required if river is set',
      errorFields: { turn: true, river: true },
    };
  }
  if (f && !FLOP_REGEX.test(f)) {
    return {
      ok: false,
      message: 'Flop must be exactly 3 cards, e.g. As7d2c',
      errorFields: { flop: true },
    };
  }
  if (t && !SINGLE_CARD_REGEX.test(t)) {
    return {
      ok: false,
      message: 'Turn must be 1 card, e.g. Td',
      errorFields: { turn: true },
    };
  }
  if (r && !SINGLE_CARD_REGEX.test(r)) {
    return {
      ok: false,
      message: 'River must be 1 card, e.g. Jh',
      errorFields: { river: true },
    };
  }

  if (!f && !t && !r) {
    return { ok: true, board_structured: null };
  }
  return {
    ok: true,
    board_structured: { flop: f, turn: t || null, river: r || null },
  };
}
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;

type InputMode = 'text' | 'quick' | 'screenshot';
type Position = 'BTN' | 'CO' | 'MP' | 'UTG' | 'SB' | 'BB';
type GameOption = 'NLH' | 'PLO' | 'Unknown';

export default function QuickAnalyzeScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<InputMode>('text');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Text mode
  const [rawText, setRawText] = useState('');
  const [textSource, setTextSource] = useState<'manual' | 'ocr'>('manual');

  // Quick mode
  const [position, setPosition] = useState<Position | null>(null);
  const [heroCards, setHeroCards] = useState('');
  const [stackBb, setStackBb] = useState('');
  const [preflopAction, setPreflopAction] = useState('');
  const [boardFlop, setBoardFlop] = useState('');
  const [boardTurn, setBoardTurn] = useState('');
  const [boardRiver, setBoardRiver] = useState('');
  const [boardErrorFields, setBoardErrorFields] = useState<{ flop?: boolean; turn?: boolean; river?: boolean }>({});

  // Screenshot mode
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrTruncatedWarning, setOcrTruncatedWarning] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [ocrAutoAnalyzing, setOcrAutoAnalyzing] = useState(false);

  // Extract fields (OCR → quick form)
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractHint, setExtractHint] = useState(false);
  const [quickFormSource, setQuickFormSource] = useState<'manual' | 'ocr_extract'>('manual');
  const [gameOption, setGameOption] = useState<GameOption>('Unknown');
  const [stakes, setStakes] = useState('');
  const [lowConfidenceHighlight, setLowConfidenceHighlight] = useState(false);

  // Coach style selection (local to this analysis)
  const [selectedCoachStyle, setSelectedCoachStyle] = useState<CoachStyle>('MENTAL');

  // Quick Form defaults (load/save between sessions)
  const [quickFormDefaults, setQuickFormDefaults] = useState<QuickFormDefaults | null>(null);
  const [showUsingDefaultsMessage, setShowUsingDefaultsMessage] = useState(false);

  const positions: Position[] = ['BTN', 'CO', 'MP', 'UTG', 'SB', 'BB'];
  const coachStyles: CoachStyle[] = ['TOXIC', 'MENTAL', 'MATH'];

  // Load user's default coach style from profile on mount
  useEffect(() => {
    async function loadProfile() {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('coach_style')
        .maybeSingle<Pick<Profile, 'coach_style'>>();
      
      if (profileData?.coach_style) {
        setSelectedCoachStyle(profileData.coach_style as CoachStyle);
      }
    }
    loadProfile();
  }, []);

  // Load Auto-analyze preference from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(OCR_AUTO_ANALYZE_KEY).then((value) => {
      setAutoAnalyze(value === '1');
    });
  }, []);

  // Load Quick Form defaults on mount
  useEffect(() => {
    AsyncStorage.getItem(QUICK_FORM_DEFAULTS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as QuickFormDefaults;
        if (parsed && typeof parsed.game === 'string' && typeof parsed.stakesInputText === 'string' && typeof parsed.stackInputText === 'string') {
          setQuickFormDefaults({
            game: parsed.game === 'NLH' || parsed.game === 'PLO' ? parsed.game : 'Unknown',
            stakesInputText: parsed.stakesInputText.length > 32 ? parsed.stakesInputText.slice(0, 32) : parsed.stakesInputText,
            stackInputText: parsed.stackInputText,
            hero_pos: parsed.hero_pos && positions.includes(parsed.hero_pos) ? parsed.hero_pos : undefined,
          });
        }
      } catch {
        // ignore invalid stored data
      }
    });
  }, []);

  // Apply defaults when switching to Quick mode (only fill empty fields)
  useEffect(() => {
    if (mode !== 'quick' || !quickFormDefaults) return;
    let applied = false;
    if (gameOption === 'Unknown') {
      setGameOption(quickFormDefaults.game);
      applied = true;
    }
    if (stakes === '') {
      setStakes(quickFormDefaults.stakesInputText);
      applied = true;
    }
    if (stackBb === '') {
      setStackBb(quickFormDefaults.stackInputText);
      applied = true;
    }
    if (position === null && quickFormDefaults.hero_pos) {
      setPosition(quickFormDefaults.hero_pos);
      applied = true;
    }
    if (applied) {
      setShowUsingDefaultsMessage(true);
      const t = setTimeout(() => setShowUsingDefaultsMessage(false), 3000);
      return () => clearTimeout(t);
    }
  }, [mode, quickFormDefaults]);

  const setAutoAnalyzeAndPersist = (next: boolean) => {
    setAutoAnalyze(next);
    AsyncStorage.setItem(OCR_AUTO_ANALYZE_KEY, next ? '1' : '0');
  };

  async function pickScreenshot(useCamera: boolean) {
    if (useCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setError('Нужен доступ к камере');
        return;
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setError('Нужен доступ к галерее');
        return;
      }
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mime = asset.mimeType?.toLowerCase() ?? 'image/jpeg';
    if (!ALLOWED_IMAGE_TYPES.includes(mime as any)) {
      setError('Только JPEG и PNG');
      return;
    }
    if ((asset.fileSize ?? 0) > MAX_IMAGE_BYTES) {
      Alert.alert('Слишком большое изображение', 'Максимум 6 МБ.');
      return;
    }

    setScreenshotUri(asset.uri);
    setError(null);
    setOcrLoading(true);

    try {
      await ensureSession();
      const formData = new FormData();
      formData.append('mode', 'hand_history');
      formData.append('file', {
        uri: asset.uri,
        name: asset.fileName ?? 'screenshot.jpg',
        type: mime,
      } as any);

      const data = await callEdgeOcr(formData);
      const extracted = typeof data?.text === 'string' ? data.text.trim() : '';
      const truncated = Boolean(data?.meta?.truncated);
      setRawText(extracted);
      setTextSource('ocr');
      setOcrTruncatedWarning(truncated);
      setMode('text');
      setScreenshotUri(null);

      // Auto-analyze: only when enabled, not truncated, and enough text
      if (autoAnalyze && !truncated && extracted.length >= 30) {
        setOcrAutoAnalyzing(true);
        try {
          await handleAnalyze(extracted, 'ocr');
        } finally {
          setOcrAutoAnalyzing(false);
        }
      }
    } catch (err: any) {
      if (err?.code === 'not_hand_history') {
        Alert.alert(
          'Не похоже на историю раздачи',
          'Попробуй другой скрин (история рук/HH).'
        );
        setError(null);
      } else {
        setError(err?.message ?? 'Ошибка распознавания');
      }
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleExtractFields() {
    const text = rawText.trim();
    if (!text) return;
    setExtractLoading(true);
    setError(null);
    try {
      await ensureSession();
      const result = await callEdgeParseHandText(text);
      if (result.ok) {
        const { hand, meta } = result;
        const pos = hand.hero_pos;
        if (positions.includes(pos as Position)) {
          setPosition(pos as Position);
        } else {
          setPosition(null);
        }
        const gameStr = (hand.game || '').toUpperCase();
        if (gameStr.includes('PLO')) setGameOption('PLO');
        else if (gameStr.includes('NL') || gameStr === 'NLH') setGameOption('NLH');
        else setGameOption('Unknown');
        const stakesRaw = (hand.stakes ?? '').trim();
        setStakes(stakesRaw.length > 32 ? stakesRaw.slice(0, 32) : stakesRaw);
        setStackBb(hand.effective_stack_bb != null ? String(hand.effective_stack_bb) : '');
        setPreflopAction(hand.preflop || '');
        if (hand.board != null) {
          setBoardFlop(hand.board.flop ?? '');
          setBoardTurn(hand.board.turn ?? '');
          setBoardRiver(hand.board.river ?? '');
        } else {
          setBoardFlop('');
          setBoardTurn('');
          setBoardRiver('');
        }
        if (meta.confidence === 'LOW') {
          setLowConfidenceHighlight(true);
        } else {
          setLowConfidenceHighlight(false);
          setExtractHint(true);
        }
        setQuickFormSource('ocr_extract');
        setMode('quick');
      } else {
        if (__DEV__ && result.meta?.source_message) {
          console.log('[ai-parse-hand-text] ok:false', result.meta.source_message);
        }
        Alert.alert("Couldn't extract fields — use Text mode", result.error || 'unparseable');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Extract failed');
    } finally {
      setExtractLoading(false);
    }
  }

  async function handleAnalyze(overrideRawText?: string, overrideSource?: 'manual' | 'ocr') {
    const useOverride = overrideRawText !== undefined;

    // Validate input (skip when auto-analyzing with override text)
    if (!useOverride) {
      if (mode === 'text' && !rawText.trim()) {
        setError('Введите текст раздачи');
        return;
      }
      if (mode === 'quick') {
        if (!preflopAction.trim()) {
          Alert.alert('Preflop action is required');
          return;
        }
        const stackResult = parseEffectiveStackBb(stackBb);
        if (!stackResult.ok) {
          Alert.alert('Stack', stackResult.message);
          return;
        }
        const boardValidation = validateBoardFields(boardFlop, boardTurn, boardRiver);
        if (!boardValidation.ok) {
          setBoardErrorFields(boardValidation.errorFields ?? {});
          Alert.alert('Board', boardValidation.message);
          return;
        }
        setBoardErrorFields({});
      }
    }

    setLoading(true);
    setError(null);

    try {
      await ensureSession();
      console.log('[Analyze] about to invoke, session ok');

      let input: Record<string, unknown>;

      if (useOverride || mode === 'text') {
        const textToUse = useOverride ? overrideRawText!.trim() : rawText.trim();
        const source = overrideSource ?? textSource;
        input = { raw_text: textToUse, source };
      } else {
        const heroPos = position || 'UNKNOWN';
        const stackResult = parseEffectiveStackBb(stackBb);
        const stackNum = stackResult.ok ? stackResult.value : null;
        const preflop = preflopAction.trim();
        const boardValidation = validateBoardFields(boardFlop, boardTurn, boardRiver);
        const boardStructured = boardValidation.ok ? boardValidation.board_structured : null;
        const stakesCleaned = stakes.trim();
        const stakesPayload = stakesCleaned === '' ? null : stakesCleaned.length > 32 ? stakesCleaned.slice(0, 32) : stakesCleaned;
        const gamePayload = gameOption === 'Unknown' ? undefined : gameOption;

        input = {
          mode: 'quick_form',
          game: gamePayload,
          stakes: stakesPayload ?? undefined,
          hero_pos: heroPos,
          effective_stack_bb: stackNum,
          streets: {
            preflop: preflop,
            flop: '',
            turn: '',
            river: '',
          },
          board_structured: boardStructured,
          source: quickFormSource,
          position: heroPos !== 'UNKNOWN' ? heroPos : undefined,
          hero_cards: heroCards.trim() || undefined,
          stack_bb: stackNum,
          action_preflop: preflop,
        };
      }

      // Call Edge Function
      const data = await callEdge('ai-analyze-hand', {
        input,
        coach_style: selectedCoachStyle,
      });

      const analysisId = data.analysis_id;

      // Save Quick Form defaults when analyze succeeded from Quick mode
      if (mode === 'quick') {
        const defaultsToSave: QuickFormDefaults = {
          game: gameOption,
          stakesInputText: stakes.trim().length > 32 ? stakes.trim().slice(0, 32) : stakes.trim(),
          stackInputText: stackBb,
          ...(position ? { hero_pos: position } : {}),
        };
        AsyncStorage.setItem(QUICK_FORM_DEFAULTS_KEY, JSON.stringify(defaultsToSave)).catch(() => {});
      }

      // Navigate to hand detail screen
      router.replace(`/hand/${analysisId}`);
    } catch (err: any) {
      console.error('[Analyze] invoke error raw:', err);

      // Handle session creation failure
      if (err?.message === 'Failed to create session') {
        setError('Не удалось создать сессию. Перезапусти приложение.');
        return;
      }

      setError(err?.message ?? 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenWrapper>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <AppText variant="body" color="#4C9AFF">← Назад</AppText>
            </TouchableOpacity>
            <AppText variant="h1" style={styles.title}>Разобрать руку</AppText>
          </View>

          {/* Coach style selector */}
          <Card style={styles.card}>
            <AppText variant="h3" style={styles.cardTitle}>Стиль тренера для этого разбора</AppText>
            <View style={styles.coachStyleGrid}>
              {coachStyles.map((style) => (
                <TouchableOpacity
                  key={style}
                  style={[
                    styles.coachStyleButton,
                    selectedCoachStyle === style && styles.coachStyleButtonActive,
                  ]}
                  onPress={() => setSelectedCoachStyle(style)}
                  disabled={loading}
                >
                  <AppText
                    variant="body"
                    color={selectedCoachStyle === style ? '#FFFFFF' : '#A7B0C0'}
                    style={styles.coachStyleButtonText}
                  >
                    {style}
                  </AppText>
                </TouchableOpacity>
              ))}
            </View>
            <AppText variant="caption" style={styles.coachStyleCaption}>
              Это не изменит твой основной стиль в профиле.
            </AppText>
          </Card>

          {/* Mode toggle */}
          <View style={styles.modeToggleContainer}>
            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === 'text' && styles.modeButtonActive,
              ]}
              onPress={() => { setMode('text'); setExtractHint(false); }}
            >
              <AppText
                variant="body"
                color={mode === 'text' ? '#FFFFFF' : '#A7B0C0'}
                style={styles.modeButtonText}
              >
                Текст
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === 'quick' && styles.modeButtonActive,
              ]}
              onPress={() => { setMode('quick'); setOcrTruncatedWarning(false); setExtractHint(false); setQuickFormSource('manual'); setLowConfidenceHighlight(false); }}
            >
              <AppText
                variant="body"
                color={mode === 'quick' ? '#FFFFFF' : '#A7B0C0'}
                style={styles.modeButtonText}
              >
                Быстро
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === 'screenshot' && styles.modeButtonActive,
              ]}
              onPress={() => { setMode('screenshot'); setOcrTruncatedWarning(false); }}
            >
              <AppText
                variant="body"
                color={mode === 'screenshot' ? '#FFFFFF' : '#A7B0C0'}
                style={styles.modeButtonText}
              >
                Скриншот
              </AppText>
            </TouchableOpacity>
          </View>

          {/* Text mode */}
          {mode === 'text' && (
            <Card style={styles.card}>
              <AppText variant="h3" style={styles.cardTitle}>Вставь текст раздачи</AppText>
              <TextInput
                style={styles.textInput}
                multiline
                numberOfLines={8}
                placeholder="Пример:&#10;BTN открывает 2.5BB, у меня AhKd на CO&#10;Флоп: As7d2c&#10;Стек 100BB"
                placeholderTextColor="#65708A"
                value={rawText}
                onChangeText={(t) => {
                  setRawText(t);
                  setTextSource('manual');
                }}
                editable={!loading}
              />
              {ocrAutoAnalyzing && (
                <AppText variant="caption" style={styles.ocrAnalyzingStatus}>
                  OCR done → analyzing…
                </AppText>
              )}
              {ocrTruncatedWarning && (
                <AppText variant="caption" style={styles.truncatedWarning}>
                  Text truncated — review first
                </AppText>
              )}
              {rawText.trim().length > 0 && (
                <TouchableOpacity
                  style={[styles.extractButton, extractLoading && styles.extractButtonDisabled]}
                  onPress={handleExtractFields}
                  disabled={extractLoading}
                >
                  {extractLoading ? (
                    <ActivityIndicator color="#4C9AFF" size="small" />
                  ) : (
                    <AppText variant="body" color="#4C9AFF" style={styles.extractButtonText}>
                      Extract fields
                    </AppText>
                  )}
                </TouchableOpacity>
              )}
            </Card>
          )}

          {/* Screenshot mode */}
          {mode === 'screenshot' && (
            <Card style={styles.card}>
              <AppText variant="h3" style={styles.cardTitle}>Скриншот раздачи</AppText>
              <View style={styles.autoAnalyzeRow}>
                <AppText variant="body" style={styles.autoAnalyzeLabel}>Auto-analyze</AppText>
                <Switch
                  value={autoAnalyze}
                  onValueChange={setAutoAnalyzeAndPersist}
                  trackColor={{ false: '#2A2E36', true: 'rgba(76, 154, 255, 0.5)' }}
                  thumbColor={autoAnalyze ? '#4C9AFF' : '#A7B0C0'}
                />
              </View>
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={() => pickScreenshot(false)}
                disabled={ocrLoading}
              >
                {ocrLoading ? (
                  <ActivityIndicator color="#4C9AFF" />
                ) : (
                  <AppText variant="body" color="#4C9AFF" style={styles.uploadButtonText}>
                    Загрузить скриншот
                  </AppText>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.uploadButton, styles.uploadButtonSecondary]}
                onPress={() => pickScreenshot(true)}
                disabled={ocrLoading}
              >
                <AppText variant="body" color="#A7B0C0" style={styles.uploadButtonText}>
                  Сделать фото
                </AppText>
              </TouchableOpacity>
              {screenshotUri && !ocrLoading && (
                <View style={styles.previewWrap}>
                  <Image source={{ uri: screenshotUri }} style={styles.previewImage} resizeMode="cover" />
                </View>
              )}
              <AppText variant="caption" style={styles.screenshotHint}>
                После распознавания текст попадёт в режим «Текст» — можно отредактировать и нажать «Запустить разбор».
              </AppText>
            </Card>
          )}

          {/* Quick mode */}
          {mode === 'quick' && (
            <Card style={styles.card}>
              {extractHint && (
                <AppText variant="caption" style={styles.extractHint}>
                  Review fields before analyze.
                </AppText>
              )}
              {lowConfidenceHighlight && (
                <AppText variant="caption" style={styles.lowConfidenceHint}>
                  Low confidence — please review highlighted fields.
                </AppText>
              )}
              <AppText variant="h3" style={styles.cardTitle}>Быстрый ввод</AppText>
              {showUsingDefaultsMessage && (
                <AppText variant="caption" style={styles.usingDefaultsHint}>Using last defaults</AppText>
              )}

              {/* Game */}
              <View style={[styles.inputGroup, lowConfidenceHighlight && styles.inputGroupLowConfidence]}>
                <AppText variant="label" style={styles.inputLabel}>
                  ИГРА
                </AppText>
                <View style={styles.gameSegmented}>
                  {(['NLH', 'PLO', 'Unknown'] as const).map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[
                        styles.gameOptionButton,
                        gameOption === opt && styles.gameOptionButtonActive,
                      ]}
                      onPress={() => setGameOption(opt)}
                      disabled={loading}
                    >
                      <AppText
                        variant="body"
                        color={gameOption === opt ? '#FFFFFF' : '#A7B0C0'}
                        style={styles.gameOptionButtonText}
                      >
                        {opt}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Position */}
              <View style={[styles.inputGroup, lowConfidenceHighlight && styles.inputGroupLowConfidence]}>
                <AppText variant="label" style={styles.inputLabel}>
                  ПОЗИЦИЯ
                </AppText>
                <View style={styles.positionGrid}>
                  {positions.map((pos) => (
                    <TouchableOpacity
                      key={pos}
                      style={[
                        styles.positionButton,
                        position === pos && styles.positionButtonActive,
                      ]}
                      onPress={() => setPosition(pos)}
                      disabled={loading}
                    >
                      <AppText
                        variant="body"
                        color={position === pos ? '#FFFFFF' : '#A7B0C0'}
                        style={styles.positionButtonText}
                      >
                        {pos}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Hero cards */}
              <View style={styles.inputGroup}>
                <AppText variant="label" style={styles.inputLabel}>
                  ТВОИ КАРТЫ
                </AppText>
                <TextInput
                  style={styles.input}
                  placeholder="Например: AhKd или AK"
                  placeholderTextColor="#65708A"
                  value={heroCards}
                  onChangeText={setHeroCards}
                  editable={!loading}
                />
              </View>

              {/* Stack */}
              <View style={[styles.inputGroup, lowConfidenceHighlight && styles.inputGroupLowConfidence]}>
                <AppText variant="label" style={styles.inputLabel}>
                  СТЕК (BB)
                </AppText>
                <TextInput
                  style={styles.input}
                  placeholder="Например: 100 или 100bb"
                  placeholderTextColor="#65708A"
                  keyboardType="decimal-pad"
                  value={stackBb}
                  onChangeText={setStackBb}
                  editable={!loading}
                />
              </View>

              {/* Stakes */}
              <View style={[styles.inputGroup, lowConfidenceHighlight && styles.inputGroupLowConfidence]}>
                <AppText variant="label" style={styles.inputLabel}>
                  СТЕЙКИ (опционально)
                </AppText>
                <TextInput
                  style={styles.input}
                  placeholder="Например: $1/$2 или 10/20"
                  placeholderTextColor="#65708A"
                  value={stakes}
                  onChangeText={(t) => setStakes(t.length > 32 ? t.slice(0, 32) : t)}
                  editable={!loading}
                  maxLength={32}
                />
              </View>

              {/* Preflop action */}
              <View style={styles.inputGroup}>
                <AppText variant="label" style={styles.inputLabel}>
                  ДЕЙСТВИЯ ПРЕФЛОП
                </AppText>
                <TextInput
                  style={styles.input}
                  placeholder="Например: UTG открыл 2.5BB, я колл"
                  placeholderTextColor="#65708A"
                  value={preflopAction}
                  onChangeText={setPreflopAction}
                  editable={!loading}
                />
              </View>

              {/* Board: flop / turn / river */}
              <View style={[styles.inputGroup, lowConfidenceHighlight && styles.inputGroupLowConfidence]}>
                <AppText variant="label" style={styles.inputLabel}>
                  БОРД (опционально)
                </AppText>
                <TextInput
                  style={[styles.input, boardErrorFields.flop && styles.inputError]}
                  placeholder="Флоп, напр. As7d2c"
                  placeholderTextColor="#65708A"
                  value={boardFlop}
                  onChangeText={(t) => { setBoardFlop(t); setBoardErrorFields((prev) => ({ ...prev, flop: false })); }}
                  editable={!loading}
                />
                <TextInput
                  style={[styles.input, styles.boardStreetInput, boardErrorFields.turn && styles.inputError]}
                  placeholder="Тёрн, напр. Td"
                  placeholderTextColor="#65708A"
                  value={boardTurn}
                  onChangeText={(t) => { setBoardTurn(t); setBoardErrorFields((prev) => ({ ...prev, turn: false })); }}
                  editable={!loading}
                />
                <TextInput
                  style={[styles.input, styles.boardStreetInput, boardErrorFields.river && styles.inputError]}
                  placeholder="Ривер, напр. Jh"
                  placeholderTextColor="#65708A"
                  value={boardRiver}
                  onChangeText={(t) => { setBoardRiver(t); setBoardErrorFields((prev) => ({ ...prev, river: false })); }}
                  editable={!loading}
                />
                <AppText variant="caption" style={styles.boardHelperText}>
                  Format: flop As7d2c, turn Td, river Jh
                </AppText>
              </View>
            </Card>
          )}

          {/* Error */}
          {error && (
            <Card style={styles.errorCard}>
              <AppText variant="body" color="#F44336">{error}</AppText>
            </Card>
          )}

          {/* Analyze button */}
          <TouchableOpacity
            style={[styles.analyzeButton, loading && styles.analyzeButtonDisabled]}
            onPress={() => handleAnalyze()}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <AppText variant="body" color="#FFFFFF" style={styles.analyzeButtonText}>
                Запустить разбор
              </AppText>
            )}
          </TouchableOpacity>
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
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  modeButton: {
    flex: 1,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderColor: '#4C9AFF',
  },
  modeButtonText: {
    fontWeight: '600',
  },
  card: {
    padding: 20,
  },
  cardTitle: {
    fontSize: 18,
    marginBottom: 16,
  },
  textInput: {
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: '#FFFFFF',
    fontSize: 15,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    marginBottom: 8,
    color: '#A7B0C0',
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
  inputError: {
    borderColor: '#F44336',
  },
  boardStreetInput: {
    marginTop: 8,
  },
  boardHelperText: {
    color: '#65708A',
    marginTop: 6,
    fontSize: 12,
  },
  positionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  positionButton: {
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 60,
    alignItems: 'center',
  },
  positionButtonActive: {
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderColor: '#4C9AFF',
  },
  positionButtonText: {
    fontWeight: '600',
    fontSize: 14,
  },
  errorCard: {
    padding: 16,
    backgroundColor: '#1F1416',
    borderColor: '#F44336',
  },
  analyzeButton: {
    backgroundColor: '#4C9AFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  analyzeButtonDisabled: {
    opacity: 0.6,
  },
  analyzeButtonText: {
    fontWeight: '600',
    fontSize: 16,
  },
  coachStyleGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  coachStyleButton: {
    flex: 1,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  coachStyleButtonActive: {
    backgroundColor: 'rgba(244, 67, 54, 0.15)',
    borderColor: '#F44336',
  },
  coachStyleButtonText: {
    fontWeight: '600',
    fontSize: 15,
  },
  coachStyleCaption: {
    color: '#65708A',
    fontSize: 13,
    fontStyle: 'italic',
  },
  uploadButton: {
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderColor: '#4C9AFF',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadButtonSecondary: {
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  uploadButtonText: {
    fontWeight: '600',
  },
  previewWrap: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  previewImage: {
    width: 120,
    height: 120,
  },
  screenshotHint: {
    color: '#65708A',
    marginTop: 12,
    fontStyle: 'italic',
  },
  autoAnalyzeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  autoAnalyzeLabel: {
    color: '#E6E9EF',
  },
  ocrAnalyzingStatus: {
    color: '#4C9AFF',
    marginBottom: 8,
  },
  truncatedWarning: {
    color: '#FFA726',
    marginTop: 8,
    fontSize: 12,
  },
  extractButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(76, 154, 255, 0.12)',
    borderRadius: 12,
    alignItems: 'center',
  },
  extractButtonDisabled: {
    opacity: 0.7,
  },
  extractButtonText: {
    fontWeight: '600',
  },
  extractHint: {
    color: '#4C9AFF',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  lowConfidenceHint: {
    color: '#FFA726',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  usingDefaultsHint: {
    color: '#65708A',
    marginTop: -8,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  inputGroupLowConfidence: {
    borderWidth: 1,
    borderColor: 'rgba(255, 167, 38, 0.6)',
    borderRadius: 12,
    padding: 8,
    marginBottom: 8,
  },
  gameSegmented: {
    flexDirection: 'row',
    gap: 8,
  },
  gameOptionButton: {
    flex: 1,
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  gameOptionButtonActive: {
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderColor: '#4C9AFF',
  },
  gameOptionButtonText: {
    fontWeight: '600',
    fontSize: 14,
  },
});
