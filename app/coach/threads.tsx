import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { LEAK_CATALOG, getLeakDisplay } from '../../lib/leakCatalog';

const FILTER_ALL = 'all';

type ThreadRow = {
  id: string;
  title: string | null;
  updated_at: string;
  leak_tag: string | null;
};

function formatThreadDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffM < 1) return 'сейчас';
  if (diffM < 60) return `${diffM} мин`;
  if (diffH < 24) return `${diffH} ч`;
  if (diffD < 7) return `${diffD} д`;
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const LEAK_TAGS = Object.keys(LEAK_CATALOG);

export default function CoachThreadsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLeak, setFilterLeak] = useState<string>(FILTER_ALL);
  const [newThreadModalVisible, setNewThreadModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadThreads = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      let q = supabase
        .from('chat_threads')
        .select('id, title, updated_at, leak_tag')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (filterLeak !== FILTER_ALL) {
        q = q.eq('leak_tag', filterLeak);
      }
      const { data } = await q;
      setThreads((data ?? []) as ThreadRow[]);
    } catch (e) {
      console.warn('[CoachThreads] Load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id, filterLeak]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const openChat = (threadId: string) => {
    router.push({ pathname: '/coach/chat', params: { thread_id: threadId } });
  };

  const openNewThreadModal = () => setNewThreadModalVisible(true);
  const closeNewThreadModal = () => {
    if (!creating) setNewThreadModalVisible(false);
  };

  const createThreadWithLeak = async (leakTag: string | null) => {
    if (!user || creating) return;
    setCreating(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chat_threads Insert type not inferred by client
      const { data, error } = await supabase
        .from('chat_threads')
        .insert({ user_id: user.id, leak_tag: leakTag ?? null } as any)
        .select('id')
        .single();
      if (error) throw error;
      setNewThreadModalVisible(false);
      const id = (data as { id: string }).id;
      router.push({ pathname: '/coach/chat', params: { thread_id: id } });
    } catch (e) {
      console.warn('[CoachThreads] Create thread failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const renderItem = ({ item }: { item: ThreadRow }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => openChat(item.id)}
      style={styles.rowTouch}
    >
      <Card style={styles.rowCard}>
        <View style={styles.rowContent}>
          <View style={styles.rowTitleRow}>
            <AppText variant="body" style={styles.rowTitle} numberOfLines={1} ellipsizeMode="tail">
              {(item.title != null && String(item.title).trim() !== '') ? String(item.title).trim() : 'Chat'}
            </AppText>
            {item.leak_tag != null && item.leak_tag !== '' && (
              <View style={styles.leakBadge}>
                <AppText variant="caption" style={styles.leakBadgeText} numberOfLines={1}>
                  {getLeakDisplay(item.leak_tag).title}
                </AppText>
              </View>
            )}
          </View>
          <AppText variant="caption" style={styles.rowDate}>
            {formatThreadDate(item.updated_at)}
          </AppText>
        </View>
        <AppText variant="body" style={styles.chevron}>›</AppText>
      </Card>
    </TouchableOpacity>
  );

  return (
    <ScreenWrapper style={styles.wrapper}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <AppText variant="h3" color="#4C9AFF">
            ← Назад
          </AppText>
        </TouchableOpacity>
        <AppText variant="h2" style={styles.title}>
          Chats
        </AppText>
        <TouchableOpacity onPress={openNewThreadModal} style={styles.newThreadButton}>
          <AppText variant="label" color="#4C9AFF">New thread</AppText>
        </TouchableOpacity>
      </View>

      <View style={styles.filterStrip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          <TouchableOpacity
            style={[styles.filterChip, filterLeak === FILTER_ALL && styles.filterChipActive]}
            onPress={() => setFilterLeak(FILTER_ALL)}
          >
            <AppText variant="caption" style={filterLeak === FILTER_ALL ? styles.filterChipTextActive : styles.filterChipText}>
              All
            </AppText>
          </TouchableOpacity>
          {LEAK_TAGS.map((tag) => {
            const isActive = filterLeak === tag;
            return (
              <TouchableOpacity
                key={tag}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setFilterLeak(tag)}
              >
                <AppText variant="caption" numberOfLines={1} style={isActive ? styles.filterChipTextActive : styles.filterChipText}>
                  {getLeakDisplay(tag).title}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#4C9AFF" size="small" />
          <AppText variant="caption" style={styles.loadingText}>
            Загрузка…
          </AppText>
        </View>
      ) : threads.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="body" style={styles.emptyText}>
            No chats yet
          </AppText>
          <TouchableOpacity onPress={openNewThreadModal} style={styles.startButton}>
            <AppText variant="label" color="#FFFFFF" style={styles.startButtonText}>
              New thread
            </AppText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal visible={newThreadModalVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeNewThreadModal}>
          <View style={styles.modalContent}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
              <AppText variant="h3" style={styles.modalTitle}>New thread</AppText>
              <AppText variant="caption" style={styles.modalSubtitle}>Choose leak focus (optional)</AppText>
              <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
                <TouchableOpacity
                  style={styles.modalRow}
                  onPress={() => createThreadWithLeak(null)}
                  disabled={creating}
                >
                  <AppText variant="body">None</AppText>
                </TouchableOpacity>
                {LEAK_TAGS.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={styles.modalRow}
                    onPress={() => createThreadWithLeak(tag)}
                    disabled={creating}
                  >
                    <AppText variant="body">{getLeakDisplay(tag).title}</AppText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity onPress={closeNewThreadModal} style={styles.modalCancel}>
                <AppText variant="label" color="#888">Cancel</AppText>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    padding: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 24,
    flex: 1,
  },
  newThreadButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  filterStrip: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  filterScroll: {
    gap: 8,
    paddingRight: 20,
  },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#4C9AFF',
  },
  filterChipText: {
    fontSize: 12,
    opacity: 0.9,
  },
  filterChipTextActive: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  list: {
    padding: 20,
    paddingTop: 16,
    gap: 10,
  },
  rowTouch: {
    marginBottom: 2,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#11161F',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
    marginBottom: 2,
  },
  rowTitle: {
    fontSize: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  leakBadge: {
    backgroundColor: 'rgba(76, 154, 255, 0.2)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    maxWidth: 140,
  },
  leakBadgeText: {
    fontSize: 11,
    color: '#4C9AFF',
    fontWeight: '500',
  },
  rowDate: {
    fontSize: 12,
    opacity: 0.6,
  },
  chevron: {
    fontSize: 22,
    opacity: 0.5,
    marginLeft: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 60,
  },
  loadingText: {
    opacity: 0.7,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    gap: 20,
  },
  emptyText: {
    opacity: 0.7,
    fontSize: 16,
  },
  startButton: {
    backgroundColor: '#4C9AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  startButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 20,
  },
  modalTitle: {
    marginBottom: 4,
  },
  modalSubtitle: {
    opacity: 0.7,
    marginBottom: 16,
  },
  modalList: {
    maxHeight: 320,
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  modalCancel: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 8,
  },
});
