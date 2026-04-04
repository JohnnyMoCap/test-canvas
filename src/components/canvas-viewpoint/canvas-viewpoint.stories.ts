import type { Meta, StoryObj } from '@storybook/angular';
import { CanvasViewportComponent } from './canvas-viewpoint';
import { applicationConfig } from '@storybook/angular';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HistoryService } from '../../services/history.service';

const meta: Meta<CanvasViewportComponent> = {
  title: 'Canvas/CanvasViewport',
  component: CanvasViewportComponent,
  decorators: [
    applicationConfig({
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }),
  ],
};
export default meta;

type Story = StoryObj<CanvasViewportComponent>;

const defaultArgs = {
  backgroundUrl: undefined,
  isCreateModeInput: false,
  isMagicModeInput: false,
  isMeasurementModeInput: false,
  readOnlyMode: false,
  brightnessInput: 100,
  contrastInput: 100,
};

/** Empty canvas — baseline pan/zoom with no background or boxes. */
export const Default: Story = {
  args: defaultArgs,
};

/** Create mode active — cursor changes and click-drag creates a box. */
export const CreateMode: Story = {
  args: { ...defaultArgs, isCreateModeInput: true },
};

/** Read-only — no interactions, no selection. */
export const ReadOnly: Story = {
  args: { ...defaultArgs, readOnlyMode: true },
};

/** Measurement mode with a metric scale. */
export const MeasurementMode: Story = {
  args: {
    ...defaultArgs,
    isMeasurementModeInput: true,
    metricWidthInput: 100,
    metricHeightInput: 50,
  },
};

/**
 * Three pre-loaded boxes (2 accepted, 1 pending) injected via HistoryService.
 * Requires a backgroundUrl to be visible; boxes render at normalized positions.
 */
export const WithBoxes: Story = {
  args: defaultArgs,
  play: async ({ canvasElement }) => {
    const { TestBed } = await import('@angular/core/testing');
    const historyService = TestBed.inject(HistoryService);
    historyService.initialize([
      { tempId: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.15, state: 'accepted' },
      { tempId: 2, x: 0.4, y: 0.3, w: 0.15, h: 0.25, rotation: 15, state: 'accepted' },
      { tempId: 3, x: 0.65, y: 0.55, w: 0.2, h: 0.1, state: 'pending' },
    ]);
  },
};
