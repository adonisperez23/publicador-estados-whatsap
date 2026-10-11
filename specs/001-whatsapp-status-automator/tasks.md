---

description: "Task list template for feature implementation"
---

# Tasks: Automatizador de Estados de WhatsApp Business

**Input**: Design documents from `/specs/001-whatsapp-status-automator/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — plan.md (Testing) and quickstart.md (done criteria: `npm test` en verde) explicitly require `node:test` + `node:assert/strict` unit/contract tests plus Playwright integration coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project plano en la raíz (fijado por plan.md): `index.js`, `whatsappBot.js`, `lib/`, `menu.json`, `assets/`, `session/`, `tests/`. No frontend, no API, sin backend separado.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure per plan.md «Project Structure»

- [ ] T001 Create project structure per implementation plan: `lib/`, `assets/`, `session/`, `tests/unit/`, `tests/contract/`, `tests/integration/` at repository root
- [ ] T002 Initialize package.json (CommonJS) in `package.json` with dependencies `playwright`, `node-cron`, `ajv` and script `"test": "node --test tests/"`
- [ ] T003 [P] Configure `.gitignore` at repository root to exclude `session/` and sensitive data (FR-016, Principio IV)
- [ ] T004 [P] Install Chromium browser for Playwright via `npx playwright install chromium`

**Checkpoint**: Project skeleton ready — foundational work can begin

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Implement `lib/logger.js` emitting one line per event per contracts/log-format.md: `<ISO-8601 local> | <intento|omision|sistema> | <plato|-|> | <exito|fallo> | <motivo|->` with the closed motivo enum (`imagen-faltante`, `texto-vacío`, `texto-largo`, `config-invalida`, `sesion-no-disponible`, `timeout`, `error-interfaz`, `error-red`)
- [ ] T006 Implement `lib/config.js`: load `menu.json`, validate with AJV against `specs/001-whatsapp-status-automator/contracts/menu-config.schema.json`, apply defaults (`publishIntervalSeconds` 60, `attemptTimeoutSeconds` 90), enforce semantic rule «every `schedules[].dishIds[x]` MUST exist in `dishes[].id`», and fail with a clear immediate error (exit ≠ 0, log `config-invalida`) on any violation
- [ ] T007 [P] Contract test validating `menu.json` against `specs/001-whatsapp-status-automator/contracts/menu-config.schema.json` in `tests/contract/test_menu_config.test.js` (valid config passes; orphan `dishIds`, empty text fields, `attemptTimeoutSeconds` > 90 fail)
- [ ] T008 [P] Contract test asserting `.gitignore` contains `session/` in `tests/contract/test_session_gitignore.test.js` (research.md R9)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Publicación programada del menú sin intervención manual (Priority: P1) 🎯 MVP

**Goal**: The system publishes dish States at configured times with no manual intervention, reusing the authenticated session (FR-001, FR-002, FR-011, FR-013, FR-015)

**Independent Test**: Configure a near-term schedule and a valid dish image, wait for the time, and verify the Status appears published without anyone touching the keyboard (quickstart S1, S7, S10)

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T009 [P] [US1] Unit test for future-only cron scheduling semantics (missed schedules omitted, no backfill) in `tests/unit/test_scheduler.test.js` (quickstart S6, Clarificación 1)
- [ ] T010 [P] [US1] Unit test for global mutex serialization and `publishIntervalSeconds` delay between consecutive publications (zero concurrency) in `tests/unit/test_mutex.test.js` (FR-013, FR-015, quickstart S7/S10)

### Implementation for User Story 1

- [ ] T011 [US1] Implement `whatsappBot.js`: `chromium.launchPersistentContext('session/', {...})` headful, navigate WhatsApp Web, publish ONE Status (image via `setInputFiles` on hidden file input, dish text, publish, confirmation) using only stable selectors (`page.getByRole(...)`, `[data-icon="..."]`, `[aria-label="..."]`), all browser blocks wrapped in `try/catch/finally` (FR-009, FR-012, Principios IV/V/VII, research.md R2/R4)
- [ ] T012 [US1] Implement session authentication check at startup in `whatsappBot.js`: verify logged-in state via stable selector (e.g. `role="navigation"` / `data-icon="chat"`); if absent/unauthenticated, signal `sesion-no-disponible` — NEVER display QR or interactive login (FR-002, FR-014, research.md R3)
- [ ] T013 [US1] Implement `index.js` orchestrator: load config via `lib/config.js`, register ONLY future occurrences of each `schedule.cron` with `node-cron` (no backfill), serialize all attempts through a global mutex with queue, insert `publishIntervalSeconds` between consecutive publications, enforce global attempt budget `attemptTimeoutSeconds` (≤ 90 s) via `Promise.race`/timer wrapping the whole attempt, map failures to `timeout`/`error-interfaz`/`error-red` motivos, and continue with the next schedule after a failure (FR-001, FR-008, FR-011, FR-015, research.md R6/R8)
- [ ] T014 [US1] Apply session directory security at startup in `index.js`: ensure `session/` exists check, `chmod 700` on `session/` (`600` on sensitive files where the FS allows), abort with clear error + log `sesion-no-disponible` if session missing (FR-014, FR-016, research.md R9)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Configuración centralizada de platos y horarios (Priority: P2)

**Goal**: Operator adds/edits dishes (image, name, price, description, CTA) and schedules entirely in `menu.json`, without touching code (FR-003, FR-004, FR-005)

**Independent Test**: Edit the config to change a price and a schedule, and verify the next publication uses the new price at the new time without editing any program file (quickstart S11)

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T015 [P] [US2] Unit tests for config loading edge cases (missing file, malformed JSON, duplicate `id`, empty `dishes`/`schedules`, orphan `dishIds`) asserting clear `config-invalida` failure in `tests/unit/test_config.test.js`

### Implementation for User Story 2

- [ ] T016 [P] [US2] Create example `menu.json` at repository root with `publishIntervalSeconds`, `attemptTimeoutSeconds`, ≥ 1 dish (`id`, `image`, `name`, `price`, `description`, `cta`) and ≥ 1 schedule (`cron` 5 fields, `dishIds` referencing valid ids) conforming to `specs/001-whatsapp-status-automator/contracts/menu-config.schema.json`
- [ ] T017 [P] [US2] Add a sample dish image placeholder note in `assets/README.md` documenting that every dish's image MUST exist physically in `assets/` and is linked to its text exclusively by `id` (FR-005, Principio III)
- [ ] T018 [US2] Document the configuration workflow in `README.md`: how to add a dish, edit a price, and move a schedule in `menu.json` in ≤ 3 minutes without editing code (SC-002), including cron 5-field syntax in local timezone

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Validación previa y trazabilidad de resultados (Priority: P3)

**Goal**: Every attempt is validated before invoking the bot (image exists/readable, text non-empty, ≤ 1024 chars) and every attempt/omission leaves exactly one clear console log line (FR-006, FR-007, FR-010, SC-003, SC-005)

**Independent Test**: Point the config at a non-existent image and a dish with empty price; verify nothing is published for them, the motives appear in the log output, and the rest of the day's publications continue (quickstart S2, S3)

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T019 [P] [US3] Unit tests for per-attempt dish validation (missing/unreadable/zero-size image → `imagen-faltante`; whitespace-only `name`/`price`/`description`/`cta` → `texto-vacío`; composite message > 1024 chars → `texto-largo`) in `tests/unit/test_validate_dish.test.js`

### Implementation for User Story 3

- [ ] T020 [US3] Implement `lib/validateDish.js`: per-attempt validation of image existence/readability/size > 0 under `assets/`, non-empty-after-`trim` text fields, and composite message (name + price + description + cta with fixed separators) ≤ `MAX_STATUS_TEXT_LENGTH = 1024`; returns success or a closed motivo enum value (FR-006, FR-007, research.md R10, data-model.md)
- [ ] T021 [US3] Wire pre-publication validation into `index.js` before invoking `whatsappBot.js`: on validation failure emit one `omision` log line with motivo and continue with pending publications; NEVER pass partial/empty content to the bot (FR-006, FR-007, SC-003)
- [ ] T022 [US3] Guarantee exactly one log line per attempt in `index.js` + `lib/logger.js`: `intento|exito`, `intento|fallo` + motivo, or `omision|fallo` + motivo; system events (`config-invalida`, `sesion-no-disponible`) logged as `sistema` with `plato=-`; no `session/` content ever logged (FR-010, SC-005, contracts/log-format.md invariants)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T023 [P] Integration test scaffold driving the publish flow with Playwright against a controlled/mocked WhatsApp Web page in `tests/integration/test_publish_flow.test.js` (research.md R1)
- [ ] T024 Run quickstart.md validation scenarios S1–S12 end-to-end and verify the post-run invariant greps (SC-001, SC-003, SC-005, SC-006, SC-007) per `specs/001-whatsapp-status-automator/quickstart.md`
- [ ] T025 Complete `README.md` with setup (`npm install`, `npx playwright install chromium`), one-time manual QR login flow (outside the automated cycle), session permission verification, and daemon command `node index.js`
- [ ] T026 Final review against `.specify/memory/constitution.md` (Principios I–VII) and `spec.md` FRs; ensure `npm test` (unit + contract) is green, no orphan Chromium processes, and no shadow code beyond the spec

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
  - T005 (logger) and T006 (config loader) are the blocking primitives
  - T007/T008 are contract tests parallel to T005/T006 verification
- **User Story 1 (Phase 3)**: Depends on Foundational (T005, T006)
- **User Story 2 (Phase 4)**: Depends on Foundational (T006); independent of US1
- **User Story 3 (Phase 5)**: Depends on Foundational (T005) and integrates with US1's `index.js` call path (T021/T022 touch `index.js` from T013)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) — independent of US1 (config loader already foundational)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2); T021/T022 integrate with US1's orchestrator — if US1 is not yet done, validate with unit tests of `lib/validateDish.js` + logger and wire later

### Within Each User Story

- Tests written FIRST and confirmed failing before implementation
- Models/config before services; services before orchestration
- Bot module (`whatsappBot.js`) before orchestrator (`index.js`) in US1
- Story complete before moving to next priority

### Parallel Opportunities

- T003 ∥ T004 (Setup)
- T007 ∥ T008 (contract tests), and both ∥ T005/T006 implementation writing
- T009 ∥ T010 (US1 tests)
- T016 ∥ T017 (US2 docs/assets)
- T019 (US3 test) ∥ any US1/US2 work
- T023 (integration scaffold) ∥ documentation tasks T024/T025
- Whole stories US1 ∥ US2 after Phase 2 (different files: `whatsappBot.js`/`index.js` vs `menu.json`/`README.md`)

---

## Parallel Example: User Story 1

```bash
# Launch both US1 tests together:
Task: "Unit test for future-only cron scheduling in tests/unit/test_scheduler.test.js"
Task: "Unit test for mutex serialization in tests/unit/test_mutex.test.js"

