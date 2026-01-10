import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Input,
  NgZone,
  signal,
  effect,
} from '@angular/core';
import { Box, getBoxId } from '../../intefaces/boxes.interface';
import { Quadtree } from './core/quadtree';
import { Camera, ResizeCorner, TextMetrics } from './core/types';
import { CreateBoxState, BoxType, BOX_TYPES } from './core/creation-state';
import { CoordinateTransform } from './utils/coordinate-transform';
import { CameraUtils } from './utils/camera-utils';
import { BoxUtils } from './utils/box-utils';
import { NametagUtils } from './utils/nametag-utils';
import { InteractionUtils } from './utils/interaction-utils';
import { RenderUtils } from './utils/render-utils';
import { CreationUtils } from './utils/creation-utils';
import { BoxCreationUtils } from './utils/box-creation-utils';
import { BoxStateUtils } from './utils/box-state-utils';
import { ContextMenuUtils, ContextMenuState } from './utils/context-menu-utils';
import { QuadtreeUtils } from './utils/quadtree-utils';
import { BackgroundUtils } from './utils/background-utils';
import { FrameRenderer } from './utils/frame-renderer';
import { HoverDetectionUtils } from './utils/hover-detection-utils';
import { PerformanceConfig } from './core/performance-config';

import { BoxContextMenuComponent } from './box-context-menu.component';

