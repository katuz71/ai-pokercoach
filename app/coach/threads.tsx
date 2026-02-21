import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';

type ThreadRow = {
  id: string;
  title: string | null;
  updated_at: string;
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

export default function CoachThreadsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadThreads = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('chat_threads')
        .select('id, title, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(20);
      setThreads((data ?? []) as ThreadRow[]);
    } catch (e) {
      console.warn('[CoachThreads] Load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const openChat = (threadId: string) => {
    router.push({ pathname: '/coach/chat', params: { thread_id: threadId } });
  };

  const startChat = () => {
    router.push('/coach/chat');
  };

  const renderItem = ({ item }: { item: ThreadRow }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => openChat(item.id)}
      style={styles.rowTouch}
    >
      <Card style={styles.rowCard}>
        <View style={styles.rowContent}>
          <AppText variant="body" style={styles.rowTitle} numberOfLines={1} ellipsizeMode="tail">
            {(item.title != null && String(item.title).trim() !== '') ? String(item.title).trim() : 'Chat'}
          </AppText>
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
          <TouchableOpacity onPress={startChat} style={styles.startButton}>
            <AppText variant="label" color="#FFFFFF" style={styles.startButtonText}>
              Start chat
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
  rowTitle: {
    fontSize: 16,
    marginBottom: 2,
    flexShrink: 1,
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
});
