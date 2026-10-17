import type { GameState } from './types';
/**
 * Abstract lifecycle hooks that game developers override.
 */
export declare abstract class GameLifecycle {
    /**
     * Called when the WebSocket connection is established.
     */
    onConnect?(): void | Promise<void>;
    /**
     * Called when the session is joined successfully.
     */
    onSessionJoin?(sessionId: string, playerCount: number): void | Promise<void>;
    /**
     * Called when this connection is confirmed as a spectator. Spectators receive
     * events/state but never drive lifecycle or send actions.
     */
    onSpectate?(sessionId: string, playerCount: number): void | Promise<void>;
    /**
     * Called when the game is ready to start.
     */
    onReady?(): void | Promise<void>;
    /**
     * Called when the game starts (received session:started from the platform —
     * the session entered Playing and gameplay actions are now accepted).
     */
    onStart?(data: any): void | Promise<void>;
    /**
     * Called when a game event is received from the engine.
     */
    onEvent?(action: string, payload: any): void | Promise<void>;
    /**
     * Called when another player performs an action.
     */
    onPlayerAction?(playerId: string, action: string, payload: any): void | Promise<void>;
    /**
     * Called when the game finishes.
     */
    onFinish?(data: any): void | Promise<void>;
    /**
     * Called when an error occurs.
     */
    onError?(error: string): void | Promise<void>;
    /**
     * Called when the connection is closed.
     */
    onDisconnect?(): void | Promise<void>;
    /**
     * Called when reconnection attempts are exhausted and the connection is
     * permanently lost. Use to surface a terminal "disconnected" state to the
     * user (distinct from a transient drop, which just fires onDisconnect).
     */
    onReconnectFailed?(): void | Promise<void>;
    /**
     * Called on state transitions.
     */
    onStateChange?(state: GameState): void | Promise<void>;
}
