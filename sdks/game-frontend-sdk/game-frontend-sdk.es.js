let g = 0;
class I {
  constructor(t) {
    this.ws = null, this.lifecycle = null, this.reconnectAttempts = 0, this.reconnectTimer = null, this.connected = !1, this.intentionalClose = !1, this.options = {
      autoReconnect: !0,
      reconnectDelay: 3e3,
      maxReconnectAttempts: 5,
      ...t
    };
  }
  /**
   * Register lifecycle hooks.
   */
  use(t) {
    return this.lifecycle = t, this;
  }
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
  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
      return;
    this.intentionalClose = !1;
    const t = await this.options.ticketProvider();
    if (!t) {
      this.intentionalClose || this.tryReconnect();
      return;
    }
    const e = new URLSearchParams({
      ticket: t,
      gameId: String(this.options.gameId)
    });
    this.options.sessionId && e.set("sessionId", this.options.sessionId), this.options.roomCode && e.set("roomCode", this.options.roomCode), this.options.spectate && e.set("spectate", "1");
    const n = `${this.options.url}?${e.toString()}`;
    this.ws = new WebSocket(n), this.ws.onopen = () => {
      var s, i;
      this.connected = !0, this.reconnectAttempts = 0, (i = (s = this.lifecycle) == null ? void 0 : s.onConnect) == null || i.call(s);
    }, this.ws.onmessage = (s) => {
      try {
        const i = JSON.parse(s.data);
        this.dispatch(i);
      } catch (i) {
        console.error("[GameSDK] Failed to parse message:", i);
      }
    }, this.ws.onclose = () => {
      var s, i;
      this.connected = !1, (i = (s = this.lifecycle) == null ? void 0 : s.onDisconnect) == null || i.call(s), !this.intentionalClose && this.tryReconnect();
    }, this.ws.onerror = (s) => {
      console.error("[GameSDK] WebSocket error:", s);
    };
  }
  /**
   * Send a game action to the server.
   */
  sendAction(t, e) {
    if (this.options.spectate) {
      console.warn("[GameSDK] spectators cannot send actions");
      return;
    }
    this.send({
      type: "action",
      action: t,
      payload: e,
      timestamp: Date.now(),
      seq: ++g
    });
  }
  /**
   * Send a system/lifecycle message to the server.
   */
  sendSystem(t, e) {
    this.options.spectate || this.send({
      type: "system",
      action: t,
      payload: e,
      timestamp: Date.now(),
      seq: ++g
    });
  }
  /**
   * Notify the server that the game is ready.
   */
  ready() {
    this.sendSystem("session:ready", {});
  }
  /**
   * Pull this player's authoritative state snapshot. The platform routes the
   * request to the engine's onSync hook — valid in any live session state, so
   * reconnects and first entry recover without retry dances. Spectator
   * connections don't carry wallet state and are rejected server-side.
   */
  sync() {
    this.sendSystem("state:sync", {});
  }
  /**
   * Notify the server to start the game.
   */
  start() {
    this.sendSystem("session:start", {});
  }
  /**
   * Notify the server to finish the game.
   */
  finish() {
    this.sendSystem("session:finish", {});
  }
  /**
   * Disconnect from the server.
   */
  disconnect() {
    this.intentionalClose = !0, this.reconnectTimer && (clearTimeout(this.reconnectTimer), this.reconnectTimer = null), this.ws && (this.ws.close(), this.ws = null);
  }
  /**
   * Check if connected.
   */
  isConnected() {
    return this.connected;
  }
  // --- Private ---
  send(t) {
    this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify(t));
  }
  dispatch(t) {
    var n, s;
    const e = this.lifecycle;
    if (e)
      switch (t.type) {
        case "system":
          this.dispatchSystem(t, e);
          break;
        case "event":
          (n = e.onEvent) == null || n.call(e, t.action, t.payload);
          break;
        case "action":
          (s = e.onPlayerAction) == null || s.call(e, t.playerId ?? "", t.action, t.payload);
          break;
      }
  }
  dispatchSystem(t, e) {
    var n, s, i, c, d, r, o, h, p, u, m, f, l, w, y;
    switch (t.action) {
      case "session:joined":
        (i = e.onSessionJoin) == null || i.call(e, (n = t.payload) == null ? void 0 : n.sessionId, (s = t.payload) == null ? void 0 : s.playerCount);
        break;
      case "session:spectating":
        (r = e.onSpectate) == null || r.call(e, (c = t.payload) == null ? void 0 : c.sessionId, (d = t.payload) == null ? void 0 : d.playerCount);
        break;
      case "session:state":
        (h = e.onStateChange) == null || h.call(e, (o = t.payload) == null ? void 0 : o.state), ((p = t.payload) == null ? void 0 : p.state) === "ready" && ((u = e.onReady) == null || u.call(e));
        break;
      case "session:started":
        (m = e.onStart) == null || m.call(e, t.payload);
        break;
      case "session:finished":
      case "game:finished":
        (f = e.onFinish) == null || f.call(e, t.payload);
        break;
      case "error":
        (w = e.onError) == null || w.call(e, ((l = t.payload) == null ? void 0 : l.message) ?? "Unknown error");
        break;
      default:
        (y = e.onEvent) == null || y.call(e, t.action, t.payload);
        break;
    }
  }
  tryReconnect() {
    var e, n;
    if (!this.options.autoReconnect) return;
    if (this.reconnectAttempts >= (this.options.maxReconnectAttempts ?? 5)) {
      console.warn("[GameSDK] Max reconnect attempts reached"), (n = (e = this.lifecycle) == null ? void 0 : e.onReconnectFailed) == null || n.call(e);
      return;
    }
    this.reconnectAttempts++;
    const t = this.options.reconnectDelay ?? 3e3;
    console.log(`[GameSDK] Reconnecting in ${t}ms (attempt ${this.reconnectAttempts})`), this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, t);
  }
}
const S = "onlinegame:config:request", k = "onlinegame:config:response", C = "onlinegame:ticket:request", E = "onlinegame:ticket:response", R = "onlinegame:game:exit";
function q(a = {}) {
  const t = a.timeoutMs ?? 5e3, e = a.targetOrigin ?? T();
  return e ? new Promise((n, s) => {
    if (window.parent === window) {
      s(new Error("game host is not available"));
      return;
    }
    const i = window.setTimeout(() => {
      window.removeEventListener("message", c), s(new Error("game host config request timed out"));
    }, t);
    function c(d) {
      if (d.source !== window.parent || d.origin !== e) return;
      const r = d.data;
      if (!r || r.type !== k) return;
      const o = r.payload;
      !(o != null && o.wsUrl) || !o.gameId || (window.clearTimeout(i), window.removeEventListener("message", c), n({
        wsUrl: o.wsUrl,
        gameId: String(o.gameId),
        requestTicket: () => b({ targetOrigin: e }),
        sessionId: o.sessionId ? String(o.sessionId) : void 0,
        roomCode: o.roomCode ? String(o.roomCode) : void 0,
        spectate: !!o.spectate
      }));
    }
    window.addEventListener("message", c), window.parent.postMessage({ type: S }, e);
  }) : Promise.reject(new Error('game host origin could not be determined; refusing to broadcast to "*"'));
}
function b(a) {
  const t = a.targetOrigin, e = a.timeoutMs ?? 5e3;
  return new Promise((n, s) => {
    const i = window.setTimeout(() => {
      window.removeEventListener("message", c), s(new Error("game host ticket request timed out"));
    }, e);
    function c(d) {
      if (d.source !== window.parent || d.origin !== t) return;
      const r = d.data;
      !r || r.type !== E || (window.clearTimeout(i), window.removeEventListener("message", c), n(r.payload && r.payload.ticket || null));
    }
    window.addEventListener("message", c), window.parent.postMessage({ type: C }, t);
  });
}
function M() {
  return {
    configRequest: S,
    configResponse: k,
    ticketRequest: C,
    ticketResponse: E,
    gameExit: R
  };
}
function O(a = {}) {
  const t = a.targetOrigin ?? T();
  return !t || window.parent === window ? !1 : (window.parent.postMessage({ type: R }, t), !0);
}
function T() {
  if (!document.referrer) return null;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}
class v {
}
class D {
  constructor() {
    this.handlers = /* @__PURE__ */ new Map();
  }
  on(t, e) {
    return this.handlers.has(t) || this.handlers.set(t, []), this.handlers.get(t).push(e), this;
  }
  off(t, e) {
    if (!e)
      return this.handlers.delete(t), this;
    const n = this.handlers.get(t);
    return n && this.handlers.set(t, n.filter((s) => s !== e)), this;
  }
  emit(t, ...e) {
    const n = this.handlers.get(t);
    if (n)
      for (const s of n)
        try {
          s(...e);
        } catch (i) {
          console.error(`[GameSDK] Error in event handler "${t}":`, i);
        }
  }
  removeAllListeners() {
    this.handlers.clear();
  }
}
export {
  D as EventEmitter,
  I as GameClient,
  v as GameLifecycle,
  M as hostConfigMessageTypes,
  O as notifyGameExit,
  q as requestHostGameConfig
};
