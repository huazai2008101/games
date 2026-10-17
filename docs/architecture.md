# Online Game Platform — Architecture

> **维护提示(2026-10-05)**:本文为内部架构参考,部分内容已滞后于实现,阅读时以代码为准。已知的过时点:
> - WebSocket 鉴权已改为"玩家令牌换一次性票据"(`POST /game/ws/ticket`,30 秒单次有效),本文个别段落仍写 `?token=JWT`;
> - 响应封装函数现为 `httpresp.Fail/WriteFail`,本文的 `dto.Success/dto.OK/dto.Error` 已重命名;错误响应体为空、错误信息在 `X-Error-Code`/`X-Error-Message` 头(本文 L117 附近两处描述互相矛盾,以 headers 为准);
> - Admin/Lobby 职责清单缺财务中心、内容运营、券、工单、签到、通知、充值等已实现模块;
> - 游戏状态机中 `pending_review/rejected` 属版本包状态,游戏实体状态为 `draft|approved|archived`。
>
> 对外文档(玩家手册与开发商接入指南)以 `docs/manual/src/` 为权威;错误码契约见 `docs/error-codes.md`。

## System Overview

```
┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
│  Admin SPA   │  │  Lobby SPA   │  │  Game Frontend (TS)  │
│  Vue3+EP     │  │  Vue3+TW     │  │  WebSocket Client    │
└──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘
       │ REST            │ REST                │ WebSocket
┌──────┼────────────────┼─────────────────────┼────────────┐
│      ▼                ▼                     ▼            │
│  ┌─────────┐   ┌──────────┐   ┌──────────────────────┐  │
│  │ Admin   │   │  Lobby   │   │  Game API Gateway    │  │
│  │ :8080   │   │  :8081   │   │  :8082               │  │
│  └────┬────┘   └────┬─────┘   └──────────┬───────────┘  │
│       │              │                    │              │
│       └──────┬───────┘                    │              │
│              │                            │              │
│              ▼                            ▼              │
│       ┌──────────┐              ┌──────────────────┐    │
│       │PostgreSQL│              │  Game Engine     │    │
│       │   +Redis │              │  goja Runtime    │    │
│       └──────────┘              │  Pool + Bridge   │    │
│                                 │  + Sandbox       │    │
│                                 └──────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Dual Identity Architecture

**管理后台用户 (`user`) 与游戏玩家 (`player`) 是完全独立的身份域。**

| 维度 | Admin User | Game Player |
|------|-----------|-------------|
| 数据表 | `user` | `player` |
| 创建方式 | 超级管理员创建 | 大厅自助注册 |
| 身份属性 | developer_id, RBAC | nickname, avatar, status |
| 鉴权 | JWT + RBAC 权限检查 | JWT 纯身份验证 |
| 钱包 | No admin wallet ledger | `player_balance` + `player_transaction` |
| 关联 | role, permission, menu, developer | game engine, explicit game rounds |
| JWT | `{userId, username, role}` | `{playerId, username, nickname}` |
| 路由守卫 | `RequireAuth()` (RBAC) | `RequirePlayerAuth()` (JWT only) |

**RBAC 体系只管理 `user` 表，与 `player` 完全无关。**

## Database Schema (18 tables)

### Admin Domain
| Table | Purpose |
|-------|---------|
| `user` | Admin accounts (username, email, password, developer_id) |
| `developer` | Developer orgs (company_name, status) |
| `game_category` | Managed game categories (name, sort_order, status) |
| `game` | Games (title, category_id, status, session_mode, min/max_player, allow_spectate) |
| `game_package` | Versioned game bundles (frontend_url, backend_js, review status) |
| `game_round` | Wallet-bearing game rounds keyed by platform-generated `round_id` |
| `game_round_operation` | Per-wallet-operation round audit records, including failed operations that never become ledger rows |
| `review_log` | Package review audit trail |
| `audit_log` | Sensitive admin operation log (actor, action, target, ip) |

### RBAC Domain
| Table | Purpose |
|-------|---------|
| `role` | Roles (slug, developer_id for private roles) |
| `permission` | Permission points (http_method, http_path, menu_id) |
| `menu` | Navigation tree (parent_id self-ref, menu_type: menu/directory) |
| `role_permission` | M:N role ↔ permission |
| `user_role` | M:N user ↔ role |
| `user_permission` | Direct per-user permission overrides |

### Player Domain
| Table | Purpose |
|-------|---------|
| `player` | Player accounts (nickname, avatar, status: active/banned/frozen) |
| `player_balance` | Player wallets (balance, non-negative) |
| `player_transaction` | Player balance change records; game transactions carry `round_id` |

> **Note**: `role_menu` table was removed. Menus are derived from
> `permission.menu_id` — no separate role-menu maintenance needed.

## Service Responsibilities

### Admin (:8080)
- Login (returns user + tokens + permissions + menus in single response)
- Developer CRUD + auto-provision (creates user → developer → private role → clone permissions → user_role)
- Category CRUD for the canonical game-category taxonomy shown in the lobby
- Game management + category assignment + state machine (draft → pending_review → approved → archived)
- Frontend bundle upload/hosting through a configured S3-compatible object store for reviewed game clients
- Package review workflow (approve/reject with bundle security validation)
- Balance adjustments (player-only, with confirmation)
- Full RBAC: role/permission/menu CRUD, developer-scoped role management

### Lobby (:8081)
- Player registration (creates player + player_balance + player JWT)
- Player login/logout (separate JWT system from admin)
- Active category listing for lobby navigation
- Approved game listing by category (Redis cached, invalidated on approval/category changes)
- Player profile + balance + transaction history

### Game API (:8082)
- WebSocket upgrade (player JWT via query param)
- Session lifecycle: created → waiting → ready → playing → finished
- Explicit round lifecycle inside game scripts: `beginRound` → wallet/game events → `endRound`
- Matchmaker: auto-pools quick-mode players per game
- Room mode: REST room creation + join by room code
- Spectating: read-only observer connections (game must opt-in)
- goja engine: sandboxed JS execution with platform bridge API
- Engine pool: runtime wrapper recycling (VM is per-game, not pooled)

## HTTP API Contract And Code Standard

Admin、Lobby、Game API 的前后端 REST/HTTP 接口统一使用 HTTP 原生语义，不再额外包一层 `{code,message,data}`。

Rules:
- Error code is the HTTP status code. Examples: `400`, `401`, `403`, `404`, `409`, `429`, `500`.
- Error code is returned in the response header `X-Error-Code` ("0" on success); the error body is `{"code","message"}`.
- Error response body is empty. Do not return `{"code":400,"message":"..."}`
  or any other error envelope.
- Success response body is clean business data. Return the DTO/list/object
  directly, for example `{ "items": [...], "total": 10 }`, `[ ... ]`, or
  `{ "token": "..." }`. Do not return `{"code":200,"message":"ok","data":...}`.
- Empty success may return `{}` when the client needs a JSON response.

Backend code rules:
- Gin handlers should use `dto.Success`, `dto.OK`, `dto.Error`, or
  `dto.ErrorFromErr`.
- Non-Gin HTTP handlers should use `dto.WriteError`.
- Handlers and middleware must not use `AbortWithStatusJSON`/`http.Error` for
  front-back API errors.
- Internal/server details are logged server-side and must not be exposed to
  clients. Client-facing internal failures use `500` with
  `X-Error-Message: internal server error`.
- CORS must expose `X-Error-Message` through `Access-Control-Expose-Headers`.

Frontend code rules:
- Success paths read `res.data` as the business payload directly.
- Error display reads `X-Error-Message` through the shared API helper
  (`getErrorMessage`). Do not parse response bodies for application errors.
- Page code must not inspect `res.data.code`, `res.data.message`, or
  `res.data.data`.

Protocol boundaries:
- WebSocket messages are not REST/HTTP JSON responses and keep their event
  envelope.
- The S3-compatible storage endpoint is not a front-back application API and
  keeps the S3 XML protocol.

## Game API Actor Architecture

The Game API gateway uses a session-centric actor architecture. The main design
goal is to make state ownership explicit, remove shared-memory coordination from
the gameplay hot path, and prepare the gateway for horizontal scaling under high
concurrency.

The actor model replaces the old "global hub + session manager + engine
manager" shape with isolated actors that communicate only by messages. Each
piece of mutable runtime state has exactly one owner. Other components cannot
mutate that state directly; they must send commands to the owning actor.

Current production wiring uses local actors plus Redis-backed indexes for
session ownership, presence, room lookup, and game config caching. The router
and in-memory remote transport support multi-node tests, but `game-api` does
not yet wire a production remote actor transport such as NATS.

### Core Principles

| Principle | Design Rule |
|-----------|-------------|
| Single owner per state | Session, connection, matchmaking, room index, engine VM, and wallet state each have one authoritative actor |
| Session authority | `SessionActor` owns lifecycle, players, spectators, action ordering, and game-state transitions |
| Serialized game logic | `EngineActor` is the only component allowed to touch a goja VM, and it processes one mailbox message at a time |
| Explicit round boundary | Game scripts must call `platform.beginRound` and `platform.endRound`; the platform never creates implicit rounds |
| Stateless gateway edge | WebSocket gateway nodes accept connections and route messages, but do not own game sessions |
| Bounded mailboxes | Every actor queue has a capacity, explicit overload behavior, and observable metrics |
| Location transparency | Actor IDs are stable; the router decides whether the destination is local or remote |
| Failure containment | Actor crashes are handled by supervisors; session failure must not compromise the whole gateway process |

### Actor Topology

```
ActorSystem
  GatewaySupervisor
    ConnActor                 one per WebSocket connection
    GatewayNodeActor          local connection registry + remote downlink target

  GameSupervisor
    MatchmakerActor           sharded quick-match queues
    RoomRegistryActor         roomCode -> sessionID index
    SessionSupervisor
      SessionActor            one per active game session
        EngineActor           one per running game VM

  PlatformSupervisor
    WalletActor               sharded by playerID
    PresenceActor             player/connection/node presence
    GameConfigActor           approved game and package cache
