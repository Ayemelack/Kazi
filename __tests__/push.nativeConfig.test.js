// KZ-02 / KZ-03: the native push setup can't be built on every machine (iOS
// needs a Mac), so these checks keep the configuration from silently breaking.
// The ios-build CI job (.github/workflows/ci.yml) does the real build and the
// launch-without-Firebase check on macOS. Plain JS: it reads files with fs.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// Top-level <key>/<value> pairs of an XML plist's root <dict>, as raw XML.
function plistKeys(xml) {
  const body = xml.slice(xml.indexOf('<dict>') + '<dict>'.length, xml.lastIndexOf('</dict>'));
  const keys = {};
  let depth = 0;
  let current = null;
  for (const token of body.match(/<\/?[a-zA-Z]+\/?>|[^<]+/g)) {
    if (depth === 0 && token === '<key>') {
      current = '';
      continue;
    }
    if (current !== null && depth === 0 && token === '</key>') {
      keys[current.trim()] = '';
      current = { key: current.trim() };
      continue;
    }
    if (typeof current === 'string') {
      current += token;
      continue;
    }
    if (current && typeof current === 'object') {
      keys[current.key] += token;
      if (/^<[a-zA-Z]+>$/.test(token)) depth += 1;
      if (/^<\/[a-zA-Z]+>$/.test(token)) depth -= 1;
      if (depth === 0 && !/^\s+$/.test(token)) current = null;
    }
  }
  return keys;
}

describe('iOS push configuration (KZ-02)', () => {
  const info = plistKeys(read('ios/Kazi/Info.plist'));

  it('declares remote-notification background mode and no empty usage strings', () => {
    expect(info.UIBackgroundModes).toMatch(/<string>remote-notification<\/string>/);
    expect(info).not.toHaveProperty('NSLocationWhenInUseUsageDescription');
    for (const [key, value] of Object.entries(info)) {
      if (key.endsWith('UsageDescription')) {
        expect(value.replace(/<\/?string>/g, '').trim()).not.toBe('');
      }
    }
  });

  it('has the Push entitlement wired into both build configurations', () => {
    expect(plistKeys(read('ios/Kazi/Kazi.entitlements'))['aps-environment']).toMatch(
      /<string>development<\/string>/,
    );
    const pbx = read('ios/Kazi.xcodeproj/project.pbxproj');
    expect(pbx.match(/CODE_SIGN_ENTITLEMENTS = Kazi\/Kazi\.entitlements;/g)).toHaveLength(2);
    expect(pbx).toMatch(/path = Kazi\/Kazi\.entitlements;/);
  });

  it('copies GoogleService-Info.plist only when present, as a build phase of the app target', () => {
    const pbx = read('ios/Kazi.xcodeproj/project.pbxproj');
    const id = '4B2A0C1E2F6D4A0002C0FFEE';
    const phases = pbx.slice(pbx.indexOf('buildPhases = ('), pbx.indexOf(');', pbx.indexOf('buildPhases = (')));
    expect(phases).toContain(id);
    const phase = pbx.slice(pbx.indexOf(`${id} /* [Kazi] Copy`, pbx.indexOf('Begin PBXShellScriptBuildPhase')));
    expect(phase).toMatch(/if \[ -f \\"\$PLIST\\" \]; then/);
    expect(phase).toMatch(/echo \\"warning: /);
    // Balanced, so Xcode can parse the file.
    const unquoted = pbx.replace(/"(?:[^"\\]|\\.)*"/g, '');
    expect((unquoted.match(/\{/g) || []).length).toBe((unquoted.match(/\}/g) || []).length);
    expect((unquoted.match(/\(/g) || []).length).toBe((unquoted.match(/\)/g) || []).length);
  });

  it('keeps the plist out of git', () => {
    expect(read('.gitignore').split('\n')).toContain('ios/Kazi/GoogleService-Info.plist');
  });

  it('sets the RNFB Podfile flags before any target block', () => {
    const podfile = read('ios/Podfile');
    const target = podfile.indexOf("target 'Kazi'");
    for (const line of [
      '$RNFirebaseDisableSPM = true',
      '$RNFirebaseAsStaticFramework = true',
      'use_frameworks! :linkage => :static',
    ]) {
      const at = podfile.indexOf(`\n${line}\n`);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(target);
    }
  });

  it('configures Firebase only behind the plist checks, before React Native starts', () => {
    const swift = read('ios/Kazi/AppDelegate.swift');
    expect(swift).toMatch(/import FirebaseCore/);
    expect(swift.match(/FirebaseApp\.configure\(/g)).toHaveLength(1);
    expect(swift).toMatch(/FirebaseApp\.configure\(options: options\)/);
    expect(swift).toMatch(/FirebaseOptions\(contentsOfFile: path\)/);
    expect(swift.indexOf('configureFirebaseIfPresent()')).toBeLessThan(swift.indexOf('factory.startReactNative'));
  });
});

describe('Android / shared push configuration (KZ-03)', () => {
  it('keeps native FCM auto-init off so a placeholder build never fetches a token', () => {
    expect(JSON.parse(read('firebase.json'))['react-native'].messaging_auto_init_enabled).toBe(false);
  });

  it('ships the placeholder google-services.json the app recognises', () => {
    const { isPlaceholderFirebaseProject } = require('../src/notifications/firebase');
    const config = JSON.parse(read('android/app/google-services.json'));
    expect(config.client[0].client_info.android_client_info.package_name).toBe('com.kazi.app');
    expect(
      isPlaceholderFirebaseProject({
        projectId: config.project_info.project_id,
        messagingSenderId: config.project_info.project_number,
      }),
    ).toBe(true);
  });
});
