import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CanvasViewportComponent } from '../components/canvas-viewpoint/canvas-viewpoint';
import { BoxListComponent } from '../components/box-list/box-list.component';
import { Box } from '../interface/boxes.interface';
import { HistoryService } from '../services/history.service';

@Component({
  selector: 'app-root',
  imports: [CanvasViewportComponent, BoxListComponent, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  standalone: true,
})
export class App {
  isCreateMode = signal(false);
  isMagicMode = signal(false);
  isMeasurementMode = signal(false);
  readOnlyMode = signal(false);
  magicTolerance = signal(15);
  metricWidth = signal(10);
  metricHeight = signal(10);
  showBoxList = signal(false);
  zoom = signal(100);
  debugMagic = signal(false);

  // Box list state
  selectedBoxId = signal<number | null>(null);
  hoveredBoxId = signal<number | null>(null);

  constructor(public historyService: HistoryService) {
    // Initialize history service with example boxes
    this.historyService.initialize(this.exampleBoxes);
  }

  // Canvas event handlers
  onSelectedBoxChange(boxId: number | null) {
    this.selectedBoxId.set(boxId);
  }

  onHoveredBoxChange(boxId: number | null) {
    this.hoveredBoxId.set(boxId);
  }

  // Box list event handlers
  onBoxListHover(boxId: number | null) {
    this.hoveredBoxId.set(boxId);
  }

  onBoxListClick(boxId: number) {
    this.selectedBoxId.set(boxId);
  }

  toggleCreateMode() {
    this.isCreateMode.update((v) => !v);
  }

  toggleReadOnlyMode() {
    this.readOnlyMode.update((v) => !v);
  }

  toggleMagicMode() {
    this.isMagicMode.update((v) => !v);
  }

  toggleMeasurementMode() {
    this.isMeasurementMode.update((v) => !v);
  }

  toggleDebugMagic() {
    this.debugMagic.update((v) => !v);
  }

  toggleBoxList() {
    this.showBoxList.update((v) => !v);
  }

  onZoomChange(zoom: number) {
    this.zoom.set(Math.round(zoom * 100));
  }

  onCreateModeChange(isCreateMode: boolean) {
    this.isCreateMode.set(isCreateMode);
  }

  onMagicModeChange(isMagicMode: boolean) {
    this.isMagicMode.set(isMagicMode);
  }

  onMeasurementModeChange(isMeasurementMode: boolean) {
    this.isMeasurementMode.set(isMeasurementMode);
  }

  exampleBoxes: Box[] = Array.from({ length: 1000 }, (_, i) => {
    const x = Math.random();
    const y = Math.random();

    const w = Math.random() / 100;
    const h = Math.random() / 100;

    // Random rotation (0–360 degrees)
    const rotation = Math.random() * Math.PI * 2;

    const color = predefinedColors[Math.floor(Math.random() * predefinedColors.length)];

    return {
      id: i + 1,
      x,
      y,
      w,
      h,
      rotation,
      color,
      state: Math.random() < 0.5 ? 'pending' : 'accepted',
    };
  });
}

const predefinedColors = Array.from(
  { length: 50 },
  (_, i) => `hsl(${Math.floor((i / 50) * 360)}, 70%, 50%)`,
);
