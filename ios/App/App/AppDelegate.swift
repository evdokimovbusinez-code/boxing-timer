import UIKit
import AVFoundation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Экран не гаснет вообще — телефон лежит на полу, руки в перчатках.
        application.isIdleTimerDisabled = true
        // Громко и всегда: звук идёт и при беззвучном режиме, и в фоне. mixWithOthers — музыка в зале не останавливается.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        try? session.setActive(true)
        NotificationCenter.default.addObserver(self, selector: #selector(audioRouteChanged),
                                               name: AVAudioSession.routeChangeNotification, object: nil)
        return true
    }

    // Микрофон для топота WebKit включает режимом «запись и воспроизведение». В нём iOS по умолчанию
    // уводит звук в разговорный динамик (еле слышно — «голоса нет») и глушит хаптику. Возвращаем громкий динамик.
    @objc func audioRouteChanged(_ note: Notification) {
        let session = AVAudioSession.sharedInstance()
        try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        guard session.category == .playAndRecord else { return }
        if session.currentRoute.outputs.contains(where: { $0.portType == .builtInReceiver }) {
            try? session.overrideOutputAudioPort(.speaker)
        }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        application.isIdleTimerDisabled = true
        try? AVAudioSession.sharedInstance().setAllowHapticsAndSystemSoundsDuringRecording(true)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
