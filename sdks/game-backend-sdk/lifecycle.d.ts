import { EventEmitter } from './events';
/**
 * Base class for game backend logic.
 * Game developers extend this and override lifecycle methods.
 */
export declare abstract class GameLifecycle extends EventEmitter {
    /**
     * Called when the game engine initializes.
     * Set up initial game state here.
     */
    onInit(): void;
    /**
     * Called when a player performs an action.
     */
    onAction(playerId: string, action: string, payload: any): void;
    /**
     * Called when a session member (player or spectator) pulls an authoritative
     * state snapshot via the platform `state:sync` system action — first entry,
     * reconnect, tab refocus, or error recovery. Unlike onAction this fires in
     * any live session state (not just Playing). Push the caller's full state
     * with platform.sendTo(playerId, ...).
     */
    onSync(playerId: string): void;
    /**
     * Called when the game finishes.
     * Compute results and reward players here.
     */
    onFinish(): void;
    /**
     * Called when a member's last connection drops (genuine leave — the platform
     * dedupes multi-tab/multi-device connections via presence). The member stays
     * on the roster; a reconnect re-fires onPlayerJoin for the same ID.
     * Games typically hand the vacated seat to a bot until they return.
     */
    onPlayerLeave?(playerId: string): void;
    /**
     * Called when a member (re)gains a live connection or joins the session:
     * new joiners and reconnecting members both fire this. Games can restore
     * human control of a bot-taken-over seat here.
     */
    onPlayerJoin?(playerId: string, displayName: string): void;
}
