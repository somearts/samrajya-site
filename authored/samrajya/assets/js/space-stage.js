/* ==========================================================================
   SAMRAJYA - OUTER SPACE, THE INTERSTELLAR COUNTER

   A SHARED screen, drawn from the state the way the chests, the fight, Epoch
   and the Black Hole panel are: `game.space` is the whole truth about it -
   which seat is at the counter, whether the suits are being chosen or the
   acquisition popup is speaking, and which suit was retired by this
   arrival. Every device draws the middle from that fact.

   THE SCREEN, BUILT FROM SCRATCH: a warm off-white panel in the board's own
   material carrying a headline and ONE ROW of three tall portrait cards -
   [ Quantum One ] [ Photon Weave ] [ Singularity Mantle ] - each with its
   artwork at the top, name beneath, price and discount beneath that, and
   ACQUIRE SUIT pinned at the bottom inside the card. The row is what makes
   everything fit: headline plus three side-by-side cards in the viewport,
   no scrolling anywhere. A visible X in the panel's top-right closes the
   counter (it is the visit's own `continue` - no purchase, no state
   change beyond a clean leave).

   THE ARTWORK: three realistic, human-proportioned astronauts - same
   skeleton, same stance, same upper-left light across all three, roughly
   seven-and-a-half heads tall, serious full-glass helmets with no faces
   visible, fitted plate armor over a dark undersuit, gloves, knee pads,
   boots, an EVA pack's hoses at the collar. Only the material differs:
   pearl-white with restrained teal (Quantum One), graphite with subtle
   violet (Photon Weave), obsidian with indigo and cyan (Singularity
   Mantle). No case boxes, no cartoon proportions, no badges.

   NOTHING HERE DECIDES ANYTHING

   Prices, the discount arithmetic, the funds check and the one-suit rule
   all live in shared/suits.js and shared/game.js. This file only shows
   them; every button press is an action the server answers.
   ========================================================================== */

import { el } from "./dom.js";
import { resetHolder } from "./board-fx.js";
import { SUITS, suitById } from "./shared/suits.js";
import { rupees } from "./shared/economy.js";

/* ------------------------------------------------------------- the suits

   ONE BODY, THREE MATERIALS. Every figure is the same 96x128 frame with
   identical coordinates - helmet, shoulders, torso, belt, pelvis, thighs,
   knees, shins, boots, arms to mid-thigh - so the row reads as three
   issues of one equipment line photographed identically. Light falls from
   the upper left in all three; a soft halo behind the torso and a low
   ground shadow root each figure on the cream card. Accents stay
   restrained: a seam, a belt rule, wrist rings, the visor glint, and one
   energy core on the Mantle. */

