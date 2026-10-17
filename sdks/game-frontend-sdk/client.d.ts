import { GameLifecycle } from './lifecycle';
import type { GameClientOptions } from './types';
export declare class GameClient {
    private ws;
    private options;
    private lifecycle;
    private reconnectAttempts;
    private reconnectTimer;
    private connected;
    private intentionalClose;
    constructor(options: GameClientOptions);
    /**
     * Register lifecycle hooks.
     */
    use(lifecycle: GameLifecycle): this;
    /**
     * Connect to the game server. Asks the ticket provider for a single-use WS
     * ticket (the lobby host mints it on demand), then opens the socket with
     * ?ticket= so the player's access token never enters the iframe, the WS URL,
     * proxy logs, browser history, or Referer.
     *
     * Returns a promise so callers can await the handshake kickoff; it does not
     * wait for the socket to open. Each connect/reconnect requests a FRESH ticket,
     * so a long session survives access-token expiry (the host re-mints).
     */
    connect(): Promise<void>;
    /**
     * Send a game action to the server.
     */
    sendAction(action: string, payload: any): void;
    /**
     * Send a system/lifecycle message to the server.
     */
    private sendSystem;
    /**
     * Notify the server that the game is ready.
     */
    ready(): void;
    /**
     * Pull this player's authoritative state snapshot. The platform routes the
     * request to the engine's onSync hook — valid in any live session state, so
     * reconnects and first entry recover without retry dances. Spectator
     * connections don't carry wallet state and are rejected server-side.
     */
    sync(): void;
    /**
     * Notify the server to start the game.
     */
    start(): void;
    /**
     * Notify the server to finish the game.
     */
    finish(): void;
    /**
     * Disconnect from the server.
     */
    disconnect(): void;
    /**
     * Check if connected.
     */
    isConnected(): boolean;
    private send;
    private dispatch;
    private dispatchSystem;
    private tryReconnect;
}
