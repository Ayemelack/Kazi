// Notification-tap navigation: where a pushed screen opens, in any app state.
//
// A tap arrives in three situations:
// - foreground: the navigator exists and is ready — navigate immediately;
// - background/terminated: notifee's background handler fires while the app
//   is still starting, before any navigator exists — the push is queued;
// - after sign-in: AppStack mounts, registers the navigator, and the queued
//   push is flushed (pushNavigation.ts stays agnostic of auth).
//
// Everything here is deliberately defensive: a tap must never crash the app,
// and a route that does not exist in the current app state is dropped.

import { createNavigationContainerRef } from '@react-navigation/native';
import type { ParsedPush } from '@kazi/shared';
import type { RootStackParamList } from '../navigation/RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** The slice of the navigation container this module needs; tests use a fake. */
export interface PushNavigator {
  isReady(): boolean;
  navigate(name: string, params?: object): void;
}

let navigator: PushNavigator | null = null;
let pending: ParsedPush | null = null;

/** AppStack registers the navigator on mount and clears it on unmount. */
export function setPushNavigator(next: PushNavigator | null): void {
  navigator = next;
  if (next !== null && pending !== null) {
    const push = pending;
    pending = null;
    open(push);
  }
}

/** Where a push opens, or null when it has no screen to open (display only). */
export function pushRoute(push: ParsedPush): { name: string; params?: object } | null {
  if (push.type === 'low_stock') {
    // The item itself when it is named, otherwise the stock list.
    return push.itemId === null
      ? { name: 'Main', params: { screen: 'Products' } }
      : {
          name: 'Main',
          params: {
            screen: 'Products',
            params: { screen: 'ProductForm', params: { itemId: push.itemId } },
          },
        };
  }
  if (push.type === 'inactivity') {
    // A re-engagement nudge names no record: open the account's Home tab, the
    // verified authenticated landing screen.
    return { name: 'Main', params: { screen: 'Home' } };
  }
  return null;
}

/** Handles a tap on a push. Queues the navigation when no navigator is ready. */
export function handlePushOpened(push: ParsedPush): void {
  try {
    if (pushRoute(push) === null) {
      return;
    }
    if (navigator === null || !navigator.isReady()) {
      pending = push;
      return;
    }
    open(push);
  } catch {
    // A navigation failure must never crash a notification tap.
  }
}

function open(push: ParsedPush): void {
  const route = pushRoute(push);
  if (route === null || navigator === null) {
    return;
  }
  try {
    navigator.navigate(route.name, route.params);
  } catch {
    // No such route in this app state (e.g. still on the auth flow): drop it.
  }
}
