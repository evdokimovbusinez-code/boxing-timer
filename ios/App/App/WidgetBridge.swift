import Capacitor
import WidgetKit

// Мост «приложение → виджет»: app.js (Widget.sync) кладёт статистику JSON-строкой в общую папку App Group
// и просит iOS перерисовать виджет. Группа — ключ AppGroup в Info.plist (group.<идентификатор приложения>).
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)]

    @objc func save(_ call: CAPPluginCall) {
        let group = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String ?? ""
        UserDefaults(suiteName: group)?.set(call.getString("json") ?? "", forKey: "stats")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}

// Свой плагин регистрируется после загрузки моста. (Свойства CAPBridgeViewController не open — их не трогаем.)
class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}
