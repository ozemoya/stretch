import React from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from './pageStyles';
import { tripOptions } from './pageData';

export default function PlanTripPage({ selectedTrip, onSelectTrip }) {
  return (
    <View style={styles.pageShell}>
      <Text style={styles.eyebrow}>PLAN A TRIP</Text>
      <Text accessibilityRole="header" style={styles.pageTitle}>Pick the route that keeps your basket happy.</Text>
      <View style={styles.tripPageGrid}>
        {tripOptions.map((trip) => {
          const isSelected = selectedTrip === trip.label;
          return (
            <Pressable
              key={trip.label}
              accessibilityRole="button"
              accessibilityLabel={`Select ${trip.label}`}
              onPress={() => onSelectTrip(trip.label)}
              style={[styles.tripOptionCard, trip.featured && styles.tripOptionFeatured, isSelected && styles.tripOptionSelected]}
            >
              <Text style={[styles.tripCardLabel, (trip.featured || isSelected) && styles.featuredTripText]}>{trip.label}</Text>
              <Text style={[styles.tripCardPrice, (trip.featured || isSelected) && styles.featuredTripText]}>{trip.price}</Text>
              <Text style={[styles.tripCardDetail, (trip.featured || isSelected) && styles.featuredTripText]}>{trip.detail}</Text>
              <Text style={[styles.tripCardStops, (trip.featured || isSelected) && styles.featuredTripText]}>{trip.stops}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.planSummaryCard}>
        <Text style={styles.planSummaryTitle}>Selected route</Text>
        <Text style={styles.planSummaryValue}>{selectedTrip}</Text>
        <Text style={styles.planSummaryText}>Best for: fresh produce + pantry restock + one simple loop home.</Text>
      </View>
    </View>
  );
}
