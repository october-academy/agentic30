import AppKit
import Combine
import Foundation
import ServiceManagement
import SwiftUI

protocol LoginItemRegistering {
    func register() throws
    func unregister() throws
    var isRegistered: Bool { get }
}

struct SMAppServiceRegistrar: LoginItemRegistering {
    func register() throws { try SMAppService.mainApp.register() }
    func unregister() throws { try SMAppService.mainApp.unregister() }
    var isRegistered: Bool { SMAppService.mainApp.status == .enabled }
}

@MainActor
final class LoginItemsManager: ObservableObject {
    static let autoEnrollAttemptedKey = "agentic30.loginItem.autoEnrollAttempted.v1"

    static let shared = LoginItemsManager()

    @Published private(set) var isEnabled: Bool = false

    private let registrar: LoginItemRegistering
    private let defaults: UserDefaults

    init(
        registrar: LoginItemRegistering? = nil,
        defaults: UserDefaults = .standard
    ) {
        self.registrar = registrar ?? SMAppServiceRegistrar()
        self.defaults = defaults
        syncFromSystem()
    }

    func autoEnrollIfFirstLaunch(isFirstLaunchEver: Bool) {
        guard isFirstLaunchEver else { return }
        guard !defaults.bool(forKey: Self.autoEnrollAttemptedKey) else { return }
        defaults.set(true, forKey: Self.autoEnrollAttemptedKey)
        setEnabled(true)
    }

    func setEnabled(_ desired: Bool) {
        do {
            if desired {
                try registrar.register()
            } else {
                try registrar.unregister()
            }
        } catch {
            NSLog("[LoginItemsManager] register/unregister failed: \(error.localizedDescription)")
        }
        syncFromSystem()
    }

    func refresh() {
        syncFromSystem()
    }

    private func syncFromSystem() {
        isEnabled = registrar.isRegistered
    }

    static func wasLaunchedAtLogin() -> Bool {
        guard let event = NSAppleEventManager.shared().currentAppleEvent,
              event.eventID == kAEOpenApplication,
              let propData = event.paramDescriptor(forKeyword: keyAEPropData) else {
            return false
        }
        return propData.enumCodeValue == keyAELaunchedAsLogInItem
    }
}
