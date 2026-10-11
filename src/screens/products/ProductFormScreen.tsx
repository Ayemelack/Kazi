import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ImagePlus,
  Package,
  PackageMinus,
  PackagePlus,
  Scissors,
  Trash2,
} from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import LoadingView from '../../components/ui/LoadingView';
import { useToast } from '../../components/ui/Toast';
import {
  createItem,
  deleteItem,
  getItem,
  stockIn,
  stockOut,
  updateItem,
} from '../../offline/api';
import {
  ITEM_NAME_MAX,
  ITEM_NOTES_MAX,
  LOW_STOCK_THRESHOLD_MAX,
  parseMoneyInput,
} from '@kazi/shared';
import { MONEY_INPUT_MAX_LENGTH, moneyPreview } from '../../money/input';
import {
  hasItemErrors,
  parseWholeNumber,
  validateItemForm,
  type ItemFormErrors,
} from '../../items/validation';
import { pickImage } from '../../items/image';
import type { Item, ItemType, StockDirection } from '../../items/types';
import type { ProductsStackParamList } from '../../navigation/RootNavigator';
import { LocalError, errorMessage } from '../../errors/messages';
import { colors, radius, spacing, typography } from '../../theme';
import StockMovementDialog from './StockMovementDialog';

type ScreenProps = NativeStackScreenProps<ProductsStackParamList, 'ProductForm'>;

const TYPES: ItemType[] = ['product', 'service'];

