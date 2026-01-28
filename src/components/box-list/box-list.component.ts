import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Box, getBoxId } from '../../intefaces/boxes.interface';

@Component({
  selector: 'app-box-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './box-list.component.html',
  styleUrls: ['./box-list.component.css'],
})
export class BoxListComponent {
  @Input() boxes: Box[] = [];
  @Input() selectedBoxId: string | number | null = null;
  @Input() hoveredBoxId: string | number | null = null;

  @Output() boxHover = new EventEmitter<string | number | null>();
  @Output() boxClick = new EventEmitter<string | number>();

  getBoxId(box: Box): string | number {
    return getBoxId(box);
  }

  onBoxMouseEnter(box: Box): void {
    this.boxHover.emit(getBoxId(box));
  }

  onBoxMouseLeave(): void {
    this.boxHover.emit(null);
  }

  onBoxClick(box: Box): void {
    this.boxClick.emit(getBoxId(box));
  }

  isSelected(box: Box): boolean {
    return String(getBoxId(box)) === String(this.selectedBoxId);
  }

  isHovered(box: Box): boolean {
    return String(getBoxId(box)) === String(this.hoveredBoxId);
  }
}
