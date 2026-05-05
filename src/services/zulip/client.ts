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

  private serializeTo(params: SendMessageParams): string {
    if (params.type === 'direct') {
      return JSON.stringify(params.to);
    }
    return String(params.to);
  }
}
