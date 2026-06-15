import AppKit

@MainActor
enum AgenticOpenPanelPresenter {
    typealias Completion = (NSApplication.ModalResponse, URL?) -> Void

    static func present(
        configure: (NSOpenPanel) -> Void,
        completion: @escaping Completion
    ) {
        let panel = NSOpenPanel()
        configure(panel)

        NSApp.activate()

        let completionHandler: (NSApplication.ModalResponse) -> Void = { response in
            completion(response, response == .OK ? panel.url : nil)
        }

        if let window = sheetPresentationWindow() {
            panel.beginSheetModal(for: window, completionHandler: completionHandler)
        } else {
            panel.begin(completionHandler: completionHandler)
        }
    }

    private static func sheetPresentationWindow() -> NSWindow? {
        guard let window = presentationWindow(),
              window.sheetParent == nil,
              window.attachedSheet == nil
        else {
            return nil
        }
        return window
    }

    private static func presentationWindow() -> NSWindow? {
        if let keyWindow = NSApp.keyWindow, keyWindow.isVisible, !keyWindow.isMiniaturized {
            return keyWindow
        }
        if let mainWindow = NSApp.mainWindow, mainWindow.isVisible, !mainWindow.isMiniaturized {
            return mainWindow
        }
        return NSApp.windows.first { window in
            window.isVisible && !window.isMiniaturized
        }
    }
}
