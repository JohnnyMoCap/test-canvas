import { MeasurementUtils } from './measurement-utils';
import { MeasurementState } from '../core/types';

const p = (x: number, y: number) => ({ x, y });
const baseState = (): MeasurementState => MeasurementUtils.createInitialState();

describe('MeasurementUtils', () => {
  describe('calculateDistance', () => {
    it('returns 0 for identical points', () => {
      // given
      const pointOne = p(5, 5);
      const pointTwo = p(5, 5);
      // when
      const result = MeasurementUtils.calculateDistance(pointOne, pointTwo);
      // then
      expect(result).toBe(0);
    });

    it('measures axis-aligned horizontal distance', () => {
      // given
      const pointOne = p(0, 0);
      const pointTwo = p(10, 0);
      // when
      const result = MeasurementUtils.calculateDistance(pointOne, pointTwo);
      // then
      expect(result).toBe(10);
    });

    it('measures axis-aligned vertical distance', () => {
      // given
      const pointOne = p(0, 0);
      const pointTwo = p(0, 6);
      // when
      const result = MeasurementUtils.calculateDistance(pointOne, pointTwo);
      // then
      expect(result).toBe(6);
    });

    it('measures diagonal via 3-4-5 triangle', () => {
      // given
      const pointOne = p(0, 0);
      const pointTwo = p(3, 4);
      // when
      const result = MeasurementUtils.calculateDistance(pointOne, pointTwo);
      // then
      expect(result).toBeCloseTo(5);
    });
  });

  describe('calculateMetricDistance', () => {
    it('converts 500 pixels to 0.5 m on a 1000×1000 image / 1×1 m space', () => {
      // given
      const canvasDistance = 500;
      const imageWidth = 1000;
      const imageHeight = 1000;
      const metricWidth = 1;
      const metricHeight = 1;
      // when
      const result = MeasurementUtils.calculateMetricDistance(
        canvasDistance,
        imageWidth,
        imageHeight,
        metricWidth,
        metricHeight,
      );
      // then
      expect(result).toBeCloseTo(0.5);
    });

    it('scales proportionally with non-square image', () => {
      // given — avgPPM = (2000/10 + 1000/10) / 2 = 150;  200 / 150 ≈ 1.333
      const canvasDistance = 200;
      const imageWidth = 2000;
      const imageHeight = 1000;
      const metricWidth = 10;
      const metricHeight = 10;
      // when
      const result = MeasurementUtils.calculateMetricDistance(
        canvasDistance,
        imageWidth,
        imageHeight,
        metricWidth,
        metricHeight,
      );
      // then
      expect(result).toBeCloseTo(200 / 150);
    });

    it('returns 0 for 0 canvas distance', () => {
      // given
      const canvasDistance = 0;
      // when
      const result = MeasurementUtils.calculateMetricDistance(canvasDistance, 1000, 1000, 5, 5);
      // then
      expect(result).toBe(0);
    });
  });

  describe('formatDistance', () => {
    it('formats sub-meter distances in cm', () => {
      // given
      const meters = 0.5;
      // when
      const result = MeasurementUtils.formatDistance(meters);
      // then
      expect(result).toBe('50.0 cm');
    });

    it('formats meter-range distances', () => {
      // given
      const meters = 12.345;
      // when
      const result = MeasurementUtils.formatDistance(meters);
      // then
      expect(result).toBe('12.35 m');
    });

    it('formats kilometre-range distances', () => {
      // given
      const meters = 1500;
      // when
      const result = MeasurementUtils.formatDistance(meters);
      // then
      expect(result).toBe('1.50 km');
    });

    it('formats exactly 1 m', () => {
      // given
      const meters = 1;
      // when
      const result = MeasurementUtils.formatDistance(meters);
      // then
      expect(result).toBe('1.00 m');
    });

    it('treats 1000 m as km', () => {
      // given
      const meters = 1000;
      // when
      const result = MeasurementUtils.formatDistance(meters);
      // then
      expect(result).toBe('1.00 km');
    });
  });

  describe('getMidpoint', () => {
    it('returns midpoint between two points', () => {
      // given
      const pointOne = p(0, 0);
      const pointTwo = p(10, 20);
      // when
      const result = MeasurementUtils.getMidpoint(pointOne, pointTwo);
      // then
      expect(result).toEqual({ x: 5, y: 10 });
    });

    it('returns same point when both inputs are equal', () => {
      // given
      const pointOne = p(3, 7);
      const pointTwo = p(3, 7);
      // when
      const result = MeasurementUtils.getMidpoint(pointOne, pointTwo);
      // then
      expect(result).toEqual({ x: 3, y: 7 });
    });
  });

  describe('isPointNear', () => {
    it('returns true when distance is less than threshold', () => {
      // given — actual distance is 5
      const point = p(0, 0);
      const target = p(3, 4);
      const threshold = 10;
      // when
      const result = MeasurementUtils.isPointNear(point, target, threshold);
      // then
      expect(result).toBe(true);
    });

    it('returns true when distance equals threshold', () => {
      // given
      const point = p(0, 0);
      const target = p(5, 0);
      const threshold = 5;
      // when
      const result = MeasurementUtils.isPointNear(point, target, threshold);
      // then
      expect(result).toBe(true);
    });

    it('returns false when distance exceeds threshold', () => {
      // given
      const point = p(0, 0);
      const target = p(10, 0);
      const threshold = 5;
      // when
      const result = MeasurementUtils.isPointNear(point, target, threshold);
      // then
      expect(result).toBe(false);
    });
  });

  describe('createInitialState', () => {
    it('creates inactive state with null points', () => {
      // when
      const result = MeasurementUtils.createInitialState();
      // then
      expect(result.isActive).toBe(false);
      expect(result.pointOne).toBeNull();
      expect(result.pointTwo).toBeNull();
      expect(result.isDraggingPoint).toBeNull();
    });

    it('defaults metric dimensions to 10×10', () => {
      // when
      const result = MeasurementUtils.createInitialState();
      // then
      expect(result.metricWidth).toBe(10);
      expect(result.metricHeight).toBe(10);
    });

    it('accepts custom metric dimensions', () => {
      // given
      const width = 25;
      const height = 50;
      // when
      const result = MeasurementUtils.createInitialState(width, height);
      // then
      expect(result.metricWidth).toBe(25);
      expect(result.metricHeight).toBe(50);
    });
  });

  describe('resetPoints', () => {
    it('clears all points but preserves metric dimensions', () => {
      // given
      const state: MeasurementState = {
        ...baseState(),
        pointOne: p(1, 2),
        pointTwo: p(3, 4),
        metricWidth: 20,
        metricHeight: 30,
      };
      // when
      const result = MeasurementUtils.resetPoints(state);
      // then
      expect(result.pointOne).toBeNull();
      expect(result.pointTwo).toBeNull();
      expect(result.isDraggingPoint).toBeNull();
      expect(result.metricWidth).toBe(20);
      expect(result.metricHeight).toBe(30);
    });
  });

  describe('setPointOne', () => {
    it('sets pointOne and clears pointTwo', () => {
      // given
      const state = { ...baseState(), pointTwo: p(9, 9) };
      const newPoint = p(1, 2);
      // when
      const result = MeasurementUtils.setPointOne(state, newPoint);
      // then
      expect(result.pointOne).toEqual(p(1, 2));
      expect(result.pointTwo).toBeNull();
    });

    it('clears isDraggingPoint', () => {
      // given
      const state = { ...baseState(), isDraggingPoint: 'one' as const };
      // when
      const result = MeasurementUtils.setPointOne(state, p(0, 0));
      // then
      expect(result.isDraggingPoint).toBeNull();
    });
  });

  describe('setPointTwo', () => {
    it('sets pointTwo without clearing pointOne', () => {
      // given
      const state = { ...baseState(), pointOne: p(1, 2) };
      const newPoint = p(5, 6);
      // when
      const result = MeasurementUtils.setPointTwo(state, newPoint);
      // then
      expect(result.pointTwo).toEqual(p(5, 6));
      expect(result.pointOne).toEqual(p(1, 2));
    });
  });

  describe('updateMetricDimensions', () => {
    it('updates width and height', () => {
      // given
      const state = baseState();
      // when
      const result = MeasurementUtils.updateMetricDimensions(state, 15, 25);
      // then
      expect(result.metricWidth).toBe(15);
      expect(result.metricHeight).toBe(25);
    });

    it('clamps values below 0.1 to 0.1', () => {
      // given
      const state = baseState();
      // when
      const result = MeasurementUtils.updateMetricDimensions(state, 0, -5);
      // then
      expect(result.metricWidth).toBe(0.1);
      expect(result.metricHeight).toBe(0.1);
    });
  });

  describe('activate', () => {
    it('sets isActive to true', () => {
      // given
      const state = baseState();
      // when
      const result = MeasurementUtils.activate(state);
      // then
      expect(result.isActive).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('sets isActive to false and clears all points', () => {
      // given
      const state: MeasurementState = {
        ...baseState(),
        isActive: true,
        pointOne: p(1, 1),
        pointTwo: p(2, 2),
      };
      // when
      const result = MeasurementUtils.deactivate(state);
      // then
      expect(result.isActive).toBe(false);
      expect(result.pointOne).toBeNull();
      expect(result.pointTwo).toBeNull();
    });
  });
});
