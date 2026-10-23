/* ==========================================================================
   SAMRAJYA - MOTION THAT ALWAYS ENDS

   The board waits for animations: a card slides away, a coin flies, a button
   shakes, a prayer flies to the Nexus. Waiting is right - the next thing
   should not start on top of the last - but a browser that is not drawing does
   not advance an animation, and the promise that says "this one has finished"
   never settles.

   That is not a theory. A tab in the background, a phone with the screen off,
   a laptop that is asleep: the animation is created, it never runs, and its
   `finished` promise stays pending for ever. A board that waits for one of
   those is a board that is locked for as long as the player looks away, and
   when they come back the board is still locked - which is a game that looks
   frozen and can only be restarted by reloading the page.

   So every wait for an animation here has a clock behind it. The animation
   ends when it ends; the clock ends it when it will not. The coin layer has
   always done this for the walk; this module is that same rule, written once
   and used everywhere.
   ========================================================================== */

/**
 * Wait for a promise, but not for ever.
 *
 * `ms` is how long the wait may last before the clock takes over. It should be
 * a little longer than the thing being waited for, so an animation that is
 * running still ends when it ends, and only one that will never end is cut
 * short.
 */
export function settled(promise, ms = 600) {
  return Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * Animate a node and wait for it, with the clock behind it.
 *
 * The animation itself is returned, so a caller can still pause it, read its
 * play state, or let it be.
 */
export function animate(node, frames, options = {}, ms = null) {
  const duration = Number(options?.duration) || 0;
  const limit = ms ?? duration + 150;
  const animation = node.animate(frames, options);
  return { animation, done: settled(animation.finished, limit) };
}
