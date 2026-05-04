export interface SendMessageParams {
  type: 'stream' | 'direct';
  to: string | number;
  topic?: string;
  content: string;
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
    body.set('to', String(params.to));
    if (params.topic) {
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
}
