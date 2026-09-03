import { Resend } from "resend";

export interface ReviewSummary {
  rating: number;
  text: string | null;
  author: string | null;
}

export interface EmailClient {
  sendMagicLinkEmail(to: string, loginUrl: string): Promise<void>;
  sendAlertFallbackEmail(to: string, review: ReviewSummary): Promise<void>;
}

export function createEmailClient(apiKey: string, fromAddress: string): EmailClient {
  const resend = new Resend(apiKey);

  return {
    async sendMagicLinkEmail(to, loginUrl) {
      const { error } = await resend.emails.send({
        from: fromAddress,
        to,
        subject: "Your login link",
        html: `<p>Click below to log in. This link expires in 15 minutes.</p><p><a href="${loginUrl}">${loginUrl}</a></p>`,
      });
      if (error) {
        throw new Error(`Failed to send magic link email: ${error}`);
      }
    },
    async sendAlertFallbackEmail(to, review) {
      const { error } = await resend.emails.send({
        from: fromAddress,
        to,
        subject: `New ${review.rating} star review needs your attention`,
        html: `<p>A new review from ${review.author ?? "a customer"} came in:</p><blockquote>${review.text ?? "(no comment left)"}</blockquote><p>Rating: ${review.rating} out of 5.</p>`,
      });
      if (error) {
        throw new Error(`Failed to send alert fallback email: ${error}`);
      }
    },
  };
}

export const emailClient = createEmailClient(
  process.env.RESEND_API_KEY ?? "",
  process.env.EMAIL_FROM ?? "alerts@example.com"
);