const SUIT_ART = Object.freeze({
  "quantum-one": `<svg viewBox="0 0 96 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="q1-halo" cx="0.5" cy="0.42" r="0.62">
        <stop offset="0" stop-color="#e7eae6"/>
        <stop offset="1" stop-color="#f7f4ef" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="q1-armor" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f4f2ec"/>
        <stop offset="0.55" stop-color="#dcdad3"/>
        <stop offset="1" stop-color="#b9bcb7"/>
      </linearGradient>
      <linearGradient id="q1-limb" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#e9e7e0"/>
        <stop offset="1" stop-color="#c3c6c0"/>
      </linearGradient>
      <linearGradient id="q1-visor" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#2c3a3a"/>
        <stop offset="1" stop-color="#0e1414"/>
      </linearGradient>
    </defs>
    <ellipse cx="48" cy="54" rx="31" ry="39" fill="url(#q1-halo)"/>
    <ellipse cx="48" cy="125" rx="17" ry="2.6" fill="#121116" opacity="0.14"/>
    <path d="M43.4 31.5 q-1.6 -2.6 -3.4 -3.4" stroke="#6d7570" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M52.6 31.5 q1.6 -2.6 3.4 -3.4" stroke="#6d7570" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <rect x="39" y="30.5" width="18" height="13" rx="3" fill="#c6c9c3"/>
    <path d="M39.6 67 L47.4 67 L46.6 95.5 L40.4 95.5 Z" fill="url(#q1-limb)"/>
    <path d="M48.6 67 L56.4 67 L55.6 95.5 L49.4 95.5 Z" fill="url(#q1-limb)"/>
    <ellipse cx="44" cy="97.3" rx="3.8" ry="3" fill="#eceae4"/>
    <ellipse cx="52" cy="97.3" rx="3.8" ry="3" fill="#eceae4"/>
    <path d="M41.6 99.6 L46.4 99.6 L45.8 119 L42.2 119 Z" fill="url(#q1-limb)"/>
    <path d="M49.6 99.6 L54.4 99.6 L53.8 119 L50.2 119 Z" fill="url(#q1-limb)"/>
    <rect x="40.6" y="118.6" width="6.8" height="4.4" rx="1.3" fill="#f0eee8"/>
    <rect x="39.6" y="122.4" width="8.2" height="3" rx="1.3" fill="#4d544f"/>
    <rect x="48.6" y="118.6" width="6.8" height="4.4" rx="1.3" fill="#f0eee8"/>
    <rect x="48.2" y="122.4" width="8.2" height="3" rx="1.3" fill="#4d544f"/>
    <path d="M38.8 57.5 h18.4 l-1 8 q-1.3 4 -3.9 4 h-8.6 q-2.6 0 -3.9 -4 z" fill="url(#q1-armor)"/>
    <rect x="38.6" y="56.6" width="18.8" height="3.4" rx="1.4" fill="#6d7570"/>
    <rect x="38.6" y="59.4" width="18.8" height="1" fill="#3f9c8f"/>
    <path d="M43.2 27.4 L36 30.6 q-1.6 .8 -1.5 2.7 l1 13.2 q.3 4.6 1.2 8.4 l.7 3 q.5 2.6 3.5 2.6 h15.8 q3 0 3.5 -2.6 l.7 -3 q.9 -3.8 1.2 -8.4 l1 -13.2 q.1 -1.9 -1.5 -2.7 L52.8 27.4 z" fill="url(#q1-armor)"/>
    <path d="M39.4 34.5 q4 -1.6 8 .4 M56.6 34.5 q-4 -1.6 -8 .4" stroke="#9ba19c" stroke-width="1.1" fill="none" opacity="0.7"/>
    <path d="M48 33.5 v21.5" stroke="#3f9c8f" stroke-width="1.3" opacity="0.9"/>
    <path d="M42.5 50.5 h11" stroke="#a8ada8" stroke-width="0.9" fill="none"/>
    <ellipse cx="37.6" cy="33" rx="6" ry="6.2" fill="url(#q1-armor)"/>
    <ellipse cx="58.4" cy="33" rx="6" ry="6.2" fill="url(#q1-armor)"/>
    <rect x="32.8" y="35.4" width="7.6" height="17.5" rx="3.6" fill="url(#q1-limb)"/>
    <rect x="55.6" y="35.4" width="7.6" height="17.5" rx="3.6" fill="url(#q1-limb)"/>
    <rect x="33.2" y="51.4" width="6.8" height="7.6" rx="3.2" fill="url(#q1-limb)"/>
    <rect x="56" y="51.4" width="6.8" height="7.6" rx="3.2" fill="url(#q1-limb)"/>
    <rect x="33.6" y="57.8" width="6.4" height="11.6" rx="3" fill="url(#q1-limb)"/>
    <rect x="56" y="57.8" width="6.4" height="11.6" rx="3" fill="url(#q1-limb)"/>
    <rect x="33.7" y="68.6" width="6.2" height="1.6" rx="0.8" fill="#3f9c8f"/>
    <rect x="56.1" y="68.6" width="6.2" height="1.6" rx="0.8" fill="#3f9c8f"/>
    <rect x="33.4" y="69.8" width="6.8" height="7.4" rx="2.4" fill="#e2e0d9"/>
    <ellipse cx="40" cy="72.6" rx="1.5" ry="2.1" fill="#e2e0d9"/>
    <rect x="55.8" y="69.8" width="6.8" height="7.4" rx="2.4" fill="#e2e0d9"/>
    <ellipse cx="56" cy="72.6" rx="1.5" ry="2.1" fill="#e2e0d9"/>
    <rect x="44.6" y="23.8" width="6.8" height="4.4" rx="1.6" fill="#6d7570"/>
    <path d="M48 9.5 c5.6 0 8.8 4.2 8.8 9.8 c0 3.6 -1.2 6.4 -3.2 8.1 c-1.6 1.35 -3.4 2.05 -5.6 2.05 s-4 -.7 -5.6 -2.05 c-2 -1.7 -3.2 -4.5 -3.2 -8.1 c0 -5.6 3.2 -9.8 8.8 -9.8 z" fill="url(#q1-armor)"/>
    <path d="M41.4 12.6 q4.2 -4 11.2 -3" stroke="#ffffff" stroke-width="1.4" fill="none" opacity="0.65" stroke-linecap="round"/>
    <path d="M42 14.2 q6 -3.4 12 0 l-.5 5.4 q-.9 2.8 -5.5 2.8 t-5.5 -2.8 z" fill="url(#q1-visor)" stroke="#d7dad4" stroke-width="0.9" stroke-opacity="0.7"/>
    <path d="M43.6 16.2 q4.6 -2.5 8.8 -.7" stroke="#bfe6df" stroke-width="1.5" fill="none" opacity="0.85" stroke-linecap="round"/>
    <rect x="37.6" y="15.5" width="2.4" height="4" rx="1.1" fill="#cfd2cc"/>
    <rect x="56" y="15.5" width="2.4" height="4" rx="1.1" fill="#cfd2cc"/>
  </svg>`,

  "photon-weave": `<svg viewBox="0 0 96 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="pw-halo" cx="0.5" cy="0.42" r="0.62">
        <stop offset="0" stop-color="#e4e6ea"/>
        <stop offset="1" stop-color="#f7f4ef" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="pw-armor" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#70767e"/>
        <stop offset="0.55" stop-color="#4a4f57"/>
        <stop offset="1" stop-color="#33373d"/>
      </linearGradient>
      <linearGradient id="pw-limb" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#5f656d"/>
        <stop offset="1" stop-color="#3f444b"/>
      </linearGradient>
      <linearGradient id="pw-visor" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#292640"/>
        <stop offset="1" stop-color="#0f0e18"/>
      </linearGradient>
    </defs>
    <ellipse cx="48" cy="54" rx="31" ry="39" fill="url(#pw-halo)"/>
    <ellipse cx="48" cy="125" rx="17" ry="2.6" fill="#121116" opacity="0.16"/>
    <path d="M43.4 31.5 q-1.6 -2.6 -3.4 -3.4" stroke="#2c2f35" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M52.6 31.5 q1.6 -2.6 3.4 -3.4" stroke="#2c2f35" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <rect x="39" y="30.5" width="18" height="13" rx="3" fill="#3b4046"/>
    <path d="M39.6 67 L47.4 67 L46.6 95.5 L40.4 95.5 Z" fill="url(#pw-limb)"/>
    <path d="M48.6 67 L56.4 67 L55.6 95.5 L49.4 95.5 Z" fill="url(#pw-limb)"/>
    <ellipse cx="44" cy="97.3" rx="3.8" ry="3" fill="#666c74"/>
    <ellipse cx="52" cy="97.3" rx="3.8" ry="3" fill="#666c74"/>
    <path d="M41.6 99.6 L46.4 99.6 L45.8 119 L42.2 119 Z" fill="url(#pw-limb)"/>
    <path d="M49.6 99.6 L54.4 99.6 L53.8 119 L50.2 119 Z" fill="url(#pw-limb)"/>
    <rect x="40.6" y="118.6" width="6.8" height="4.4" rx="1.3" fill="#4a4f57"/>
    <rect x="39.6" y="122.4" width="8.2" height="3" rx="1.3" fill="#22252a"/>
    <rect x="48.6" y="118.6" width="6.8" height="4.4" rx="1.3" fill="#4a4f57"/>
    <rect x="48.2" y="122.4" width="8.2" height="3" rx="1.3" fill="#22252a"/>
    <path d="M38.8 57.5 h18.4 l-1 8 q-1.3 4 -3.9 4 h-8.6 q-2.6 0 -3.9 -4 z" fill="url(#pw-armor)"/>
    <rect x="38.6" y="56.6" width="18.8" height="3.4" rx="1.4" fill="#2c2f35"/>
    <rect x="38.6" y="59.4" width="18.8" height="1" fill="#8b7ae0"/>
    <path d="M43.2 27.4 L36 30.6 q-1.6 .8 -1.5 2.7 l1 13.2 q.3 4.6 1.2 8.4 l.7 3 q.5 2.6 3.5 2.6 h15.8 q3 0 3.5 -2.6 l.7 -3 q.9 -3.8 1.2 -8.4 l1 -13.2 q.1 -1.9 -1.5 -2.7 L52.8 27.4 z" fill="url(#pw-armor)"/>
    <path d="M39.4 34.5 q4 -1.6 8 .4 M56.6 34.5 q-4 -1.6 -8 .4" stroke="#868c95" stroke-width="1.1" fill="none" opacity="0.55"/>
    <path d="M48 33.5 v21.5" stroke="#8b7ae0" stroke-width="1.3" opacity="0.9"/>
    <path d="M42.5 50.5 h11" stroke="#7b818a" stroke-width="0.9" fill="none"/>
    <ellipse cx="37.6" cy="33" rx="6" ry="6.2" fill="url(#pw-armor)"/>
    <ellipse cx="58.4" cy="33" rx="6" ry="6.2" fill="url(#pw-armor)"/>
    <rect x="32.8" y="35.4" width="7.6" height="17.5" rx="3.6" fill="url(#pw-limb)"/>
    <rect x="55.6" y="35.4" width="7.6" height="17.5" rx="3.6" fill="url(#pw-limb)"/>
    <rect x="33.2" y="51.4" width="6.8" height="7.6" rx="3.2" fill="url(#pw-limb)"/>
    <rect x="56" y="51.4" width="6.8" height="7.6" rx="3.2" fill="url(#pw-limb)"/>
    <rect x="33.6" y="57.8" width="6.4" height="11.6" rx="3" fill="url(#pw-limb)"/>
    <rect x="56" y="57.8" width="6.4" height="11.6" rx="3" fill="url(#pw-limb)"/>
    <rect x="33.7" y="68.6" width="6.2" height="1.6" rx="0.8" fill="#8b7ae0"/>
    <rect x="56.1" y="68.6" width="6.2" height="1.6" rx="0.8" fill="#8b7ae0"/>
    <rect x="33.4" y="69.8" width="6.8" height="7.4" rx="2.4" fill="#525861"/>
    <ellipse cx="40" cy="72.6" rx="1.5" ry="2.1" fill="#525861"/>
    <rect x="55.8" y="69.8" width="6.8" height="7.4" rx="2.4" fill="#525861"/>
    <ellipse cx="56" cy="72.6" rx="1.5" ry="2.1" fill="#525861"/>
    <rect x="44.6" y="23.8" width="6.8" height="4.4" rx="1.6" fill="#2c2f35"/>
    <path d="M48 9.5 c5.6 0 8.8 4.2 8.8 9.8 c0 3.6 -1.2 6.4 -3.2 8.1 c-1.6 1.35 -3.4 2.05 -5.6 2.05 s-4 -.7 -5.6 -2.05 c-2 -1.7 -3.2 -4.5 -3.2 -8.1 c0 -5.6 3.2 -9.8 8.8 -9.8 z" fill="url(#pw-armor)"/>
    <path d="M41.4 12.6 q4.2 -4 11.2 -3" stroke="#9aa0a8" stroke-width="1.4" fill="none" opacity="0.6" stroke-linecap="round"/>
    <path d="M42 14.2 q6 -3.4 12 0 l-.5 5.4 q-.9 2.8 -5.5 2.8 t-5.5 -2.8 z" fill="url(#pw-visor)" stroke="#7f858e" stroke-width="0.9" stroke-opacity="0.8"/>
    <path d="M43.6 16.2 q4.6 -2.5 8.8 -.7" stroke="#c3b7f5" stroke-width="1.5" fill="none" opacity="0.9" stroke-linecap="round"/>
    <rect x="37.6" y="15.5" width="2.4" height="4" rx="1.1" fill="#666c74"/>
    <rect x="56" y="15.5" width="2.4" height="4" rx="1.1" fill="#666c74"/>
  </svg>`,

  "singularity-mantle": `<svg viewBox="0 0 96 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="sm-halo" cx="0.5" cy="0.42" r="0.62">
        <stop offset="0" stop-color="#e3e5ea"/>
        <stop offset="1" stop-color="#f7f4ef" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="sm-armor" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#383b44"/>
        <stop offset="0.55" stop-color="#212329"/>
        <stop offset="1" stop-color="#14151a"/>
      </linearGradient>
      <linearGradient id="sm-limb" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#2f323a"/>
        <stop offset="1" stop-color="#1c1e24"/>
      </linearGradient>
      <linearGradient id="sm-visor" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#1a1e33"/>
        <stop offset="1" stop-color="#07080e"/>
      </linearGradient>
    </defs>
    <ellipse cx="48" cy="54" rx="31" ry="39" fill="url(#sm-halo)"/>
    <ellipse cx="48" cy="125" rx="17" ry="2.6" fill="#121116" opacity="0.18"/>
    <path d="M43.4 31.5 q-1.6 -2.6 -3.4 -3.4" stroke="#17181d" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M52.6 31.5 q1.6 -2.6 3.4 -3.4" stroke="#17181d" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <rect x="39" y="30.5" width="18" height="13" rx="3" fill="#1a1c22"/>
    <path d="M39.6 67 L47.4 67 L46.6 95.5 L40.4 95.5 Z" fill="url(#sm-limb)"/>
    <path d="M48.6 67 L56.4 67 L55.6 95.5 L49.4 95.5 Z" fill="url(#sm-limb)"/>
    <ellipse cx="44" cy="97.3" rx="3.8" ry="3" fill="#3f434c"/>
    <ellipse cx="52" cy="97.3" rx="3.8" ry="3" fill="#3f434c"/>
    <path d="M41.6 99.6 L46.4 99.6 L45.8 119 L42.2 119 Z" fill="url(#sm-limb)"/>
    <path d="M49.6 99.6 L54.4 99.6 L53.8 119 L50.2 119 Z" fill="url(#sm-limb)"/>
    <rect x="40.6" y="118.6" width="6.8" height="4.4" rx="1.3" fill="#26282f"/>
    <rect x="39.6" y="122.4" width="8.2" height="3" rx="1.3" fill="#101116"/>
    <rect x="48.6" y="118.6" width="6.8" height="4.4" rx="1.3" fill="#26282f"/>
    <rect x="48.2" y="122.4" width="8.2" height="3" rx="1.3" fill="#101116"/>
    <path d="M38.8 57.5 h18.4 l-1 8 q-1.3 4 -3.9 4 h-8.6 q-2.6 0 -3.9 -4 z" fill="url(#sm-armor)"/>
    <rect x="38.6" y="56.6" width="18.8" height="3.4" rx="1.4" fill="#17181d"/>
    <rect x="38.6" y="59.4" width="18.8" height="1" fill="#5b62c9"/>
    <path d="M43.2 27.4 L36 30.6 q-1.6 .8 -1.5 2.7 l1 13.2 q.3 4.6 1.2 8.4 l.7 3 q.5 2.6 3.5 2.6 h15.8 q3 0 3.5 -2.6 l.7 -3 q.9 -3.8 1.2 -8.4 l1 -13.2 q.1 -1.9 -1.5 -2.7 L52.8 27.4 z" fill="url(#sm-armor)"/>
    <path d="M39.4 34.5 q4 -1.6 8 .4 M56.6 34.5 q-4 -1.6 -8 .4" stroke="#565a64" stroke-width="1.1" fill="none" opacity="0.7"/>
    <rect x="46.9" y="36" width="2.2" height="9" rx="1.1" fill="#5b62c9"/>
    <circle cx="48" cy="45.2" r="1.7" fill="#4fd0e0"/>
    <path d="M42.5 50.5 h11" stroke="#4a4e58" stroke-width="0.9" fill="none"/>
    <ellipse cx="37.6" cy="33" rx="6" ry="6.2" fill="url(#sm-armor)"/>
    <ellipse cx="58.4" cy="33" rx="6" ry="6.2" fill="url(#sm-armor)"/>
    <rect x="32.8" y="35.4" width="7.6" height="17.5" rx="3.6" fill="url(#sm-limb)"/>
    <rect x="55.6" y="35.4" width="7.6" height="17.5" rx="3.6" fill="url(#sm-limb)"/>
    <rect x="33.2" y="51.4" width="6.8" height="7.6" rx="3.2" fill="url(#sm-limb)"/>
    <rect x="56" y="51.4" width="6.8" height="7.6" rx="3.2" fill="url(#sm-limb)"/>
    <rect x="33.6" y="57.8" width="6.4" height="11.6" rx="3" fill="url(#sm-limb)"/>
    <rect x="56" y="57.8" width="6.4" height="11.6" rx="3" fill="url(#sm-limb)"/>
    <rect x="33.7" y="68.6" width="6.2" height="1.6" rx="0.8" fill="#4fd0e0"/>
    <rect x="56.1" y="68.6" width="6.2" height="1.6" rx="0.8" fill="#4fd0e0"/>
    <rect x="33.4" y="69.8" width="6.8" height="7.4" rx="2.4" fill="#26282f"/>
    <ellipse cx="40" cy="72.6" rx="1.5" ry="2.1" fill="#26282f"/>
    <rect x="55.8" y="69.8" width="6.8" height="7.4" rx="2.4" fill="#26282f"/>
    <ellipse cx="56" cy="72.6" rx="1.5" ry="2.1" fill="#26282f"/>
    <rect x="44.6" y="23.8" width="6.8" height="4.4" rx="1.6" fill="#17181d"/>
    <path d="M48 9.5 c5.6 0 8.8 4.2 8.8 9.8 c0 3.6 -1.2 6.4 -3.2 8.1 c-1.6 1.35 -3.4 2.05 -5.6 2.05 s-4 -.7 -5.6 -2.05 c-2 -1.7 -3.2 -4.5 -3.2 -8.1 c0 -5.6 3.2 -9.8 8.8 -9.8 z" fill="url(#sm-armor)"/>
    <path d="M41.4 12.6 q4.2 -4 11.2 -3" stroke="#8f96a3" stroke-width="1.4" fill="none" opacity="0.55" stroke-linecap="round"/>
    <path d="M42 14.2 q6 -3.4 12 0 l-.5 5.4 q-.9 2.8 -5.5 2.8 t-5.5 -2.8 z" fill="url(#sm-visor)" stroke="#4a4e5c" stroke-width="0.9" stroke-opacity="0.9"/>
    <path d="M43.6 16.2 q4.6 -2.5 8.8 -.7" stroke="#7fe3ef" stroke-width="1.5" fill="none" opacity="0.9" stroke-linecap="round"/>
    <rect x="37.6" y="15.5" width="2.4" height="4" rx="1.1" fill="#3f4350"/>
    <rect x="56" y="15.5" width="2.4" height="4" rx="1.1" fill="#3f4350"/>
  </svg>`,
});

