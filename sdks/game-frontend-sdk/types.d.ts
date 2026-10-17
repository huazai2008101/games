export type MessageType = 'event' | 'action' | 'system';
export interface GameMessage {
    type: MessageType;
    action: string;
    payload: any;
    timestamp: number;
    seq: number;
    playerId?: string;
    gameId?: string;
    sessionId?: string;
}
export type GameState = 'created' | 'waiting' | 'ready' | 'playing' | 'finished' | 'error' | 'timeout';
export interface GameClientOptions {
    url: string;
    gameId: string;
    /**
     * Obtains a fresh single-use WS ticket. The game iframe never holds the
     * player's access token — the lobby host mints tickets on demand (one per
     * connect/reconnect), so a compromised game bundle can only ever obtain
     * one-time WS tickets, never the player's reusable API credential.
     */
    ticketProvider: () => Promise<string | null>;
    sessionId?: string;
    /** Join as a read-only spectator (the game must allow spectating). */
    spectate?: boolean;
    /** Room code for room-mode games (alternative to sessionId). */
    roomCode?: string;
    autoReconnect?: boolean;
    reconnectDelay?: number;
    maxReconnectAttempts?: number;
}
export interface HostGameConfig {
    wsUrl: string;
    gameId: string;
    /** Fetches a fresh single-use WS ticket from the lobby host (ticket-on-demand). */
    requestTicket: () => Promise<string | null>;
    sessionId?: string;
    roomCode?: string;
    spectate?: boolean;
}
