export enum RallyState { IDLE = 'IDLE', SERVE_PREP = 'SERVE_PREP', RALLY = 'RALLY', END_PENDING = 'END_PENDING' }
export type Player = 'A' | 'B';
export interface FrameFeature {
  t: number;
  /** Measured pose activity, not a calibrated probability. */
  motion_score: number;
  hit_audio: boolean;
  hit_visual: boolean;
  shuttle_held: boolean;
  shuttle_ground: boolean;
  court_visible?: boolean;
  players_visible?: number;
  activity?: boolean;
}
export interface RallyClip {
  id: number;
  start: number;
  end: number;
  hits: number;
  hitSource?: 'audio_estimate' | 'manual' | 'unknown';
  /** Stable player identity; unknown until explicitly supplied. Never near/far. */
  serverSide?: Player | null;
  winner?: Player | null;
  scoreBefore?: { a: number; b: number };
  source?: string;
  reviewStatus?: 'pending' | 'accepted';
  reviewReasons?: string[];
  evidenceStrength?: number;
}
export interface ScoreState {
  scoreA: number | null;
  scoreB: number | null;
  server: Player | null;
  serviceSide: 'Right' | 'Left' | null;
  visualServiceCourt: string;
  isGamePoint: boolean;
  isInterval: boolean;
}
export interface RallyClipWithState extends RallyClip { scoreStateBefore: ScoreState; scoreStateAfter: ScoreState }
export interface MatchStats {
  totalDuration: number; validDuration: number; rallyCount: number; averageRallyLen: number;
  scoreA: number | null; scoreB: number | null;
  totalHits: number; avgHitsPerRally: number; maxHits: number;
  pendingCount: number;
}
export interface AnalysisMetadata {
  version: string; sourceFile: string; sourceDuration?: number;
  analysisStart?: number; analysisEnd?: number; method?: string;
  scoreboardUsed?: boolean; sampleFps?: number; warnings?: string[];
}
export interface AnalysisResult { metadata: AnalysisMetadata; rallies: RallyClip[]; frames?: FrameFeature[] }
