import React, { useMemo, useState } from 'react';
import {
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

export default function CalculatorScreen() {
  const router = useRouter();
  const [potSize, setPotSize] = useState('');
  const [callSize, setCallSize] = useState('');
  const [outs, setOuts] = useState('');

  const potSizeNum = parseFloat(potSize) || 0;
  const callSizeNum = parseFloat(callSize) || 0;
  const outsNum = Math.min(20, Math.max(0, parseInt(outs, 10) || 0));

  const result = useMemo(() => {
    if (potSizeNum <= 0 || callSizeNum <= 0) {
      return null;
    }
    const totalPot = potSizeNum + callSizeNum;
    const potOdds = (callSizeNum / totalPot) * 100;
    const equityTurn = outsNum * 2;
    const equityRiver = outsNum * 4;
    return {
      potOdds,
      equityTurn,
      equityRiver,
      isProfitable: equityRiver >= potOdds,
    };
  }, [potSizeNum, callSizeNum, outsNum]);

  return (
    <ScreenWrapper>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
            <AppText variant="body" color="#4C9AFF">← Назад</AppText>
          </TouchableOpacity>
          <AppText variant="caption" color="#A7B0C0">Tools</AppText>
          <AppText variant="h1" style={styles.title}>Pot Odds Calculator</AppText>
        </View>

        <View style={styles.inputGroup}>
          <AppText variant="label" style={styles.inputLabel}>
            Размер банка (Pot Size)
          </AppText>
          <TextInput
            style={styles.input}
            placeholder="Например: 100"
            placeholderTextColor="#65708A"
            keyboardType="numeric"
            value={potSize}
            onChangeText={setPotSize}
          />
        </View>

        <View style={styles.inputGroup}>
          <AppText variant="label" style={styles.inputLabel}>
            Размер ставки, которую нужно заколлировать (Call Size)
          </AppText>
          <TextInput
            style={styles.input}
            placeholder="Например: 50"
            placeholderTextColor="#65708A"
            keyboardType="numeric"
            value={callSize}
            onChangeText={setCallSize}
          />
        </View>

        <View style={styles.inputGroup}>
          <AppText variant="label" style={styles.inputLabel}>
            Количество аутов (Outs, от 1 до 20)
          </AppText>
          <TextInput
            style={styles.input}
            placeholder="Например: 9"
            placeholderTextColor="#65708A"
            keyboardType="numeric"
            value={outs}
            onChangeText={(text) => {
              const n = parseInt(text, 10);
              if (text === '' || (!isNaN(n) && n >= 0 && n <= 20)) {
                setOuts(text);
              }
            }}
          />
        </View>

        {result && (
          <Card style={styles.resultCard}>
            <AppText variant="body" color="#A7B0C0">
              Шансы банка: <AppText variant="body" color="#FFFFFF">{result.potOdds.toFixed(1)}%</AppText>
            </AppText>
            <AppText variant="body" color="#A7B0C0" style={styles.resultRow}>
              Эквити (1 улица): <AppText variant="body" color="#FFFFFF">{result.equityTurn}%</AppText>
            </AppText>
            <AppText variant="body" color="#A7B0C0" style={styles.resultRow}>
              Эквити (2 улицы): <AppText variant="body" color="#FFFFFF">{result.equityRiver}%</AppText>
            </AppText>
            <View style={styles.verdictRow}>
              {result.isProfitable ? (
                <AppText variant="h3" color="#4CAF50">
                  Выгодный колл (на 2 улицы) +EV
                </AppText>
              ) : (
                <AppText variant="h3" color="#F44336">
                  Пас -EV
                </AppText>
              )}
            </View>
          </Card>
        )}
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
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    marginBottom: 8,
    color: '#A7B0C0',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#1B1C22',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 16,
  },
  resultCard: {
    backgroundColor: '#1B1C22',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 20,
    marginTop: 8,
    gap: 8,
  },
  resultRow: {
    marginTop: 4,
  },
  verdictRow: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
});