```

The important boundary is strict: session state lives in `SessionActor`, goja
execution and active `RoundContext` live in `EngineActor`, room lookup lives in
`RoomRegistryActor`, game metadata lives in `GameConfigActor`, round-scoped
wallet settlement lives behind `BalanceService.CommitRound`, and wallet reads
plus fallback single-operation messages live behind `WalletActor`.

### Actor IDs

Actor IDs must be stable and routable across nodes.

| Actor | ID Format | Routing Key |
|-------|-----------|-------------|
| Connection | `conn:{nodeID}:{connID}` | local node only |
| Gateway node | `gateway:{nodeID}` | nodeID |
| Player presence | `presence:{playerID}` | `playerID` |
| Matchmaker | `matchmaker:{gameID}:{bucket}` | `gameID + bucket` |
| Room registry | `room-registry:{bucket}` | `gameID + roomCode` |
| Session | `session:{sessionID}` | `sessionID` |
| Engine | `engine:{sessionID}` | parent session |
| Wallet | `wallet:{playerID}` | `playerID` |
| Game config | `game-config:{gameID}` | `gameID` |

The router owns actor location lookup. Local delivery uses in-memory channels.
Remote delivery goes through the `RemoteTransport` interface. Redis is used for
leases, presence indexes, room indexes, and rate-limit state, not for every
real-time gameplay message.

### High-Level Message Flow

```
Client
  -> ConnActor
  -> ActorRouter
  -> MatchmakerActor / RoomRegistryActor
  -> SessionActor
  -> EngineActor
  -> SessionActor
  -> GatewayNodeActor
  -> ConnActor
  -> Client
