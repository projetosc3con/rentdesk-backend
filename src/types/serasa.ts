export type DocumentType = 'PF' | 'PJ';

export interface SerasaLoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  scope: string;
}

export interface SerasaScoreRequest {
  document: string;
  model: string;
  entities: Record<string, unknown>;
}

export interface SerasaModelScore {
  score: number;
  execution_error: string | null;
  execution_success: boolean;
  model_code: string;
  model_uid: string;
  additional_scores?: Record<string, unknown>;
  score_factors?: unknown[];
  score_percentile?: string;
}

export interface SerasaScoreResponse {
  success: boolean;
  error: string | null;
  payload: {
    model_scores: SerasaModelScore[];
  };
}
