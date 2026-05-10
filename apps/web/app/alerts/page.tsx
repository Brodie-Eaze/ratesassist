/**
 * /alerts — legacy redirect.
 *
 * The grant-alerts surface was folded into /recovery as a `recently_granted`
 * detection signal. This page redirects to /recovery with the filter query
 * pre-applied so existing bookmarks and links continue to work.
 *
 * The complementary /alerts/[tenementId] tenement-detail view is preserved —
 * Recovery is property-centric, that page is tenement-centric, and the
 * Recovery candidate detail links across to it.
 */

import { redirect } from "next/navigation";

export default function AlertsRedirectPage(): never {
  redirect("/recovery?signal=recently_granted");
}
