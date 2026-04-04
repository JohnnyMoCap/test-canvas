import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { CanvasViewportComponent } from './canvas-viewpoint';

describe('CanvasViewportComponent', () => {
  let component: CanvasViewportComponent;
  let fixture: ComponentFixture<CanvasViewportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CanvasViewportComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CanvasViewportComponent);
    component = fixture.componentInstance;
    // Note: fixture.whenStable() is intentionally omitted here.
    // AfterViewInit calls getContext('2d') which jsdom does not support.
    // Full component rendering is covered by Storybook stories.
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
