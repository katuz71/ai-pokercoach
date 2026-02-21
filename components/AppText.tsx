import React from 'react';
import { StyleSheet, StyleProp, Text, TextProps, TextStyle } from 'react-native';

type Variant = 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'label';

type Props = TextProps & {
  variant?: Variant;
  color?: string;
  style?: StyleProp<TextStyle>;
};

export function AppText({ variant = 'body', color, style, ...props }: Props) {
  const variantStyle = styles[variant];
  const colorStyle = color ? { color } : undefined;

  return <Text {...props} style={[variantStyle, colorStyle, style]} />;
}

const styles = StyleSheet.create({
  h1: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 40,
  },
  h2: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 32,
  },
  h3: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: '#A7B0C0',
    lineHeight: 22,
  },
  caption: {
    fontSize: 14,
    fontWeight: '400',
    color: '#65708A',
    lineHeight: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A7B0C0',
    lineHeight: 16,
  },
});
