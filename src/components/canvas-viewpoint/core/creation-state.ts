/**
 * Box creation state management
 */

export interface CreateBoxState {
  isCreating: boolean;
  startPoint: { x: number; y: number } | null;
  currentPoint: { x: number; y: number } | null;
}

export type BoxType = 'finding' | 'annotation' | 'highlight' | 'comment';

export interface BoxTypeInfo {
  type: BoxType;
  label: string;
  defaultColor: string;
  defaultSize: { w: number; h: number }; // in pixels
}

export const BOX_TYPES: Record<BoxType, BoxTypeInfo> = {
  finding: {
    type: 'finding',
    label: 'Finding',
    defaultColor: 'hsl(0, 70%, 50%)',
    defaultSize: { w: 200, h: 150 },
  },
  annotation: {
    type: 'annotation',
    label: 'Annotation',
    defaultColor: 'hsl(210, 70%, 50%)',
    defaultSize: { w: 150, h: 100 },
  },
  highlight: {
    type: 'highlight',
    label: 'Highlight',
    defaultColor: 'hsl(60, 70%, 50%)',
    defaultSize: { w: 100, h: 75 },
  },
  comment: {
    type: 'comment',
    label: 'Comment',
    defaultColor: 'hsl(120, 70%, 50%)',
    defaultSize: { w: 120, h: 90 },
  },
};
