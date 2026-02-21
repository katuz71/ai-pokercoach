import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

type Props = {
  onPress: () => void;
  children?: React.ReactNode;
};

export function PrimaryRoundButton({ onPress, children }: Props) {
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

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={onPress}>
      <Animated.View style={[styles.button, { transform: [{ scale: scaleAnim }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
