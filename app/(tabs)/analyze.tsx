import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, ActivityIndicator, Modal, ScrollView, Share, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { PrimaryRoundButton } from '../../components/PrimaryRoundButton';
import { supabase } from '../../lib/supabase';
import { HandAnalysisResult } from '../../types/hand';

/** Stored input shape: text mode has raw_text + source; quick_form has mode + source + streets/hero_pos/stakes */
type StoredInput = {
  mode?: 'quick_form';
  source?: 'manual' | 'ocr' | 'ocr_extract' | null;
  raw_text?: string;
  hero_pos?: string | null;
  stakes?: string | null;
  game?: string | null;
  effective_stack_bb?: number | null;
  streets?: { preflop?: string; flop?: string; turn?: string; river?: string } | null;
  board_structured?: { flop: string; turn?: string | null; river?: string | null } | null;
  [key: string]: unknown;
};

const PROMPT_MAX_LENGTH = 6000;

/** Build canonical prompt text for copy (debug/support). raw_text → as-is; quick_form → structured lines. */
function getCanonicalPromptText(input: StoredInput | null): string {
  if (!input) return '';
  if (input.raw_text) {
    const t = input.raw_text.trim();
    if (t.length <= PROMPT_MAX_LENGTH) return t;
    return t.slice(0, PROMPT_MAX_LENGTH) + '\n[TRUNCATED]';
  }
  if (input.mode === 'quick_form') {
    const source = input.source === 'ocr_extract' ? 'ocr_extract' : input.source === 'manual' ? 'manual' : '...';
    const game = (input.game && String(input.game).trim()) || 'UNKNOWN';
    const stakes = (input.stakes && String(input.stakes).trim()) || 'null';
    const heroPos = (input.hero_pos && String(input.hero_pos).trim()) || 'UNKNOWN';
    const stackBb = input.effective_stack_bb != null ? String(input.effective_stack_bb) : 'null';
    const streets = input.streets ?? {};
    const preflop = (streets.preflop && String(streets.preflop).trim()) || '';
    const flop = (streets.flop && String(streets.flop).trim()) || 'null';
    const turn = (streets.turn && String(streets.turn).trim()) || 'null';
    const river = (streets.river && String(streets.river).trim()) || 'null';
    const bs = input.board_structured;
    const boardLine = bs
      ? `Board: Flop ${bs.flop || '—'}, Turn ${bs.turn ?? '—'}, River ${bs.river ?? '—'}`
      : '';
    const lines = [
      `Mode: QUICK_FORM (source=${source})`,
      `Game: ${game}, Stakes: ${stakes}`,
      `Hero position: ${heroPos}, Effective stack: ${stackBb} bb`,
      `Preflop: ${preflop || '(empty)'}`,
      `Flop: ${flop}`,
      `Turn: ${turn}`,
      `River: ${river}`,
      ...(boardLine ? [boardLine] : []),
    ];
    const text = lines.join('\n');
    if (text.length <= PROMPT_MAX_LENGTH) return text;
    return text.slice(0, PROMPT_MAX_LENGTH) + '\n[TRUNCATED]';
  }
  return '';
}

type AnalysisRecord = {
  id: string;
  input: StoredInput | null;
  result: HandAnalysisResult;
  created_at: string;
};

/** Derive display source from stored input. Manual = text manual OR quick_form manual; OCR = text ocr; Extract = quick_form ocr_extract. */
function getSource(input: StoredInput | null): 'manual' | 'ocr' | 'ocr_extract' | null {
  if (!input) return null;
  if (input.mode === 'quick_form') {
    const s = input.source;
    return s === 'ocr_extract' ? 'ocr_extract' : s === 'manual' ? 'manual' : null;
  }
  const s = input.source;
  return s === 'ocr' ? 'ocr' : s === 'manual' ? 'manual' : null;
}