```

Wallet settlement for gameplay flows is committed at the explicit round
boundary:

```
EngineActor
  -> explicit RoundContext
  -> BalanceService.CommitRound
  -> PostgreSQL ledger (game_round, game_round_operation, player_transaction.round_id)
  -> EngineActor
  -> SessionActor
```

`WalletActor` still serves balance reads and the legacy single-operation
message path, but round-scoped game wallet writes use `CommitRound` so
`endRound()` is the durable settlement boundary.

### Gateway Actors

#### ConnActor

`ConnActor` owns one WebSocket connection.

Responsibilities:
- read client messages;
- decode and validate envelope shape;
- attach `playerID`, `connID`, `nodeID`, and client sequence;
- forward commands to the router;
- serialize outbound messages to the socket;
- enforce per-connection read/write rate limits;
- close slow or unhealthy connections.

`ConnActor` does not own session state. It may cache the current `sessionID` for
fast routing, but the session remains authoritative in `SessionActor`.

Inbound messages:
- `ClientAction`
- `ClientSystem`
- `SocketClosed`
- `Ping`

Outbound messages:
- `ServerEvent`
- `SystemEvent`
- `ErrorEvent`
- `CloseConnection`

Backpressure:
- outbound queue is bounded;
- critical system messages are sent before low-value game state updates;
- if the queue stays full, the connection is closed and presence is cleared.

#### GatewayNodeActor

`GatewayNodeActor` is the local downlink target for remote actors. It maps
`connID` and `playerID` to local `ConnActor` references.

Responsibilities:
- register/unregister local connections;
- deliver remote downlink messages to the correct local connection;
- maintain local connection counts and health metrics;
- answer "is this player connected on this node?" queries from presence.

### Matchmaking And Room Actors

#### MatchmakerActor

`MatchmakerActor` owns quick-match queues. It is sharded by
`matchmaker:{gameID}:{bucket}` so popular games do not bottleneck on one actor.

Responsibilities:
- validate quick-match join requests against game rules;
- group compatible players;
- create `SessionActor` when a match is ready;
- reserve in-flight session capacity before `SessionActor` snapshots catch up;
- reject joins when the bucket is overloaded;
- remove disconnected or expired waiters;
- publish queue length and wait-time metrics.

Bucket selection:
- default: `hash(playerID) % bucketCount`;
- for very hot games: dynamic bucket count from config;
- for low-traffic games: bucket count may be `1`.

Messages:
- `JoinQuickMatch`
- `CancelQuickMatch`
- `PlayerDisconnected`
- `MatchTimeout`
- `CreateSessionResult`

Overload behavior:
- lifecycle and cancel messages are never dropped;
- new join requests are rejected with a retryable error when the mailbox or
  bucket queue exceeds limits.

#### RoomRegistryActor

`RoomRegistryActor` owns room-code lookup. The current runtime registers one
local registry bucket per node and uses Redis as the cross-process directory;
future deployments can shard buckets by `gameID + roomCode`.

Responsibilities:
- create unique room codes;
- map `(gameID, roomCode) -> sessionID`;
- enforce TTL and owner idempotency;
- resolve joins by room code, checking the persistent directory before trusting
  local cache;
- remove room mappings when sessions finish.

Persistent index:
- Redis stores `room:{gameID}:{roomCode} -> sessionID` with TTL;
- Redis stores `owner-room:{gameID}:{ownerID} -> sessionID` with TTL;
- Redis stores `session-room:{sessionID} -> room key` for cleanup;
- the authoritative live session state still belongs to `SessionActor`.

### SessionActor

`SessionActor` is the authoritative owner of one game session.

Owned state:
- `sessionID`;
- `gameID`;
- `mode`;
- `state`;
- `ownerID`;
- `roomCode`;
- `players`;
- `spectators`;
- `participant connection refs`;
- `createdAt`, `startedAt`, `finishedAt`, `ttl`;
- `clientSeq` and action dedupe state;
- `engineRef`;
- pending wallet and engine operations.

Only `SessionActor` may change session lifecycle state. External components must
not call transition methods directly.

Lifecycle:

```
created -> waiting -> ready -> playing -> finished
                    \-> error
                    \-> timeout
