/* ==========================================================================
   SAMRAJYA - THE TIMINGS

   How long the die takes, and how long it is held, in one place.

   THE DIE GOES FIRST
   -----------------
   A throw is three moments: the tumble, the hold, and then the coin. The
   tumble is the die finding its face; the hold is that face sitting still,
   read and believed; and only after both does anything on the board move.

   The numbers live here rather than inside the throw, because two devices
   have to agree on them: the player who threw and the player watching have to
   see the coin start at the same moment, and they can only do that if both
   are reading the same numbers. A value that is computed on one device and
   sent to the other would be a value that could disagree.

   THE TUMBLE IS MEASURED, NOT GUESSED
   -----------------------------------
   The throw as it stood took 1086ms from the tap to the face settling: twelve
   ticks that get slower, so the die decelerates into its result, and the
   promise chain between them. DICE_ROLL_MS is that measurement plus a second,
   so the die is given a full second longer to be read.
   ========================================================================== */

/** How long the die tumbles for, from the tap to the face settling. */
export const DICE_ROLL_MS = 2086;

/** How long the settled face stays on screen, still, before anything moves. */
export const DICE_HOLD_MS = 800;

/** The whole delay between the tap and the coin moving. */
export const DICE_DELAY_MS = DICE_ROLL_MS + DICE_HOLD_MS;

/**
 * A pause, as a promise.
 *
 * The throw is two of these, one after the other, and the coin waits for both.
 * It is here so that a check can wait the same way with a clock it controls.
 */
export const pause = (ms) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
