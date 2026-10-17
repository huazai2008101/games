import type { PlatformAPI } from './api';
import { EventEmitter } from './events';
import { GameLifecycle } from './lifecycle';
export type { PlatformAPI };
export { EventEmitter, GameLifecycle };
/**
 * Register a game instance. The engine will call lifecycle methods automatically.
 */
export declare function registerGame(game: GameLifecycle): void;
