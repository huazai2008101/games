export interface BalanceOptions {
    /** Optional ledger description written to player_transaction.description. */
    description?: string;
}
export interface PlatformAPI {
    /** Send an event to all players in the session. */
    broadcast(event: string, data?: any): void;
    /** Send an event to a specific player. */
    sendTo(playerId: string, event: string, data?: any): void;
    /** Get a value from the game state. */
    getGameState<T = any>(key: string): T | undefined;
    /** Store a value in the game state. */
    setGameState(key: string, value: any): void;
    /**
     * Get the session roster with display names: [{id, name}]. Names are minted
     * from each player's signed JWT at ticket time and flow through the session
     * roster — no lookups. `name` is "" when unknown: fall back to your own ID
     * rendering.
     */
    getPlayers(): Array<{
        id: string;
        name: string;
    }>;
    /**
     * Whether the player currently holds any live WebSocket connection to this
     * session (pure presence lookup — no IO from the engine's perspective).
     * Bots and never-seen IDs are online by convention; use it to distinguish
     * a vacated seat from a backgrounded tab.
     */
    isPlayerOnline(playerId: string): boolean;
    /**
     * Conclude the session at a clean point (e.g. the current hand just ended
     * and every human has left): the platform finishes the session, releases the
     * room, and stops the engine. Intended to be called at most once, from a
     * game-side "no players left" decision — never mid-hand.
     */
    finishSession(): void;
    /**
     * Reopen a session whose current hand just ended with vacated seats: the
     * platform transitions the session back to the joinable Waiting state so
     * players can join by room code again and the game can start the next hand
     * when the seats are refilled.
     */
    reopenSession(): void;
    /** Generate a random float between 0 and 1. */
    random(): number;
    /**
     * Begin a verifiable (commit-reveal) fair round: the platform mints a secret
     * seed and broadcasts only its SHA-256 commitment to players BEFORE any draw.
     * Returns the commitment hash (empty string on entropy failure).
     * Pair with getFairRandom(seedId, i) for draws and revealFairRound(seedId)
     * after settlement so players can recompute every number.
     */
    beginFairRound(seedId: string): string;
    /** Derive the index-th reproducible number in [0,1) from a fair seed. Returns false for unknown seeds. */
    getFairRandom(seedId: string, index: number): number | false;
    /** Broadcast the revealed seed + commitment + draw count for players to verify. Returns false for unknown seeds. */
    revealFairRound(seedId: string): {
        seed: string;
        commitment: string;
        draws: number;
    } | false;
    /** Log a message (visible in server logs). */
    log(...args: any[]): void;
    /** Schedule a one-shot callback after a delay (ms). Returns timer ID. */
    setTimeout(callback: () => void, delay: number): number;
    /** Schedule a repeating callback. Returns timer ID. */
    setInterval(callback: () => void, interval: number): number;
    /** Cancel a timer by its ID. */
    clearTimer(id: number): void;
    /** Begin an explicit business round with a platform-generated opaque round ID. Returns empty string if a round is already active. */
    beginRound(): string;
    /** Commit and end the active business round. Returns false when no round is active, arguments are provided, or settlement fails. */
    endRound(): boolean;
    /** Get the currently active round ID. Empty string means no explicit round is open. */
    getRoundId(): string;
    /**
     * Get the wallet's rejection reason for the round that just failed to commit
     * (read after endRound() returned false), e.g. "insufficient balance".
     * Empty string when the last round committed successfully or no round ran.
     * Surface it to the player instead of guessing from endRound's bare false.
     */
    lastRoundError(): string;
    /** Queue a balance deduction in the active round. Final settlement happens in endRound(). */
    deductBalance(playerId: string, amount: number, options?: string | BalanceOptions): boolean;
    /** Queue a balance reward in the active round. Final settlement happens in endRound(). */
    rewardBalance(playerId: string, amount: number, options?: string | BalanceOptions): boolean;
    /**
     * Queue one seat's outcome for the active round (对局记录数据源). Requires
     * an open round (beginRound); rows persist when endRound commits and are
     * idempotent per (round, player). result: 'win' | 'lose' | 'draw'.
     * scoreDelta is the player-visible score/coin change; meta (optional,
     * <=255 chars) carries free-form context e.g. '炸弹×2' or '番型:清一色'.
     */
    recordResult(playerId: string, result: 'win' | 'lose' | 'draw', scoreDelta?: number, meta?: string): boolean;
    /** Get the current cached balance of a player. */
    getBalance(playerId: string): number;
    /**
     * Get the monotonic version counter of the player's last committed balance
     * (0 when unknown). Include it in result payloads so game clients can reject
     * out-of-order balance pushes that predate the result.
     */
    getBalanceVersion(playerId: string): number;
}
declare global {
    const platform: PlatformAPI;
}
