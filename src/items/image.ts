import { launchImageLibrary, type ImageLibraryOptions } from 'react-native-image-picker';
import i18n from '../i18n';

export type PickImageResult =
  | { status: 'cancelled' }
  | { status: 'selected'; image: string }
  | { status: 'error'; message: string };

const PICKER_OPTIONS: ImageLibraryOptions = {
  mediaType: 'photo',
  selectionLimit: 1,
  includeBase64: true,
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 0.6,
};

export async function pickImage(): Promise<PickImageResult> {
  const response = await launchImageLibrary(PICKER_OPTIONS);
  if (response.didCancel) {
    return { status: 'cancelled' };
  }
  if (response.errorCode) {
    return { status: 'error', message: i18n.t('products.imageError') };
  }
  const asset = response.assets?.[0];
  const base64 = asset?.base64;
  if (!asset || !base64) {
    return { status: 'cancelled' };
  }
  const mime = asset.type ?? 'image/jpeg';
  return { status: 'selected', image: `data:${mime};base64,${base64}` };
}