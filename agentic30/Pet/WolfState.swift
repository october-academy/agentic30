import Foundation

/// 13 desktop-pet animation states. Each rawValue maps to the bundled
/// `wolf-<rawValue>` fallback assets shipped under `agentic30/wolf/`.
enum WolfState: String, CaseIterable, Codable, Equatable, Sendable {
    case idle
    case sleeping
    case attention
    case carrying
    case sweeping
    case happy
    case thinking
    case working
    case typing
    case juggling
    case conducting
    case notification
    case error

    /// Bundle resource name (without extension) for fallback GIF/PNG assets.
    var assetName: String {
        "wolf-\(rawValue)"
    }

    /// Higher = more important. When two transitions race, the higher
    /// priority wins. Mirrors the table in clawd-on-desk's `state.js`
    /// `STATE_PRIORITY`, adapted for our 13-state set.
    var priority: Int {
        switch self {
        case .error:        return 8
        case .notification: return 7
        case .conducting:   return 6
        case .juggling:     return 5
        case .typing:       return 4
        case .working:      return 4
        case .thinking:     return 3
        case .happy:        return 2
        case .sweeping:     return 2
        case .carrying:     return 2
        case .attention:    return 1
        case .idle:         return 0
        case .sleeping:     return -1
        }
    }
}