```

Messages:
- `JoinSession`
- `LeaveSession`
- `SpectateSession`
- `ReconnectSession`
- `DisconnectSession`
- `ReadySession`
- `StartSession`
- `PlayerAction`
- `EngineEvent`
- `EngineFailed`
- `WalletResult`
- `FinishSession`
- `SessionTimeout`

Rules:
- players may only send actions after the session is `playing`;
- spectators never drive lifecycle or actions;
- quick sessions allow any participant to drive lifecycle; room sessions are
  host-driven through `ownerID`;
- quick sessions auto-start after `ready` when the minimum player count is met;
- every player action includes `playerID`, `connID`, `clientSeq`, and payload;
- duplicate `(playerID, clientSeq)` messages are ignored or answered from
  dedupe cache;
- `SessionActor` forwards valid actions to `EngineActor` in session order;
- `SessionActor` does not create or infer rounds; round boundaries are game
  script decisions enforced by `EngineActor`;
- `SessionActor` is responsible for broadcasting lifecycle changes.

Backpressure:
- lifecycle messages are priority messages;
- player actions are rejected with a retryable error when the mailbox is full;
- repeated low-value state updates may be coalesced;
- disconnect and finish messages must always be accepted.

### EngineActor

`EngineActor` owns one goja VM and all game-script execution for a session.

Owned state:
- goja runtime;
- compiled game code;
- lifecycle hook references;
- platform API state;
- active `RoundContext` (`roundID`, action sequence, wallet operation index);
- JS timers;
- pending continuations for async platform operations.

Hard rule: no goroutine except `EngineActor` may call into the VM.

Messages:
- `EngineInit`
- `EngineStart`
- `EngineAction`
- `EngineFinish`
- `TimerFired`
- `WalletResult`
- `StopEngine`

Timer model:
- `platform.setTimeout` and `platform.setInterval` do not call JS callbacks
  directly from timer goroutines;
- timers only enqueue `TimerFired` to `EngineActor`;
- `EngineActor` executes the callback from its mailbox thread;
- timers are cancelled when the engine stops.

Platform API model:
- `platform.broadcast` emits `EngineEvent` to `SessionActor`;
- `platform.sendTo` emits a targeted event to `SessionActor`;
- `platform.getPlayerIDs` asks `SessionActor` or uses a session-owned snapshot
  supplied by the parent;
- `platform.beginRound()` opens the only active business round for the current
  JS callback and returns a platform-generated opaque UUID-style round ID;
- `platform.endRound()` closes the active round and flushes queued wallet
  operations through `BalanceService.CommitRound`; it returns `true` only after
  the round is durably settled and returns `false` on validation or settlement
  failure; arguments are rejected;
- the platform never creates implicit rounds for lifecycle hooks, player
  actions, or timer callbacks;
- wallet operations are queued inside the active round and committed only by
  explicit `endRound()`;
- `deductBalance` and `rewardBalance` return after platform validation and
  enqueue; the final settlement result is reflected in the `endRound()` return
  value and emitted as wallet system events;
- `deductBalance` and `rewardBalance` require an active `RoundContext`; without
  `beginRound`, they return `false` and do not enqueue wallet work;
- `getBalance` returns the EngineActor-local cached balance and enqueues an
  async refresh, so the VM never waits on database calls.

Round rules:
- every gameplay flow that can write wallet ledger rows must explicitly wrap
  the flow with zero-argument `beginRound` and `endRound` calls;
- `round_id` is generated only by server-side platform/runtime code and must
  not be accepted from client action payloads or lifecycle API arguments;
- wallet-bearing rounds are recorded in `game_round` when their wallet
  operations are committed;
- every queued wallet operation is recorded in `game_round_operation`; failed
  round commits keep auditable failed operation rows even when no
  `player_transaction` row is created;
- every wallet adjustment in that flow carries the same `round_id` into
  `player_transaction`;
- callbacks must not return with an active round; `EngineActor` clears the
  leaked round and treats the callback as a script error;
- `round_id` is the durable reconciliation key for game wallet transactions.

CPU and runtime limits:
- each message execution has a maximum duration;
- runaway scripts are interrupted and reported as `EngineFailed`;
- repeated engine failures move the session to `error`.

### WalletActor

`WalletActor` serializes wallet reads and the fallback single-operation wallet
message path by `playerID`. Round-scoped gameplay writes are normally settled
through `BalanceService.CommitRound`, which writes the round audit rows and
ledger rows in database transactions.

Owned state:
- in-flight operations for one player shard;
- bounded actor-local idempotency cache for fast duplicate replies;
- balance-read request routing and fallback adjustment replies.

Messages:
- `AdjustBalance`
- `GetBalance`
- `WalletResult`

Idempotency key:

```
wallet:<sha256(server session/action/op context)>
wallet:<uuid>
```

Wallet request IDs are opaque platform-generated values and never come from the
client. Action-scoped wallet operations use a stable server-side hash over the
session ID, player ID, action sequence, operation index, operation type, amount,
and game ID, so a retried action can reuse the same idempotency key. Non-action
system operations use a server-generated UUID.

Database rules:
- every balance mutation is written to `player_transaction`;
- balance updates and transaction inserts happen in one database transaction;
- unique idempotency key prevents duplicate charging or duplicate rewards;
- game wallet transactions require `player_transaction.round_id`;
- `player_transaction` and `game_round_operation` reference the same
  `(round_id, game_id)` pair in `game_round`, so database constraints reject
  cross-game round mismatches;
- `game_round_operation.request_id` is unique, so a wallet operation can be
  reconciled even when a failed round does not create a `player_transaction`;
- `player_transaction` intentionally does not store `session_id`; round IDs are
  the reconciliation boundary exposed to finance and operations;
- `player_transaction.idempotency_key` is nullable and unique when present, so
  admin/manual transactions without request IDs remain valid;
- negative balances are rejected at the database and actor levels.

Gameplay API behavior:
- wallet adjustment APIs enqueue into the active round;
- `endRound()` is the commit point and returns `false` if any operation cannot
  be settled;
- failed wallet operations are emitted back to the session as system events and
  recorded in `game_round_operation`;
- game scripts should broadcast gameplay results only after `endRound()`
  returns `true`.

### PresenceActor

`PresenceActor` tracks where players are connected.

Responsibilities:
- map `playerID -> gateway node + connID list`;
- track node leases;
- clear presence when a connection closes or a node lease expires;
- support reconnect routing;
- expose online metrics.

Redis index:
- `presence:player:{playerID} -> nodeID/connIDs`, short TTL;
- `presence:node:{nodeID}` heartbeat lease;
- actor-local state is refreshed by heartbeats and unregister events.

### GameConfigActor

`GameConfigActor` caches approved game rules and backend package metadata.

Responsibilities:
- serve session creation with mode/min/max/spectate/package info;
- cache approved backend bundle metadata;
- invalidate cache on admin review/category/game updates;
- fail closed when game metadata is missing or not approved.

The actual backend JS bundle may still be loaded from the package repository or
object storage. `GameConfigActor` owns the decision of which approved version is
used for a new session.

### Router And Transport

The actor router provides one API for local and remote delivery.

```
type ActorID string

