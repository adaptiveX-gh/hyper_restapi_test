export function vFromSigma (sigmaBps = 0) {
  const capped = Math.min(3, Math.max(0, sigmaBps));
  // 0 bps  → 0.6   3 bps → 2.5  (px / frame)
  return 0.6 + (capped / 3) * 1.9;
}

export function chase (paddle, ballY, obi = 1) {
  const base   = 0.6;          // always move a little
  const factor = 3.0;          // extra speed when OBI extreme
  const speed  = base + factor * Math.min(1, Math.abs(obi - 1));
  if (ballY > paddle.y) paddle.y += Math.min(speed, 6);
  else                  paddle.y -= Math.min(speed, 6);
}

export class PongGame {
  constructor(chart) {
    this.chart = chart;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pong-overlay';
    chart.renderTo.style.position = 'relative';
    chart.renderTo.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.paddleWidth = 6;
    this.leftPct  = 0.03;   // 3 % default
    this.rightPct = 0.03;
    this.ballRadius = 4;
    this.speed = 1.5;
    this.dir = 1;
    this.ballX = 0;
    this.ballY = 0;

    this.leftY = 0;
    this.rightY = 0;
    this.vx = this.speed;
    this.randomiseVy();      // random vertical component

    this.obi = 1;
    this.bull = 0;
    this.bear = 0;
    this.midPrice = 0;

    this.resize();
    requestAnimationFrame(() => this.loop());
  }

  resize() {
    const { plotLeft, plotTop, plotWidth, plotHeight } = this.chart;
    Object.assign(this.canvas.style, {
      left: plotLeft + 'px',
      top: plotTop + 'px'
    });
    this.canvas.width = plotWidth;
    this.canvas.height = plotHeight;
    this.ballY = plotHeight / 2;
    this.ballX = (this.leftBoundary() + this.rightBoundary()) / 2;
    this.leftY = plotHeight / 2;
    this.rightY = plotHeight / 2;
  }

  leftBoundary () { return this.canvas.width * 0.42; }   // centre-neutral ±8 %
  rightBoundary() { return this.canvas.width * 0.58; }

  setPaddles (bearPct = 3, bullPct = 3) {
    this.leftPct  = Math.max(3, +bearPct)  / 100;
    this.rightPct = Math.max(3, +bullPct)  / 100;
  }

  update ({ bearPct, bullPct, obi, sigmaBps, midPrice }) {
    if (bearPct != null || bullPct != null) {
      this.setPaddles(bearPct ?? this.leftPct * 100, bullPct ?? this.rightPct * 100);
      if (bearPct != null) this.bear = bearPct;
      if (bullPct != null) this.bull = bullPct;
    }
    if (obi != null) this.obi = obi;
    if (sigmaBps != null) {
      this.sigma = sigmaBps;
      this.speed = vFromSigma(sigmaBps);
      this.vx = Math.sign(this.vx || 1) * this.speed;
    }
    if (midPrice != null) this.midPrice = midPrice;
  }

  loop() {
    if (this.canvas.width !== this.chart.plotWidth ||
        this.canvas.height !== this.chart.plotHeight) {
      this.resize();
    }
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const leftX = this.leftBoundary();
    const rightX = this.rightBoundary();
    const paddleW = this.paddleWidth;
    const lH = Math.max(12, h * this.leftPct);
    const rH = Math.max(12, h * this.rightPct);

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#ea4d5c';
    ctx.fillRect(leftX, this.leftY - lH / 2, paddleW, lH);

    ctx.fillStyle = '#41e084';
    ctx.fillRect(rightX - paddleW, this.rightY - rH / 2, paddleW, rH);

    const lp = { y: this.leftY };
    const rp = { y: this.rightY };
    chase(lp, this.ballY, this.obi);
    chase(rp, this.ballY, this.obi);
    this.leftY = Math.max(lH / 2, Math.min(h - lH / 2, lp.y));
    this.rightY = Math.max(rH / 2, Math.min(h - rH / 2, rp.y));

    const prevX = this.ballX;
    const prevY = this.ballY;
    this.ballX += this.vx;
    this.ballY += this.vy;

    if (this.ballY - this.ballRadius <= 0 || this.ballY + this.ballRadius >= h) {
      this.vy *= -1;
      this.ballY = Math.max(this.ballRadius, Math.min(h - this.ballRadius, this.ballY));
    }

    const crossedLeft  = prevX - this.ballRadius > leftX + paddleW &&
                         this.ballX - this.ballRadius <= leftX + paddleW;
    const crossedRight = prevX + this.ballRadius < rightX - paddleW &&
                         this.ballX + this.ballRadius >= rightX - paddleW;

    if (crossedLeft || this.ballX - this.ballRadius <= leftX + paddleW) {
      const t = crossedLeft
        ? (prevX - this.ballRadius - (leftX + paddleW)) /
          (prevX - this.ballRadius - (this.ballX - this.ballRadius))
        : 0;
      const yAtCross = crossedLeft ? prevY + (this.ballY - prevY) * t : this.ballY;
      if (yAtCross >= this.leftY - lH / 2 && yAtCross <= this.leftY + lH / 2) {
        this.vx = Math.abs(this.vx);
        this.ballX = leftX + paddleW + this.ballRadius;
        this.ballY = yAtCross;
        this.randomiseVy();
      } else if (this.ballX < leftX) {
        this.registerMiss('left');
        return;
      }
    }

    if (crossedRight || this.ballX + this.ballRadius >= rightX - paddleW) {
      const t = crossedRight
        ? ((rightX - paddleW) - (prevX + this.ballRadius)) /
          ((this.ballX + this.ballRadius) - (prevX + this.ballRadius))
        : 0;
      const yAtCross = crossedRight ? prevY + (this.ballY - prevY) * t : this.ballY;
      if (yAtCross >= this.rightY - rH / 2 && yAtCross <= this.rightY + rH / 2) {
        this.vx = -Math.abs(this.vx);
        this.ballX = rightX - paddleW - this.ballRadius;
        this.ballY = yAtCross;
        this.randomiseVy();
      } else if (this.ballX > rightX) {
        this.registerMiss('right');
        return;
      }
    }

    ctx.fillStyle = '#999';
    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, this.ballRadius, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(() => this.loop());
  }

  registerMiss(side) {
    const dir = side === 'left' ? 'LONG' : 'SHORT';
    const allow = (dir === 'LONG' && this.bull > 45) ||
                  (dir === 'SHORT' && this.bear > 45);
    if (allow && this.midPrice) {
      const entry = {
        dir,
        price: this.midPrice,
        ts: Date.now(),
        ctx: { obi: this.obi, sigma: this.sigma }
      };
      try {
        const log = JSON.parse(localStorage.getItem('tradeLog') || '[]');
        log.push(entry);
        localStorage.setItem('tradeLog', JSON.stringify(log));
      } catch {}
      console.log(entry);
    }
    this.resetBall(dir === 'LONG' ? 1 : -1);
  }

  randomiseVy() {
    this.vy = (Math.random() * 2 - 1) * this.speed;
    if (Math.abs(this.vy) < 0.2) this.vy = 0.2 * Math.sign(this.vy || 1);
  }

  resetBall(direction) {
    const h = this.canvas.height;
    this.ballX = (this.leftBoundary() + this.rightBoundary()) / 2;
    this.ballY = Math.random() * (h - this.ballRadius * 2) + this.ballRadius;
    this.vx = direction * this.speed;
    this.randomiseVy();
  }
}
