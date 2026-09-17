import React, { useCallback, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChevronRight, Package, Plus, Scissors } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import LoadingView from '../../components/ui/LoadingView';
import { listItems } from '../../offline/api';
import { formatPrice } from '../../items/format';
import type { Item, ItemType } from '../../items/types';
import type { ProductsStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<ProductsStackParamList, 'ProductsList'>;

const TYPE_ICONS: Record<ItemType, typeof Package> = {
  product: Package,
  service: Scissors,
};

export default function ProductsScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const result = await listItems();
        setItems(result.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.error.generic'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const openForm = (itemId?: number) => {
    navigation.navigate('ProductForm', itemId === undefined ? undefined : { itemId });
  };

  return (
    <Screen>
      <AppHeader
        title={t('navigation.products')}
        rightIcon={Plus}
        onRightPress={() => openForm()}
      />
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load('initial')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          title={t('empty.productsTitle')}
          message={t('empty.productsMessage')}
          actionLabel={t('products.emptyAction')}
          onAction={() => openForm()}
        />
      ) : (
        <View style={styles.list}>
          <Text style={styles.count}>
            {t('products.itemCount', { count: items.length })}
          </Text>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} />
            }
            showsVerticalScrollIndicator={false}
          >
            {items.map(item => (
              <ItemRow key={item.id} item={item} onPress={() => openForm(item.id)} />
            ))}
          </ScrollView>
        </View>
      )}
    </Screen>
  );
}

function ItemRow({
  item,
  onPress,
}: {
  item: Item;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const TypeIcon = TYPE_ICONS[item.type];
  const isProduct = item.type === 'product';

  let stockLabel: string | null = null;
  let stockTone: 'warning' | 'error' | 'ok' = 'ok';
  if (item.trackStock) {
    if (item.lowStock) {
      stockLabel =
        item.stock === 0
          ? t('products.notInStock')
          : t('products.lowStockBadge');
      stockTone = item.stock === 0 ? 'error' : 'warning';
    } else {
      stockLabel = t('products.inStock', { count: item.stock });
    }
  }

  return (
    <Card onPress={onPress}>
      <View style={styles.rowContent}>
        <View
          style={[
            styles.typeIconWrap,
            isProduct ? styles.typeIconProduct : styles.typeIconService,
          ]}
        >
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.typeImage} resizeMode="cover" />
          ) : (
            <TypeIcon size={20} color={isProduct ? colors.primaryDark : colors.accent} />
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.itemType}>
            {t(isProduct ? 'products.product' : 'products.service')}
          </Text>
          {stockLabel ? (
            <View style={styles.stockRow}>
              <View
                style={[
                  styles.stockDot,
                  stockTone === 'warning' && styles.stockDotWarning,
                  stockTone === 'error' && styles.stockDotError,
                ]}
              />
              <Text
                style={[
                  styles.stockText,
                  stockTone === 'warning' && styles.stockTextWarning,
                  stockTone === 'error' && styles.stockTextError,
                ]}
              >
                {stockLabel}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.itemPrice}>{formatPrice(item.price)}</Text>
        <ChevronRight size={20} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  count: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  typeImage: {
    width: '100%',
    height: '100%',
  },
  typeIconProduct: {
    backgroundColor: colors.primarySoft,
  },
  typeIconService: {
    backgroundColor: colors.accentSoft,
  },
  rowText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  itemName: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  itemType: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  stockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  stockDotWarning: {
    backgroundColor: colors.warning,
  },
  stockDotError: {
    backgroundColor: colors.error,
  },
  stockText: {
    ...typography.caption,
    color: colors.success,
  },
  stockTextWarning: {
    color: colors.warning,
  },
  stockTextError: {
    color: colors.error,
  },
  itemPrice: {
    ...typography.heading,
    color: colors.primaryDark,
    marginRight: spacing.xs,
  },
});