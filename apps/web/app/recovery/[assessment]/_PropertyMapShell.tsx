"use client";

/**
 * Client shell for the recovery-pack PropertyMap. Allows the server-rendered
 * /recovery/[assessment] page to embed the leaflet-based map without dragging
 * its window-only deps into the server bundle.
 */

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type PropertyMapType from "@/components/PropertyMap";

const PropertyMap = dynamic(() => import("@/components/PropertyMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-ink-100 flex items-center justify-center text-ink-400 text-sm">
      Loading map…
    </div>
  ),
});

export function PropertyMapClientShell(
  props: ComponentProps<typeof PropertyMapType>,
) {
  return <PropertyMap {...props} />;
}
