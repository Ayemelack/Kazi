import AsyncStorage from '@react-native-async-storage/async-storage';

const DISMISSED_KEY = 'kazi.announcement.dismissed';

export async function getDismissedAnnouncementId(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(DISMISSED_KEY);
  return raw && raw.length > 0 ? raw : null;
}

export async function setDismissedAnnouncementId(id: number): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, String(id));
}