@Component({
  selector: 'app-canvas-viewport',
  templateUrl: './canvas-viewpoint.html',
  styleUrls: ['./canvas-viewpoint.css'],
  standalone: true,
  imports: [BoxContextMenuComponent],
})
export class CanvasViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** Public Inputs */
  @Input({ required: false }) set boxes(value: Box[] | undefined) {
    this._boxes.set(value ?? []);
    this.rebuildIndex();
    this.scheduleRender();
  }
  @Input() backgroundUrl?: string;

  showNametags = true;
  debugShowQuadtree = true; //TODO: add more debug options

  // Creation mode
  isCreateMode = false;
  private createState: CreateBoxState = {
    isCreating: false,
    startPoint: null,
    currentPoint: null,
  };
  private nextTempId = 1; // Counter for temporary IDs

  // Context menu
  private contextMenuState: ContextMenuState = ContextMenuUtils.close();
  get contextMenuVisible() {
    return this.contextMenuState.visible;
  }
  get contextMenuX() {
    return this.contextMenuState.x;
  }
  get contextMenuY() {
    return this.contextMenuState.y;
  }

  // Signals
  private _boxes = signal<Box[]>([]);
  boxesSignal = this._boxes;
  camera = signal<Camera>({ zoom: 1, x: 0, y: 0, rotation: 0 });

  // Canvas state
  private raf = 0;
  private ctx?: CanvasRenderingContext2D;
  private devicePixelRatio = 1;
  private dirty = signal(true);
  private lastFrameTime = 0;

  // Interaction state
  private isPointerDown = false;
  private lastPointer = { x: 0, y: 0 };
  private hoveredBoxId: string | null = null;
  private selectedBoxId: string | null = null;
  private isDraggingBox = false;
  private dragStartWorld = { x: 0, y: 0 };
  private boxStartPos = { x: 0, y: 0 };
  private isResizing = false;
  private resizeCorner: ResizeCorner | null = null;
  private isRotating = false;
  private rotationStartAngle = 0;
  private boxStartRotation = 0;
  private isDraggingOrInteracting = false; // Flag to defer expensive operations
  private currentCursor = 'default'; // Track current cursor to avoid unnecessary updates

  // Caches
  private bgCanvas?: HTMLCanvasElement;
  private nametagMetricsCache = new Map<string, TextMetrics>();
  private quadtree?: Quadtree<Box>;
  private minZoom = 0;

  constructor(private ngZone: NgZone) {
    effect(() => {
      const _ = this.camera();
      const __ = this._boxes();
      this.dirty.set(true);
      this.scheduleRender();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.devicePixelRatio = window.devicePixelRatio || 1;
    this.onResize();

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context not supported');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;

    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl);

    this.rebuildIndex();
    this.ngZone.runOutsideAngular(() => this.startLoop());

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
  }

  resetCamera() {
    const defaultZoom = this.minZoom > 0 ? this.minZoom : 1;
    this.camera.set({ zoom: defaultZoom, x: 0, y: 0, rotation: 0 });
    this.scheduleRender();
  }

  toggleCreateMode() {
    this.isCreateMode = !this.isCreateMode;
    if (!this.isCreateMode) {
      this.createState = {
        isCreating: false,
        startPoint: null,
        currentPoint: null,
      };
      this.scheduleRender();
    }
    this.updateCursor();
  }

  onContextMenuSelect(type: BoxType) {
    if (!this.contextMenuState.worldPos || !this.bgCanvas) return;

    const newBox = BoxCreationUtils.createBoxFromContextMenu(
      type,
      this.contextMenuState.worldPos.x,
      this.contextMenuState.worldPos.y,
      this.camera(),
      this.bgCanvas.width,
      this.bgCanvas.height,
      BoxCreationUtils.generateTempId(this.nextTempId++)
    );

    this._boxes.set(BoxStateUtils.addBox(this._boxes(), newBox));
    this.rebuildIndex();
    this.scheduleRender();

    this.closeContextMenu();
  }

  closeContextMenu() {
    this.contextMenuState = ContextMenuUtils.close();
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY;
    const zoomFactor = Math.exp(delta * 0.0015);
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * this.devicePixelRatio;
    const cy = (e.clientY - rect.top) * this.devicePixelRatio;

    const cam = this.camera();
    const canvas = this.canvasRef.nativeElement;
    const newZoom = Math.min(16, Math.max(this.minZoom || 0.0001, cam.zoom * zoomFactor));

    const worldBefore = CoordinateTransform.screenToWorld(cx, cy, canvas.width, canvas.height, cam);
    const newCam = { ...cam, zoom: newZoom };
    const worldAfter = CoordinateTransform.screenToWorld(
      cx,
      cy,
      canvas.width,
      canvas.height,
      newCam
    );

    const dx = worldAfter.x - worldBefore.x;
    const dy = worldAfter.y - worldBefore.y;

    const updatedCam = { ...newCam, x: cam.x - dx, y: cam.y - dy };
    this.camera.set(this.clampCamera(updatedCam));
    this.detectHover(worldBefore.x, worldBefore.y);
  }

  onPointerDown(e: PointerEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const canvas = this.canvasRef.nativeElement;
    const mx = (e.clientX - rect.left) * this.devicePixelRatio;
    const my = (e.clientY - rect.top) * this.devicePixelRatio;
    const worldPos = CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      this.camera()
    );

    // Don't handle pointer events if clicking on the context menu
    if (this.contextMenuState.visible && ContextMenuUtils.isWithinMenu(e.target as HTMLElement)) {
      return;
    }

    // Close context menu if clicking outside
    if (this.contextMenuState.visible) {
      this.closeContextMenu();
      return;
    }

    // Handle right-click for context menu
    if (e.button === 2) {
      e.preventDefault();
      this.contextMenuState = ContextMenuUtils.open(e.clientX, e.clientY, worldPos.x, worldPos.y);
      return;
    }

    // Handle create mode
    if (this.isCreateMode && e.button === 0) {
      this.createState.isCreating = true;
      this.createState.startPoint = worldPos;
      this.createState.currentPoint = worldPos;
      this.scheduleRender();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    // Disable normal interactions in create mode
    if (this.isCreateMode) return;

    // Check rotation knob
    if (this.selectedBoxId) {
      const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
      if (box && this.bgCanvas) {
        const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
        if (wb && InteractionUtils.detectRotationKnob(worldPos.x, worldPos.y, wb, this.camera())) {
          this.isRotating = true;
          this.rotationStartAngle = Math.atan2(worldPos.y - wb.y, worldPos.x - wb.x);
          this.boxStartRotation = wb.rotation;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          return;
        }

        // Check corner handles
        if (wb) {
          const corner = InteractionUtils.detectCornerHandle(
            worldPos.x,
            worldPos.y,
            wb,
            this.camera()
          );
          if (corner) {
            this.isResizing = true;
            this.resizeCorner = corner;
            this.dragStartWorld = worldPos;
            this.boxStartPos = { x: wb.x, y: wb.y };
            (e.target as Element).setPointerCapture?.(e.pointerId);
            return;
          }
        }
      }
    }

    // Check box/nametag click
    const candidates = this.quadtree
      ? (this.quadtree.queryRange(worldPos.x - 1, worldPos.y - 1, 2, 2) as Box[])
      : this._boxes();

    let clickedBoxId: string | null = null;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      if (!this.bgCanvas) continue;
      const worldBox = BoxUtils.normalizeBoxToWorld(
        rawBox,
        this.bgCanvas.width,
        this.bgCanvas.height
      );
      if (!worldBox) continue;

      if (
        this.showNametags &&
        NametagUtils.pointInNametag(
          worldPos.x,
          worldPos.y,
          worldBox,
          this.camera(),
          this.nametagMetricsCache,
          this.ctx
        )
      ) {
        clickedBoxId = String(getBoxId(rawBox));
        break;
      }

      if (CoordinateTransform.pointInBox(worldPos.x, worldPos.y, worldBox)) {
        clickedBoxId = String(getBoxId(rawBox));
        break;
      }
    }

    if (clickedBoxId) {
      this.selectedBoxId = clickedBoxId;
      this.isDraggingBox = true;
      this.dragStartWorld = worldPos;
      const box = this._boxes().find((b) => String(getBoxId(b)) === clickedBoxId);
      if (box && this.bgCanvas) {
        const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
        if (wb) this.boxStartPos = { x: wb.x, y: wb.y };
      }
      this.scheduleRender();
    } else {
      if (this.selectedBoxId) {
        this.selectedBoxId = null;
        this.scheduleRender();
      }
      this.isPointerDown = true;
    }

    this.lastPointer = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  onPointerUp(e: PointerEvent) {
    // Handle create mode
    if (
      this.createState.isCreating &&
      this.createState.startPoint &&
      this.createState.currentPoint &&
      this.bgCanvas
    ) {
      const newBox = BoxCreationUtils.createBoxFromDrag(
        this.createState.startPoint.x,
        this.createState.startPoint.y,
        this.createState.currentPoint.x,
        this.createState.currentPoint.y,
        this.bgCanvas.width,
        this.bgCanvas.height,
        BoxCreationUtils.generateTempId(this.nextTempId++)
      );

      if (newBox) {
        this._boxes.set(BoxStateUtils.addBox(this._boxes(), newBox));
        this.rebuildIndex();
      }

      this.createState = {
        isCreating: false,
        startPoint: null,
        currentPoint: null,
      };
      this.scheduleRender();
    }

    this.isPointerDown = false;
    this.isDraggingBox = false;
    this.isResizing = false;
    this.isRotating = false;
    this.resizeCorner = null;

    // Rebuild quadtree after interaction ends
    if (this.isDraggingOrInteracting) {
      this.isDraggingOrInteracting = false;
      this.rebuildIndex();
    }

    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  onPointerMove(e: PointerEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const canvas = this.canvasRef.nativeElement;
    const mx = (e.clientX - rect.left) * this.devicePixelRatio;
    const my = (e.clientY - rect.top) * this.devicePixelRatio;
    const worldPos = CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      this.camera()
    );

    // Handle creation preview
    if (this.createState.isCreating && this.createState.startPoint) {
      this.createState.currentPoint = worldPos;
      this.scheduleRender();
      return;
    }

    // Disable normal interactions in create mode
    if (this.isCreateMode) return;

    if (this.isRotating && this.selectedBoxId) {
      this.isDraggingOrInteracting = true;
      this.handleRotation(worldPos.x, worldPos.y);
      return;
    }

    if (this.isResizing && this.selectedBoxId && this.resizeCorner) {
      this.isDraggingOrInteracting = true;
      this.handleResize(worldPos.x, worldPos.y);
      return;
    }

    if (this.isDraggingBox && this.selectedBoxId) {
      const dx = worldPos.x - this.dragStartWorld.x;
      const dy = worldPos.y - this.dragStartWorld.y;
      const newX = this.boxStartPos.x + dx;
      const newY = this.boxStartPos.y + dy;
      this.isDraggingOrInteracting = true;
      this.updateBoxPosition(this.selectedBoxId, newX, newY);
      return;
    }

    if (this.selectedBoxId && !this.isPointerDown && this.bgCanvas) {
      const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
      if (box) {
        const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
        if (wb) {
          if (InteractionUtils.detectRotationKnob(worldPos.x, worldPos.y, wb, this.camera())) {
            this.setCursor('grab');
          } else {
            const corner = InteractionUtils.detectCornerHandle(
              worldPos.x,
              worldPos.y,
              wb,
              this.camera()
            );
            if (corner) {
              this.setCursor(InteractionUtils.getResizeCursor(corner, wb));
            } else {
              this.setCursor(this.hoveredBoxId ? 'pointer' : 'default');
            }
          }
        }
      }
    }

    if (!this.isPointerDown && !this.isDraggingBox) {
      this.detectHover(worldPos.x, worldPos.y);
    }

    if (this.isPointerDown) {
      const dx = (e.clientX - this.lastPointer.x) * this.devicePixelRatio;
      const dy = (e.clientY - this.lastPointer.y) * this.devicePixelRatio;
      this.lastPointer = { x: e.clientX, y: e.clientY };

      const cam = this.camera();
      const worldDelta = CoordinateTransform.screenDeltaToWorld(dx, dy, cam);
      const updatedCam = { ...cam, x: cam.x - worldDelta.x, y: cam.y - worldDelta.y };
      this.camera.set(this.clampCamera(updatedCam));
    } else {
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  }

  private detectHover(wx: number, wy: number) {
    // Skip hover detection in create mode
    if (this.isCreateMode) {
      if (this.hoveredBoxId !== null) {
        this.hoveredBoxId = null;
        this.scheduleRender();
      }
      return;
    }

    if (!this.bgCanvas) return;

    const foundBoxId = HoverDetectionUtils.detectHoveredBox(
      wx,
      wy,
      this._boxes(),
      this.quadtree,
      this.bgCanvas.width,
      this.bgCanvas.height,
      this.camera(),
      this.showNametags,
      this.nametagMetricsCache,
      this.ctx
    );

    if (this.hoveredBoxId !== foundBoxId) {
      this.hoveredBoxId = foundBoxId;
      this.scheduleRender();
      this.setCursor(foundBoxId ? 'pointer' : 'default');
    }
  }

  private handleRotation(wx: number, wy: number) {
    if (!this.selectedBoxId || !this.bgCanvas) return;

    const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
    if (!box) return;

    const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
    if (!wb) return;

    const currentAngle = Math.atan2(wy - wb.y, wx - wb.x);
    const deltaAngle = currentAngle - this.rotationStartAngle;
    const newRotation = this.boxStartRotation + deltaAngle;

    this._boxes.set(
      BoxStateUtils.updateBoxRotation(this._boxes(), this.selectedBoxId, newRotation)
    );

    // Skip expensive quadtree rebuild during rotation
    if (!this.isDraggingOrInteracting) {
      this.rebuildIndex();
    }
    this.scheduleRender();
  }

  private handleResize(wx: number, wy: number) {
    if (!this.selectedBoxId || !this.resizeCorner || !this.bgCanvas) return;

    const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
    if (!box) return;

    const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
    if (!wb) return;

    // Transform mouse to local space
    const dx = wx - wb.x;
    const dy = wy - wb.y;
    const rot = -wb.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const localMouseX = dx * cos - dy * sin;
    const localMouseY = dx * sin + dy * cos;

    // Anchor corners
    const anchorCorners = {
      se: { x: -wb.w / 2, y: -wb.h / 2 },
      sw: { x: wb.w / 2, y: -wb.h / 2 },
      ne: { x: -wb.w / 2, y: wb.h / 2 },
      nw: { x: wb.w / 2, y: wb.h / 2 },
    };

    const anchor = anchorCorners[this.resizeCorner];
    const deltaX = localMouseX - anchor.x;
    const deltaY = localMouseY - anchor.y;

    // New center
    const newLocalCenterX = anchor.x + deltaX / 2;
    const newLocalCenterY = anchor.y + deltaY / 2;

    // Transform back to world
    const cosRot = Math.cos(wb.rotation);
    const sinRot = Math.sin(wb.rotation);
    const newWorldCenterX = wb.x + (newLocalCenterX * cosRot - newLocalCenterY * sinRot);
    const newWorldCenterY = wb.y + (newLocalCenterX * sinRot + newLocalCenterY * cosRot);

    // Convert to normalized
    const normalizedPos = BoxUtils.worldToNormalized(
      newWorldCenterX,
      newWorldCenterY,
      this.bgCanvas.width,
      this.bgCanvas.height
    );
    const normalizedDims = BoxUtils.worldDimensionsToNormalized(
      Math.max(1, Math.abs(deltaX)),
      Math.max(1, Math.abs(deltaY)),
      this.bgCanvas.width,
      this.bgCanvas.height
    );

    this._boxes.set(
      BoxStateUtils.updateBoxGeometry(
        this._boxes(),
        this.selectedBoxId,
        normalizedPos.x,
        normalizedPos.y,
        normalizedDims.w,
        normalizedDims.h
      )
    );

    // Skip expensive quadtree rebuild during resize
    if (!this.isDraggingOrInteracting) {
      this.rebuildIndex();
    }
    this.scheduleRender();
  }

  private updateBoxPosition(boxId: string, worldX: number, worldY: number) {
    if (!this.bgCanvas) return;

    const normalized = BoxUtils.worldToNormalized(
      worldX,
      worldY,
      this.bgCanvas.width,
      this.bgCanvas.height
    );

    this._boxes.set(
      BoxStateUtils.updateBoxPosition(this._boxes(), boxId, normalized.x, normalized.y)
    );

    // Skip expensive quadtree rebuild during drag, rebuild on pointer up
    if (!this.isDraggingOrInteracting) {
      this.rebuildIndex();
    }
    this.scheduleRender();
  }

  private startLoop() {
    const loop = (currentTime: number) => {
      this.raf = requestAnimationFrame(loop);

      // Frame rate limiting
      const elapsed = currentTime - this.lastFrameTime;
      if (elapsed < PerformanceConfig.FRAME_TIME) return;

      this.lastFrameTime = currentTime - (elapsed % PerformanceConfig.FRAME_TIME);

      if (!this.dirty()) return;
      this.renderFrame();
      this.dirty.set(false);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private scheduleRender() {
    this.dirty.set(true);
  }

  private renderFrame() {
    if (!this.ctx || !this.bgCanvas) return;

    const canvas = this.canvasRef.nativeElement;
    const cam = this.camera();
    const viewBounds = CameraUtils.getViewBoundsInWorld(canvas.width, canvas.height, cam);
    const visibleBoxes = this.queryVisible(viewBounds);

    FrameRenderer.renderFrame(
      this.ctx,
      canvas,
      cam,
      this.bgCanvas,
      visibleBoxes,
      this.bgCanvas.width,
      this.bgCanvas.height,
      this.hoveredBoxId,
      this.selectedBoxId,
      this.showNametags,
      this.nametagMetricsCache,
      this.createState,
      this.debugShowQuadtree,
      this.quadtree
    );
  }

  private queryVisible(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    if (!this.bgCanvas) return [];
    return QuadtreeUtils.queryVisible(
      this._boxes(),
      this.quadtree,
      bounds,
      this.isDraggingOrInteracting,
      this.bgCanvas.width,
      this.bgCanvas.height
    );
  }

  private async loadBackground(url: string) {
    const canvas = this.canvasRef.nativeElement;
    const result = await BackgroundUtils.loadBackground(url, canvas.width, canvas.height);

    this.bgCanvas = result.canvas;
    this.minZoom = result.minZoom;
    this.camera.set({ zoom: this.minZoom, x: 0, y: 0, rotation: 0 });
    this.rebuildIndex();
    this.scheduleRender();
  }

  private onResize() {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * this.devicePixelRatio));
    const h = Math.max(1, Math.floor(rect.height * this.devicePixelRatio));
    canvas.width = w;
    canvas.height = h;

    if (this.bgCanvas) {
      this.minZoom = BackgroundUtils.recalculateMinZoom(
        w,
        h,
        this.bgCanvas.width,
        this.bgCanvas.height
      );
      this.camera.set(
        this.clampCamera({ ...this.camera(), zoom: Math.max(this.camera().zoom, this.minZoom) })
      );
    }
    this.scheduleRender();
  }

  private rebuildIndex() {
    if (!this.bgCanvas) {
      this.quadtree = undefined;
      return;
    }
    this.quadtree = QuadtreeUtils.rebuildQuadtree(
      this._boxes(),
      this.bgCanvas.width,
      this.bgCanvas.height,
      this.showNametags
    );
  }

  private clampCamera(cam: Camera): Camera {
    if (!this.bgCanvas) return cam;
    const canvas = this.canvasRef.nativeElement;
    return CameraUtils.clampCamera(
      cam,
      canvas.width,
      canvas.height,
      this.bgCanvas.width,
      this.bgCanvas.height,
      this.minZoom
    );
  }

  private updateCursor() {
    if (this.isCreateMode) {
      this.setCursor(CreationUtils.getCreateCursor());
    } else {
      this.setCursor('default');
    }
  }

  private setCursor(cursor: string) {
    if (this.currentCursor !== cursor) {
      this.currentCursor = cursor;
      this.canvasRef.nativeElement.style.cursor = cursor;
    }
  }
}