type Envelope struct {
    ID          string
    Source      ActorID
    Target      ActorID
    Type        string
    TraceID     string
    Deadline    time.Time
    Priority    Priority
    RequiresAck bool
    Payload     any
}

type Transport interface {
    Send(ctx context.Context, target ActorID, msg Envelope) error
}

type TransportHandler func(ctx context.Context, msg Envelope) error

type Subscription interface {
    Close() error
}

type RemoteTransport interface {
    Transport
    Subscribe(ctx context.Context, nodeID string, handler TransportHandler) (Subscription, error)
}
```

Inbound remote messages are delivered through `Router.DeliverLocal`; the normal
resolver path is only used for outbound routing so remote receive loops cannot
bounce a message back to another node.

Delivery classes:

| Class | Use Case | Semantics |
|-------|----------|-----------|
| At-most-once | broadcast events, presence updates | may drop under overload |
| At-least-once + idempotent | wallet requests, session commands | receiver dedupes by message/idempotency key |
| Local-only | connection writes | direct in-memory delivery |

Recommended cluster implementation:
- in-memory transport for single-node development;
- NATS for remote actor messages;
- Redis for node leases, room index, presence index, rate limits, and coarse
  discovery;
- PostgreSQL for wallet ledger and durable business records.

Implementation status:
- local actor kernel, priority mailboxes, session/engine/gateway/connection
  actors, room registry, matchmaker, wallet, presence, and game config actors
  are implemented;
- node IDs, session-owner leases, Redis-backed room and presence directories,
  and remote routing tests are implemented;
- production `game-api` still needs a real remote transport and placement
  policy before multiple replicas can actively share gameplay actors.

### Horizontal Scaling Model

Gateway nodes:
- accept WebSocket connections;
- run `ConnActor` and `GatewayNodeActor`;
- do not own game sessions;
- can scale by connection count and network throughput.

Game nodes:
- run `MatchmakerActor`, `RoomRegistryActor`, `SessionActor`, and
  `EngineActor`;
- scale by active session count, action rate, and goja CPU usage;
- may be the same binary as gateway nodes in small deployments.

Platform nodes:
- run `WalletActor`, `PresenceActor`, and `GameConfigActor`;
- scale by wallet transaction throughput and cache load.

Session placement:
- default placement is consistent hash on `sessionID`;
- newly created sessions are assigned by the router or placement service;
- active owner is recorded as `session-owner:{sessionID} -> nodeID` with a
  lease;
- messages to a session use the owner index first, then hash fallback.

Node failure:
- first version treats sessions on a failed owner node as failed;
- when the owner lease expires, a reaper marks those sessions `error` or
  `timeout`, releases room/matchmaker indexes, and notifies connected clients
  when possible;
- later versions may add event-sourced session recovery for selected game types.

### Mailbox Policy

All mailboxes are bounded and report metrics.

| Message Type | Priority | Overload Behavior |
|--------------|----------|-------------------|
| Lifecycle/system | Highest | reserve capacity; never drop while actor is alive |
| Wallet result | High | reserve capacity; dedupe by request ID |
| Player action | Normal | reject with retryable error when full |
| Broadcast event | Low | coalesce or drop low-value state frames |
| Presence heartbeat | Low | latest value wins |
| Metrics/debug | Lowest | drop first |

Metrics:
- mailbox length;
- enqueue latency;
- processing latency;
- dropped/rejected count;
- actor restart count;
- actor count by type;
- session count by state;
- remote delivery latency;
- wallet transaction latency;
- engine execution duration.

### Supervision And Failure Handling

Supervisors own actor lifecycle.

| Actor | Failure Strategy |
|-------|------------------|
| `ConnActor` | close socket, unregister presence |
| `GatewayNodeActor` | restart and rebuild local connection index from live actors |
| `MatchmakerActor` | restart; waiting queue may be lost |
| `RoomRegistryActor` | restart; rebuild live mappings from Redis/session actors |
| `SessionActor` | fail session, stop engine, release room/matchmaker resources |
| `EngineActor` | notify session; session moves to `error` unless game policy allows restart |
| `WalletActor` | restart; recover correctness from PostgreSQL idempotency keys |
| `PresenceActor` | restart; rebuild from Redis leases and gateway heartbeats |
| `GameConfigActor` | restart; reload from database/package repository |

Session failure policy:
- broadcast `session:error` when possible;
- stop engine timers and release VM resources;
- remove room code;
- remove quick-match references;
- close or detach participants;
- write final metrics/audit event.

### Security And Validation

Security checks stay at the edge and at the authoritative actor:
- `ConnActor` validates JWT and token revocation before accepting commands;
- `SessionActor` verifies membership for lifecycle and action messages;
- spectators cannot send actions;
- `EngineActor` validates platform calls against session membership and active
  explicit round state;
- `BalanceService.CommitRound` and `PlayerBalanceRepo` validate round ID,
  player ID, idempotency key, amount direction, balance rules, and
  game/round pairing before writing ledger rows;
- `WalletActor` validates player ID, round ID, idempotency key, amount, and
  balance rules for the fallback single-operation message path;
- game config lookup fails closed unless the game and backend package are
  approved.

### Next Steps

Completed foundations:
- local actor kernel and local/in-memory remote transports;
- `ConnActor`, `GatewayNodeActor`, `MatchmakerActor`, `RoomRegistryActor`,
  `SessionActor`, `EngineActor`, `WalletActor`, `PresenceActor`, and
  `GameConfigActor`;
- session-owner leases, room directory, presence directory, and game config
  cache backed by Redis/repositories;
- approved bundle loading centralized through `GameConfigActor`.

Remaining architecture work:
- wire a production remote actor transport and subscription lifecycle in
  `game-api`;
- add explicit actor placement for matchmaker, room registry, session, engine,
  wallet, presence, and game config actors;
- add remote actor delivery metrics and retry/idempotency policies where needed;
- make game config invalidation event-driven across processes instead of only
  relying on cache TTL plus local invalidation.

Advanced scaling:
- shard matchmakers for hot games;
- add broadcast coalescing for large spectator sessions;
- separate gateway/game/platform node roles if needed;
- evaluate event-sourced session recovery for games that require reconnect
  after owner-node failure.

## RBAC Permission Chain

```
User → user_role → role → role_permission → permission → {http_method, http_path}
                                          ↘ permission.menu_id → menu (sidebar visibility)
