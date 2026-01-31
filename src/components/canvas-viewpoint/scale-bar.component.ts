import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  signal,
  ElementRef,
  ViewChild,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-scale-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      #scaleBarContainer
      class="scale-bar-container"
      [class.visible]="visible()"
      [style.left.px]="position().x"
      [style.top.px]="position().y"
      (pointerdown)="onDragStart($event)"
    >
      <div class="scale-bar">
        <div class="scale-line"></div>
        <div class="scale-label">{{ scaleText() }}</div>
      </div>
    </div>
  `,
  styles: [
    `
      .scale-bar-container {
        position: absolute;
        background: rgba(0, 0, 0, 0.7);
        padding: 12px 16px;
        border-radius: 8px;
        pointer-events: all;
        cursor: move;
        user-select: none;
        transition: opacity 0.3s ease-in-out;
        opacity: 0;
        z-index: 1000;
      }

      .scale-bar-container.visible {
        opacity: 1;
      }

      .scale-bar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
      }

      .scale-line {
        width: 100px;
        height: 3px;
        background: white;
        border-left: 3px solid white;
        border-right: 3px solid white;
      }

      .scale-label {
        color: white;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        white-space: nowrap;
      }
    `,
  ],
})
export class ScaleBarComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('scaleBarContainer') containerRef!: ElementRef<HTMLDivElement>;

  @Input() zoom: number = 1;
  @Input() viewportWidth: number = 0;
  @Input() viewportHeight: number = 0;
  @Input() imageWidth: number = 0;
  @Input() imageHeight: number = 0;
  @Input() metricWidth: number = 10; // meters
  @Input() metricHeight: number = 10; // meters

  visible = signal(true);
  position = signal({ x: 0, y: 0 });
  scaleText = signal('10 m');

  private hideTimeout: any = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private hasSetInitialPosition = false;

  ngOnInit(): void {
    this.resetHideTimer();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Update scale calculation when zoom changes
    if (
      changes['zoom'] ||
      changes['imageWidth'] ||
      changes['metricWidth'] ||
      changes['metricHeight']
    ) {
      this.updateScale();
    }

    // Update position when viewport size changes
    if ((changes['viewportWidth'] || changes['viewportHeight']) && !this.hasSetInitialPosition) {
      setTimeout(() => this.updateDefaultPosition(), 0);
    }
  }

  ngOnDestroy(): void {
    this.clearHideTimer();
    this.removeGlobalListeners();
  }

  /**
   * Update the default position (bottom right with padding)
   */
  private updateDefaultPosition(): void {
    const padding = 20;

    // Get actual dimensions of the scale bar container
    const containerWidth = this.containerRef?.nativeElement?.offsetWidth || 150;
    const containerHeight = this.containerRef?.nativeElement?.offsetHeight || 60;

    this.position.set({
      x: this.viewportWidth - containerWidth - padding,
      y: this.viewportHeight - containerHeight - padding,
    });

    this.hasSetInitialPosition = true;
  }

  /**
   * Calculate and update the scale bar text based on zoom
   */
  private updateScale(): void {
    if (!this.imageWidth || !this.imageHeight) return;

    // The scale bar is a fixed 100px width on screen
    const barWidthPx = 100;

    // Calculate how many world coordinate units this represents
    // World coordinates are the same scale as image pixels
    const worldDistance = barWidthPx / this.zoom;

    // Calculate pixels per meter ratio (same as measurement tool)
    const pixelsPerMeterX = this.imageWidth / this.metricWidth;
    const pixelsPerMeterY = this.imageHeight / this.metricHeight;
    const avgPixelsPerMeter = (pixelsPerMeterX + pixelsPerMeterY) / 2;

    // Convert world distance to pixels (world coords = image pixels at zoom 1)
    // Then convert to meters
    const meters = worldDistance / avgPixelsPerMeter;

    // Show exact value, not rounded
    this.scaleText.set(this.formatDistance(meters));
  }

  /**
   * Format distance for display with exact 2 decimal places
   */
  private formatDistance(meters: number): string {
    if (meters < 0.01) {
      return `${(meters * 1000).toFixed(2)} mm`;
    } else if (meters < 1) {
      return `${(meters * 100).toFixed(2)} cm`;
    } else if (meters < 1000) {
      return `${meters.toFixed(2)} m`;
    } else {
      return `${(meters / 1000).toFixed(2)} km`;
    }
  }

  /**
   * Show the scale bar and reset hide timer
   */
  show(): void {
    this.visible.set(true);
    this.resetHideTimer();
  }

  /**
   * Reset the hide timer
   */
  private resetHideTimer(): void {
    this.clearHideTimer();
    this.hideTimeout = setTimeout(() => {
      this.visible.set(false);
    }, 5000);
  }

  /**
   * Clear the hide timer
   */
  private clearHideTimer(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * Handle drag start
   */
  onDragStart(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    this.isDragging = true;
    const pos = this.position();
    this.dragOffset = {
      x: event.clientX - pos.x,
      y: event.clientY - pos.y,
    };

    this.addGlobalListeners();
    this.resetHideTimer();
  }

  /**
   * Handle drag move
   */
  private onDragMove = (event: PointerEvent): void => {
    if (!this.isDragging) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const newX = event.clientX - this.dragOffset.x;
    const newY = event.clientY - this.dragOffset.y;

    // Constrain to viewport bounds
    const containerWidth = this.containerRef?.nativeElement?.offsetWidth || 150;
    const containerHeight = this.containerRef?.nativeElement?.offsetHeight || 60;
    const maxX = this.viewportWidth - containerWidth;
    const maxY = this.viewportHeight - containerHeight;

    this.position.set({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY)),
    });
  };

  /**
   * Handle drag end
   */
  private onDragEnd = (event: PointerEvent): void => {
    if (!this.isDragging) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    this.isDragging = false;
    this.removeGlobalListeners();
  };

  /**
   * Add global pointer listeners for dragging
   */
  private addGlobalListeners(): void {
    document.addEventListener('pointermove', this.onDragMove as any);
    document.addEventListener('pointerup', this.onDragEnd as any);
  }

  /**
   * Remove global pointer listeners
   */
  private removeGlobalListeners(): void {
    document.removeEventListener('pointermove', this.onDragMove as any);
    document.removeEventListener('pointerup', this.onDragEnd as any);
  }
}
