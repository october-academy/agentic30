import AppKit
import SwiftUI

/// Hosts the wolf pet inside a borderless, transparent, always-on-top
/// `NSPanel`. The panel joins all Spaces, stays put across active app
/// changes, and persists its frame across launches.
@MainActor
final class PetWindowController {

    private let frameDefaultsKey = "pet.window.frame"
    private let enabledDefaultsKey = "pet.enabled"
    private let petSize = NSSize(width: 114, height: 114)

    private var panel: NSPanel?
    private var hostingController: NSHostingController<PetView>?
    private weak var stateMachine: WolfStateMachine?

    /// Wires the controller to a state machine. Idempotent.
    func attach(stateMachine: WolfStateMachine) {
        self.stateMachine = stateMachine
        hostingController?.rootView = PetView(stateMachine: stateMachine)
    }

    /// Whether the pet window should appear on launch.
    var isEnabled: Bool {
        get {
            // Default ON for first launch.
            if UserDefaults.standard.object(forKey: enabledDefaultsKey) == nil {
                return true
            }
            return UserDefaults.standard.bool(forKey: enabledDefaultsKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: enabledDefaultsKey)
            if newValue {
                show()
            } else {
                hide()
            }
        }
    }

    func show() {
        if panel == nil {
            panel = makePanel()
        }
        guard let panel else { return }
        applyPetSize(to: panel)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    func toggle() {
        if panel?.isVisible == true {
            hide()
        } else {
            show()
        }
    }

    // MARK: - Panel construction

    private func makePanel() -> NSPanel {
        guard let stateMachine else {
            // No state machine attached yet — still build the panel with a
            // placeholder; `attach` will swap the rootView later.
            let placeholder = WolfStateMachine()
            return makePanel(with: placeholder)
        }
        return makePanel(with: stateMachine)
    }

    private func makePanel(with stateMachine: WolfStateMachine) -> NSPanel {
        let initialFrame = restoredFrame() ?? defaultFrame()
        let panel = PetPanel(
            contentRect: initialFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isMovableByWindowBackground = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.hidesOnDeactivate = false

        let hosting = NSHostingController(rootView: PetView(stateMachine: stateMachine))
        hosting.view.frame = NSRect(origin: .zero, size: initialFrame.size)
        hosting.view.autoresizingMask = [.width, .height]
        // NSHostingController's view is layer-backed and paints a system
        // background by default — overrule it so the panel's transparent
        // backgroundColor shows through.
        hosting.view.wantsLayer = true
        hosting.view.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = hosting.view
        panel.setContentSize(petSize)
        panel.setFrame(normalizedFrame(from: panel.frame), display: false)
        self.hostingController = hosting

        // Persist frame on move/resize.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(persistFrame),
            name: NSWindow.didMoveNotification,
            object: panel
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(persistFrame),
            name: NSWindow.didResizeNotification,
            object: panel
        )

        return panel
    }

    @objc private func persistFrame() {
        guard let panel else { return }
        UserDefaults.standard.set(NSStringFromRect(normalizedFrame(from: panel.frame)), forKey: frameDefaultsKey)
    }

    private func restoredFrame() -> NSRect? {
        guard let raw = UserDefaults.standard.string(forKey: frameDefaultsKey) else {
            return nil
        }
        let rect = NSRectFromString(raw)
        guard rect.width > 0, rect.height > 0 else { return nil }
        return normalizedFrame(from: rect)
    }

    private func applyPetSize(to panel: NSPanel) {
        let nextFrame = normalizedFrame(from: panel.frame)
        if panel.frame.size != nextFrame.size {
            panel.setFrame(nextFrame, display: true)
            hostingController?.view.frame = NSRect(origin: .zero, size: nextFrame.size)
        }
        UserDefaults.standard.set(NSStringFromRect(nextFrame), forKey: frameDefaultsKey)
    }

    private func normalizedFrame(from rect: NSRect) -> NSRect {
        NSRect(
            x: rect.midX - petSize.width / 2,
            y: rect.midY - petSize.height / 2,
            width: petSize.width,
            height: petSize.height
        )
    }

    private func defaultFrame() -> NSRect {
        // Bottom-right of the main screen, with a small inset.
        guard let screen = NSScreen.main else {
            return NSRect(x: 100, y: 100, width: petSize.width, height: petSize.height)
        }
        let visible = screen.visibleFrame
        return NSRect(
            x: visible.maxX - petSize.width - 24,
            y: visible.minY + 24,
            width: petSize.width,
            height: petSize.height
        )
    }

}

/// `NSPanel` subclass that opts into key-window status so SwiftUI
/// gestures and drag work even though `styleMask` is borderless.
private final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
