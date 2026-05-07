import Testing
@testable import agentic30

struct MacAuthModelsTests {
    @Test func exchangeResponseMapsToStoredSession() throws {
        let response = MacAuthExchangeResponse(
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresAt: 1_776_000_000,
            expiresIn: 3600,
            tokenType: "bearer",
            user: MacAuthUser(id: "user-1", email: "founder@example.com"),
            consent: MacAuthConsent(
                acceptedAt: "2026-04-15T00:00:00.000Z",
                termsVersion: "terms",
                privacyVersion: "privacy"
            )
        )

        let session = response.toSession()

        #expect(session.accessToken == "access-token")
        #expect(session.refreshToken == "refresh-token")
        #expect(session.userId == "user-1")
        #expect(session.email == "founder@example.com")
        #expect(session.termsVersion == "terms")
        #expect(session.privacyVersion == "privacy")
        #expect(session.isUsable)
    }

    @Test func refreshResponsePreservesPreviousConsentWhenMissing() throws {
        let response = MacAuthExchangeResponse(
            accessToken: "new-access",
            refreshToken: "new-refresh",
            expiresAt: nil,
            expiresIn: nil,
            tokenType: nil,
            user: MacAuthUser(id: "user-1", email: nil),
            consent: nil
        )

        let session = response.toSession(
            fallbackConsent: MacAuthConsent(
                acceptedAt: "2026-04-15T00:00:00.000Z",
                termsVersion: "terms",
                privacyVersion: "privacy"
            )
        )

        #expect(session.tokenType == "bearer")
        #expect(session.termsAcceptedAt == "2026-04-15T00:00:00.000Z")
        #expect(session.termsVersion == "terms")
        #expect(session.privacyVersion == "privacy")
    }
}
