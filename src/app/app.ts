import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CanvasViewportComponent } from '../components/canvas-viewpoint/canvas-viewpoint';
import { Box } from '../intefaces/boxes.interface';
import { HistoryService } from '../services/history.service';

@Component({
  selector: 'app-root',
  imports: [CanvasViewportComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  standalone: true,
})
export class App {
  constructor(private historyService: HistoryService) {
    // Initialize history service with example boxes
    this.historyService.initialize(this.exampleBoxes);
  }

  exampleBoxes: Box[] = Array.from({ length: 1000 }, (_, i) => {
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
