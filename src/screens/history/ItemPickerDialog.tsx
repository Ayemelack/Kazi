import React from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Check, Package, Scissors, X } from 'lucide-react-native';
import type { Item, ItemType } from '../../items/types';
import { colors, radius, spacing, typography } from '../../theme';

interface Props {
  visible: boolean;
  items: Item[];
  selectedId?: number;
  onSelect: (item: Item | null) => void;
  onClose: () => void;
}

const TYPE_ICONS: Record<ItemType, typeof Package> = {
  product: Package,
  service: Scissors,
};

function ItemIcon({ item }: { item: Item }) {
  const Icon = TYPE_ICONS[item.type];
  if (item.image) {
    return (
      <View style={styles.iconWrap}>
        <Image source={{ uri: item.image }} style={styles.itemImage} resizeMode="cover" />
      </View>
    );
  }
  return (
    <View style={[styles.iconWrap, item.type === 'product' ? styles.iconProduct : styles.iconService]}>
      <Icon size={18} color={item.type === 'product' ? colors.primaryDark : colors.accent} />
    </View>
  );
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

export default function ItemPickerDialog({
  visible,
  items,
  selectedId,
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation();

  const choose = (item: Item | null) => {
    onSelect(item);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.content} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('transactions.selectItem')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeButton}
            >
              <X size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <Pressable style={styles.clearRow} onPress={() => choose(null)}>
            <Text style={styles.clearLabel}>{t('transactions.noItem')}</Text>
            {selectedId === undefined ? <Check size={18} color={colors.primary} /> : null}
          </Pressable>

          <FlatList
            data={items}
            keyExtractor={item => String(item.id)}
            ItemSeparatorComponent={ItemSeparator}
            ListEmptyComponent={
              <Text style={styles.empty}>{t('empty.productsMessage')}</Text>
            }
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              return (
                <Pressable style={styles.row} onPress={() => choose(item)}>
                  <ItemIcon item={item} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {t(item.type === 'product' ? 'products.product' : 'products.service')}
                      {item.trackStock
                        ? ` · ${t('products.inStock', { count: item.stock })}`
                        : ''}
                    </Text>
                  </View>
                  {selected ? <Check size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 42, 38, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '75%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  clearLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  iconProduct: {
    backgroundColor: colors.primarySoft,
  },
  iconService: {
    backgroundColor: colors.accentSoft,
  },
  rowText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowName: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});