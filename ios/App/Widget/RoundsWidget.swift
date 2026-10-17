// Виджет «Раунды» на экране «Домой»: серия недель с выполненной целью, неделя к цели, календарь 12 недель.
// Данные пишет приложение (WidgetBridge.swift) в общую папку App Group. Неделю и серию виджет считает сам по
// сегодняшней дате — иначе в понедельник показывал бы прошлую неделю, пока не откроешь приложение.
import WidgetKit
import SwiftUI

struct Stats: Decodable {
    let goal: Int
    let best: Int
    let days: [String: Int]   // «ГГГГ-ММ-ДД» → раундов за день
    let weeks: [String: Int]  // понедельник → тренировок за неделю
    let t: [String: String]   // подписи на языке приложения
}

enum Store {
    static func load() -> Stats? {
        let group = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String ?? ""
        guard let s = UserDefaults(suiteName: group)?.string(forKey: "stats"), let d = s.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Stats.self, from: d)
    }
}

struct Calc {
    let streak: Int, best: Int, week: Int, goal: Int
    let grid: [[Int]] // 12 недель × 7 дней; -1 — день ещё не наступил

    init(_ s: Stats, now: Date) {
        let cal = Calendar(identifier: .gregorian)
        let f = DateFormatter()
        f.calendar = cal; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .current; f.dateFormat = "yyyy-MM-dd"
        let today = cal.startOfDay(for: now)
        let monday = cal.date(byAdding: .day, value: -((cal.component(.weekday, from: today) + 5) % 7), to: today)!
        func week(_ k: Int) -> Date { cal.date(byAdding: .day, value: 7 * k, to: monday)! }
        func met(_ d: Date) -> Bool { (s.weeks[f.string(from: d)] ?? 0) >= s.goal }
        var k = met(monday) ? 0 : -1, n = 0 // текущая неделя, пока не закрыта, серию не рвёт
        while met(week(k)) { n += 1; k -= 1 }
        streak = n; best = max(s.best, n); goal = max(1, s.goal)
        self.week = s.weeks[f.string(from: monday)] ?? 0
        grid = (0..<12).map { c in (0..<7).map { r in
            let d = cal.date(byAdding: .day, value: r, to: week(c - 11))!
            return d > today ? -1 : (s.days[f.string(from: d)] ?? 0)
        } }
    }
}

struct Entry: TimelineEntry { let date: Date; let stats: Stats? }

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), stats: nil) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: Date(), stats: Store.load())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // Обновляемся сразу после полуночи (новый день — новый квадрат в календаре) и когда приложение запишет тренировку.
        let next = Calendar.current.startOfDay(for: Date().addingTimeInterval(86_400)).addingTimeInterval(60)
        completion(Timeline(entries: [Entry(date: Date(), stats: Store.load())], policy: .after(next)))
    }
}

let accent = Color(red: 1, green: 0.2, blue: 0.278)
let background = Color(red: 0.043, green: 0.043, blue: 0.051)

struct Summary: View {
    let c: Calc, t: [String: String]
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("🔥").font(.system(size: 24))
                Text("\(c.streak)").font(.system(size: 44, weight: .heavy, design: .rounded)).foregroundColor(.white)
            }
            Text(t["streak"] ?? "").font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundColor(.white.opacity(0.6))
            Spacer(minLength: 6)
            Text("\(t["week"] ?? "") \(c.week)/\(c.goal)").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundColor(.white)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.15))
                    Capsule().fill(accent).frame(width: g.size.width * min(1, CGFloat(c.week) / CGFloat(c.goal)))
                }
            }.frame(height: 6)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Heat: View {
    let grid: [[Int]]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<grid.count, id: \.self) { c in
                VStack(spacing: 3) {
                    ForEach(0..<7, id: \.self) { r in
                        RoundedRectangle(cornerRadius: 2).fill(color(grid[c][r])).aspectRatio(1, contentMode: .fit)
                    }
                }
            }
        }
    }
    // Ярче — больше раундов за день (как в приложении: 1–3, 4–7, 8–11, 12+).
    func color(_ r: Int) -> Color {
        if r < 0 { return .clear }
        if r == 0 { return Color.white.opacity(0.1) }
        return accent.opacity(r >= 12 ? 1 : r >= 8 ? 0.8 : r >= 4 ? 0.55 : 0.3)
    }
}

struct WidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry
    var body: some View {
        let s = entry.stats
        let t = s?.t ?? [:]
        Group {
            if let s = s {
                let c = Calc(s, now: entry.date)
                if family == .systemMedium {
                    HStack(spacing: 14) { Summary(c: c, t: t); Heat(grid: c.grid) }
                } else {
                    Summary(c: c, t: t)
                }
            } else {
                // Тренировок ещё нет (или приложение не открывали после установки виджета)
                VStack(alignment: .leading, spacing: 6) {
                    Text("🥊").font(.system(size: 34))
                    Text("Раунды").font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundColor(.white)
                    Text("Открой приложение и проведи тренировку").font(.system(size: 12, design: .rounded)).foregroundColor(.white.opacity(0.6))
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.widgetBackground(background)
    }
}

extension View {
    // iOS 17+ требует фон виджета через containerBackground, иначе вместо виджета — заглушка.
    @ViewBuilder func widgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            padding().background(color)
        }
    }
}

@main
struct RoundsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RoundsWidget", provider: Provider()) { WidgetView(entry: $0) }
            .configurationDisplayName("Раунды")
            .description("Серия недель и тренировки")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