/* ------------------------------------------------------------------ copy */

const HEADLINE = "HERE BEGINS YOUR INTERSTELLAR JOURNEY";

/** Which suit's notice this visit has already shown, so a repaint cannot
    bring it back after the player has read it. One key per visit. */
let noticeDismissed = null;

/* ------------------------------------------------------------------ cards */

/** One tall portrait card: artwork, name, price line, and the press pinned
    at the bottom of the card. */
function suitCard(suit, { mine, money }) {
  const affordable = (money || 0) >= suit.price;
  return el("article", { class: "space-suit", "data-suit": suit.id }, [
    el("span", { class: "space-suit__art", html: SUIT_ART[suit.id] || "" }),
    el("h4", { class: "space-suit__name", text: suit.name }),
    el("p", { class: "space-suit__price" }, [
      el("b", { text: rupees(suit.price) }),
      el("span", { text: ` · ${suit.discount}% discount` }),
    ]),
    el("button", {
      type: "button",
      class: "chest-card__draw space-suit__buy",
      "data-action": "acquire",
      "data-suit": suit.id,
      disabled: !mine || !affordable,
      "aria-disabled": String(!mine || !affordable),
      text: affordable ? "Acquire suit" : "Insufficient funds",
    }),
  ]);
}

/** The counter: headline with the close X beside it, then the one row of
    three portrait cards. Nothing else - no subtitle, no exposition, no
    protocol list. */
