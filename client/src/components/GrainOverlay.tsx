'use client';

/* Animated SVG turbulence grain — mimics analogue film stock.
   The stepped animation swaps the noise pattern every frame,
   creating the characteristic jitter of real grain. */
export default function GrainOverlay() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      className="grain-svg"
    >
      <filter id="g">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.72"
          numOctaves="2"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#g)" />
    </svg>
  );
}
