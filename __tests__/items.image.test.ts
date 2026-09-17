import { launchImageLibrary } from 'react-native-image-picker';
import { pickImage } from '../src/items/image';

const mockLaunch = launchImageLibrary as jest.MockedFunction<typeof launchImageLibrary>;

describe('pickImage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns cancelled when the user dismisses the picker', async () => {
    mockLaunch.mockResolvedValue({
      didCancel: true,
      errorCode: undefined,
      errorMessage: undefined,
      assets: [],
    } as never);

    await expect(pickImage()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns an error when the picker fails', async () => {
    mockLaunch.mockResolvedValue({
      didCancel: false,
      errorCode: 'camera_unavailable',
      errorMessage: 'Camera unavailable',
      assets: [],
    } as never);

    const result = await pickImage();
    expect(result.status).toBe('error');
  });

  it('returns a data URI when an image is selected', async () => {
    mockLaunch.mockResolvedValue({
      didCancel: false,
      errorCode: undefined,
      assets: [
        { type: 'image/png', base64: 'aGVsbG8=' },
      ],
    } as never);

    await expect(pickImage()).resolves.toEqual({
      status: 'selected',
      image: 'data:image/png;base64,aGVsbG8=',
    });
  });

  it('defaults the mime type when the asset has none', async () => {
    mockLaunch.mockResolvedValue({
      didCancel: false,
      errorCode: undefined,
      assets: [{ base64: 'aGVsbG8=' }],
    } as never);

    await expect(pickImage()).resolves.toEqual({
      status: 'selected',
      image: 'data:image/jpeg;base64,aGVsbG8=',
    });
  });

  it('returns cancelled when the asset carries no base64', async () => {
    mockLaunch.mockResolvedValue({
      didCancel: false,
      errorCode: undefined,
      assets: [{ type: 'image/png' }],
    } as never);

    await expect(pickImage()).resolves.toEqual({ status: 'cancelled' });
  });
});