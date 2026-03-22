import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CanvasViewportComponent } from './canvas-viewpoint';

describe('CanvasViewportComponent', () => {
  let component: CanvasViewportComponent;
  let fixture: ComponentFixture<CanvasViewportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CanvasViewportComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CanvasViewportComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
