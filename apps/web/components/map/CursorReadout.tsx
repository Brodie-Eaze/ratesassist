"use client";

/**
 * CursorReadout — small bottom-right overlay showing the live cursor lat/lng.
 *
 * Single responsibility: listen for mousemove and render the throttled
 * coordinate readout. Isolated as its own subtree so 60Hz mousemoves only
 * rerender this div, not the whole PropertyMap (which would otherwise
 * recompute overlap geometry and rerun memoised conversions on every pixel
 * of cursor travel).
 *
 * Hidden in print mode.
 */

import { useRef, useState } from "react";
import { useMapEvents } from "react-leaflet";

export type CursorReadoutProps = {
  /** When true, suppress the readout (print view). */
  isPrint: boolean;
};

/** 100ms minimum gap between rerenders — enough to feel live, cheap enough
 *  not to dominate the frame budget. */
const THROTTLE_MS = 100;

function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export default function CursorReadout({
  isPrint,
}: CursorReadoutProps): JSX.Element | null {
  const [pos, setPos] = useState<[number, number] | null>(null);
  const lastMove = useRef(0);
  useMapEvents({
    mousemove: (e) => {
      const now = Date.now();
      if (now - lastMove.current < THROTTLE_MS) return;
      lastMove.current = now;
      setPos([e.latlng.lat, e.latlng.lng]);
    },
  });
  if (!pos || isPrint) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 8,
        right: 8,
        zIndex: 1000,
        background: "rgba(255,255,255,0.92)",
        padding: "3px 8px",
        borderRadius: 4,
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
        color: "#374151",
        boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        pointerEvents: "none",
      }}
    >
      {formatLatLng(pos[0], pos[1])}
    </div>
  );
}
