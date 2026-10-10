import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import styles from './pageStyles';

export default function MyListPage({ groceryList, onToggleItem, onChangeQuantity, onRemoveItem, onAddItem, onNavigate }) {
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('');
  const total = groceryList.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return (
    <View style={styles.pageShell}>
      <Text style={styles.eyebrow}>MY LIST</Text>
      <Text accessibilityRole="header" style={styles.pageTitle}>Keep your essentials in one easy route.</Text>
      <View style={styles.listInputCard}>
        <TextInput value={itemName} onChangeText={setItemName} placeholder="Add an item" placeholderTextColor="#6E7B52" style={styles.input} accessibilityLabel="Item name" />
        <TextInput value={itemQty} onChangeText={setItemQty} placeholder="Qty" placeholderTextColor="#6E7B52" style={[styles.input, styles.inputSmall]} accessibilityLabel="Quantity" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add item"
          onPress={() => {
            if (!itemName.trim()) return;
            onAddItem(itemName.trim(), itemQty.trim() || '1');
            setItemName('');
            setItemQty('');
          }}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>ADD</Text>
        </Pressable>
      </View>
      <View style={styles.groceryList}>
        {groceryList.map((item) => (
          <View key={item.id} style={styles.groceryItem}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Mark ${item.label} complete`} onPress={() => onToggleItem(item.id)} style={styles.checkBox}>
              <Text style={styles.checkBoxText}>{item.checked ? '✓' : ''}</Text>
            </Pressable>
            <View style={styles.itemTextWrap}>
              <Text style={[styles.itemLabel, item.checked && styles.itemChecked]}>{item.label}</Text>
              <Text style={styles.itemQty}>Estimated ${item.unitPrice.toFixed(2)} each</Text>
            </View>
            <View style={styles.quantityControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${item.label} quantity`}
                onPress={() => item.quantity > 1 && onChangeQuantity(item.id, item.quantity - 1)}
                style={styles.quantityButton}
              >
                <Text style={styles.quantityButtonText}>−</Text>
              </Pressable>
              <Text style={styles.quantityValue}>{item.quantity}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Increase ${item.label} quantity`}
                onPress={() => onChangeQuantity(item.id, item.quantity + 1)}
                style={styles.quantityButton}
              >
                <Text style={styles.quantityButtonText}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.itemTotal}>Est. ${(item.quantity * item.unitPrice).toFixed(2)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.label}`} onPress={() => onRemoveItem(item.id)} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>REMOVE</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.runningTotal}>
        <Text style={styles.runningTotalLabel}>ESTIMATED GROCERY TOTAL</Text>
        <Text style={styles.runningTotalValue}>${total.toFixed(2)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Plan a trip"
        onPress={() => onNavigate('plan')}
        style={styles.nextStepButton}
      >
        <Text style={styles.nextStepButtonText}>NEXT STEP: PLAN A TRIP ↗</Text>
      </Pressable>
    </View>
  );
}
