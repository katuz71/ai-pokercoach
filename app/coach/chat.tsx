import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import type { Voice } from 'expo-speech';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { callEdge } from '../../lib/edge';
import { ensureSession } from '../../lib/ensureSession';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

type CoachChatEvidence = {
  memory_ids: string[];
  message_ids: string[];
  tags: string[];
};

/** JSON response when edge returns non-streaming (e.g. error or fallback). */
type CoachChatJsonResponse = {
  thread_id: string;
  assistant_message: { id: string; content: string };
  evidence?: CoachChatEvidence;
};

/** SSE stream event: delta chunk. */
type StreamDeltaEvent = { delta: string };
/** SSE stream event: stream finished, message saved. Optional final_content = sanitized text to show in UI. */
type StreamDoneEvent = {
  done: true;
  thread_id: string;
  assistant_message_id: string;
  final_content?: string;
  evidence?: CoachChatEvidence;
};
/** SSE stream event: error during stream. */
type StreamErrorEvent = { error: string };
type StreamEvent = StreamDeltaEvent | StreamDoneEvent | StreamErrorEvent;

function isStreamDoneEvent(e: StreamEvent): e is StreamDoneEvent {
  return 'done' in e && e.done === true;
}
function isStreamErrorEvent(e: StreamEvent): e is StreamErrorEvent {
  return 'error' in e && typeof (e as StreamErrorEvent).error === 'string';
}
import { TopLeak } from '../../types/leaks';
import { ActionPlanItem } from '../../types/actionPlan';
import { formatCoachText } from '../../lib/textFormat';

/** Distance from bottom (px) within which we consider user "at bottom" for auto-scroll. */
const NEAR_BOTTOM_THRESHOLD_PX = 120;

/** Stream request timeout; on expiry we abort and show "Request timed out". */
const STREAM_TIMEOUT_MS = 45000;

const COACH_TTS_ENABLED_KEY = 'coach_tts_enabled';
const COACH_TTS_MODE_KEY = 'coach_tts_mode';

type TtsMode = 'auto' | 'manual';

const CYRILLIC_RATIO_THRESHOLD = 0.15;

/** Эвристика: если доля кириллических букв > порога → 'ru', иначе 'en'. */
function detectLanguage(text: string): 'ru' | 'en' {
  if (!text || !text.trim()) return 'en';
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return 'en';
  const cyrillic = (text.match(/[\u0400-\u04FF]/g) ?? []).length;
  return cyrillic / letters.length > CYRILLIC_RATIO_THRESHOLD ? 'ru' : 'en';
}

/** Rate по стилю: toxic быстрее, mental медленнее, math нейтрально. */
function getTtsRateForStyle(style: string): number {
  const s = (style || '').toUpperCase();
  if (s === 'TOXIC') return 1.05;
  if (s === 'MENTAL') return 0.95;
  return 1.0;
}

type ChatMessage = {
  id: string;
  role: 'user' | 'coach';
  text: string;
  createdAt: Date;
  evidence?: CoachChatEvidence;
};

/** Source message row in Evidence modal (from Supabase chat_messages). */
type EvidenceSourceMessage = {
  id: string;
  content: string;
  created_at: string;
  thread_id?: string;
};

