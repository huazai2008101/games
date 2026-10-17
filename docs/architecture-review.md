# Architecture Review — 2026-07

A peer-level review of the platform's architecture and implementation. Findings
are grouped by root cause, each with a file:line anchor and a concrete fix.
Resolution status tracks work on branch `refactor/architecture-cleanup`.

## Verdict

The top-level decisions are sound: dual-identity domains, HTTP-native error
contract (zero violations), actor-model gateway, explicit round settlement, and
the `game_round` / `game_round_operation` / `player_transaction` reconciliation
model. The problems are not bad choices but four recurring root causes:

1. **Service layer applied inconsistently** — wallet settlement logic lives in
   the repository; the player domain has no service; the lobby has no handler
   layer; admin handlers write raw GORM.
2. **The actor migration left seams** — hub half-retired, disconnect/reconnect
   messages defined but never wired, legacy wallet path unreachable in prod.
3. **Conventions / DI hygiene** — three repository-consumption patterns, wire
   double-instantiation, inconsistent error mapping.
4. **Splits without a shared core** — duplicated JWT managers, EventEmitter,
   axios clients; Go DTOs hand-mirrored to TS.

## Strengths to preserve

- Dual-identity separation — `RequirePlayerAuth` never touches RBAC cache/path
  matching; distinct context keys prevent identity bleed.
- HTTP error contract — no `AbortWithStatusJSON`/`http.Error` on app API paths;
  errors flow through `dto.Error*` + `X-Error-Message`.
- Wallet reconciliation schema — composite FK `(round_id, game_id)`, unique
  `request_id`, partial-unique `idempotency_key`, DB-level non-negative balance.
- Explicit round boundary — `beginRound`/`endRound`, single active round,
  leak detection in `finishExecution`, server-generated `round_id`.
- Actor kernel — priority mailboxes, single owner, panic recovery, OnStop.

## P0 functional bugs (fixed)

| Anchor | Bug | Fix |
|---|---|---|
| `actorproto/ids.go` | Matchmaker sharded by `fnv(playerID)%16` splits the match pool | per-game single matchmaker |
| `cmd/lobby/main.go` | `/api/lobby/category` nil-panics (CategorySvc not forwarded) | forward the dep |
| `service/rbac.go:250` | developer permission filter ignores Scan error → fail-open | check error, fail closed |
| `service/rbac.go:228` | role-not-found returns bare error → 500 not 404 | wrap `errs.ErrNotFound` |

## Structural debts (Phase D)

- **Wallet service missing** — ~420 lines of settlement logic in
  `repository/player.go` (`CommitRound` + helpers); admin handler and game-api
  `balanceAdapter` both bypass a service. Extract `WalletService`.
- **`runtime.go` God object** (was 1466 lines) — DONE: split into three
  managers that share the Runtime's mutex (`*sync.Mutex`), preserving the exact
  lock semantics — `sessionOwnerManager` (session_owner.go),
  `connLeaseManager` (connection_directory.go), `actorRegistry`
  (actor_registry.go) — plus a `connection.go` for the connection lifecycle.
  `runtime.go` is now the ~540-line routing facade. Verified `go test -race`.
- **Three repository-consumption patterns** — DB-as-arg, interface+adapter,
  dual-hold. ~150 lines of forwarding boilerplate. Unify on DB-as-arg.
- **Player domain has no service** — admin player handlers call repos directly
  and write raw GORM. Extract `PlayerService`.
- **Lobby has no handler layer** — business logic in `route.go` closures.
- **developer-scope exclusion encoded four times** — middleware SQL literal +
  Go slices + multiple queries. Move to `permission.platform_only`.
- **No frontend codegen** — Go DTOs hand-mirrored to TS; `frontend/shared`
  holds only `httpError.ts`.

## Dead code (cleaned)

Removed: `AuthService.RegisterPlayer` (wrote to the wrong table), broken
`UserRepo.ListByRole`, dead `FindByDeveloperID`, abandoned `user_permission`
write methods, `model.UserRole` type, hub broadcast methods + write-only
indexes, unwired session/matchmaker message constants, `gameListResponse`
wrapper, 9 unreachable empty-param guards, `enforcer` dead param,
`contentLengthOf`, unused `CORS/RateLimit/Logger` helpers, `InvalidateGameList`
duplicate, empty directories.

## Deliberately kept

- **`session_state` query methods on both `SessionState` and `SessionSnapshot`** —
  the owner (hot path, no alloc, 31 call sites) and the immutable projection
  (cross-actor) each need them; forcing dedup allocates a slice copy per action.
- **WalletActor legacy single-op path** — documented intentional, with tests;
  removal belongs with the wallet-service consolidation (settlement hot path).

## Remaining low-priority items

wire double-RBAC instantiation, `AdminDeps` dead fields, `bearerToken`/logout
duplication admin↔lobby, inconsistent time formats, `BalanceAdjustment`
`Operation`/`Type` triple-derivation, Dashboard `ListMyGame` for super-admin.
