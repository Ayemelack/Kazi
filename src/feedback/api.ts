import { apiRequest } from '../api/client';

export interface Feedback {
  id: number;
  rating: number;
  liked?: string;
  disliked?: string;
  suggestion?: string;
  createdAt: string;
}

export interface FeedbackInput {
  rating: number;
  liked?: string;
  disliked?: string;
  suggestion?: string;
}

export function submitFeedback(input: FeedbackInput): Promise<{ feedback: Feedback }> {
  return apiRequest<{ feedback: Feedback }>('/feedback', {
    method: 'POST',
    body: input,
    auth: true,
  });
}