export default function CoachChatScreen() {
  const router = useRouter();
  const { thread_id: paramThreadId } = useLocalSearchParams<{ thread_id?: string }>();
  const flatListRef = useRef<FlatList>(null);
  const { user } = useAuth();

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingThread, setLoadingThread] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [savingToMemory, setSavingToMemory] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [oldestMessageCursor, setOldestMessageCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stoppedPartialAssistantText, setStoppedPartialAssistantText] = useState<string | null>(null);
  const [stoppedLastUserMessageText, setStoppedLastUserMessageText] = useState<string | null>(null);
  const [evidenceModalVisible, setEvidenceModalVisible] = useState(false);
  const [evidenceModalEvidence, setEvidenceModalEvidence] = useState<CoachChatEvidence | null>(null);
  const [evidenceSourceMessages, setEvidenceSourceMessages] = useState<EvidenceSourceMessage[]>([]);
  const [evidenceSourceLoading, setEvidenceSourceLoading] = useState(false);
  const [todayShortcuts, setTodayShortcuts] = useState<ActionPlanItem[]>([]);
  const [loadingTodayShortcuts, setLoadingTodayShortcuts] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsMode, setTtsMode] = useState<TtsMode>('manual');
  const [messageIdWithTapHint, setMessageIdWithTapHint] = useState<string | null>(null);

  const isNearBottomRef = useRef(true);
  const ttsEnabledRef = useRef(false);
  const ttsModeRef = useRef<TtsMode>('manual');
  const inputTextRef = useRef('');
  const errorRef = useRef<string | null>(null);
  const pendingAutoSpeakRef = useRef<{ messageId: string; text: string; coachStyle: string } | null>(null);
  const scrollIntentRef = useRef(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const userDidStopRef = useRef(false);
  const partialStreamTextRef = useRef('');
  const loadingTodayShortcutsRef = useRef(false);
  const voicesCacheRef = useRef<Voice[] | null>(null);
  const coachStyleRef = useRef<string>('MENTAL');

  const ensureVoicesCached = useCallback(async () => {
    if (voicesCacheRef.current != null) return;
    try {
      const list = await Speech.getAvailableVoicesAsync();
      voicesCacheRef.current = list ?? [];
    } catch (e) {
      console.warn('[CoachChat] getAvailableVoicesAsync failed:', e);
      voicesCacheRef.current = [];
    }
  }, []);

  const speakCoachText = useCallback(
    async (
      text: string,
      coachStyle: string,
      callbacks?: { onDone?: () => void; onStopped?: () => void }
    ) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      try {
        await ensureVoicesCached();
        const language = detectLanguage(trimmed);
        const rate = getTtsRateForStyle(coachStyle);
        const voices = voicesCacheRef.current ?? [];
        const voice = voices.find((v) => (v.language || '').toLowerCase().startsWith(language));
        const options: Speech.SpeechOptions = {
          language: language === 'ru' ? 'ru-RU' : 'en-US',
          rate,
        };
        if (voice?.identifier) options.voice = voice.identifier;
        if (callbacks?.onDone) options.onDone = callbacks.onDone;
        if (callbacks?.onStopped) options.onStopped = callbacks.onStopped;
        Speech.speak(trimmed, options);
      } catch (e) {
        console.warn('[CoachChat] TTS failed:', e);
      }
    },
    [ensureVoicesCached]
  );

  /** In auto mode: when current speech ends, play pending if any. */
  const playPendingAutoSpeak = useCallback(() => {
    const pending = pendingAutoSpeakRef.current;
    if (!pending) return;
    pendingAutoSpeakRef.current = null;
    speakCoachText(pending.text, pending.coachStyle, {
      onDone: () => {
        playPendingAutoSpeak();
      },
    }).catch(() => {});
  }, [speakCoachText]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const scrollBottom = contentOffset.y + layoutMeasurement.height;
    const contentHeight = contentSize.height;
    const distanceFromBottom = contentHeight - scrollBottom;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    if (nearBottom !== isNearBottomRef.current) {
      isNearBottomRef.current = nearBottom;
      setShowJumpToBottom(!nearBottom);
    }
  };

  const scrollToEnd = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setShowJumpToBottom(false);
    isNearBottomRef.current = true;
  };

  useEffect(() => {
    if (messages.length === 0) return;
    if (!scrollIntentRef.current) return;
    if (isNearBottomRef.current) {
      const t = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
        scrollIntentRef.current = false;
      }, 50);
      return () => clearTimeout(t);
    }
    scrollIntentRef.current = false;
  }, [messages]);

  // Load thread and messages: by thread_id param or last thread
  const effectiveThreadId = typeof paramThreadId === 'string' ? paramThreadId : Array.isArray(paramThreadId) ? paramThreadId[0] : undefined;
  useEffect(() => {
    if (!user) {
      setLoadingThread(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await ensureSession();
        let targetId: string | undefined;
        if (effectiveThreadId) {
          const { data: thread } = await supabase
            .from('chat_threads')
            .select('id')
            .eq('id', effectiveThreadId)
            .maybeSingle();
          if (cancelled) return;
          targetId = (thread as { id: string } | null)?.id;
        } else {
          const { data: threads } = await supabase
            .from('chat_threads')
            .select('id')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false })
            .limit(1);
          if (cancelled) return;
          targetId = (threads?.[0] as { id: string } | undefined)?.id;
        }
        if (targetId) {
          setThreadId(targetId);
          const { data: rows } = await supabase
            .from('chat_messages')
            .select('id, role, content, created_at')
            .eq('thread_id', targetId)
            .order('created_at', { ascending: false })
            .limit(30);
          if (cancelled) return;
          const rawList = (rows ?? []) as { id: string; role: string; content: string; created_at: string }[];
          const list = rawList
            .map((r): ChatMessage => ({
              id: r.id,
              role: r.role === 'assistant' ? 'coach' : 'user',
              text: r.content,
              createdAt: new Date(r.created_at),
            }))
            .reverse();
          setMessages(list);
          setHasMoreMessages(rawList.length === 30);
          setOldestMessageCursor(list.length > 0 ? list[0].createdAt.toISOString() : null);
          if (list.length > 0) {
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
          }
        } else {
          setThreadId(null);
          setMessages([]);
          setHasMoreMessages(false);
          setOldestMessageCursor(null);
        }
      } catch (e) {
        if (!cancelled) console.warn('[CoachChat] Load thread failed:', e);
      } finally {
        if (!cancelled) setLoadingThread(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, effectiveThreadId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedEnabled, storedMode] = await Promise.all([
          AsyncStorage.getItem(COACH_TTS_ENABLED_KEY),
          AsyncStorage.getItem(COACH_TTS_MODE_KEY),
        ]);
        if (!cancelled) {
          setTtsEnabled(storedEnabled === '1');
          setTtsMode((storedMode === 'auto' || storedMode === 'manual') ? storedMode : 'manual');
        }
      } catch (e) {
        if (!cancelled) console.warn('[CoachChat] Load TTS pref failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  useEffect(() => {
    ttsModeRef.current = ttsMode;
  }, [ttsMode]);

  useEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  const openEvidenceModal = (evidence: CoachChatEvidence) => {
    setEvidenceModalEvidence(evidence);
    setEvidenceModalVisible(true);
    setEvidenceSourceMessages([]);
  };

  const closeEvidenceModal = () => {
    setEvidenceModalVisible(false);
    setEvidenceModalEvidence(null);
    setEvidenceSourceMessages([]);
  };

  // Fetch source messages when Evidence modal opens with message_ids (no thread filter — show sources from any thread)
  useEffect(() => {
    if (!evidenceModalVisible || !evidenceModalEvidence) return;
    const ids = evidenceModalEvidence.message_ids;
    if (!ids?.length) {
      setEvidenceSourceLoading(false);
      return;
    }
    let cancelled = false;
    setEvidenceSourceLoading(true);
    (async () => {
      try {
        let query = supabase
          .from('chat_messages')
          .select('id, content, created_at, thread_id')
          .in('id', ids);
        if (user?.id) {
          query = query.eq('user_id', user.id);
        }
        const { data: rows } = await query;
        if (cancelled) return;
        const list = (rows ?? []) as EvidenceSourceMessage[];
        list.sort((a, b) => {
          const ta = a.created_at ?? '';
          const tb = b.created_at ?? '';
          if (ta !== tb) return ta.localeCompare(tb);
          return (a.id ?? '').localeCompare(b.id ?? '');
        });
        setEvidenceSourceMessages(list);
      } catch (e) {
        if (!cancelled) console.warn('[CoachChat] Evidence source fetch failed:', e);
      } finally {
        if (!cancelled) setEvidenceSourceLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [evidenceModalVisible, user?.id, evidenceModalEvidence?.message_ids?.join(',')]);

  // Load today's action plan shortcuts (undone items, max 3, priority: analyze > drill > checkin)
  const loadTodayShortcuts = useCallback(async () => {
    if (!user) {
      setTodayShortcuts([]);
      return;
    }
    if (loadingTodayShortcutsRef.current) return;
    loadingTodayShortcutsRef.current = true;
    setLoadingTodayShortcuts(true);
    const today = new Date().toISOString().split('T')[0];
    try {
      const { data } = await supabase
        .from('action_plans')
        .select('id, period_start, period_end, items')
        .eq('user_id', user.id)
        .lte('period_start', today)
        .gte('period_end', today)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { id: string; period_start: string; period_end: string; items: ActionPlanItem[] } | null };
      const items = Array.isArray(data?.items) ? data.items : [];
      const undone = items.filter((i) => i.done === false);
      const typeOrder = (t: string | undefined) => {
        if (t === 'analyze') return 0;
        if (t === 'drill') return 1;
        if (t === 'checkin') return 2;
        return 3;
      };
      const sorted = [...undone].sort((a, b) => typeOrder(a.type) - typeOrder(b.type));
      setTodayShortcuts(sorted.slice(0, 3));
    } catch (e) {
      console.warn('[CoachChat] Today shortcuts load failed:', e);
      setTodayShortcuts([]);
    } finally {
      loadingTodayShortcutsRef.current = false;
      setLoadingTodayShortcuts(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadTodayShortcuts();
  }, [loadTodayShortcuts, effectiveThreadId]);

  useFocusEffect(
    useCallback(() => {
      loadTodayShortcuts();
    }, [loadTodayShortcuts])
  );

  /** Sync action plan (done by today's activity) then refresh Today shortcuts. Errors are logged only, no banner. */
  const syncActionPlanAndRefresh = useCallback(async () => {
    try {
      await callEdge('ai-sync-action-plan', {});
    } catch (e) {
      console.warn('[CoachChat] ai-sync-action-plan failed:', e);
    }
    await loadTodayShortcuts();
  }, [loadTodayShortcuts]);

  const scrollToMessageId = (messageId: string) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
    } else {
      Alert.alert(
        'Load older messages to find this source',
        'This message is not loaded yet. Tap "Load older" at the top of the chat, then try again.',
        [
          { text: 'OK' },
          { text: 'Load older', onPress: () => { loadOlderMessages(); } },
        ]
      );
    }
  };

  const loadOlderMessages = async () => {
    if (!threadId || oldestMessageCursor == null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data: rows } = await supabase
        .from('chat_messages')
        .select('id, role, content, created_at')
        .eq('thread_id', threadId)
        .lt('created_at', oldestMessageCursor)
        .order('created_at', { ascending: false })
        .limit(30);
      const rawList = (rows ?? []) as { id: string; role: string; content: string; created_at: string }[];
      const olderReversed = rawList
        .map((r): ChatMessage => ({
          id: r.id,
          role: r.role === 'assistant' ? 'coach' : 'user',
          text: r.content,
          createdAt: new Date(r.created_at),
        }))
        .reverse();
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const olderDeduped = olderReversed.filter((m) => !existingIds.has(m.id));
        return [...olderDeduped, ...prev];
      });
      if (olderReversed.length > 0) {
        setOldestMessageCursor(olderReversed[0].createdAt.toISOString());
      }
      setHasMoreMessages(rawList.length === 30);
    } catch (e) {
      console.warn('[CoachChat] Load older failed:', e);
    } finally {
      setLoadingOlder(false);
    }
  };

  const loadPersonalizationContext = async (): Promise<{
    coachStyle: string;
    systemContext: string;
    topLeaks: TopLeak[];
  }> => {
    let coachStyle = 'MENTAL';
    let topLeaks: TopLeak[] = [];
    let systemContextParts: string[] = [];

    try {
      // 1. Get coach_style from profiles
      if (user) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('coach_style')
          .eq('id', user.id)
          .maybeSingle();

        const profile = profileData as any;
        if (profile && profile.coach_style) {
          coachStyle = profile.coach_style.toUpperCase();
        }
      }

      systemContextParts.push(`Стиль тренера: ${coachStyle}`);

      // 2. Get top leaks from leak_summaries
      if (user) {
        const { data: leakData } = await supabase
          .from('leak_summaries')
          .select('summary')
          .eq('user_id', user.id)
          .order('period_end', { ascending: false })
          .limit(1)
          .maybeSingle();

        const leak = leakData as any;
        if (leak && leak.summary && leak.summary.top_leaks) {
          topLeaks = leak.summary.top_leaks.slice(0, 3) as TopLeak[];
          
          if (topLeaks.length > 0) {
            const leaksText = topLeaks
              .map((leak, idx) => `${idx + 1}) ${leak.tag} (${leak.count}x)`)
              .join(' ');
            systemContextParts.push(`Топ-ошибки: ${leaksText}`);
          }
        }
      }

      // 3. Retrieve memories (currently disabled - no embedding function available)
      // When embedding function is ready, add:
      // - Get embedding for user message
      // - Call supabase.rpc('match_coach_memory', {...})
      // - Add memory snippets to systemContextParts

      const systemContext = systemContextParts.join('\n');

      return { coachStyle, systemContext, topLeaks };
    } catch (err) {
      // Graceful degradation - return defaults
      console.warn('[CoachChat] Failed to load personalization:', err);
      return { 
        coachStyle, 
        systemContext: systemContextParts.join('\n'), 
        topLeaks 
      };
    }
  };

  const dismissErrorBanner = () => {
    setError(null);
    setPendingRetry(null);
    setStoppedPartialAssistantText(null);
    setStoppedLastUserMessageText(null);
  };

  /** Отправляет текст сообщения тренеру через ai-coach-chat и добавляет ответ в чат (stream или JSON). isRetry: не добавлять user bubble (уже в списке). isContinue: mode "continue" с continue_context, без user bubble и без user message в БД. */
  const sendMessageToCoach = async (
    messageText: string,
    isRetry = false,
    isContinue = false,
    continueContext?: { partial_assistant_text: string }
  ) => {
    const trimmed = messageText.trim();
    const isContinueMode = isContinue && continueContext && threadId;
    if (!isContinueMode && (!trimmed || loading)) return;
    if (isContinueMode && loading) return;

    if (!isRetry && !isContinue) {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        createdAt: new Date(),
      };
      scrollIntentRef.current = true;
      setMessages((prev) => [...prev, userMessage]);
    }
    setError(null);
    setPendingRetry(null);
    if (isContinue) {
      setStoppedPartialAssistantText(null);
      setStoppedLastUserMessageText(null);
    }
    setLoading(true);

    const ac = new AbortController();
    activeAbortControllerRef.current = ac;
    const timeoutId = setTimeout(() => ac.abort(), STREAM_TIMEOUT_MS);

    const fail = (errMsg: string, allowRetry: boolean) => {
      activeAbortControllerRef.current = null;
      setIsStreaming(false);
      clearTimeout(timeoutId);
      setError(errMsg);
      if (allowRetry) setPendingRetry(trimmed);
      setLoading(false);
      setLoadingContext(false);
    };

    try {
      await ensureSession();
      setLoadingContext(true);
      const { coachStyle } = await loadPersonalizationContext();
      coachStyleRef.current = coachStyle;
      setLoadingContext(false);

      const { data: session } = await supabase.auth.getSession();
      const userJwt = session.session?.access_token;
      if (!userJwt) {
        fail('No active session', !isRetry && !isContinue);
        return;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-coach-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'x-user-jwt': userJwt,
        },
        body: JSON.stringify(
          isContinueMode
            ? {
                thread_id: threadId,
                mode: 'continue',
                continue_context: { partial_assistant_text: continueContext!.partial_assistant_text },
                coach_style: coachStyle ?? undefined,
              }
            : {
                thread_id: threadId,
                message: trimmed,
                coach_style: coachStyle ?? undefined,
              }
        ),
        signal: ac.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        activeAbortControllerRef.current = null;
        setIsStreaming(false);
        let errMsg = `Coach chat ${response.status}`;
        try {
          const text = await response.text();
          const json = JSON.parse(text) as { error?: string; detail?: string };
          errMsg = [json.detail, json.error].filter(Boolean).join(' — ') || (text ? text.slice(0, 200) : errMsg);
        } catch {
          // non-JSON or empty body already handled in errMsg
        }
        fail(errMsg, !isRetry && !isContinue);
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream')) {
        const streamingId = `streaming-${Date.now()}`;
        scrollIntentRef.current = true;
        setMessages((prev) => [...prev, { id: streamingId, role: 'coach', text: '', createdAt: new Date() }]);

        const reader = response.body?.getReader();
        if (!reader) {
          activeAbortControllerRef.current = null;
          setIsStreaming(false);
          setError('Stream not supported');
          setMessages((prev) => prev.filter((m) => m.id !== streamingId));
          setLoading(false);
          setLoadingContext(false);
          if (!isRetry && !isContinue) setPendingRetry(trimmed);
          return;
        }
        partialStreamTextRef.current = '';
        setIsStreaming(true);
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() ?? '';
            for (const part of parts) {
              const line = part.split('\n').find((l) => l.startsWith('data: '));
              if (!line) continue;
              const raw = line.slice(6).trim();
              if (!raw) continue;
              let payload: StreamEvent;
              try {
                payload = JSON.parse(raw) as StreamEvent;
              } catch {
                continue;
              }
              if (isStreamErrorEvent(payload)) {
                activeAbortControllerRef.current = null;
                setIsStreaming(false);
                setError(payload.error);
                setMessages((prev) => prev.filter((m) => m.id !== streamingId));
                setLoading(false);
                setLoadingContext(false);
                if (!isRetry && !isContinue) setPendingRetry(trimmed);
                return;
              }
              if (isStreamDoneEvent(payload)) {
                activeAbortControllerRef.current = null;
                setIsStreaming(false);
                setThreadId((prev) => prev ?? payload.thread_id);
                setError(null);
                setPendingRetry(null);
                scrollIntentRef.current = true;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'coach' && last.id === streamingId) {
                    const text = typeof payload.final_content === 'string' ? payload.final_content : last.text;
                    next[next.length - 1] = {
                      ...last,
                      text,
                      id: payload.assistant_message_id,
                      evidence: payload.evidence,
                    };
                  }
                  return next;
                });
                const textToSpeak = typeof payload.final_content === 'string' ? payload.final_content : partialStreamTextRef.current;
                const assistantId = payload.assistant_message_id;
                if (ttsEnabledRef.current && typeof textToSpeak === 'string' && textToSpeak.trim()) {
                  const mode = ttsModeRef.current;
                  if (mode === 'manual') {
                    setMessageIdWithTapHint(null);
                  } else {
                    const mayAutoSpeak =
                      inputTextRef.current.trim().length === 0 &&
                      isNearBottomRef.current === true &&
                      errorRef.current == null;
                    if (!mayAutoSpeak) {
                      setMessageIdWithTapHint(assistantId);
                    } else {
                      setMessageIdWithTapHint(null);
                      Speech.isSpeakingAsync().then((speaking) => {
                        if (speaking) {
                          pendingAutoSpeakRef.current = {
                            messageId: assistantId,
                            text: textToSpeak.trim(),
                            coachStyle,
                          };
                        } else {
                          speakCoachText(textToSpeak.trim(), coachStyle, {
                            onDone: () => playPendingAutoSpeak(),
                          }).catch(() => {});
                        }
                      });
                    }
                  }
                } else {
                  setMessageIdWithTapHint(null);
                }
                setLoading(false);
                setLoadingContext(false);
                return;
              }
              if ('delta' in payload && typeof payload.delta === 'string') {
                scrollIntentRef.current = true;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'coach') {
                    const newText = last.text + payload.delta;
                    partialStreamTextRef.current = newText;
                    next[next.length - 1] = { ...last, text: newText };
                  }
                  return next;
                });
              }
            }
          }
        } catch (streamErr: unknown) {
          const isUserStop =
            streamErr instanceof Error && streamErr.name === 'AbortError' && userDidStopRef.current;
          if (isUserStop) {
            setError('Stopped');
            setPendingRetry(null);
            setStoppedPartialAssistantText(partialStreamTextRef.current);
            setStoppedLastUserMessageText(trimmed);
            // leave stream bubble with current text
          } else {
            const msg =
              streamErr instanceof Error && streamErr.name === 'AbortError'
                ? 'Request timed out'
                : streamErr instanceof Error
                  ? streamErr.message
                  : 'Stream error';
            setError(msg);
            setMessages((prev) => prev.filter((m) => m.id !== streamingId));
            if (!isRetry && !isContinue) setPendingRetry(trimmed);
          }
        } finally {
          clearTimeout(timeoutId);
          activeAbortControllerRef.current = null;
          setIsStreaming(false);
          userDidStopRef.current = false;
          setLoading(false);
          setLoadingContext(false);
        }
        return;
      }

      const responseJson = (await response.json()) as CoachChatJsonResponse | null;
      activeAbortControllerRef.current = null;
      if (responseJson?.thread_id) {
        setThreadId((prev) => prev ?? responseJson.thread_id);
      }
      if (responseJson?.assistant_message) {
        setError(null);
        setPendingRetry(null);
        const coachMessage: ChatMessage = {
          id: responseJson.assistant_message.id,
          role: 'coach',
          text: responseJson.assistant_message.content,
          createdAt: new Date(),
          evidence: responseJson.evidence,
        };
        scrollIntentRef.current = true;
        setMessages((prev) => [...prev, coachMessage]);
        const content = responseJson.assistant_message.content;
        const assistantId = responseJson.assistant_message.id;
        if (ttsEnabledRef.current && typeof content === 'string' && content.trim()) {
          const mode = ttsModeRef.current;
          if (mode === 'manual') {
            setMessageIdWithTapHint(null);
          } else {
            const mayAutoSpeak =
              inputTextRef.current.trim().length === 0 &&
              isNearBottomRef.current === true &&
              errorRef.current == null;
            if (!mayAutoSpeak) {
              setMessageIdWithTapHint(assistantId);
            } else {
              setMessageIdWithTapHint(null);
              Speech.isSpeakingAsync().then((speaking) => {
                if (speaking) {
                  pendingAutoSpeakRef.current = {
                    messageId: assistantId,
                    text: content.trim(),
                    coachStyle,
                  };
                } else {
                  speakCoachText(content.trim(), coachStyle, {
                    onDone: () => playPendingAutoSpeak(),
                  }).catch(() => {});
                }
              });
            }
          }
        } else {
          setMessageIdWithTapHint(null);
        }
      }
    } catch (err: unknown) {
      activeAbortControllerRef.current = null;
      setIsStreaming(false);
      const isUserStop =
        err instanceof Error && err.name === 'AbortError' && userDidStopRef.current;
      userDidStopRef.current = false;
      if (isUserStop) {
        setError('Stopped');
        setPendingRetry(null);
        setStoppedPartialAssistantText(partialStreamTextRef.current);
        setStoppedLastUserMessageText(trimmed);
        setLoading(false);
        setLoadingContext(false);
      } else {
        const msg =
          err instanceof Error && err.name === 'AbortError'
            ? 'Request timed out'
            : err instanceof Error
              ? err.message
              : 'Ошибка отправки сообщения';
        console.error('[CoachChat] Failed to send message:', err);
        fail(msg, !isRetry && !isContinue);
      }
    }
  };

  const continueAfterStop = () => {
    if (stoppedLastUserMessageText == null || loading || !threadId) return;
    const partial = stoppedPartialAssistantText ?? '';
    sendMessageToCoach('', false, true, { partial_assistant_text: partial });
  };

  const stopStreaming = () => {
    userDidStopRef.current = true;
    activeAbortControllerRef.current?.abort();
    pendingAutoSpeakRef.current = null;
    try {
      Speech.stop();
    } catch (e) {
      console.warn('[CoachChat] Speech.stop failed:', e);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || loading) return;
    const text = inputText.trim();
    setInputText('');
    await sendMessageToCoach(text);
  };

  const startRecording = async () => {
    try {
      console.log('[VoiceInput] Requesting permissions...');
      const permission = await Audio.requestPermissionsAsync();
      
      if (!permission.granted) {
        setError('Разрешение на запись аудио не предоставлено');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log('[VoiceInput] Starting recording...');
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(newRecording);
      setIsRecording(true);
      setError(null);
      console.log('[VoiceInput] Recording started');
    } catch (err: any) {
      console.error('[VoiceInput] Failed to start recording:', err);
      setError('Не удалось начать запись: ' + err.message);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      console.log('[VoiceInput] Stopping recording...');
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      const uri = recording.getURI();
      console.log('[VoiceInput] Recording stopped. URI:', uri);

      if (!uri) {
        setError('Не удалось получить аудио файл');
        setIsRecording(false);
        setRecording(null);
        return;
      }

      console.log('[VoiceInput] Sending audio file to transcription...');
      setLoading(true);
      
      await ensureSession();

      const { data: session } = await supabase.auth.getSession();
      const userJwt = session.session?.access_token;

      // Create FormData with audio file
      const formData = new FormData();
      formData.append('file', {
        uri,
        name: 'voice.m4a',
        type: 'audio/m4a',
      } as any);

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-request`,
        {
          method: 'POST',
          headers: {
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
            'x-user-jwt': userJwt ?? '',
          },
          body: formData,
        }
      );

      const raw = await response.text();
      const status = response.status;
      const contentType = response.headers.get('content-type') ?? '';

      if (__DEV__) {
        console.warn('[VoiceInput] ai-request response:', {
          status,
          contentType,
          rawPreview: raw.slice(0, 200),
        });
      }

      if (!response.ok) {
        throw new Error(`[ai-request ${status}] ${raw.slice(0, 200)}`);
      }

      let data: { text?: string };
      try {
        data = JSON.parse(raw) as { text?: string };
      } catch {
        throw new Error(`Non-JSON response from ai-request: ${raw.slice(0, 200)}`);
      }

      if (!data || typeof data.text !== 'string') {
        throw new Error(`Invalid JSON from ai-request: ${raw.slice(0, 200)}`);
      }

      const transcribedText = data.text;

      if (transcribedText.trim()) {
        setInputText(transcribedText.trim());
        console.log('[VoiceInput] Transcription success:', transcribedText);
      } else {
        setError('Не удалось распознать речь');
      }
    } catch (err: unknown) {
      console.error('[VoiceInput] Failed to process recording:', err);
      setError('Ошибка обработки записи: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsRecording(false);
      setRecording(null);
      setLoading(false);
    }
  };

  const saveToMemory = async () => {
    if (!threadId || savingToMemory) return;
    setSavingToMemory(true);
    try {
      await ensureSession();
      const res = await callEdge('ai-summarize-chat-thread', {
        thread_id: threadId,
        max_messages: 40,
      }) as { saved?: number; skipped?: number };
      const saved = typeof res?.saved === 'number' ? res.saved : 0;
      if (saved > 0) {
        Alert.alert('Память тренера', `Сохранено записей: ${saved}`);
      } else {
        Alert.alert('Память тренера', 'Нечего сохранять или ничего не подошло под критерии.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка сохранения';
      Alert.alert('Ошибка', msg);
    } finally {
      setSavingToMemory(false);
    }
  };

  const toggleVoiceInput = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const ev = item.role === 'coach' ? item.evidence : undefined;
    const hasMemory = (ev?.memory_ids?.length ?? 0) > 0;
    const hasMessageRefs = (ev?.message_ids?.length ?? 0) > 0;
    const tagList = ev?.tags?.filter(Boolean) ?? [];
    const tagsPreview = tagList.length > 0 ? tagList.slice(0, 2).join(', ') + (tagList.length > 2 ? ` +${tagList.length - 2}` : '') : '';

    return (
      <View style={[styles.messageContainer, isUser && styles.messageContainerUser]}>
        <Card
          style={[
            styles.messageBubble,
            isUser ? styles.messageBubbleUser : styles.messageBubbleCoach,
          ]}
        >
          <AppText variant="body" style={styles.messageText}>
            {isUser ? (
              item.text
            ) : item.text === '' && item.id.startsWith('streaming-') ? (
              <AppText variant="body" style={{ fontStyle: 'italic', opacity: 0.7 }}>…</AppText>
            ) : (
              formatCoachText(item.text).map((chunk, index) => (
                <AppText
                  key={index}
                  variant="body"
                  style={chunk.bold ? { fontWeight: '800' } : undefined}
                >
                  {chunk.text}
                </AppText>
              ))
            )}
          </AppText>
          {!isUser && ev ? (
            <TouchableOpacity
              style={styles.evidenceRow}
              onPress={() => openEvidenceModal(ev)}
              activeOpacity={0.7}
            >
              {hasMemory ? (
                <AppText variant="caption" style={styles.evidenceBadge}>
                  Основано на твоей памяти
                </AppText>
              ) : null}
              {!hasMemory && hasMessageRefs ? (
                <AppText variant="caption" style={styles.evidenceBadge}>
                  Источники
                </AppText>
              ) : null}
              {tagsPreview ? (
                <AppText variant="caption" style={styles.evidenceTags} numberOfLines={1}>
                  {hasMemory || hasMessageRefs ? ' · ' : ''}Tags: {tagsPreview}
                </AppText>
              ) : null}
            </TouchableOpacity>
          ) : null}
          {!isUser && ttsEnabled && item.text?.trim() ? (
            ttsMode === 'auto' && item.id === messageIdWithTapHint ? (
              <AppText variant="caption" style={styles.ttsHintText}>
                Tap 🔊 to play
              </AppText>
            ) : (
              <View style={styles.ttsRow}>
                <TouchableOpacity
                  style={styles.ttsButton}
                  onPress={async () => {
                    try {
                      Speech.stop();
                      pendingAutoSpeakRef.current = null;
                      setMessageIdWithTapHint(null);
                      await speakCoachText(item.text.trim(), coachStyleRef.current ?? 'MENTAL');
                    } catch (e) {
                      console.warn('[CoachChat] TTS failed:', e);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <AppText variant="caption" style={styles.ttsButtonText}>🔊 Play</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ttsButton}
                  onPress={() => {
                    try {
                      Speech.stop();
                    } catch (e) {
                      console.warn('[CoachChat] Speech.stop failed:', e);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <AppText variant="caption" style={styles.ttsButtonText}>⏹ Stop</AppText>
                </TouchableOpacity>
              </View>
            )
          ) : null}
          <AppText variant="caption" style={styles.messageTime}>
            {item.createdAt.toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </AppText>
        </Card>
      </View>
    );
  };

  return (
    <ScreenWrapper style={styles.wrapper}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <AppText variant="h3" color="#4C9AFF">
                ← Назад
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/coach/threads')} style={styles.chatsButton}>
              <AppText variant="h3" color="#4C9AFF">
                Chats
              </AppText>
            </TouchableOpacity>
            <AppText variant="h2" style={styles.title}>
              Coach Chat
            </AppText>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={async () => {
                const next = !ttsEnabled;
                setTtsEnabled(next);
                try {
                  await AsyncStorage.setItem(COACH_TTS_ENABLED_KEY, next ? '1' : '0');
                } catch (e) {
                  console.warn('[CoachChat] Save TTS pref failed:', e);
                }
              }}
              style={styles.voiceToggleButton}
            >
              <AppText variant="caption" color={ttsEnabled ? '#4C9AFF' : '#65708A'}>
                Voice
              </AppText>
            </TouchableOpacity>
            {ttsEnabled ? (
              <TouchableOpacity
                onPress={async () => {
                  const next: TtsMode = ttsMode === 'auto' ? 'manual' : 'auto';
                  setTtsMode(next);
                  try {
                    await AsyncStorage.setItem(COACH_TTS_MODE_KEY, next);
                  } catch (e) {
                    console.warn('[CoachChat] Save TTS mode failed:', e);
                  }
                }}
                style={styles.ttsModePill}
              >
                <AppText variant="caption" style={styles.ttsModePillText}>
                  {ttsMode === 'auto' ? 'Auto' : 'Manual'}
                </AppText>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={saveToMemory}
              disabled={!threadId || savingToMemory}
              style={styles.saveMemoryButton}
            >
              {savingToMemory ? (
                <ActivityIndicator color="#4C9AFF" size="small" />
              ) : (
                <AppText variant="caption" color="#4C9AFF">
                  В память
                </AppText>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setThreadId(null);
                setMessages([]);
                setError(null);
                setPendingRetry(null);
                setStoppedPartialAssistantText(null);
                setStoppedLastUserMessageText(null);
                setHasMoreMessages(false);
                setOldestMessageCursor(null);
                setMessageIdWithTapHint(null);
                pendingAutoSpeakRef.current = null;
              }}
              style={styles.newChatButton}
            >
              <AppText variant="caption" color="#4C9AFF">
                Новый чат
              </AppText>
            </TouchableOpacity>
          </View>
        </View>

        {/* Error Banner: compact, Retry (if pendingRetry), Dismiss */}
        {error != null && error !== '' && (
          <Card style={styles.errorBanner}>
            <AppText variant="body" style={styles.errorBannerText} numberOfLines={3}>
              {error}
            </AppText>
            <View style={styles.errorBannerActions}>
              {error === 'Stopped' && stoppedLastUserMessageText != null ? (
                <TouchableOpacity
                  onPress={continueAfterStop}
                  style={styles.errorBannerRetryButton}
                  disabled={loading}
                >
                  <AppText variant="label" color="#4C9AFF">Continue</AppText>
                </TouchableOpacity>
              ) : pendingRetry != null ? (
                <TouchableOpacity
                  onPress={() => {
                    const msg = pendingRetry;
                    setPendingRetry(null);
                    setError(null);
                    if (msg) sendMessageToCoach(msg, true);
                  }}
                  style={styles.errorBannerRetryButton}
                  disabled={loading}
                >
                  <AppText variant="label" color="#4C9AFF">Retry</AppText>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={dismissErrorBanner} style={styles.errorBannerDismissButton}>
                <AppText variant="label" color="#65708A">Dismiss</AppText>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Messages List + Jump to bottom */}
        <View style={styles.messagesListWrap}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            onScroll={handleScroll}
            scrollEventThrottle={80}
            contentContainerStyle={styles.messagesList}
            ListHeaderComponent={
            hasMoreMessages && messages.length > 0 ? (
              <View style={styles.loadOlderWrap}>
                <TouchableOpacity
                  onPress={loadOlderMessages}
                  disabled={loadingOlder}
                  style={styles.loadOlderButton}
                  activeOpacity={0.7}
                >
                  {loadingOlder ? (
                    <ActivityIndicator color="#4C9AFF" size="small" />
                  ) : (
                    <AppText variant="caption" style={styles.loadOlderText}>
                      Load older
                    </AppText>
                  )}
                </TouchableOpacity>
              </View>
            ) : null
          }
          ListEmptyComponent={
            loadingThread ? (
              <View style={styles.emptyContainer}>
                <ActivityIndicator color="#4C9AFF" size="small" />
                <AppText variant="caption" style={styles.emptyHint}>
                  Загрузка…
                </AppText>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <AppText variant="body" style={styles.emptyText}>
                  Задай вопрос тренеру
                </AppText>
                <AppText variant="caption" style={styles.emptyHint}>
                  Например: "Как правильно играть с парой на флопе?"
                </AppText>
              </View>
            )
          }
          />
          {showJumpToBottom && (
            <TouchableOpacity
              onPress={scrollToEnd}
              style={styles.jumpToBottomButton}
              activeOpacity={0.8}
            >
              <AppText style={styles.jumpToBottomIcon}>↓</AppText>
            </TouchableOpacity>
          )}
        </View>

        {/* Action Shortcuts — today's undone plan items (max 3) */}
        {(todayShortcuts.length > 0 || loadingTodayShortcuts) && (
          <View style={styles.todayShortcutsWrap}>
            <View style={styles.todayShortcutsHeader}>
              <AppText variant="caption" style={styles.todayShortcutsLabel}>
                Today
              </AppText>
              <TouchableOpacity
                onPress={loadTodayShortcuts}
                disabled={loadingTodayShortcuts}
                style={styles.todayShortcutsRefreshButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {loadingTodayShortcuts ? (
                  <ActivityIndicator color="#4C9AFF" size="small" />
                ) : (
                  <AppText style={styles.todayShortcutsRefreshIcon}>↻</AppText>
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.todayShortcutsRow}>
              {todayShortcuts.map((item) => {
                const type = item.type ?? 'manual';
                const label =
                  type === 'analyze' ? 'Analyze' : type === 'drill' ? 'Drill' : type === 'checkin' ? 'Check-in' : (item.text?.slice(0, 12) || 'Task');
                const onPress = async () => {
                  await syncActionPlanAndRefresh();
                  if (type === 'analyze') router.push('/analyze/new');
                  else if (type === 'drill') router.push('/(tabs)/train');
                  else if (type === 'checkin') router.push('/(tabs)/profile');
                  else router.push('/(tabs)/profile');
                };
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.todayShortcutPill}
                    onPress={onPress}
                    activeOpacity={0.7}
                  >
                    <AppText variant="caption" style={styles.todayShortcutPillText}>
                      {label}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Input */}
        <View style={styles.inputContainer}>
          {loadingContext && (
            <View style={styles.contextLoadingIndicator}>
              <ActivityIndicator color="#4C9AFF" size="small" />
              <AppText variant="caption" style={styles.contextLoadingText}>
                Coach is thinking…
              </AppText>
            </View>
          )}
          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <AppText variant="caption" style={styles.recordingText}>
                Запись...
              </AppText>
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Введи вопрос..."
              placeholderTextColor="#65708A"
              value={inputText}
              onChangeText={setInputText}
              editable={!loading && !isRecording}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              onPress={toggleVoiceInput}
              style={[
                styles.micButton,
                isRecording && styles.micButtonRecording,
              ]}
              disabled={loading}
            >
              <AppText style={styles.micIcon}>
                🎤
              </AppText>
            </TouchableOpacity>
            {isStreaming ? (
              <TouchableOpacity
                onPress={stopStreaming}
                style={styles.stopButton}
                activeOpacity={0.8}
              >
                <AppText variant="label" color="#FFFFFF" style={styles.sendButtonText}>
                  Stop
                </AppText>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={sendMessage}
                style={[styles.sendButton, (loading || !inputText.trim()) && styles.sendButtonDisabled]}
                disabled={loading || !inputText.trim()}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <AppText variant="label" color="#FFFFFF" style={styles.sendButtonText}>
                    Send
                  </AppText>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Evidence modal */}
      <Modal
        visible={evidenceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeEvidenceModal}
      >
        <TouchableOpacity
          style={styles.evidenceModalOverlay}
          activeOpacity={1}
          onPress={closeEvidenceModal}
        >
          <TouchableOpacity
            style={styles.evidenceModalContent}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <AppText variant="h3" style={styles.evidenceModalTitle}>
              Evidence
            </AppText>

            {evidenceModalEvidence?.tags && evidenceModalEvidence.tags.length > 0 ? (
              <View style={styles.evidenceModalSection}>
                <AppText variant="caption" style={styles.evidenceModalLabel}>
                  Tags
                </AppText>
                <AppText variant="body" style={styles.evidenceModalTagsText}>
                  {evidenceModalEvidence.tags.join(', ')}
                </AppText>
              </View>
            ) : null}

            <View style={styles.evidenceModalSection}>
              <AppText variant="caption" style={styles.evidenceModalLabel}>
                Source messages
              </AppText>
              {evidenceModalEvidence?.message_ids?.length ? (
                evidenceSourceLoading ? (
                  <ActivityIndicator color="#4C9AFF" size="small" style={{ marginVertical: 12 }} />
                ) : (
                  <>
                    <ScrollView style={styles.evidenceSourceList} nestedScrollEnabled>
                      {evidenceSourceMessages.length === 0 ? (
                        <AppText variant="caption" style={styles.evidenceModalMuted}>
                          No messages found.
                        </AppText>
                      ) : (
                        evidenceSourceMessages.map((msg) => (
                          <TouchableOpacity
                            key={msg.id}
                            style={styles.evidenceSourceItem}
                            onPress={() => {
                              const currentThread = threadId ?? null;
                              if (msg.thread_id != null && currentThread != null && msg.thread_id !== currentThread) {
                                Alert.alert(
                                  'This source is from another chat.',
                                  undefined,
                                  [
                                    { text: 'Cancel', style: 'cancel' },
                                    {
                                      text: 'Open chat',
                                      onPress: () => {
                                        closeEvidenceModal();
                                        router.push(`/coach/chat?thread_id=${msg.thread_id}`);
                                      },
                                    },
                                  ]
                                );
                                return;
                              }
                              closeEvidenceModal();
                              scrollToMessageId(msg.id);
                            }}
                            activeOpacity={0.7}
                          >
                            <AppText variant="body" numberOfLines={2} style={styles.evidenceSourcePreview}>
                              {msg.content || '—'}
                            </AppText>
                            <AppText variant="caption" style={styles.evidenceSourceTime}>
                              {new Date(msg.created_at).toLocaleString('ru-RU', {
                                day: '2-digit',
                                month: '2-digit',
                                year: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </AppText>
                          </TouchableOpacity>
                        ))
                      )}
                    </ScrollView>
                    {(evidenceModalEvidence?.message_ids?.length ?? 0) - evidenceSourceMessages.length > 0 ? (
                      <AppText variant="caption" style={styles.evidenceModalMissing}>
                        Some sources are not available ({(evidenceModalEvidence?.message_ids?.length ?? 0) - evidenceSourceMessages.length}).
                      </AppText>
                    ) : null}
                  </>
                )
              ) : (evidenceModalEvidence?.memory_ids?.length ?? 0) > 0 ? (
                <AppText variant="body" style={styles.evidenceModalMuted}>
                  Based on saved memory, no direct message references.
                </AppText>
              ) : (
                <AppText variant="body" style={styles.evidenceModalMuted}>
                  No source messages.
                </AppText>
              )}
            </View>

            <TouchableOpacity style={styles.evidenceModalCloseButton} onPress={closeEvidenceModal}>
              <AppText variant="label" color="#4C9AFF">
                Close
              </AppText>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    padding: 0,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  chatsButton: {
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 24,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  saveMemoryButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  newChatButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  voiceToggleButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  ttsModePill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(76, 154, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(76, 154, 255, 0.3)',
  },
  ttsModePillText: {
    fontSize: 11,
    color: '#4C9AFF',
    opacity: 0.95,
  },
  ttsHintText: {
    fontSize: 11,
    color: '#4C9AFF',
    opacity: 0.75,
    marginTop: 4,
    marginBottom: 2,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#1F1914',
    borderColor: '#FF9800',
    borderWidth: 1,
  },
  errorBannerText: {
    color: '#FF9800',
    marginBottom: 10,
  },
  errorBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorBannerRetryButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  errorBannerDismissButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  messagesListWrap: {
    flex: 1,
    position: 'relative',
  },
  messagesList: {
    padding: 20,
    gap: 16,
    flexGrow: 1,
  },
  messageContainer: {
    width: '100%',
    alignItems: 'flex-start',
  },
  messageContainerUser: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
  },
  messageBubbleUser: {
    backgroundColor: '#11161F',
    borderColor: '#E53935',
    borderWidth: 1,
  },
  messageBubbleCoach: {
    backgroundColor: '#11161F',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 6,
    marginBottom: 2,
    gap: 2,
  },
  evidenceBadge: {
    fontSize: 10,
    opacity: 0.65,
    color: '#4C9AFF',
  },
  evidenceTags: {
    fontSize: 10,
    opacity: 0.55,
    maxWidth: '85%',
  },
  messageTime: {
    fontSize: 11,
    opacity: 0.6,
  },
  ttsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  ttsButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  ttsButtonText: {
    fontSize: 11,
    color: '#4C9AFF',
    opacity: 0.9,
  },
  loadOlderWrap: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingBottom: 4,
  },
  loadOlderButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(76, 154, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(76, 154, 255, 0.2)',
  },
  loadOlderText: {
    fontSize: 12,
    color: '#4C9AFF',
    opacity: 0.9,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    opacity: 0.7,
  },
  emptyHint: {
    fontSize: 13,
    opacity: 0.5,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  todayShortcutsWrap: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: '#0B0E14',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  todayShortcutsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  todayShortcutsLabel: {
    opacity: 0.6,
    fontSize: 11,
  },
  todayShortcutsRefreshButton: {
    padding: 4,
  },
  todayShortcutsRefreshIcon: {
    fontSize: 16,
    color: '#4C9AFF',
    opacity: 0.9,
  },
  todayShortcutsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  todayShortcutPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(76, 154, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(76, 154, 255, 0.25)',
  },
  todayShortcutPillText: {
    color: '#4C9AFF',
    fontSize: 12,
    fontWeight: '500',
  },
  inputContainer: {
    padding: 20,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: '#0B0E14',
  },
  contextLoadingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  contextLoadingText: {
    fontSize: 12,
    fontStyle: 'italic',
    opacity: 0.7,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: '#11161F',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#FFFFFF',
    maxHeight: 100,
  },
  micButton: {
    backgroundColor: '#11161F',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonRecording: {
    backgroundColor: '#E53935',
    borderColor: '#E53935',
  },
  micIcon: {
    fontSize: 24,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E53935',
  },
  recordingText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#E53935',
  },
  sendButton: {
    backgroundColor: '#4C9AFF',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 70,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  stopButton: {
    backgroundColor: '#E53935',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 70,
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  jumpToBottomButton: {
    position: 'absolute',
    right: 20,
    bottom: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(76, 154, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  jumpToBottomIcon: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  evidenceModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  evidenceModalContent: {
    backgroundColor: '#11161F',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 20,
    maxWidth: '100%',
    maxHeight: '80%',
    width: 360,
  },
  evidenceModalTitle: {
    marginBottom: 16,
  },
  evidenceModalSection: {
    marginBottom: 16,
  },
  evidenceModalLabel: {
    opacity: 0.7,
    marginBottom: 6,
  },
  evidenceModalTagsText: {
    opacity: 0.9,
  },
  evidenceSourceList: {
    maxHeight: 220,
  },
  evidenceSourceItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  evidenceSourcePreview: {
    opacity: 0.95,
    marginBottom: 4,
  },
  evidenceSourceTime: {
    opacity: 0.55,
    fontSize: 11,
  },
  evidenceModalMuted: {
    opacity: 0.6,
    fontStyle: 'italic',
  },
  evidenceModalMissing: {
    marginTop: 8,
    fontSize: 11,
    opacity: 0.6,
    fontStyle: 'italic',
  },
  evidenceModalCloseButton: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
});
