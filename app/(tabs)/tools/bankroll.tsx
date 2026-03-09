import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';
import { supabase } from '../../../lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

type GameType = 'Cash' | 'MTT' | 'Spin';

interface BankrollSession {
  id: string;
  user_id: string;
  date: string;
  game_type: GameType;
  buy_in: number;
  cash_out: number;
  profit: number;
  notes: string | null;
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────

const GAME_TYPES: GameType[] = ['Cash', 'MTT', 'Spin'];

export default function BankrollScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<BankrollSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [gameType, setGameType] = useState<GameType>('Cash');
  const [buyIn, setBuyIn] = useState('');
  const [cashOut, setCashOut] = useState('');
  const [saving, setSaving] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('bankroll_sessions')
      .select('*')
      .order('date', { ascending: false });
    if (!error) {
      setSessions((data as BankrollSession[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const { totalProfit, roi } = useMemo(() => {
    const totalProfit = sessions.reduce((acc, s) => acc + Number(s.profit ?? 0), 0);
    const totalBuyIn = sessions.reduce((acc, s) => acc + Number(s.buy_in ?? 0), 0);
    const roiRaw = totalBuyIn > 0 ? (totalProfit / totalBuyIn) * 100 : 0;
    const roi = Number.isNaN(roiRaw) ? 0 : roiRaw;
    return { totalProfit, roi };
  }, [sessions]);

  const openModal = () => {
    setGameType('Cash');
    setBuyIn('');
    setCashOut('');
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setBuyIn('');
    setCashOut('');
    setSaving(false);
  };

  const handleSave = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const buyInNum = Number(buyIn) || 0;
    const cashOutNum = Number(cashOut) || 0;

    setSaving(true);
    const { error } = await supabase.from('bankroll_sessions').insert({
      user_id: session.user.id,
      game_type: gameType,
      buy_in: buyInNum,
      cash_out: cashOutNum,
    });

    setSaving(false);
    if (error) return;
    closeModal();
    loadSessions();
  };

  return (
    <ScreenWrapper>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
            <AppText variant="body" color="#4C9AFF">← Назад</AppText>
          </TouchableOpacity>
          <AppText variant="caption" color="#A7B0C0">Tools</AppText>
          <AppText variant="h1" style={styles.title}>Bankroll Tracker</AppText>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#4C9AFF" />
          </View>
        ) : (
          <>
            <Card style={styles.statsCard}>
              <AppText variant="label" color="#A7B0C0">Total Profit</AppText>
              <AppText
                variant="h1"
                style={[styles.totalProfit, totalProfit >= 0 ? styles.profitPositive : styles.profitNegative]}
              >
                {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)} $
              </AppText>
              <AppText variant="body" color="#A7B0C0" style={styles.roiRow}>
                ROI: <AppText variant="body" color="#FFFFFF">{(Number.isNaN(roi) ? 0 : roi).toFixed(1)}%</AppText>
              </AppText>
            </Card>

            <AppText variant="label" style={styles.sectionLabel}>Сессии</AppText>

            {sessions.length === 0 ? (
              <View style={styles.emptyWrap}>
                <AppText variant="body" color="#65708A">Добавь свою первую сессию</AppText>
              </View>
            ) : (
              <View style={styles.sessionList}>
                {sessions.map((s) => {
                  const profit = Number(s.profit ?? 0);
                  const isPositive = profit >= 0;
                  return (
                    <Card key={s.id} style={styles.sessionCard}>
                      <View style={styles.sessionRow}>
                        <AppText variant="body" color="#A7B0C0">{formatDate(s.date)}</AppText>
                        <AppText variant="label" color="#65708A">{s.game_type}</AppText>
                      </View>
                      <AppText
                        variant="h3"
                        style={[styles.sessionProfit, isPositive ? styles.profitPositive : styles.profitNegative]}
                      >
                        {isPositive ? '+' : ''}{profit.toFixed(2)} $
                      </AppText>
                    </Card>
                  );
                })}
              </View>
            )}

            <TouchableOpacity style={styles.fab} onPress={openModal} activeOpacity={0.85}>
              <AppText variant="h3" color="#0B0E14">Добавить сессию</AppText>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal
        transparent
        visible={modalVisible}
        animationType="slide"
        onRequestClose={closeModal}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeModal}
        >
          <TouchableOpacity style={styles.modalSheetTouch} activeOpacity={1} onPress={() => {}}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalKeyboard}
            >
              <View style={styles.modalSheet}>
                <AppText variant="h2" style={styles.modalTitle}>Новая сессия</AppText>

                <AppText variant="label" style={styles.inputLabel}>Тип игры</AppText>
                <View style={styles.gameTypeRow}>
                  {GAME_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.gameTypeBtn, gameType === type && styles.gameTypeBtnActive]}
                      onPress={() => setGameType(type)}
                    >
                      <AppText
                        variant="body"
                        color={gameType === type ? '#0B0E14' : '#A7B0C0'}
                      >
                        {type}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>

                <AppText variant="label" style={styles.inputLabel}>Buy-in ($)</AppText>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor="#65708A"
                  keyboardType="numeric"
                  value={buyIn}
                  onChangeText={setBuyIn}
                />

                <AppText variant="label" style={styles.inputLabel}>Cash-out ($)</AppText>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor="#65708A"
                  keyboardType="numeric"
                  value={cashOut}
                  onChangeText={setCashOut}
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                    <AppText variant="body" color="#A7B0C0">Отмена</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#0B0E14" />
                    ) : (
                      <AppText variant="body" color="#0B0E14">Сохранить</AppText>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </TouchableOpacity>
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
    paddingBottom: 100,
  },
  header: {
    marginBottom: 24,
    gap: 4,
  },
  backRow: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  statsCard: {
    backgroundColor: '#1B1C22',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 20,
    marginBottom: 24,
    gap: 4,
  },
  totalProfit: {
    fontSize: 28,
    marginTop: 4,
  },
  profitPositive: {
    color: '#4CAF50',
  },
  profitNegative: {
    color: '#F44336',
  },
  roiRow: {
    marginTop: 8,
  },
  sectionLabel: {
    color: '#A7B0C0',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  emptyWrap: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  sessionList: {
    gap: 12,
  },
  sessionCard: {
    backgroundColor: '#1B1C22',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionProfit: {
    fontSize: 18,
  },
  fab: {
    marginTop: 24,
    backgroundColor: '#4C9AFF',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalKeyboard: {
    width: '100%',
  },
  modalSheetTouch: {
    width: '100%',
  },
  modalSheet: {
    backgroundColor: '#1B1C22',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 32,
  },
  modalTitle: {
    marginBottom: 20,
    color: '#FFFFFF',
  },
  inputLabel: {
    color: '#A7B0C0',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  gameTypeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  gameTypeBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#0A0E14',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  gameTypeBtnActive: {
    backgroundColor: '#4C9AFF',
    borderColor: '#4C9AFF',
  },
  input: {
    backgroundColor: '#0A0E14',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 16,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#0A0E14',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#4C9AFF',
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
});
