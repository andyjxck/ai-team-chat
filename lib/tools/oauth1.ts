import crypto from "node:crypto";

type OAuth1Params = {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
};

export class OAuth1Client {
  constructor(private params: OAuth1Params) {}

  sign({
    method,
    url,
    body,
  }: {
    method: string;
    url: string;
    body?: string;
  }): string {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.params.consumerKey,
      oauth_nonce: crypto.randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.params.token,
      oauth_version: "1.0",
    };

    // For X API v2 with JSON body, we don't include body params in signature
    // Only include oauth params in the signature base string
    const encodedParams = Object.keys(oauthParams)
      .sort()
      .map(
        (k) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`,
      )
      .join("&");

    const baseUrl = url;
    const signatureBaseString = `${method.toUpperCase()}&${encodeURIComponent(
      baseUrl,
    )}&${encodeURIComponent(encodedParams)}`;

    const signingKey = `${encodeURIComponent(
      this.params.consumerSecret,
    )}&${encodeURIComponent(this.params.tokenSecret)}`;

    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(signatureBaseString)
      .digest("base64");

    const allParams: Record<string, string> = {
      ...oauthParams,
      oauth_signature: signature,
    };

    const header = Object.keys(allParams)
      .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(allParams[k])}"`)
      .join(", ");

    return `OAuth ${header}`;
  }
}
