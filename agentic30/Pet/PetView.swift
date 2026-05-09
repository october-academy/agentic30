import SwiftUI
import AppKit

/// SwiftUI surface inside the pet panel. Renders the current `WolfState`'s
/// animation, opens the workspace on click, and offers a right-click menu.
struct PetView: View {
    @ObservedObject var stateMachine: WolfStateMachine

    var body: some View {
        AnimatedGIFView(
            state: stateMachine.state,
            onClick: {
                NotificationCenter.default.post(name: .agenticPetOpenWorkspaceRequested, object: nil)
            }
        )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contextMenu {
                Button("Hide Pet") {
                    NotificationCenter.default.post(name: .agenticPetHideRequested, object: nil)
                }
                Button("Open Workspace") {
                    NotificationCenter.default.post(name: .agenticPetOpenWorkspaceRequested, object: nil)
                }
                Divider()
                Button("Quit Agentic30") {
                    NSApp.terminate(nil)
                }
            }
            .background(Color.clear)
    }
}

/// `NSImageView`-backed animator. Uses PNG frame sequences when present so
/// alpha edges stay smooth, and falls back to animated GIFs for older assets.
/// Subclass enables window-by-background drag so the user can grab the pet
/// anywhere on its body and reposition the panel.
struct AnimatedGIFView: NSViewRepresentable {
    let state: WolfState
    var onClick: () -> Void

    func makeNSView(context: Context) -> DraggableImageView {
        let view = DraggableImageView()
        view.imageScaling = .scaleProportionallyUpOrDown
        view.imageAlignment = .alignCenter
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        view.animates = true
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.clear.cgColor
        view.layer?.magnificationFilter = .nearest
        view.layer?.minificationFilter = .nearest
        view.onClick = onClick
        view.configure(asset: WolfImageCache.shared.asset(for: state))
        return view
    }

    func updateNSView(_ nsView: DraggableImageView, context: Context) {
        nsView.onClick = onClick
        nsView.configure(asset: WolfImageCache.shared.asset(for: state))
    }

    static func dismantleNSView(_ nsView: DraggableImageView, coordinator: ()) {
        nsView.stopFrameAnimation()
    }
}

/// `NSImageView` subclass that opts into background-drag for the parent
/// borderless `NSPanel`. Without this, SwiftUI's hit-testing swallows the
/// initial mouse-down and the panel's `isMovableByWindowBackground` never
/// gets a chance to engage.
final class DraggableImageView: NSImageView {
    var onClick: (() -> Void)?

    private var animationFrames: [NSImage] = []
    private var animationFrameIndex = 0
    private var animationIdentifier: String?
    private var animationTimer: Timer?

    override var mouseDownCanMoveWindow: Bool { true }
    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
    }

    fileprivate func configure(asset: WolfAnimationAsset) {
        guard animationIdentifier != asset.identifier else { return }
        animationIdentifier = asset.identifier

        switch asset {
        case .frames(_, let frames, let frameInterval):
            animates = false
            animationFrames = frames
            animationFrameIndex = 0
            image = frames.first
            startFrameAnimation(frameInterval: frameInterval)
        case .gif(let image):
            stopFrameAnimation()
            animationFrames = []
            animates = true
            self.image = image
        }
    }

    fileprivate func stopFrameAnimation() {
        animationTimer?.invalidate()
        animationTimer = nil
    }

    override func mouseDown(with event: NSEvent) {
        let startLocation = NSEvent.mouseLocation
        super.mouseDown(with: event)

        let endLocation = NSEvent.mouseLocation
        let deltaX = endLocation.x - startLocation.x
        let deltaY = endLocation.y - startLocation.y
        let dragDistance = hypot(deltaX, deltaY)
        if dragDistance <= 4 {
            onClick?()
        }
    }

    private func startFrameAnimation(frameInterval: TimeInterval) {
        stopFrameAnimation()
        guard animationFrames.count > 1 else { return }

        let timer = Timer(timeInterval: frameInterval, repeats: true) { [weak self] _ in
            self?.advanceFrame()
        }
        RunLoop.main.add(timer, forMode: .common)
        animationTimer = timer
    }

    private func advanceFrame() {
        guard !animationFrames.isEmpty else { return }
        animationFrameIndex = (animationFrameIndex + 1) % animationFrames.count
        image = animationFrames[animationFrameIndex]
    }
}

private struct WolfFrameNormalization {
    let sourceBodyBounds: CGRect
    let targetBodyCenterX: CGFloat
    let scale: CGFloat
    let preservedSourceBounds: [CGRect]
}

private extension WolfState {
    /// Runtime-only canvas normalization. The source PNGs stay unchanged; these
    /// values scale the visible wolf body to the idle body's 300 px height.
    var frameNormalization: WolfFrameNormalization? {
        switch self {
        case .thinking:
            return WolfFrameNormalization(
                sourceBodyBounds: CGRect(x: 78, y: 73, width: 131, height: 219),
                targetBodyCenterX: 151,
                scale: 300.0 / 219.0,
                preservedSourceBounds: [CGRect(x: 150, y: 0, width: 72, height: 90)]
            )
        case .sleeping:
            return WolfFrameNormalization(
                sourceBodyBounds: CGRect(x: 66, y: 1, width: 169, height: 296),
                targetBodyCenterX: 151,
                scale: 300.0 / 296.0,
                preservedSourceBounds: []
            )
        default:
            return nil
        }
    }
}

