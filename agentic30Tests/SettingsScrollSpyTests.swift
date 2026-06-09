import XCTest
@testable import agentic30

/// Unit coverage for the settings sidebar scroll-spy decision. The SwiftUI plumbing
/// (coordinate space, GeometryReader preferences) is exercised by the UI suite; here we
/// pin the pure `activeSection` math so the highlight rule stays deterministic.
final class SettingsScrollSpyTests: XCTestCase {

    // Representative layout: a couple of short sections, two tall ones, then short tails.
    private let layout: [(SettingsSection, CGFloat)] = [
        (.appearance, 110),
        (.workspace, 120),
        (.menubar, 110),
        (.providers, 600),
        (.integrations, 700),
        (.privacy, 160),
        (.updates, 200),
        (.advanced, 260),
    ]

    private let viewportHeight: CGFloat = 650
    private let topInset: CGFloat = 22

    /// Builds section frames in the scroll viewport coordinate space for a given scroll
    /// distance. minY/maxY shrink uniformly as the content scrolls upward.
    private func frames(
        scrolledBy distance: CGFloat,
        layout: [(SettingsSection, CGFloat)]? = nil
    ) -> [SettingsSection: SettingsSectionFrame] {
        var result: [SettingsSection: SettingsSectionFrame] = [:]
        var y = topInset - distance
        for (section, height) in (layout ?? self.layout) {
            result[section] = SettingsSectionFrame(minY: y, maxY: y + height)
            y += height
        }
        return result
    }

    private func active(
        _ frames: [SettingsSection: SettingsSectionFrame],
        viewportHeight: CGFloat? = nil
    ) -> SettingsSection? {
        SettingsScrollSpy.activeSection(
            order: SettingsSection.allCases,
            frames: frames,
            viewportHeight: viewportHeight ?? self.viewportHeight
        )
    }

    func testAtTopHighlightsFirstSection() {
        XCTAssertEqual(active(frames(scrolledBy: 0)), .appearance)
    }

    func testSecondSectionActivatesOnceItsTopCrossesTheLine() {
        // workspace top = topInset + appearance height = 132; crosses the 64pt line at D=68.
        XCTAssertEqual(active(frames(scrolledBy: 70)), .workspace)
    }

    func testTallSectionStaysActiveWhileScrollingThroughItsBody() {
        // Deep inside `providers`: its top is well above the line but the next section
        // (`integrations`) has not yet reached it.
        XCTAssertEqual(active(frames(scrolledBy: 600)), .providers)
    }

    func testScrolledToBottomPinsTheLastSection() {
        // Max scroll aligns the content bottom with the viewport bottom. The standard rule
        // alone would stop at `privacy`; the bottom-edge rule must upgrade to `advanced`.
        let contentBottom = topInset + layout.reduce(0) { $0 + $1.1 } // 2282
        let maxScroll = contentBottom - viewportHeight // 1632
        let atBottom = frames(scrolledBy: maxScroll)
        XCTAssertEqual(active(atBottom), .advanced)

        // Sanity: the bottom-edge branch is what changed the answer.
        let lastPassed = SettingsSection.allCases.last { (atBottom[$0]?.minY ?? .infinity) <= SettingsScrollSpy.defaultActivationLine }
        XCTAssertEqual(lastPassed, .privacy)
    }

    func testContentShorterThanViewportDoesNotJumpToLastSection() {
        let shortLayout: [(SettingsSection, CGFloat)] = [
            (.appearance, 100),
            (.workspace, 100),
            (.menubar, 100),
        ]
        // Nothing scrolled, content fits entirely — the first section stays active.
        XCTAssertEqual(active(frames(scrolledBy: 0, layout: shortLayout)), .appearance)
    }

    func testActivationLineBoundaryIsInclusive() {
        // Put workspace's top exactly on the activation line.
        var custom = frames(scrolledBy: 0)
        custom[.workspace] = SettingsSectionFrame(minY: SettingsScrollSpy.defaultActivationLine, maxY: 400)
        custom[.appearance] = SettingsSectionFrame(minY: -50, maxY: SettingsScrollSpy.defaultActivationLine)
        XCTAssertEqual(active(custom), .workspace)
    }

    func testWorksWithASearchFilteredSubsetOfSections() {
        // Sidebar search can hide sections; scroll-spy must operate on whatever is present.
        let subset: [SettingsSection: SettingsSectionFrame] = [
            .providers: SettingsSectionFrame(minY: -100, maxY: 500),
            .integrations: SettingsSectionFrame(minY: 300, maxY: 1000),
        ]
        XCTAssertEqual(active(subset), .providers)
    }

    func testEmptyFramesReturnsNil() {
        XCTAssertNil(active([:]))
    }

    func testZeroViewportHeightFallsBackToStandardRule() {
        // Before the viewport is measured, the bottom-edge branch is inert; the standard
        // activation-line rule still resolves a sensible section.
        XCTAssertEqual(active(frames(scrolledBy: 70), viewportHeight: 0), .workspace)
    }
}
