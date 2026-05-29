import AppKit
import SwiftUI

enum Agentic30Theme: String, CaseIterable, Identifiable, Codable {
    case white
    case dark

    static let storageKey = "agentic30.appearance.theme.v1"
    static let defaultTheme: Agentic30Theme = .white

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .white: "White"
        case .dark: "Dark"
        }
    }

    var detail: String {
        switch self {
        case .white: "day-white.html 기반의 밝은 기본 테마"
        case .dark: "기존 Agentic30 다크 테마"
        }
    }

    var colorScheme: ColorScheme {
        switch self {
        case .white: .light
        case .dark: .dark
        }
    }

    var appKitAppearanceName: NSAppearance.Name {
        switch self {
        case .white: .aqua
        case .dark: .darkAqua
        }
    }

    var windowBackgroundColor: NSColor {
        switch self {
        case .white:
            NSColor(red: 0.9698, green: 0.9778, blue: 0.9838, alpha: 1.0)
        case .dark:
            NSColor(red: 0.0801, green: 0.0874, blue: 0.0928, alpha: 1.0)
        }
    }

    static func normalized(_ rawValue: String?) -> Agentic30Theme {
        guard let rawValue, let theme = Agentic30Theme(rawValue: rawValue) else {
            return defaultTheme
        }
        return theme
    }

    static var current: Agentic30Theme {
        normalized(UserDefaults.standard.string(forKey: storageKey))
    }

    func applyAppKitAppearance() {
        NSApp.appearance = NSAppearance(named: appKitAppearanceName)
    }
}

private struct Agentic30ThemeApplicator: ViewModifier {
    @AppStorage(Agentic30Theme.storageKey) private var themeRawValue = Agentic30Theme.defaultTheme.rawValue

    private var theme: Agentic30Theme {
        Agentic30Theme.normalized(themeRawValue)
    }

    func body(content: Content) -> some View {
        content
            .preferredColorScheme(theme.colorScheme)
            .onAppear {
                theme.applyAppKitAppearance()
            }
            .onChange(of: themeRawValue) { _, newValue in
                Agentic30Theme.normalized(newValue).applyAppKitAppearance()
            }
    }
}

extension View {
    func agentic30Themed() -> some View {
        modifier(Agentic30ThemeApplicator())
    }
}

enum Agentic30BrandColor {
    static var green: Color { OpenDesignDayColor.accent }

    static var greenBright: Color {
        switch Agentic30Theme.current {
        case .white:
            Color(red: 0.0000, green: 0.5144, blue: 0.2936)
        case .dark:
            Color(red: 0.294, green: 0.871, blue: 0.502)
        }
    }
}
