import * as Keychain from 'react-native-keychain';

export type BiometryKind = 'fingerprint' | 'face' | 'iris' | 'touchid' | 'faceid' | 'optic';

const BIOMETRIC_SERVICE = 'com.kazi.app.lock.fingerprint';

export async function getBiometryType(): Promise<BiometryKind | null> {
  try {
    const type = await Keychain.getSupportedBiometryType();
    if (!type) {
      return null;
    }
    switch (type) {
      case Keychain.BIOMETRY_TYPE.FINGERPRINT:
        return 'fingerprint';
      case Keychain.BIOMETRY_TYPE.FACE:
        return 'face';
      case Keychain.BIOMETRY_TYPE.IRIS:
        return 'iris';
      case Keychain.BIOMETRY_TYPE.TOUCH_ID:
        return 'touchid';
      case Keychain.BIOMETRY_TYPE.FACE_ID:
        return 'faceid';
      case Keychain.BIOMETRY_TYPE.OPTIC_ID:
        return 'optic';
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function biometryLabel(kind: BiometryKind | null, fallback: string): string {
  switch (kind) {
    case 'face':
    case 'faceid':
      return 'Face ID';
    case 'iris':
      return 'Iris';
    case 'touchid':
      return 'Touch ID';
    case 'fingerprint':
      return 'Fingerprint';
    default:
      return fallback;
  }
}

export async function promptBiometric(title: string): Promise<boolean> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: BIOMETRIC_SERVICE,
      authenticationPrompt: { title },
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
    });
    return credentials !== false;
  } catch {
    return false;
  }
}
