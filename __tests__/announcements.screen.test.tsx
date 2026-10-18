import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import '../src/i18n';
import MoreScreen from '../src/screens/more/MoreScreen';
import { ToastProvider } from '../src/components/ui/Toast';
import { AuthProvider } from '../src/auth/AuthContext';
import { fetchActiveAnnouncement } from '../src/announcements/api';
import { fetchUnreadCount } from '../src/notifications/api';
import { getDismissedAnnouncementId, setDismissedAnnouncementId } from '../src/announcements/storage';
import type { Announcement } from '../src/announcements/types';

jest.setTimeout(20000);

jest.mock('../src/announcements/api', () => ({
  fetchActiveAnnouncement: jest.fn(),
}));

jest.mock('../src/notifications/api', () => ({
  fetchUnreadCount: jest.fn(async () => ({ unread: 0 })),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const Context = ReactModule.createContext(zero);
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaConsumer: ({ children }: { children: (insets: typeof zero) => React.ReactNode }) =>
      children(zero),
    SafeAreaInsetsContext: Context,
    useSafeAreaInsets: () => zero,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 0, height: 0 },
      insets: zero,
    },
  };
});

const navigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  // MoreScreen refreshes its unread badge whenever it is focused again.
  addListener: jest.fn(() => () => {}),
} as never;

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderScreen(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ToastProvider>
        <AuthProvider>
          <MoreScreen navigation={navigation} route={{} as never} />
        </AuthProvider>
      </ToastProvider>,
    );
  });
  await flush();
  return renderer!;
}

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 1,
    bodyEn: 'Maintenance tonight from 23:00 to 02:00',
    bodyFr: 'Maintenance cette nuit de 23h à 02h',
    bodyPid: 'We go do maintenance tonight',
    minVersion: '',
    maxVersion: '',
    ...overrides,
  };
}

describe('MoreScreen announcements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows no card when the server has none', async () => {
    (fetchActiveAnnouncement as jest.Mock).mockResolvedValue(null);
    const renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: 'announcement-body' })).toHaveLength(0);
  });

  it('shows the announcement text', async () => {
    (fetchActiveAnnouncement as jest.Mock).mockResolvedValue(announcement({ id: 3 }));
    const renderer = await renderScreen();
    const body = renderer.root.findByProps({ testID: 'announcement-body' });
    expect(body.props.children).toBe('Maintenance tonight from 23:00 to 02:00');
    expect(renderer.root.findByProps({ testID: 'announcement-dismiss' })).toBeTruthy();
  });

  it('hides a card that was dismissed on the device', async () => {
    (fetchActiveAnnouncement as jest.Mock).mockResolvedValue(announcement({ id: 2 }));
    await act(async () => {
      await setDismissedAnnouncementId(2);
    });
    const renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: 'announcement-body' })).toHaveLength(0);
  });

  it('dismisses the card and keeps it dismissed the next time it mounts', async () => {
    (fetchActiveAnnouncement as jest.Mock).mockResolvedValue(announcement({ id: 4 }));
    const renderer = await renderScreen();
    expect(renderer.root.findByProps({ testID: 'announcement-body' })).toBeTruthy();

    await act(async () => {
      renderer.root.findByProps({ testID: 'announcement-dismiss' }).props.onPress();
    });
    expect(renderer.root.findAllByProps({ testID: 'announcement-body' })).toHaveLength(0);
    expect(await getDismissedAnnouncementId()).toBe('4');

    const remounted = await renderScreen();
    expect(remounted.root.findAllByProps({ testID: 'announcement-body' })).toHaveLength(0);
  });

  it('does not break the screen when the remote fetch fails', async () => {
    (fetchActiveAnnouncement as jest.Mock).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: 'announcement-body' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'more-reminder' })).toBeTruthy();
  });

  it('shows the unread count on the Notifications row', async () => {
    (fetchUnreadCount as jest.Mock).mockResolvedValue({ unread: 3 });
    const renderer = await renderScreen();
    expect(renderer.root.findByProps({ testID: 'notifications-badge' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: '3' })).toBeTruthy();
  });

  it('shows no badge when everything has been read', async () => {
    (fetchUnreadCount as jest.Mock).mockResolvedValue({ unread: 0 });
    const renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: 'notifications-badge' })).toHaveLength(0);
  });

  it('leaves the row alone when the unread count cannot be fetched', async () => {
    (fetchUnreadCount as jest.Mock).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: 'notifications-badge' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'more-notifications' })).toBeTruthy();
  });
});