import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BoxType, BOX_TYPES } from './core/creation-state';

@Component({
  selector: 'app-box-context-menu',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      *ngIf="visible"
      class="context-menu"
      [style.left.px]="x"
      [style.top.px]="y"
      (click)="$event.stopPropagation()"
      (pointerdown)="$event.stopPropagation()"
      (pointerup)="$event.stopPropagation()"
    >
      <div class="context-menu-header">Create Box</div>
      <div class="context-menu-divider"></div>
      <button
        *ngFor="let type of boxTypes"
        class="context-menu-item"
        [style.border-left-color]="type.defaultColor"
        (click)="onSelectType(type.type)"
        (pointerdown)="$event.stopPropagation()"
        (pointerup)="$event.stopPropagation()"
      >
        <span class="context-menu-item-label">{{ type.label }}</span>
        <span class="context-menu-item-size"
          >{{ type.defaultSize.w }}×{{ type.defaultSize.h }}</span
        >
      </button>
    </div>
  `,
  styles: [
    `
      .context-menu {
        position: fixed;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        min-width: 200px;
        z-index: 10000;
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        font-size: 14px;
      }

      .context-menu-header {
        padding: 8px 12px;
        font-weight: 600;
        color: #333;
        background: #f5f5f5;
        border-radius: 4px 4px 0 0;
      }

      .context-menu-divider {
        height: 1px;
        background: #e0e0e0;
        margin: 0;
      }

      .context-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 10px 12px;
        border: none;
        border-left: 3px solid transparent;
        background: white;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s;
      }

      .context-menu-item:hover {
        background: #f0f0f0;
      }

      .context-menu-item:active {
        background: #e0e0e0;
      }

      .context-menu-item-label {
        font-weight: 500;
        color: #333;
      }

      .context-menu-item-size {
        font-size: 12px;
        color: #666;
        margin-left: 8px;
      }

      .context-menu-item:last-child {
        border-radius: 0 0 4px 4px;
      }
    `,
  ],
})
export class BoxContextMenuComponent {
  @Input() visible = false;
  @Input() x = 0;
  @Input() y = 0;
  @Output() selectType = new EventEmitter<BoxType>();
  @Output() close = new EventEmitter<void>();

  boxTypes = Object.values(BOX_TYPES);

  onSelectType(type: BoxType) {
    this.selectType.emit(type);
    this.close.emit();
  }
}
