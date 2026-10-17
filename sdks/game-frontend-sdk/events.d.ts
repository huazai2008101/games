export type EventHandler = (...args: any[]) => void;
export declare class EventEmitter {
    private handlers;
    on(event: string, handler: EventHandler): this;
    off(event: string, handler?: EventHandler): this;
    emit(event: string, ...args: any[]): void;
    removeAllListeners(): void;
}
