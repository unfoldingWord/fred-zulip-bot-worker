export interface StreamMessageParams {
  type: 'stream';
  to: string | number;
  topic: string;
  content: string;
}

export interface DirectMessageParams {
  type: 'direct';
  to: (number | string)[];
  content: string;
}

export type SendMessageParams = StreamMessageParams | DirectMessageParams;

export interface GetMessagesParams {
  narrow: Array<{ operator: string; operand: string | number }>;
  anchor?: string | number;
  num_before?: number;
  num_after?: number;
}

export class ZulipClient {
  private readonly authHeader: string;

  constructor(
    private readonly site: string,
    email: string,
    apiKey: string
  ) {
    this.authHeader = 'Basic ' + btoa(`${email}:${apiKey}`);
  }

  async sendMessage(params: SendMessageParams): Promise<Response> {
    const body = new URLSearchParams();
    body.set('type', params.type);
    body.set('to', this.serializeTo(params));
    if (params.type === 'stream') {
      body.set('topic', params.topic);
    }
    body.set('content', params.content);

    return fetch(`${this.site}/api/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }

  async addReaction(messageId: number, emojiName: string): Promise<Response> {
    const body = new URLSearchParams();
    body.set('emoji_name', emojiName);

    return fetch(`${this.site}/api/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }

  async removeReaction(messageId: number, emojiName: string): Promise<Response> {
    const body = new URLSearchParams();
    body.set('emoji_name', emojiName);

    return fetch(`${this.site}/api/v1/messages/${messageId}/reactions`, {
      method: 'DELETE',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }

  async getMessages(params: GetMessagesParams): Promise<Response> {
    const url = new URL(`${this.site}/api/v1/messages`);
    url.searchParams.set('narrow', JSON.stringify(params.narrow));
    url.searchParams.set('anchor', String(params.anchor ?? 'newest'));
    url.searchParams.set('num_before', String(params.num_before ?? 20));
    url.searchParams.set('num_after', String(params.num_after ?? 0));

    return fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: this.authHeader },
    });
  }

  private serializeTo(params: SendMessageParams): string {
    if (params.type === 'direct') {
      return JSON.stringify(params.to);
    }
    return String(params.to);
  }
}
