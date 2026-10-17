class EventEmitter {
  constructor() {
    this.handlers = {};
  }
  on(event, handler) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
    return this;
  }
  off(event, handler) {
    if (!handler) {
      delete this.handlers[event];
      return this;
    }
    var handlers = this.handlers[event];
    if (handlers) {
      this.handlers[event] = handlers.filter(function(h) {
        return h !== handler;
      });
    }
    return this;
  }
  emit(event, ...args) {
    var handlers = this.handlers[event];
    if (handlers) {
      for (var i = 0; i < handlers.length; i++) {
        try {
          handlers[i].apply(null, args);
        } catch (e) {
          platform.log('EventEmitter error in "' + event + '": ' + (e == null ? void 0 : e.message));
        }
      }
    }
  }
}
class GameLifecycle extends EventEmitter {
  /**
   * Called when the game engine initializes.
   * Set up initial game state here.
   */
  onInit() {
  }
  /**
   * Called when a player performs an action.
   */
  onAction(playerId, action, payload) {
  }
  /**
   * Called when a session member (player or spectator) pulls an authoritative
   * state snapshot via the platform `state:sync` system action — first entry,
   * reconnect, tab refocus, or error recovery. Unlike onAction this fires in
   * any live session state (not just Playing). Push the caller's full state
   * with platform.sendTo(playerId, ...).
   */
  onSync(playerId) {
  }
  /**
   * Called when the game finishes.
   * Compute results and reward players here.
   */
  onFinish() {
  }
  /**
   * Called when a member's last connection drops (genuine leave — the platform
   * dedupes multi-tab/multi-device connections via presence). The member stays
   * on the roster; a reconnect re-fires onPlayerJoin for the same ID.
   * Games typically hand the vacated seat to a bot until they return.
   */
  onPlayerLeave(playerId) {
  }
  /**
   * Called when a member (re)gains a live connection or joins the session:
   * new joiners and reconnecting members both fire this. Games can restore
   * human control of a bot-taken-over seat here.
   */
  onPlayerJoin(playerId, displayName) {
  }
}
function registerGame(game) {
  globalThis.onInit = function() {
    game.onInit();
  };
  globalThis.onAction = function(playerId, action, payload) {
    game.onAction(playerId, action, payload);
  };
  globalThis.onSync = function(playerId) {
    game.onSync(playerId);
  };
  globalThis.onFinish = function() {
    game.onFinish();
  };
  globalThis.onPlayerLeave = function(playerId) {
    if (game.onPlayerLeave) game.onPlayerLeave(playerId);
  };
  globalThis.onPlayerJoin = function(playerId, displayName) {
    if (game.onPlayerJoin) game.onPlayerJoin(playerId, displayName);
  };
  platform.log("Game registered successfully");
}
export {
  EventEmitter,
  GameLifecycle,
  registerGame
};
