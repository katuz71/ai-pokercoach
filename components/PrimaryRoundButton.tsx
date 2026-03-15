import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

const DEFAULT_SIZE = 84;

type Props = {
  onPress: () => void;
  children?: React.ReactNode;
  size?: number;
};

export function PrimaryRoundButton({ onPress, children, size = DEFAULT_SIZE }: Props) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const buttonStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={onPress}>
      <Animated.View style={[styles.button, buttonStyle, { transform: [{ scale: scaleAnim }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