```

- Permission check: `auth/middleware.go` matches request path+method against user's effective permissions (cached 5min)
- Cache invalidation: `InvalidateUserCache(userID)` / `InvalidateUsersInRole(roleID)` / `InvalidateAll()`
- Developer-scoped: `resolveDeveloperContext()` checks `user.DeveloperID` (not role slug)
- Developer private roles: `role.developer_id` non-null = private to that developer

## Game Category Design

分类是平台级主数据，由 `game_category` 统一管理；游戏表只保存 `category_id`，不保存冗余的分类名称。分类名称、排序和启停状态都从分类表读取，避免同一分类在不同游戏记录里出现多个拼写或过期名称。

### Data Model

```
game_category
  id BIGSERIAL PK
  name VARCHAR(100) UNIQUE NOT NULL
  description TEXT
  sort_order INT
  status active|disabled
  created_at / updated_at

game
  id VARCHAR(12) PK
  developer_id BIGINT NOT NULL
  category_id BIGINT NOT NULL -> game_category.id
  title / description / thumbnail_url
  status draft|pending_review|approved|rejected|archived
  session_mode / min_player / max_player / allow_spectate
```

`GameRepo` joins `game_category` when returning game rows and exposes `categoryName` as a read model field. The write contract for game creation/update accepts `categoryId` only; `GameService` validates that the category exists and is `active` before persisting.

### Admin Flow

```
Admin → Category Management
      → create/update/disable/delete category
      → invalidate lobby game-list cache

