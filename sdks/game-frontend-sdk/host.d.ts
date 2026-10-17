import type { HostGameConfig } from './types';
export interface HostConfigOptions {
    timeoutMs?: number;
    /**
     * The expected parent origin. If omitted, it is inferred from document.referrer.
     * When no specific origin can be determined the request FAILS CLOSED rather
     * than broadcasting to '*' — a game must know its host origin so that a
     * malicious embedder cannot receive the host's messages (or a WS ticket).
     */
    targetOrigin?: string;
}
/**
 * Requests the game configuration from the lobby host (the embedding parent).
 * The response carries everything the game needs EXCEPT a credential: WS
 * tickets are minted on demand via the returned `requestTicket` so the player's
 * access token never enters the game iframe.
 */
export declare function requestHostGameConfig(options?: HostConfigOptions): Promise<HostGameConfig>;
/**
 * Requests a fresh single-use WS ticket from the lobby host. Called by the
 * client on each connect/reconnect so a long game session survives the player's
 * short-lived access token (the host re-mints).
 */
export declare function requestHostTicket(options: {
    targetOrigin: string;
    timeoutMs?: number;
}): Promise<string | null>;
export declare function hostConfigMessageTypes(): {
    readonly configRequest: "onlinegame:config:request";
    readonly configResponse: "onlinegame:config:response";
    readonly ticketRequest: "onlinegame:ticket:request";
    readonly ticketResponse: "onlinegame:ticket:response";
    readonly gameExit: "onlinegame:game:exit";
};
/**
 * Notifies the lobby host that the player invoked the game's OWN exit/back
 * control, so the host can navigate back (route change, history back, ... —
 * the host decides). Fire-and-forget with the same origin discipline as the
 * config handshake: the message only goes to the inferred parent origin, and
 * standalone previews (no embedding parent) return false instead of posting.
 */
export declare function notifyGameExit(options?: {
    targetOrigin?: string;
}): boolean;
