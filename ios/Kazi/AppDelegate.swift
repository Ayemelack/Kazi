import UIKit
import FirebaseCore
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    configureFirebaseIfPresent()

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "Kazi",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // KZ-02: configure Firebase only when this build carries a usable
  // GoogleService-Info.plist (it is per environment and copied in at build
  // time, see docs/DEPLOYMENT.md section 6). FirebaseApp.configure raises an
  // Objective-C exception, which Swift cannot catch, when the file is missing
  // or lacks its app or sender id, so those are checked first. Without
  // Firebase the app runs normally with push disabled; the JavaScript side
  // sees no default app and never touches messaging.
  private func configureFirebaseIfPresent() {
    if FirebaseApp.app() != nil {
      return
    }
    guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
          let options = FirebaseOptions(contentsOfFile: path),
          !options.googleAppID.isEmpty,
          !options.gcmSenderID.isEmpty,
          options.bundleID == Bundle.main.bundleIdentifier
    else {
      NSLog("[Kazi] Firebase is not configured for this build; push notifications are disabled.")
      return
    }
    FirebaseApp.configure(options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
