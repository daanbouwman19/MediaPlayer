export interface GenerateUrlOptions {
  serverPort: number;
  preferHttp?: boolean;
}

export type GenerateUrlResult = {
  type: 'data-url' | 'http-url' | 'error';
  url?: string;
  message?: string;
};