Developer/Admin → Game Form
                → select active category
                → GameService validates category_id
                → persist game.category_id
```

Categories cannot be deleted while games reference them. To remove a category from lobby discovery without breaking existing game records, admins disable it; disabled categories are hidden from lobby/category selectors and cannot be assigned to new or updated games.

### Lobby Flow

```
Lobby loads active categories
  GET /api/lobby/category

Player selects category
  GET /api/lobby/gameList?categoryId=<id>
  → approved games filtered by game.category_id
  → response includes categoryId + categoryName from the joined read model
```

The public game-list cache key includes `categoryId` (`lobby:gameList:<offset>:<limit>:<search>:<categoryId>`). Cache invalidation uses the shared Redis `GameCacheInvalidator` and runs when:
- game visibility changes through review/status updates;
- category metadata/status changes;
- a category is deleted.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Identity split | Separate user/player tables | Clean domain boundary, no RBAC pollution |
| Role storage | `user_role` join table only | Single source of truth (no enum column) |
| Menu derivation | Via `permission.menu_id` | Eliminates redundant `role_menu` table |
| Developer roles | Private (`role.developer_id`) | Each developer org manages own roles |
| Game categories | Normalized `game_category` + `game.category_id` | Single source of truth for lobby navigation and filtering |
| Game engine | goja (pure Go JS) | No cgo, sandboxed, pool-friendly |
| Round boundary | Explicit `beginRound`/`endRound` in game scripts | Finance reconciliation uses business round IDs without coupling ledger rows to session IDs |
| Session mode | quick/room/tournament | Flexible: auto-match, private rooms, brackets |
| Balance naming | `balance` everywhere | Consistent terminology (not "points") |
| Login response | Inline permissions + menus | Eliminates 2 extra round-trips |

## End-to-End Flow

```
Developer             Admin                 Platform              Player Lobby          Game Engine
─────────             ─────                 ────────              ───────────          ───────────
1. Develop game
   (JS + frontend)