# After tests fail, implement sequentially (same-file dependencies):
Task: "Implement whatsappBot.js publish flow"
Task: "Implement index.js orchestrator (depends on whatsappBot.js)"
```

## Parallel Example: User Story 2

```bash
Task: "Create example menu.json at repository root"
Task: "Add assets/README.md image-linkage note"
# Both run in parallel; README.md config docs (T018) follows
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: quickstart S1 with a near-term cron — Status published with no keyboard interaction
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → skeleton, validated config loading, log format
2. Add User Story 1 → test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → edit config end-to-end → Deploy/Demo
4. Add User Story 3 → validation + traceability → Deploy/Demo
5. Polish → quickstart S1–S12 green, constitution re-check

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (`whatsappBot.js`, `index.js`)
   - Developer B: User Story 2 (`menu.json`, `README.md`, config tests)
   - Developer C: User Story 3 (`lib/validateDish.js`, logger wiring)
3. Stories complete and integrate independently (US3 final wiring touches `index.js` — coordinate with US1 merge)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Constitution gates: session never versioned (I/IV), zero schedules in code (II), image↔text linked only by `id` (III), selectors isolated in `whatsappBot.js` (V), validation before publish (VI), `try/catch/finally` + explicit timeouts (VII)
- Cero código sombra: implement only what `spec.md` documents
