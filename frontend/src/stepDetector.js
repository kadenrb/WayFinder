// Lightweight step detection adapted from the open-source pedometer example.
// Usage:
//   const detector = new StepDetector();
//   detector.update(accX, accY, accZ); // returns true when a step is detected
//   detector.reset();

class Kalman {
  constructor() {
    this.G = 1;
    this.Rw = 1; // desired noise power
    this.Rv = 10; // estimated noise power
    this.A = 1; // state transition coefficient
    this.C = 1; // measurement coefficient
    this.B = 0; // control input coefficient
    this.u = 0; // control input
    this.P = NaN; // estimation error covariance
    this.x = NaN; // estimated value 
    this.y = NaN; // measured value
  }
  // update assumed sensor noise dynvamically if needed
  setRv(Rv) {
    this.Rv = Rv;
  }
  // Run one Kalman filter step on a new measurement
  filter(sample) {
    this.y = sample;
    // first sample initializes the filter
    if (Number.isNaN(this.x)) {
      this.x = (1 / this.C) * this.y;
      this.P = (1 / this.C) * this.Rv * (1 / this.C);
      return this.x;
    }
    // Prediction
    this.x = this.A * this.x + this.B * this.u;
    this.P = this.A * this.P * this.A + this.Rw;
    // Gain
    this.G = (this.P * this.C) / (this.C * this.P * this.C + this.Rv);
    // Correction
    this.x = this.x + this.G * (this.y - this.C * this.x);
    this.P = this.P - this.G * this.C * this.P;
    return this.x;
  }
}

// step detector 
// detects walking steps using filtered accelerometer magnitude 
// designed to be lightweight and work in real time 
export class StepDetector {
  constructor(options = {}) {
    this.sampleIntervalMs = options.sampleIntervalMs || 50; // expected interval between samples
    this.windowMs = options.windowMs || 2000; // window for statistics
    this.minRangeG = options.minRangeG || 0.25; // minimum accel range (g) to consider a step
    this.g = 9.80665; // gravity constant 
    this.windowSize = Math.max(4, Math.round(this.windowMs / this.sampleIntervalMs)); // number of samples in the rolling window 
    this.accWindow = []; // recent filtered acceleration values 
    this.stepWindow = []; // prevents double counting steps
    this.kalman = new Kalman(); 
    this.sensibility = 1 / 30; // adaptive sestivity and threshold 
    this.threshold = 0;
    this.count = 0; // total step detected 
  }

  reset() { // reset dectector state (useful when restarting tracking)
    this.accWindow = [];
    this.stepWindow = [];
    this.kalman = new Kalman();
    this.count = 0;
    this.threshold = 0;
    this.sensibility = 1 / 30;
  }
  // update sampling rate and recompute window size 
  setSampleInterval(ms) {
    this.sampleIntervalMs = Math.max(10, ms);
    this.windowSize = Math.max(4, Math.round(this.windowMs / this.sampleIntervalMs));
  }
  // main update method call once per accelerometer reading 
  // Returns true when a step is detected
  update(ax, ay, az) {
    // compute acceleration magnitude 
    const norm = Math.sqrt((ax * ax) + (ay * ay) + (az * az));
    const filtered = this.kalman.filter(norm) / this.g; // normalize to g

    // Initialize buffers
    if (!Number.isFinite(filtered)) return false;
    if (this.accWindow.length === 0) {
      this.accWindow = Array(this.windowSize).fill(filtered);
      this.stepWindow = Array(this.windowSize).fill(0);
      return false;
    }

    // Slide window
    this.accWindow.push(filtered);
    this.accWindow.shift();

    // Stats over window
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let mean = 0;
    let meanSq = 0;
    for (const v of this.accWindow) {
      if (v < min) min = v;
      if (v > max) max = v;
      mean += v;
      meanSq += v * v;
    }
    mean /= this.accWindow.length;
    meanSq /= this.accWindow.length;
    const variance = Math.max(0, meanSq - (mean * mean));

    // Adaptive sensibility/threshold
    this.sensibility = Number.isFinite(variance) ? (2 * Math.sqrt(variance)) / (this.g * this.g) : (1 / 30);
    this.threshold = (min + max) / 2;

    // Step detection: upward threshold crossing, range check, simple refractory (previous window entry 0)
    const last = this.accWindow[this.accWindow.length - 1];
    const prev = this.accWindow[this.accWindow.length - 2];
    const diff = max - min;
    if (diff < this.minRangeG) return false; // reject very small motion (desk/idle)
    const isSensibility = Math.abs(diff) >= this.sensibility;
    const isOverThreshold = (last >= this.threshold) && (prev < this.threshold);
    const isValidStep = this.stepWindow[this.stepWindow.length - 1] === 0;

    let stepDetected = false;
    // final step confirmation 
    if (isSensibility && isOverThreshold && isValidStep) {
      stepDetected = true;
      this.count += 1;
      this.stepWindow.push(1);
    } else {
      this.stepWindow.push(0);
    }
    // slide step window refractory period 
    this.stepWindow.shift();

    return stepDetected;
  }
}
