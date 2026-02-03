/**
 * Box creation state management
 */

export interface CreateBoxState {
  isCreating: boolean;
  startPoint: { x: number; y: number } | null;
  currentPoint: { x: number; y: number } | null;
}

export type BoxType = 'you tellin' | 'me a' | 'shrimp fried' | 'this rice' | 'magic';

export interface BoxTypeInfo {
  type: BoxType;
  label: string;
  defaultColor: string;
  defaultSize: { w: number; h: number }; // in pixels
}

export const BOX_TYPES: Record<BoxType, BoxTypeInfo> = {
  'you tellin': {
    type: 'you tellin',
    label: 'You Tellin',
    defaultColor: 'hsl(0, 70%, 50%)',
    defaultSize: { w: 200, h: 150 },
  },
  'me a': {
    type: 'me a',
    label: 'Me A',
    defaultColor: 'hsl(210, 70%, 50%)',
    defaultSize: { w: 150, h: 100 },
  },
  'shrimp fried': {
    type: 'shrimp fried',
    label: 'Shrimp Fried',
    defaultColor: 'hsl(60, 70%, 50%)',
    defaultSize: { w: 100, h: 75 },
  },
  'this rice': {
    type: 'this rice',
    label: 'This Rice',
    defaultColor: 'hsl(120, 70%, 50%)',
    defaultSize: { w: 120, h: 90 },
  },
  magic: {
    type: 'magic',
    label: 'Magic',
    defaultColor: 'hsl(180, 70%, 50%)',
    defaultSize: { w: 120, h: 90 },
  },
};