2.                  Create category (if needed)
                    Create game (draft, category_id)
                    Submit package
                    → bundlesec.Validate

3.                                        Review package
                                          → approve → game live
                                          → invalidate lobby cache

4.                                                              Register/Login
                                                                → player JWT

5.                                                              Browse categories
                                                                Browse games by category
                                                                (cached list)

6.                                                              Connect WS
                                                                ?token=JWT&gameId=N

7.                                                                                    Auth → matchmake
                                                                                      → load JS bundle
                                                                                      → sandbox + bridge
                                                                                      → onInit → onStart

8.                                                              Play (sendAction)
                                                                ← broadcast events

9.                                                                                    onAction
                                                                                      → beginRound
                                                                                      → deductBalance
                                                                                      → rewardBalance
                                                                                      → endRound
                                                                                      → broadcast result

10.                                                             Game over
                                                                                      → onFinish
                                                                                      → cleanup VM
```

## Code Structure

```
backend/
  cmd/
    admin/           Admin service entry (thin main → internal/app/admin)
    lobby/           Lobby service entry (thin main → internal/app/lobby)
    game-api/        Game gateway entry (thin main → internal/app/game)
    storage/         Built-in S3-compatible object server entry
  internal/
    app/
      admin/         Admin composition root (dig module + run) + handlers/routes
      lobby/         Lobby composition root (dig module + run) + handlers/routes
      game/          Game composition root (dig module + run + reaper)
                     + gateway (WS, session, engine, bridge)
      storage/       Storage composition root (single-file app)
    auth/            JWT (admin + player), middleware, RBAC
    config/          YAML config with env overrides
    di/              dig container wrapper, shared infra/data/domain/web
                     modules, Lifecycle (ordered resource cleanup);
                     ditest/ provides sqlite+miniredis graph-resolution fakes
    domain/
      dto/           Request/Response contracts
      model/         GORM entities
      repository/    Data access layer
      service/       Business logic + transactions
    middleware/      CORS, rate-limit, request-id, health, server run loop
    metrics/         Prometheus
    pkg/             DB, Redis, logger, errs
  migration/
    final_schema     Full schema (18 tables) + built-in reference data
                     (roles, menus, permissions, role_permission, categories).
                     The initial super admin is NOT created here — run scripts/init-admin.sh.
```

### Dependency Injection

Services are wired at runtime with [go.uber.org/dig](https://github.com/uber-go/dig)
(previously Google Wire). Each service's composition root lives in
`internal/app/<service>`: a `Module` registers the service-specific providers
and `Run()` builds the container, resolves the root `dig.In` struct and hands
off to `middleware.Run`, which still owns signals and graceful shutdown.
Shared providers are layered as reusable modules in `internal/di`
(`Base` config/logger, `Data` DB/Redis with lifecycle-managed closes,
`Domain` unit-of-work, `Web` shared route middleware). Because dig resolves
lazily at runtime, each app package carries a graph-resolution smoke test
(sqlite + miniredis fakes from `internal/di/ditest`) that replaces the
compile-time verification Wire used to provide.

## Known Gaps (Future Work)

1. **Production remote actor transport**: Router/transport abstractions and
   tests exist; `game-api` still needs NATS/Redis Stream/etc. wiring.
2. **Room-mode lobby UX**: Create/join works, but there is no rich waiting room,
   participant list, readiness display, or host control panel.
3. **Tournament mode**: Schema + enum defined but no implementation.
4. **Game replay/spectating archive**: Live spectating works; no replay storage.
5. **Game config invalidation**: Cache invalidation is local/TTL-based;
   cross-process event fanout is not implemented.
6. **CDN/object storage**: Frontend bundles use the unified S3-compatible
   storage path; production should expose `storage.public_base_url` through S3
   public hosting or a CDN.
