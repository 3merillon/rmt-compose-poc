import type { SceneHit } from './render-types.ts';

/** Selection and gesture state shared by the player and its workspace element. */
export interface WorkspaceElement extends HTMLElement {
  __rmtWsClickHandler?: (e: MouseEvent & {pointerType?: string; sourceCapabilities?: {firesTouchEvents?: boolean} | null}) => void;
  __rmtWsMoveHandler?: (e: MouseEvent) => void;
  __rmtWsPointerDownPickHandler?: (e: PointerEvent) => void;
  __rmtWsPointerSuppressionHandlers?: boolean;
  __rmtSuppressClickUntil?: number;
  __rmtDownType?: string;
  __rmtDownX?: number;
  __rmtDownY?: number;
  __rmtActivePointers?: number;
  __rmtTouchTapCandidate?: { x: number; y: number; time: number; id: number };
  __rmtWsStack?: { entries: SceneHit[]; index: number; lastX?: number; lastY?: number };
}
