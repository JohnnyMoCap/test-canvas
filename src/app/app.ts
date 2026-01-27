import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CanvasViewportComponent } from '../components/canvas-viewpoint/canvas-viewpoint';
import { Box } from '../intefaces/boxes.interface';
import { HistoryService } from '../services/history.service';

@Component({
  selector: 'app-root',
  imports: [CanvasViewportComponent, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  standalone: true,
})
export class App {
  isCreateMode = signal(false);
  isMagicMode = signal(false);
  magicTolerance = signal(30);
  zoom = signal(100);
  debugMagic = signal(false);

  constructor(private historyService: HistoryService) {
    // Initialize history service with example boxes
    this.historyService.initialize(this.exampleBoxes);
  }

  resetCamera() {
    // This will trigger via the component
  }

  toggleCreateMode() {
    this.isCreateMode.update((v) => !v);
  }

  toggleMagicMode() {
    this.isMagicMode.update((v) => !v);
  }

  toggleDebugMagic() {
    this.debugMagic.update((v) => !v);
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

  exampleBoxes: Box[] = Array.from({ length: 1 }, (_, i) => {
    const x = Math.random();
    const y = Math.random();

    const w = Math.random() / 100;
    const h = Math.random() / 100;

    // Random rotation (0–360 degrees)
    const rotation = Math.random() * Math.PI * 2;

    // Style groups for batching (5 styles)
    const styleId = `style-${1 + (i % 5)}`;

    const color = predefinedColors[Math.floor(Math.random() * predefinedColors.length)];

    return {
      id: i,
      x,
      y,
      w,
      h,
      rotation,
      styleId,
      color,
    };
  });
}

const predefinedColors = Array.from(
  { length: 50 },
  (_, i) => `hsl(${Math.floor((i / 50) * 360)}, 70%, 50%)`,
);
