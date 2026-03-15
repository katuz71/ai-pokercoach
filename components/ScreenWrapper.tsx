import React from 'react';
import { StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';

type Props = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Safe area edges to apply. Default: all. Use ['top','left','right'] for tab screens to avoid black bar above tab bar. */
  edges?: Edge[];
};

const DEFAULT_EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];

export function ScreenWrapper({ children, style, edges = DEFAULT_EDGES }: Props) {
  return (
    <SafeAreaView style={[styles.container, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0E14',
    padding: 20,
  },
});