/** Build searchable haystack: raw_text or quick_form streets + hero_pos + stakes (case-insensitive match). */
function getSearchHaystack(record: AnalysisRecord): string {
  const input = record.input;
  if (!input) return '';
  if (input.raw_text) return input.raw_text;
  if (input.mode === 'quick_form') {
    const streets = input.streets ?? {};
    const parts = [
      streets.preflop ?? '',
      streets.flop ?? '',
      streets.turn ?? '',
      streets.river ?? '',
      input.hero_pos ?? '',
      input.stakes ?? '',
    ].filter(Boolean);
    return parts.join(' ');
  }
  return '';
}

type SourceFilter = 'all' | 'manual' | 'ocr' | 'ocr_extract';

const SOURCE_LABELS: Record<Exclude<SourceFilter, 'all'>, string> = {
  manual: 'Manual',
  ocr: 'OCR',
  ocr_extract: 'Extract',
};

const DEBOUNCE_MS = 250;

type LibraryMode = 'active' | 'trash';

export default function AnalyzeScreen() {
  const router = useRouter();
  const [libraryMode, setLibraryMode] = useState<LibraryMode>('active');
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [leakFilter, setLeakFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewItem, setPreviewItem] = useState<AnalysisRecord | null>(null);
  const previewSlideAnim = useRef(new Animated.Value(300)).current;
  const [undoSnackbarVisible, setUndoSnackbarVisible] = useState(false);
  const [lastDeletedRecord, setLastDeletedRecord] = useState<AnalysisRecord | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restoredSnackbarVisible, setRestoredSnackbarVisible] = useState(false);
  const restoredSnackbarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadHistoryCountRef = useRef(0);

  const loadHistory = useCallback(async (mode: LibraryMode) => {
    if (__DEV__) {
      loadHistoryCountRef.current++;
      console.log(`[Analyze] loadHistory #${loadHistoryCountRef.current} mode=${mode}`);
    }
    setLoadingHistory(true);
    try {
      const { data, error: historyError } = await supabase
        .from('hand_analyses')
        .select('id, input, result, created_at')
        .eq('is_deleted', mode === 'trash')
        .order('created_at', { ascending: false })
        .limit(20);

      if (historyError) throw historyError;

      setHistory((data || []) as AnalysisRecord[]);
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory(libraryMode);
  }, [libraryMode, loadHistory]);

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      if (restoredSnackbarTimeoutRef.current) clearTimeout(restoredSnackbarTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const uniqueLeakTags = useMemo(() => {
    const tags = history
      .map((r) => r.result?.leak_link?.tag)
      .filter((t): t is string => Boolean(t));
    return Array.from(new Set(tags)).sort();
  }, [history]);

  const filteredHistory = useMemo(() => {
    let list = history;
    if (sourceFilter !== 'all') {
      list = list.filter((record) => getSource(record.input) === sourceFilter);
    }
    if (leakFilter !== 'all') {
      list = list.filter((record) => record.result?.leak_link?.tag === leakFilter);
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((record) => getSearchHaystack(record).toLowerCase().includes(q));
    }
    return list;
  }, [history, sourceFilter, leakFilter, debouncedSearch]);

  const hasActiveFilters = sourceFilter !== 'all' || leakFilter !== 'all' || searchQuery.trim() !== '';

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setLeakFilter('all');
    setSourceFilter('all');
    setLibraryMode('active');
  }, []);

  const openPreview = useCallback((item: AnalysisRecord) => {
    setPreviewItem(item);
    setPreviewVisible(true);
    Animated.spring(previewSlideAnim, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 }).start();
  }, [previewSlideAnim]);

  const closePreview = useCallback(() => {
    Animated.timing(previewSlideAnim, { toValue: 300, duration: 200, useNativeDriver: true }).start(() => {
      setPreviewVisible(false);
      setPreviewItem(null);
      previewSlideAnim.setValue(300);
    });
  }, [previewSlideAnim]);

  const openFullAnalysis = useCallback(() => {
    if (previewItem) {
      closePreview();
      router.push(`/hand/${previewItem.id}`);
    }
  }, [previewItem, closePreview, router]);

  const copyPrompt = useCallback(async () => {
    if (!previewItem?.input) return;
    const text = getCanonicalPromptText(previewItem.input);
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied');
  }, [previewItem]);

  const sharePrompt = useCallback(async () => {
    if (!previewItem?.input) return;
    const text = getCanonicalPromptText(previewItem.input);
    if (!text) return;
    try {
      await Share.share({ message: text });
    } catch (e) {
      console.warn('Share prompt failed', e);
    }
  }, [previewItem]);

  const handleDeleteAnalysis = useCallback(() => {
    if (!previewItem) return;
    const id = previewItem.id;
    const recordToDelete: AnalysisRecord = { ...previewItem };
    Alert.alert(
      'Delete analysis?',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            closePreview();
            setHistory((prev) => prev.filter((r) => r.id !== id));
            setLastDeletedRecord(recordToDelete);
            setUndoSnackbarVisible(true);
            if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
            undoTimeoutRef.current = setTimeout(() => {
              setUndoSnackbarVisible(false);
              setLastDeletedRecord(null);
              undoTimeoutRef.current = null;
            }, 5000);

            const { error } = await supabase
              .from('hand_analyses')
              // @ts-expect-error Supabase types infer Update as never; is_deleted is valid in DB
              .update({ is_deleted: true })
              .eq('id', id);
            if (error) {
              if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
              setUndoSnackbarVisible(false);
              setLastDeletedRecord(null);
              Alert.alert("Couldn't delete");
              loadHistory(libraryMode);
            }
          },
        },
      ]
    );
  }, [previewItem, closePreview, libraryMode, loadHistory]);

  const handleUndoDelete = useCallback(async () => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    const record = lastDeletedRecord;
    setUndoSnackbarVisible(false);
    setLastDeletedRecord(null);
    if (!record) return;
    const { error } = await supabase
      .from('hand_analyses')
      // @ts-expect-error Supabase types infer Update as never; is_deleted is valid in DB
      .update({ is_deleted: false })
      .eq('id', record.id);
    if (error) {
      Alert.alert("Couldn't restore");
      loadHistory('active');
      return;
    }
    setHistory((prev) => {
      const next = [...prev, record].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return next;
    });
  }, [lastDeletedRecord]);

  const handleRestoreAnalysis = useCallback(() => {
    if (!previewItem) return;
    const id = previewItem.id;
    closePreview();
    setHistory((prev) => prev.filter((r) => r.id !== id));
    setRestoredSnackbarVisible(true);
    if (restoredSnackbarTimeoutRef.current) clearTimeout(restoredSnackbarTimeoutRef.current);
    restoredSnackbarTimeoutRef.current = setTimeout(() => {
      setRestoredSnackbarVisible(false);
      restoredSnackbarTimeoutRef.current = null;
    }, 2500);

    supabase
      .from('hand_analyses')
      // @ts-expect-error Supabase types infer Update as never; is_deleted is valid in DB
      .update({ is_deleted: false })
      .eq('id', id)
      .then(({ error }) => {
        if (error) {
          if (restoredSnackbarTimeoutRef.current) clearTimeout(restoredSnackbarTimeoutRef.current);
          setRestoredSnackbarVisible(false);
          Alert.alert("Couldn't restore");
          loadHistory(libraryMode);
        }
      });
  }, [previewItem, closePreview, libraryMode, loadHistory]);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 1) return 'только что';
    if (hours < 24) return `${hours}ч назад`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}д назад`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  const filters: SourceFilter[] = ['all', 'manual', 'ocr', 'ocr_extract'];

  return (
    <ScreenWrapper>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <View style={styles.header}>
            <AppText variant="caption" color="#A7B0C0">AI Poker Coach</AppText>
            <AppText variant="h1" style={styles.title}>Разбор рук</AppText>
          </View>

          {/* AI Insight Card */}
          <Card style={styles.insightCard}>
            <AppText variant="h3" style={styles.insightTitle}>💡 AI Insight</AppText>
            <AppText variant="body" style={styles.insightText}>
              Нажми на круглую кнопку, чтобы разобрать новую руку.
              AI проанализирует твою игру с учётом позиции, стека и истории ошибок.
            </AppText>
          </Card>

          {/* Hand Library */}
          <View style={styles.historySection}>
            <AppText variant="h3" style={styles.historyTitle}>Hand Library</AppText>

            {/* Active / Trash */}
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeChip, libraryMode === 'active' && styles.modeChipActive]}
                onPress={() => setLibraryMode('active')}
                activeOpacity={0.7}
              >
                <AppText variant="label" color={libraryMode === 'active' ? '#FFFFFF' : '#A7B0C0'}>
                  Active
                </AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeChip, libraryMode === 'trash' && styles.modeChipActive]}
                onPress={() => setLibraryMode('trash')}
                activeOpacity={0.7}
              >
                <AppText variant="label" color={libraryMode === 'trash' ? '#FFFFFF' : '#A7B0C0'}>
                  Trash
                </AppText>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.searchInput}
              placeholder="Search hands…"
              placeholderTextColor="#6B7280"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* Leak: All / tag1 / tag2 … */}
            {uniqueLeakTags.length > 0 && (
              <View style={styles.leakLabelRow}>
                <AppText variant="label" color="#A7B0C0">Leak</AppText>
              </View>
            )}
            {uniqueLeakTags.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.leakScroll}
                contentContainerStyle={styles.leakScrollContent}
              >
                <TouchableOpacity
                  style={[styles.filterChip, leakFilter === 'all' && styles.filterChipActive]}
                  onPress={() => setLeakFilter('all')}
                  activeOpacity={0.7}
                >
                  <AppText variant="label" color={leakFilter === 'all' ? '#FFFFFF' : '#A7B0C0'}>
                    All
                  </AppText>
                </TouchableOpacity>
                {uniqueLeakTags.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.filterChip, leakFilter === tag && styles.filterChipActive]}
                    onPress={() => setLeakFilter(tag)}
                    activeOpacity={0.7}
                  >
                    <AppText variant="label" color={leakFilter === tag ? '#FFFFFF' : '#A7B0C0'}>
                      {tag}
                    </AppText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Filter: All / Manual / OCR / Extract */}
            <View style={styles.filterRow}>
              {filters.map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterChip, sourceFilter === f && styles.filterChipActive]}
                  onPress={() => setSourceFilter(f)}
                  activeOpacity={0.7}
                >
                  <AppText
                    variant="label"
                    color={sourceFilter === f ? '#FFFFFF' : '#A7B0C0'}
                  >
                    {f === 'all' ? 'All' : SOURCE_LABELS[f]}
                  </AppText>
                </TouchableOpacity>
              ))}
            </View>

            {loadingHistory ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            ) : filteredHistory.length === 0 ? (
              <Card style={styles.emptyCard}>
                <AppText variant="body" color="#A7B0C0" style={styles.emptyText}>
                  {hasActiveFilters
                    ? 'No results'
                    : libraryMode === 'trash'
                      ? 'Trash is empty'
                      : 'No analyses yet.'}
                </AppText>
                {(hasActiveFilters || libraryMode === 'trash') && (
                  <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters} activeOpacity={0.7}>
                    <AppText variant="label" color="#4C9AFF">Clear filters</AppText>
                  </TouchableOpacity>
                )}
              </Card>
            ) : (
              filteredHistory.map((record) => {
                const source = getSource(record.input);
                const title = record.result.leak_link?.tag ?? 'Hand analysis';
                const subtitle = [
                  source ? SOURCE_LABELS[source] ?? source : null,
                  formatDate(record.created_at),
                ].filter(Boolean).join(' · ');

                return (
                  <TouchableOpacity
                    key={record.id}
                    onPress={() => router.push(`/hand/${record.id}`)}
                    onLongPress={() => openPreview(record)}
                    activeOpacity={0.7}
                  >
                    <Card style={styles.historyCard}>
                      <View style={styles.historyCardRow}>
                        <View style={styles.historyCardLeft}>
                          <AppText variant="body" color="#FFFFFF" style={styles.historyAction}>
                            {title}
                          </AppText>
                          <AppText variant="caption" style={styles.historyDate}>
                            {subtitle}
                          </AppText>
                        </View>
                        <View style={styles.historyCardRight}>
                          {source != null && (
                            <View
                              style={[
                                styles.sourceBadge,
                                source === 'manual' && styles.sourceBadgeManual,
                                source === 'ocr' && styles.sourceBadgeOcr,
                                source === 'ocr_extract' && styles.sourceBadgeExtract,
                              ]}
                            >
                              <AppText variant="label" color="#FFFFFF">
                                {SOURCE_LABELS[source] ?? source}
                              </AppText>
                            </View>
                          )}
                        </View>
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      {/* Floating CTA Button */}
      <View style={styles.ctaContainer}>
        <PrimaryRoundButton onPress={() => router.push('/analyze/new')}>
          <AppText variant="h2" color="#FFFFFF">+</AppText>
        </PrimaryRoundButton>
      </View>

      {/* Undo delete snackbar */}
      {undoSnackbarVisible && (
        <View style={styles.undoSnackbar}>
          <AppText variant="body" color="#E5E7EB">Deleted</AppText>
          <TouchableOpacity style={styles.undoSnackbarButton} onPress={handleUndoDelete} activeOpacity={0.7}>
            <AppText variant="label" color="#4C9AFF">Undo</AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* Restored snackbar */}
      {restoredSnackbarVisible && (
        <View style={styles.undoSnackbar}>
          <AppText variant="body" color="#E5E7EB">Restored</AppText>
        </View>
      )}

      {/* Preview Modal (bottom sheet) */}
      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        onRequestClose={closePreview}
      >
        <TouchableOpacity
          style={styles.previewOverlay}
          activeOpacity={1}
          onPress={closePreview}
        >
          <Animated.View
            style={[styles.previewSheet, { transform: [{ translateY: previewSlideAnim }] }]}
            onStartShouldSetResponder={() => true}
          >
            {previewItem && (
              <>
                <View style={styles.previewHeader}>
                  <AppText variant="h3" style={styles.previewTitle}>
                    {previewItem.result?.leak_link?.tag ?? 'Hand analysis'}
                  </AppText>
                  <View style={styles.previewMeta}>
                    {getSource(previewItem.input) != null && (
                      <View
                        style={[
                          styles.sourceBadge,
                          getSource(previewItem.input) === 'manual' && styles.sourceBadgeManual,
                          getSource(previewItem.input) === 'ocr' && styles.sourceBadgeOcr,
                          getSource(previewItem.input) === 'ocr_extract' && styles.sourceBadgeExtract,
                        ]}
                      >
                        <AppText variant="label" color="#FFFFFF">
                          {SOURCE_LABELS[getSource(previewItem.input)!] ?? getSource(previewItem.input)}
                        </AppText>
                      </View>
                    )}
                    <AppText variant="caption" color="#A7B0C0">
                      {formatDate(previewItem.created_at)}
                    </AppText>
                  </View>
                </View>
                <ScrollView style={styles.previewBody} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  {previewItem.input?.raw_text ? (
                    <AppText variant="body" color="#E5E7EB" style={styles.previewText}>
                      {previewItem.input.raw_text.slice(0, 400)}
                      {previewItem.input.raw_text.length > 400 ? '…' : ''}
                    </AppText>
                  ) : previewItem.input?.mode === 'quick_form' ? (
                    <View style={styles.previewQuickForm}>
                      {(previewItem.input.hero_pos || previewItem.input.stakes) && (
                        <AppText variant="caption" color="#A7B0C0">
                          {[previewItem.input.hero_pos, previewItem.input.stakes].filter(Boolean).join(' · ')}
                        </AppText>
                      )}
                      {previewItem.input.streets?.preflop ? (
                        <AppText variant="body" color="#E5E7EB" style={styles.previewText}>
                          Preflop: {(previewItem.input.streets.preflop.slice(0, 240))}
                          {previewItem.input.streets.preflop.length > 240 ? '…' : ''}
                        </AppText>
                      ) : null}
                      {(() => {
                        const bs = previewItem.input.board_structured;
                        if (!bs) return <AppText variant="caption" color="#A7B0C0" style={styles.previewBoard}>Board: —</AppText>;
                        const parts: string[] = [];
                        if (bs.flop) parts.push(`Flop ${bs.flop}`);
                        if (bs.turn) parts.push(`Turn ${bs.turn}`);
                        if (bs.river) parts.push(`River ${bs.river}`);
                        return (
                          <AppText variant="caption" color="#A7B0C0" style={styles.previewBoard}>
                            {parts.join(' • ')}
                          </AppText>
                        );
                      })()}
                    </View>
                  ) : (
                    <AppText variant="body" color="#A7B0C0">No preview.</AppText>
                  )}
                </ScrollView>
                <View style={styles.previewActions}>
                  {libraryMode === 'active' && (
                    <TouchableOpacity style={styles.previewPrimaryButton} onPress={openFullAnalysis} activeOpacity={0.7}>
                      <AppText variant="label" color="#FFFFFF">Open full analysis</AppText>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.previewCopyButton}
                    onPress={copyPrompt}
                    activeOpacity={0.7}
                    disabled={!getCanonicalPromptText(previewItem.input)}
                  >
                    <AppText variant="label" color="#A7B0C0">Copy prompt</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.previewCopyButton}
                    onPress={sharePrompt}
                    activeOpacity={0.7}
                    disabled={!getCanonicalPromptText(previewItem.input)}
                  >
                    <AppText variant="label" color="#A7B0C0">Share prompt</AppText>
                  </TouchableOpacity>
                  {libraryMode === 'trash' ? (
                    <TouchableOpacity style={styles.previewRestoreButton} onPress={handleRestoreAnalysis} activeOpacity={0.7}>
                      <AppText variant="label" color="#FFFFFF">Restore</AppText>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.previewDeleteButton} onPress={handleDeleteAnalysis} activeOpacity={0.7}>
                      <AppText variant="label" color="#FFFFFF">Delete</AppText>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.previewSecondaryButton} onPress={closePreview} activeOpacity={0.7}>
                    <AppText variant="label" color="#A7B0C0">Close</AppText>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
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
  insightCard: {
    padding: 20,
    backgroundColor: 'rgba(76, 154, 255, 0.05)',
  },
  insightTitle: {
    fontSize: 18,
    marginBottom: 8,
  },
  insightText: {
    lineHeight: 22,
  },
  historySection: {
    marginTop: 8,
    gap: 12,
  },
  historyTitle: {
    fontSize: 20,
    marginBottom: 4,
  },
  searchInput: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: '#FFFFFF',
    fontSize: 15,
    marginBottom: 10,
  },
  leakLabelRow: {
    marginBottom: 4,
  },
  leakScroll: {
    maxHeight: 44,
    marginBottom: 8,
  },
  leakScrollContent: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modeChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  modeChipActive: {
    backgroundColor: '#4C9AFF',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterChipActive: {
    backgroundColor: '#4C9AFF',
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  historyCard: {
    padding: 16,
    marginBottom: 8,
  },
  historyCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyCardLeft: {
    flex: 1,
    gap: 4,
  },
  historyCardRight: {},
  historyAction: {
    fontSize: 18,
    fontWeight: '600',
  },
  historyDate: {
    fontSize: 12,
  },
  sourceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sourceBadgeManual: {
    backgroundColor: '#65708A',
  },
  sourceBadgeOcr: {
    backgroundColor: '#7B68EE',
  },
  sourceBadgeExtract: {
    backgroundColor: '#4A90A4',
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  ctaContainer: {
    position: 'absolute',
    bottom: 32,
    right: 20,
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  previewSheet: {
    backgroundColor: '#1A1D24',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  previewHeader: {
    marginBottom: 14,
    gap: 8,
  },
  previewTitle: {
    fontSize: 20,
  },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewBody: {
    marginBottom: 20,
    maxHeight: 200,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
  },
  previewQuickForm: {
    gap: 6,
  },
  previewBoard: {
    marginTop: 4,
  },
  previewActions: {
    gap: 10,
  },
  previewPrimaryButton: {
    backgroundColor: '#4C9AFF',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  previewCopyButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  previewDeleteButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#DC2626',
  },
  previewRestoreButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#16A34A',
  },
  previewSecondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  undoSnackbar: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2A2E36',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginHorizontal: 0,
  },
  undoSnackbarButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