function selectionContent(space, { mine, money }) {
  return [
    el("div", { class: "space-card__bar" }, [
      el("h3", { class: "space-card__headline", text: HEADLINE }),
      el("button", {
        type: "button",
        class: "space-card__close",
        "data-action": "continue",
        disabled: !mine,
        "aria-disabled": String(!mine),
        "aria-label": "Close",
        text: "\u00d7",
      }),
    ]),
    el("div", { class: "space-card__suits" }, SUITS.map((suit) => suitCard(suit, { mine, money }))),
  ];
}

/** The acquisition popup: the suit, its narrative, the one CTA. */
function acquiredContent(suit, { mine }) {
  const acquired = SUITS.find((entry) => entry.id === suit?.id) || suitById(suit?.id);
  if (!acquired) return [];
  return [
    el("div", { class: "space-popup" }, [
      el("span", { class: "space-popup__art", html: SUIT_ART[acquired.id] || "" }),
      el("h3", { class: "space-popup__title", text: acquired.acquiredTitle }),
      el("p", { class: "space-popup__text", text: acquired.acquiredText }),
      el("button", {
        type: "button",
        class: "chest-card__draw space-popup__cta",
        "data-action": "continue",
        disabled: !mine,
        "aria-disabled": String(!mine),
        text: "Continue journey",
      }),
    ]),
  ];
}