export default function ProductFormScreen({ navigation, route }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const itemId = route.params?.itemId;

  const [loading, setLoading] = useState(itemId !== undefined);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ItemType>('product');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<string | undefined>(undefined);
  const [trackStock, setTrackStock] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState('');
  const [currentItem, setCurrentItem] = useState<Item | null>(null);
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [stockDialog, setStockDialog] = useState<StockDirection | null>(null);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockError, setStockError] = useState<unknown>(null);

  useEffect(() => {
    if (itemId === undefined) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { item } = await getItem(itemId);
        if (cancelled) {
          return;
        }
        setCurrentItem(item);
        setName(item.name);
        setType(item.type);
        setPrice(String(item.price));
        setNotes(item.notes ?? '');
        setImage(item.image);
        setTrackStock(item.trackStock);
        setLowStockThreshold(String(item.lowStockThreshold));
      } catch (err) {
        if (!cancelled) {
          setFormError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, t]);

  const save = async () => {
    if (submitting) return;
    const validationErrors = validateItemForm({
      name,
      type,
      price,
      notes,
      trackStock,
      lowStockThreshold,
    });
    if (hasItemErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const parsedPrice = parseMoneyInput(price) ?? 0;
      const parsedThreshold = trackStock
        ? (parseWholeNumber(lowStockThreshold) ?? 0)
        : 0;
      const input = {
        name: name.trim(),
        type,
        price: parsedPrice,
        notes: notes.trim() || undefined,
        image,
        trackStock,
        lowStockThreshold: parsedThreshold,
      };
      if (itemId !== undefined) {
        await updateItem(itemId, input);
        toast.show('success', t('products.itemUpdated'));
      } else {
        await createItem(input);
        toast.show('success', t('products.itemCreated'));
      }
      navigation.goBack();
    } catch (err) {
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !hasItemErrors(
    validateItemForm({ name, type, price, notes, trackStock, lowStockThreshold }),
  );

  const confirmDelete = async () => {
    if (deleting) return;
    if (itemId === undefined) {
      return;
    }
    setDeleting(true);
    try {
      await deleteItem(itemId);
      toast.show('success', t('products.itemDeleted'));
      navigation.goBack();
    } catch (err) {
      setFormError(err);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const applyStockMovement = async (quantity: number, reason?: string) => {
    if (itemId === undefined || stockDialog === null) {
      return;
    }
    setStockBusy(true);
    setStockError(null);
    try {
      const isIn = stockDialog === 'in';
      const result = isIn
        ? await stockIn(itemId, { quantity, reason })
        : await stockOut(itemId, { quantity, reason });
      setCurrentItem(result.item);
      setStockDialog(null);
      toast.show('success', t(isIn ? 'products.stockAdded' : 'products.stockRemoved'));
    } catch (err) {
      setStockError(err);
    } finally {
      setStockBusy(false);
    }
  };

  const pickPhoto = async () => {
    const result = await pickImage();
    if (result.status === 'selected') {
      setImage(result.image);
    } else if (result.status === 'error') {
      setFormError(new LocalError(result.messageKey));
    }
  };

  if (loading) {
    return (
      <Screen>
        <AppHeader title={t('products.editTitle')} onBack={() => navigation.goBack()} />
        <LoadingView />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <AppHeader
        title={itemId === undefined ? t('products.addTitle') : t('products.editTitle')}
        onBack={() => navigation.goBack()}
      />
      <TextField
        testID="item-name"
        label={t('products.name')}
        value={name}
        onChangeText={setName}
        error={errors.name ? t(errors.name) : undefined}
        autoCapitalize="words"
        maxLength={ITEM_NAME_MAX}
      />
      <Text style={styles.fieldLabel}>{t('products.typeLabel')}</Text>
      <View style={styles.typeRow}>
        {TYPES.map(option => {
          const active = type === option;
          const TypeIcon = option === 'product' ? Package : Scissors;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setType(option)}
              style={[
                styles.typeButton,
                active ? styles.typeActive : styles.typeInactive,
              ]}
            >
              <TypeIcon
                size={18}
                color={active ? colors.primaryDark : colors.textSecondary}
              />
              <Text
                style={[
                  styles.typeLabel,
                  { color: active ? colors.primaryDark : colors.textSecondary },
                ]}
              >
                {t(option === 'product' ? 'products.product' : 'products.service')}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextField
        testID="item-price"
        label={t('products.price')}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        error={errors.price ? t(errors.price) : undefined}
        hint={moneyPreview(price) ?? t('products.priceHint')}
        maxLength={MONEY_INPUT_MAX_LENGTH}
      />
      <TextField
        testID="item-notes"
        label={t('products.notes')}
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={ITEM_NOTES_MAX}
      />
      <Pressable
        testID="item-photo"
        accessibilityRole="button"
        accessibilityLabel={image ? t('products.replacePhoto') : t('products.addPhoto')}
        onPress={pickPhoto}
        style={({ pressed }) => [styles.photoBox, pressed && styles.photoPressed]}
      >
        {image ? (
          <Image source={{ uri: image }} style={styles.photoPreview} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <ImagePlus size={24} color={colors.textSecondary} />
            <Text style={styles.photoLabel}>{t('products.addPhoto')}</Text>
          </View>
        )}
      </Pressable>
      {image ? (
        <Button
          testID="item-remove-photo"
          label={t('products.removePhoto')}
          variant="ghost"
          icon={Trash2}
          onPress={() => setImage(undefined)}
          style={styles.removePhotoButton}
        />
      ) : null}
      <Text style={styles.sectionTitle}>{t('products.inventory')}</Text>
      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.toggleTitle}>{t('products.trackStock')}</Text>
          <Text style={styles.toggleHint}>{t('products.trackStockHint')}</Text>
        </View>
        <Switch
          testID="item-track-stock"
          value={trackStock}
          onValueChange={value => {
            setTrackStock(value);
            if (!value) {
              setLowStockThreshold('');
            }
          }}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>
      {trackStock ? (
        <View style={styles.stockSection}>
          {currentItem !== undefined && currentItem !== null ? (
            <View style={styles.stockBadge}>
              <Package size={16} color={colors.textSecondary} />
              <Text style={styles.stockBadgeText}>
                {t('products.currentStock')}: {currentItem.stock}
              </Text>
            </View>
          ) : null}
          <TextField
            testID="item-low-stock"
            label={t('products.lowStockAlert')}
            value={lowStockThreshold}
            onChangeText={setLowStockThreshold}
            keyboardType="number-pad"
            error={
              errors.lowStockThreshold ? t(errors.lowStockThreshold) : undefined
            }
            hint={t('products.lowStockAlertHint')}
            maxLength={String(LOW_STOCK_THRESHOLD_MAX).length}
          />
          {itemId !== undefined ? (
            <View style={styles.stockActions}>
              <Button
                label={t('products.addStock')}
                variant="secondary"
                icon={PackagePlus}
                onPress={() => {
                  setStockError(null);
                  setStockDialog('in');
                }}
                style={styles.stockActionButton}
              />
              <Button
                label={t('products.removeStock')}
                variant="outline"
                icon={PackageMinus}
                onPress={() => {
                  setStockError(null);
                  setStockDialog('out');
                }}
                style={styles.stockActionButton}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {formError ? <Text style={styles.formError}>{errorMessage(formError, t)}</Text> : null}
      <Button
        testID="item-save"
        label={t('common.save')}
        loading={submitting}
        disabled={!canSubmit}
        onPress={save}
        style={styles.saveButton}
      />
      {itemId !== undefined ? (
        <Button
          testID="item-delete"
          label={t('products.delete')}
          variant="ghost"
          icon={Trash2}
          onPress={() => setConfirmingDelete(true)}
          style={styles.deleteButton}
        />
      ) : null}

      <ConfirmDialog
        visible={confirmingDelete}
        title={t('products.deleteConfirmTitle')}
        message={t('products.deleteConfirmMessage')}
        confirmLabel={t('products.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />

      <StockMovementDialog
        visible={stockDialog !== null}
        direction={stockDialog ?? 'in'}
        itemName={name.trim()}
        busy={stockBusy}
        error={stockError ? errorMessage(stockError, t) : null}
        onCancel={() => setStockDialog(null)}
        onConfirm={applyStockMovement}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoBox: {
    alignSelf: 'stretch',
    height: 160,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  photoPressed: {
    opacity: 0.88,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  photoLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  removePhotoButton: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  toggleTextWrap: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleTitle: {
    ...typography.label,
    color: colors.textPrimary,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stockSection: {
    marginBottom: spacing.sm,
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  stockBadgeText: {
    ...typography.label,
    color: colors.textPrimary,
  },
  stockActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  stockActionButton: {
    flex: 1,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
  },
  typeActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  typeInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  typeLabel: {
    ...typography.label,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  saveButton: {
    marginBottom: spacing.sm,
  },
  deleteButton: {
    marginBottom: spacing.xl,
  },
});