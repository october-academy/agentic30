# Agentic30 Fable 5 MVP 사용자 스토리

이 파일은 관찰 가능한 user outcome을 소유한다. `SPEC.md`는 runtime contract를 소유한다.

## US1 - Workspace 설정

**사용자 필요:** Agentic30이 읽을 project를 선택한다.

**소유:** Swift가 picker를 연다. Rust가 검증하고 durable state를 기록한다.

**인수 조건:**

- 선택한 folder name과 redacted path label이 보인다.
- Restart 후 선택 workspace가 복원된다.
- 읽을 수 없거나 거부된 folder는 named failure를 보인다.

**실패:** `WORKSPACE_NOT_SELECTED`, `WORKSPACE_UNREADABLE`, `WORKSPACE_PERMISSION_DENIED`.

**이벤트:** `workspace_selection_started`, `workspace_selected`, `workspace_selection_failed`.

## US2 - Provider readiness

**사용자 필요:** scan/interview provider help가 실제로 실행 가능한지 안다.

**소유:** Node가 SDK/auth/model을 확인한다. Rust가 readiness를 저장한다. Swift가 표시한다.

**인수 조건:**

- Provider와 model이 보인다.
- Unsupported model은 generation 전에 실패한다.
- 더 약한 model로 silent fallback하지 않는다.

**실패:** `PROVIDER_SDK_MISSING`, `PROVIDER_AUTH_MISSING`, `PROVIDER_MODEL_UNSUPPORTED`, `PROVIDER_TIMEOUT`.

**이벤트:** `provider_auth_checked`, `provider_model_supported`, `provider_model_rejected`.

## US3 - Quote-backed project scan

**사용자 필요:** 앱이 무엇을 읽었고 어떤 claim을 뒷받침할 수 있는지 본다.

**소유:** Rust scan manifest와 scan result.

**인수 조건:**

- 각 strong claim에는 source path, quote, confidence가 있다.
- context가 부족하면 success처럼 보이지 않고 block된다.
- unavailable source가 따로 보인다.
- Scan result가 restart 후에도 유지된다.

**실패:** `PROJECT_CONTEXT_INSUFFICIENT`, `PROJECT_CONTEXT_QUOTES_MISSING`, `WORKSPACE_SCAN_TIMEOUT`, `SCAN_REDACTION_FAILED`.

**이벤트:** `project_context_scan_started`, `project_context_scanned`, `project_context_scan_blocked`.

## US4 - Day 1 interview

**사용자 필요:** project와 customer hypothesis를 좁힌다.

**소유:** Rust reducer. Node는 wording만 제안할 수 있다.

**인수 조건:**

- active question이 정확히 하나만 보인다.
- Question type은 Rust allowlist에서 나온다.
- Answer는 typed durable event로 저장된다.
- 완료 시 customer/problem/project summary가 보인다.

**실패:** `DAY_INTERVIEW_CONTEXT_MISSING`, `QUESTION_ALREADY_ACTIVE`, `QUESTION_ANSWER_INVALID`, `QUESTION_REPEAT_GUARD_TRIGGERED`.

**이벤트:** `day_interview_started`, `day_interview_question_created`, `day_interview_question_answered`, `day_interview_state_advanced`.

## US5 - Day 2 interview

**사용자 필요:** customer problem을 current surface와 연결한다.

**소유:** Rust reducer.

**인수 조건:**

- Surface는 source-backed, user-provided, missing 중 하나로 표시된다.
- Missing surface는 다음 입력을 명확히 말하며 block한다.
- 완료 시 problem-to-surface summary가 보인다.

**실패:** `DAY1_SUMMARY_MISSING`, `CURRENT_SURFACE_MISSING`, `SURFACE_ANSWER_TOO_VAGUE`.

**이벤트:** US4의 Day interview event family와 `day_interview_blocked`.

## US6 - Day 3 interview

**사용자 필요:** 하나의 next validation action과 expected trace를 정한다.

**소유:** Rust reducer.

**인수 조건:**

- primary next action이 하나 선택된다.
- Action은 customer 또는 external reaction과 연결된다.
- Expected trace는 screenshot, message, URL, transcript, replay search hint처럼 관찰 가능하다.
- Trace는 market proof가 아니라 next interview input으로 표시된다.

**실패:** `DAY2_SUMMARY_MISSING`, `NEXT_ACTION_UNDECIDABLE`, `NEXT_ACTION_NOT_EXTERNAL`, `EXPECTED_TRACE_MISSING`.

**이벤트:** US4의 Day interview event family와 `day_interview_blocked`.

## US7 - Founder Replay consent

**사용자 필요:** 명확한 OS permission boundary 안에서 local work-memory capture에 opt in한다.

**소유:** Swift가 TCC와 actor identity를 probe한다. Rust가 consent state를 기록한다.

**인수 조건:**

- Screen Recording과 Accessibility state는 probe-backed다.
- Consent와 visible indicator acknowledgement 전에는 capture가 시작되지 않는다.
- Actor mismatch가 named failure로 보인다.

**실패:** `RECORDER_CONSENT_MISSING`, `SCREEN_RECORDING_MISSING`, `ACCESSIBILITY_MISSING`, `PERMISSION_ACTOR_MISMATCH`, `VISIBLE_INDICATOR_NOT_ACKED`.

**이벤트:** `recorder_consent_requested`, `mac_permission_health_checked`, `recorder_consent_changed`.

## US8 - Founder Replay search/delete

**사용자 필요:** 최근 work memory를 local로 search하고 민감한 range를 delete한다.

**소유:** Swift가 capture한다. Rust가 ingest, redact, index, search, delete한다.

**인수 조건:**

- FTS는 redacted text만 사용한다.
- Raw media는 local에 있고 encrypted at rest다.
- Search result는 provenance를 보인다.
- Delete는 confirmation을 요구하고 receipt를 반환한다.
- Deleted row는 search에 나오지 않는다.

**실패:** `RECORDER_INGEST_FAILED`, `RECORDER_REDACTION_FAILED`, `RECORDER_SEARCH_UNAVAILABLE`, `RECORDER_DELETE_FAILED`.

**이벤트:** `recorder_capture_ingested`, `recorder_search_performed`, `recorder_range_deleted`.

## US9 - Diagnostics

**사용자 필요:** log를 읽지 않고 runtime health를 이해한다.

**소유:** 각 runtime이 heartbeat를 emit한다. Rust가 aggregate한다. Swift가 표시한다.

**인수 조건:**

- Swift/Rust/Node/provider/recorder status에는 runtime, timestamp, root cause가 있다.
- Unknown, disconnected, blocked, failed가 구분된다.
- Redacted diagnostic bundle은 secret, raw path, raw memory, provider prompt, raw media를 제외한다.

**실패:** `DIAGNOSTIC_HEARTBEAT_STALE`, `DIAGNOSTIC_BUNDLE_REDACTION_FAILED`, `HELPER_VERSION_MISMATCH`.

**이벤트:** `diagnostics_opened`, `diagnostic_bundle_created`, `diagnostic_bundle_failed`.

## Story 공통 불변조건

- Scan success는 quote를 요구한다.
- Interview question은 한 번에 하나만 active다.
- Provider 출력은 proposal일 뿐이다.
- Recorder data는 local memory일 뿐이다.
- Explicit blocked state가 fake recovery보다 낫다.
- 새 god file이 생기면 story는 완료가 아니다.
