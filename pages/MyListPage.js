import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import styles from './pageStyles';

export default function MyListPage({ groceryList, onToggleItem, onRemoveItem, onAddItem }) {
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('');

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
              <Text style={styles.itemQty}>{item.qty}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.label}`} onPress={() => onRemoveItem(item.id)} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>REMOVE</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
