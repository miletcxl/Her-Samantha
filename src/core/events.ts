export class EventBus<TEvent> {
  private readonly listeners = new Set<(event: TEvent) => void>();

  subscribe(listener: (event: TEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: TEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
