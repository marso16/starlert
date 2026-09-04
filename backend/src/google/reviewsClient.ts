export interface GoogleReview {
  externalReviewId: string;
  rating: number;
  text: string | null;
  author: string | null;
  reviewTime: Date;
}

export interface GoogleReviewsClient {
  listReviews(params: { accessToken: string; gbpLocationId: string }): Promise<GoogleReview[]>;
}

const STAR_RATING_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export const httpGoogleReviewsClient: GoogleReviewsClient = {
  async listReviews({ accessToken, gbpLocationId }) {
    const response = await fetch(`https://mybusiness.googleapis.com/v4/${gbpLocationId}/reviews`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Google reviews request failed with ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      reviews?: Array<{
        reviewId: string;
        starRating: string;
        comment?: string;
        reviewer?: { displayName?: string };
        createTime: string;
      }>;
    };
    return (data.reviews ?? []).map((r) => ({
      externalReviewId: r.reviewId,
      rating: STAR_RATING_MAP[r.starRating] ?? 0,
      text: r.comment ?? null,
      author: r.reviewer?.displayName ?? null,
      reviewTime: new Date(r.createTime),
    }));
  },
};
