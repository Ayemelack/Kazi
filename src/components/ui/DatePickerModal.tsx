import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import {
  BUSINESS_DATE_MIN,
  businessDateMax,
  isCalendarDate,
  isWithinBusinessDateWindow,
  localDateString,
} from '@kazi/shared';
import Button from './Button';
import { colors, radius, spacing, typography, zIndex } from '../../theme';

interface DatePickerModalProps {
  visible: boolean;
  value: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface MonthView {
  year: number;
  month: number;
}

// The picker offers exactly the business-date window the app validators and
// the API accept (KZ-16): BUSINESS_DATE_MIN up to a year after today.
export function pickerBounds(today: string = localDateString()): { min: string; max: string } {
  return { min: BUSINESS_DATE_MIN, max: businessDateMax(today) };
}

function monthKey(view: MonthView): string {
  return `${view.year}-${String(view.month + 1).padStart(2, '0')}`;
}

// A real date inside the window opens the picker on that day; anything else
// opens it on today.
function parseDate(value: string): DateParts {
  if (isCalendarDate(value) && isWithinBusinessDateWindow(value)) {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    return { year, month: month - 1, day };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

function toDateString(p: DateParts): string {
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function monthOffset(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function weekdayLabels(locale: string): string[] {
  const labels: string[] = [];
  for (let i = 1; i <= 7; i += 1) {
    labels.push(new Date(2024, 0, i).toLocaleDateString(locale, { weekday: 'short' }));
  }
  return labels;
}

function buildGrid(year: number, month: number): (number | null)[] {
  const offset = monthOffset(year, month);
  const days = daysInMonth(year, month);
  const cells: (number | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// Moves the visible month, but never outside the months of the window.
export function shiftMonth(
  prev: MonthView,
  delta: number,
  bounds: { min: string; max: string },
): MonthView {
  let month = prev.month + delta;
  let year = prev.year;
  if (month < 0) {
    month = 11;
    year -= 1;
  }
  if (month > 11) {
    month = 0;
    year += 1;
  }
  const next = { year, month };
  const key = monthKey(next);
  if (key < bounds.min.slice(0, 7) || key > bounds.max.slice(0, 7)) {
    return prev;
  }
  return next;
}

export default function DatePickerModal({ visible, value, onSelect, onClose }: DatePickerModalProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? 'en';

  const [draft, setDraft] = useState<DateParts>(() => parseDate(value));
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const p = parseDate(value);
    return { year: p.year, month: p.month };
  });

  const [today] = useState<DateParts>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  });
  const [bounds] = useState(() => pickerBounds(toDateString(today)));
  const canGoBack = shiftMonth(view, -1, bounds) !== view;
  const canGoForward = shiftMonth(view, 1, bounds) !== view;

  useEffect(() => {
    if (visible) {
      const p = parseDate(value);
      setDraft(p);
      setView({ year: p.year, month: p.month });
    }
  }, [visible, value]);

  const grid = buildGrid(view.year, view.month);
  const previewDate = new Date(draft.year, draft.month, draft.day);
  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('datePicker.title')}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <X size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.preview}>
            <CalendarDays size={18} color={colors.primary} />
            <Text style={styles.previewText}>
              {previewDate.toLocaleDateString(locale, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>

          <View style={styles.monthRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('datePicker.previousMonth')}
              accessibilityState={{ disabled: !canGoBack }}
              disabled={!canGoBack}
              onPress={() => setView(p => shiftMonth(p, -1, bounds))}
              style={styles.navButton}
            >
              <ChevronLeft
                size={22}
                color={canGoBack ? colors.textPrimary : colors.textMuted}
              />
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('datePicker.nextMonth')}
              accessibilityState={{ disabled: !canGoForward }}
              disabled={!canGoForward}
              onPress={() => setView(p => shiftMonth(p, 1, bounds))}
              style={styles.navButton}
            >
              <ChevronRight
                size={22}
                color={canGoForward ? colors.textPrimary : colors.textMuted}
              />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {weekdayLabels(locale).map((label, i) => (
              <Text key={i} style={styles.weekday}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {grid.map((day, index) => {
              if (day === null) {
                return <View key={`empty-${index}`} style={styles.cell} />;
              }
              const isToday =
                day === today.day &&
                view.month === today.month &&
                view.year === today.year;
              const isSelected =
                draft.month === view.month &&
                draft.year === view.year &&
                draft.day === day;
              const dateString = toDateString({ year: view.year, month: view.month, day });
              const outOfRange = dateString < bounds.min || dateString > bounds.max;

              return (
                <Pressable
                  key={day}
                  testID={`date-picker-day-${dateString}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: outOfRange }}
                  disabled={outOfRange}
                  onPress={() => setDraft({ year: view.year, month: view.month, day })}
                  style={[styles.cell, outOfRange && styles.dayOutOfRange]}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      isSelected && styles.daySelected,
                      isToday && !isSelected && styles.dayToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        isSelected && styles.dayTextSelected,
                        isToday && !isSelected && styles.dayTextToday,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <Button
              label={t('datePicker.today')}
              variant="secondary"
              size="md"
              onPress={() => {
                setDraft(today);
                setView({ year: today.year, month: today.month });
              }}
              style={styles.footerButton}
            />
            <Button
              label={t('common.confirm')}
              size="md"
              onPress={() => {
                onSelect(toDateString(draft));
                onClose();
              }}
              style={styles.footerButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const CELL_SIZE = 44;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 27, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    zIndex: zIndex.modal,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
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
    ...typography.heading,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  previewText: {
    ...typography.body,
    color: colors.primaryDark,
    flex: 1,
    textTransform: 'capitalize',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navButton: {
    padding: spacing.xs,
  },
  dayOutOfRange: {
    opacity: 0.3,
  },
  monthLabel: {
    ...typography.label,
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  weekday: {
    width: CELL_SIZE,
    textAlign: 'center',
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: {
    backgroundColor: colors.primary,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.primaryDark,
  },
  dayText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  dayTextSelected: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
  dayTextToday: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  footerButton: {
    flex: 1,
  },
});