/** The expiry notice: local to this card; its CONTINUE only uncovers the counter. */
function noticeContent(onContinue) {
  const notice = el("div", { class: "space-popup space-popup--notice" }, [
    el("h3", { class: "space-popup__title", text: "Suit expired" }),
    el("p", {
      class: "space-popup__text",
      text: "Your suit's operational window has closed. New frontiers await.",
    }),
    el("button", {
      type: "button",
      class: "chest-card__draw space-popup__cta",
      "data-action": "notice-continue",
      text: "Continue",
    }),
  ]);
  notice.querySelector('[data-action="notice-continue"]').addEventListener("click", () => {
    onContinue();
  });
  return notice;
}

/* ------------------------------------------------------------------ stage */

/**
 * Draw the Outer Space screen from the state.
 *
 * Returns the card it built (so the board can wire the presses), or null
 * when there is nothing to show. The close X and the acquisition CTA both
 * carry `data-action="continue"`, which the board already wires to the
 * visit's own `continue` - a clean leave, no purchase, no state of its own.
 * The notice, when this visit has one and it has not been read, is what the
 * card opens with; its CONTINUE swaps the card's own contents to the
 * counter underneath, with nothing sent to the server.
 */
export function drawSpaceStage(board, space, { mine = false, money = 0 } = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder || !space) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "space";
  holder.dataset.property = "outer-space";
  board.dataset.property = "outer-space";

  const ctx = { mine, money };
  const card = el("article", { class: "space-card" });
  holder.append(card);
  /* EVERY STAGE UNSHIDES ITS OWN HOLDER. The holder is hidden between cards
     (and starts hidden), and a card appended into a hidden box is a card
     nobody can see - the board's stranded-turn rescue then reads "decision
     with no card" and walks the visit closed. */
  holder.hidden = false;

  const render = () => {
    if (space.phase === "acquired") {
      card.replaceChildren(...acquiredContent({ id: space.suit }, ctx));
      return;
    }
    card.replaceChildren(...selectionContent(space, ctx));
  };

  const noticeKey = `${space.playerId}:${space.startedAt || 0}`;
  const showNotice = Boolean(space.expiredNotice) && noticeDismissed !== noticeKey;
  if (showNotice) {
    card.replaceChildren(
      ...noticeContent(() => {
        noticeDismissed = noticeKey;
        render();
      }),
    );
  } else {
    render();
  }

  return card;
}
