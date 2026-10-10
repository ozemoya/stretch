import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from './pageStyles';

const steps = [
  { number: '01', title: 'MAKE A LIST', description: 'Start with the things you actually need this week, not just the ingredients you hope to find.' },
  { number: '02', title: 'COMPARE TRIPS', description: 'Stretch weighs groceries against the drive so you know where the real savings show up.' },
  { number: '03', title: 'BRING IT HOME', description: 'Lock in the route, keep your total in budget, and head back before the afternoon heat takes over.' },
];

export default function HowItWorksPage() {
  const [activeStep, setActiveStep] = useState(1);

  return (
    <View style={styles.pageShell}>
      <Text style={styles.eyebrow}>HOW IT WORKS</Text>
      <Text accessibilityRole="header" style={styles.pageTitle}>A simple rhythm for better grocery runs.</Text>
      <View style={styles.stepsGrid}>
        {steps.map((step) => {
          const isActive = activeStep === Number(step.number);
          return (
            <Pressable
              key={step.number}
              accessibilityRole="button"
              accessibilityLabel={step.title}
              onPress={() => setActiveStep(Number(step.number))}
              style={[styles.howStep, isActive && styles.howStepActive]}
            >
              <Text style={[styles.howStepNumber, isActive && styles.howStepNumberActive]}>{step.number}</Text>
              <Text style={[styles.howStepTitle, isActive && styles.howStepTitleActive]}>{step.title}</Text>
              <Text style={styles.howStepDescription}>{step.description}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