fileprivate enum WolfAnimationAsset {
    case frames(String, [NSImage], frameInterval: TimeInterval)
    case gif(NSImage?)

    var identifier: String {
        switch self {
        case .frames(let id, let frames, let frameInterval):
            return "frames:\(id):\(frames.count):\(frameInterval)"
        case .gif(let image):
            guard let image else { return "gif:nil" }
            return "gif:\(ObjectIdentifier(image))"
        }
    }
}

/// Loads wolf assets once and keeps them for the process lifetime.
@MainActor
final class WolfImageCache {
    static let shared = WolfImageCache()
    private var cache: [WolfState: NSImage] = [:]
    private var frameCache: [WolfState: [NSImage]] = [:]
    private let stateSequencePackage: WolfStateSequencePackage?

    private init(stateSequencePackage: WolfStateSequencePackage? = .loadDefault()) {
        self.stateSequencePackage = stateSequencePackage
    }

    fileprivate func asset(for state: WolfState) -> WolfAnimationAsset {
        if let frames = frames(for: state), !frames.isEmpty {
            return .frames(state.assetName, frames, frameInterval: 0.1)
        }
        return .gif(image(for: state))
    }

    func image(for state: WolfState) -> NSImage? {
        if let cached = cache[state] { return cached }
        guard let url = locate(state: state),
              let image = NSImage(byReferencingFile: url.path) else {
            return cache[.idle] ?? makeFallbackImage()
        }
        cache[state] = image
        return image
    }

    private func frames(for state: WolfState) -> [NSImage]? {
        if let cached = frameCache[state] { return cached }

        if let frames = packageFrames(for: state) {
            frameCache[state] = frames
            return frames
        }

        let frames = (0..<120).compactMap { index -> NSImage? in
            guard let url = locateFrame(state: state, index: index) else { return nil }
            guard let image = NSImage(contentsOf: url) ?? NSImage(byReferencingFile: url.path) else {
                return nil
            }
            return normalizedFrame(image, for: state)
        }
        guard !frames.isEmpty else { return nil }

        frameCache[state] = frames
        return frames
    }

    private func packageFrames(for state: WolfState) -> [NSImage]? {
        guard let urls = stateSequencePackage?.frameURLs(for: state) else { return nil }
        let frames = urls.compactMap { url -> NSImage? in
            NSImage(contentsOf: url)
        }
        guard frames.count == WolfStateSequencePackage.requiredFramesPerState else {
            return nil
        }
        return frames
    }

    private func locate(state: WolfState) -> URL? {
        let name = state.assetName
        // Prefer subdirectory layout (Xcode 26 fileSystemSynchronizedGroups
        // preserves folder structure under Resources/wolf/).
        if let url = Bundle.main.url(forResource: name, withExtension: "gif", subdirectory: "wolf") {
            return url
        }
        // Fallback: flat layout (in case the build phase strips the folder).
        if let url = Bundle.main.url(forResource: name, withExtension: "gif") {
            return url
        }
        return nil
    }

    private func locateFrame(state: WolfState, index: Int) -> URL? {
        let name = String(format: "%@-frame-%03d", state.assetName, index)
        if let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "wolf") {
            return url
        }
        if let url = Bundle.main.url(forResource: name, withExtension: "png") {
            return url
        }
        return nil
    }

    private func makeFallbackImage() -> NSImage {
        // Last-resort placeholder so the view never renders empty.
        let size = NSSize(width: 64, height: 64)
        let img = NSImage(size: size)
        img.lockFocus()
        NSColor.systemPink.setFill()
        NSBezierPath(ovalIn: NSRect(origin: .zero, size: size)).fill()
        img.unlockFocus()
        return img
    }

    private func normalizedFrame(_ image: NSImage, for state: WolfState) -> NSImage {
        guard let normalization = state.frameNormalization,
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return image
        }

        let canvasWidth = cgImage.width
        let canvasHeight = cgImage.height
        let sourceBody = normalization.sourceBodyBounds
        let drawWidth = sourceBody.width * normalization.scale
        let drawHeight = sourceBody.height * normalization.scale
        let drawRect = CGRect(
            x: normalization.targetBodyCenterX - drawWidth / 2,
            y: 0,
            width: drawWidth,
            height: drawHeight
        )

        guard let context = CGContext(
            data: nil,
            width: canvasWidth,
            height: canvasHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return image
        }

        context.clear(CGRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight))
        context.interpolationQuality = .none
        if let body = cgImage.cropping(to: sourceBody.integral) {
            context.draw(body, in: drawRect)
        }

        for sourceBounds in normalization.preservedSourceBounds {
            guard let preserved = cgImage.cropping(to: sourceBounds.integral) else { continue }
            let destination = CGRect(
                x: sourceBounds.minX,
                y: CGFloat(canvasHeight) - sourceBounds.maxY,
                width: sourceBounds.width,
                height: sourceBounds.height
            )
            context.draw(preserved, in: destination)
        }

        guard let normalized = context.makeImage() else { return image }
        let result = NSImage(cgImage: normalized, size: image.size)
        result.isTemplate = image.isTemplate
        return result
    }
}

extension Notification.Name {
    static let agenticPetHideRequested = Notification.Name("agenticPetHideRequested")
    static let agenticPetOpenWorkspaceRequested = Notification.Name("agenticPetOpenWorkspaceRequested")
}
