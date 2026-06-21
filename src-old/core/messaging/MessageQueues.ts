type Message = PlayerInput | PlayerMessage;

export interface PlayerInput {
  playerId: string;
  input: string;
}

export interface PlayerMessage {
  playerId: string;
  message: string;
}

export type PlayerInputQueue = IMessageQueue<PlayerInput>;
export type PlayerMessageQueue = IMessageQueue<PlayerMessage>;

export const createPlayerInputQueue = (): PlayerInputQueue =>
  new MessageQueue<PlayerInput>();
export const createPlayerMessageQueue = (): PlayerMessageQueue =>
  new MessageQueue<PlayerMessage>();

/** 
 * A queue for messages that supports waiting for messages to arrive.  This
 * should only be used by a single consumer.
 */
export interface IMessageQueue<T extends Message> {
  /**
   * Adds the message to the queue. Thread-safe for multiple producers.
   */
  enqueue(message: T): void;

  /**
   * Returns a promise that resolves when a message is available.
   * NOT thread-safe - only one consumer should use this method.
   */
  waitForAvailableMessage(): Promise<void>;

  /**
   * Gets the next message in the queue. Returns undefined if empty.
   * NOT thread-safe - only one consumer should use this method.
   */
  dequeue(): T | undefined;

  clear(): void;
}

export class MessageQueue<T extends Message> implements IMessageQueue<T> {
  private queue: T[] = [];
  private messageAvailablePromise: Promise<void> | null = null;
  private messageAvailableResolver: (() => void) | null = null;

  enqueue(message: T): void {
    console.debug("[MessageQueue] Enqueue: %s", message);
    this.queue.push(message);
    console.debug("[MessageQueue] Message queue after enqueue: %o", this.queue);

    // Notify all waiters and clear the promise
    this.messageAvailableResolver?.();
    this.messageAvailableResolver = null;
    this.messageAvailablePromise = null;
  }

  async waitForAvailableMessage(): Promise<void> {
    if (this.queue.length > 0) {
      return;
    }

    // Create promise first to ensure we don't miss any messages
    if (!this.messageAvailablePromise) {
      this.messageAvailablePromise = new Promise<void>((resolve) => {
        this.messageAvailableResolver = resolve;
      });
    }

    console.debug("[MessageQueue] Waiting for message to arrive");
    return this.messageAvailablePromise;
  }

  dequeue(): T | undefined {
      return this.queue.shift();
  }

  clear(): void {
    this.queue.length = 0;
  }
}
