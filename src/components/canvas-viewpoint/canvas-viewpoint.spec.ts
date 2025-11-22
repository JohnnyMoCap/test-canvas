import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CanvasViewpoint } from './canvas-viewpoint';

describe('CanvasViewpoint', () => {
  let component: CanvasViewpoint;
  let fixture: ComponentFixture<CanvasViewpoint>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CanvasViewpoint]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CanvasViewpoint);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
