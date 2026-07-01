import SwiftUI

// StyleSeed design lock — enforceable token layer (see STYLESEED.md at repo root).
// Additive and non-breaking: these tokens reuse the existing OpenDesignDayColor palette
// and Agentic30Theme. Adopt them on surfaces as they are touched; do not mass-rewrite.

// MARK: - Radius (Soft personality)
// One radius personality. Stray values (2,3,4,5,6,7,9,11,12,13,16,…) snap to the nearest step.
enum OpenDesignRadius {
    static let chip: CGFloat = 8      // badges, tags, small pills, status containers
    static let control: CGFloat = 10  // buttons, list rows, inputs
    static let card: CGFloat = 14     // cards, panels, sheets
    static let pill: CGFloat = 999    // fully-round toggles / segmented controls
}

// MARK: - Type scale (StyleSeed table → SwiftUI pt)
// Numbers pair with units at ~2:1; labels are uppercase + tracked at the call site.
enum OpenDesignType {
    enum Role {
        case hero, kpi, sectionTitle, listName, listAmount, body, label, caption, trend

        var size: CGFloat {
            switch self {
            case .hero: 46
            case .kpi: 34
            case .sectionTitle: 17
            case .listName: 14
            case .listAmount: 16
            case .body: 13
            case .label: 11
            case .caption: 11
            case .trend: 12
            }
        }

        var weight: Font.Weight {
            switch self {
            case .hero, .kpi, .sectionTitle, .listName: .semibold
            case .listAmount: .bold
            case .label, .trend: .medium
            case .body, .caption: .regular
            }
        }
    }

    static func font(_ role: Role, rounded: Bool = false) -> Font {
        .system(size: role.size, weight: role.weight, design: rounded ? .rounded : .default)
    }
}

// MARK: - Motion (Snap seed)
// Crisp, no bounce. Honor reduceMotion at call sites via `snap(reduceMotion:)`.
enum OpenDesignMotion {
    static let durationFast: Double = 0.12
    static let durationNormal: Double = 0.18
    static let durationSlow: Double = 0.30

    static func snap(_ duration: Double = durationNormal) -> Animation {
        .timingCurve(0.2, 0, 0, 1, duration: duration)
    }

    static func snap(reduceMotion: Bool, _ duration: Double = durationNormal) -> Animation {
        .timingCurve(0.2, 0, 0, 1, duration: reduceMotion ? 0 : duration)
    }
}

// MARK: - Shadow language (layered, low-opacity, black-based; dark → hairline border)
// Never use a foreground/accent-tinted shadow — it renders as a white/colored glow on dark.
enum OpenDesignShadow {
    static var cardColor: Color {
        Agentic30Theme.current == .white ? Color.black.opacity(0.05) : .clear
    }
    static let cardRadius: CGFloat = 3
    static let cardY: CGFloat = 1

    static var elevatedColor: Color {
        Agentic30Theme.current == .white ? Color.black.opacity(0.08) : .clear
    }
    static let elevatedRadius: CGFloat = 12
    static let elevatedY: CGFloat = 4
}

// MARK: - Ink (near-black text on light/white control fills; never pure #000)
// StyleSeed: the darkest text is ~#2A2A2A, not #000. Used for dark text on a white CTA.
enum OpenDesignInk {
    static let onLightStrong = Color(red: 0.165, green: 0.165, blue: 0.165)
    static let onLightMuted = Color(red: 0.165, green: 0.165, blue: 0.165).opacity(0.42)
}

extension View {
    func openDesignCardShadow() -> some View {
        shadow(color: OpenDesignShadow.cardColor, radius: OpenDesignShadow.cardRadius, x: 0, y: OpenDesignShadow.cardY)
    }

    func openDesignElevatedShadow() -> some View {
        shadow(color: OpenDesignShadow.elevatedColor, radius: OpenDesignShadow.elevatedRadius, x: 0, y: OpenDesignShadow.elevatedY)
    }
}
